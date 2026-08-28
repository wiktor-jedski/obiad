package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"obiad/backend/internal/repository"
	"obiad/backend/internal/transport"
)

// maxRequestBodyBytes limits substitute request bodies before decoding.
const maxRequestBodyBytes = 4096

// substitutesHandler decodes and serves substitute searches.
func substitutesHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		if len(c.Body()) > maxRequestBodyBytes {
			return writeError(c, fiber.StatusRequestEntityTooLarge, transport.REQUESTBODYTOOLARGE, nil, "request body exceeds the 4 KiB limit")
		}

		req, field, err := decodeSubstituteRequest(c)
		if err != nil {
			return writeError(c, fiber.StatusBadRequest, transport.INVALIDREQUEST, field, err.Error())
		}

		ctx, cancel := context.WithTimeout(c.Context(), requestDeadline)
		defer cancel()

		poolConn, err := pool.Acquire(ctx)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return writeError(c, fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil, err.Error())
			}
			return writeError(c, fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil, err.Error())
		}
		defer poolConn.Release()

		find, err := repository.NewFindSubstitutePage(poolConn.Conn())
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error())
		}

		page, err := find.Run(ctx, req.FoodObjectId, req.PageIndex)
		if err != nil {
			status, code, field, logCause := substituteRunError(err)
			return writeError(c, status, code, field, logCause)
		}
		return c.JSON(substituteResponse(page))
	}
}

// deadlineLogCause is used for expired request logs.
const deadlineLogCause = "request deadline expired while reading the catalog"

// safeSubstituteCause builds a log-safe client error description.
func safeSubstituteCause(description, field string) string {
	if field == "" {
		return description
	}
	return description + " (field " + field + ")"
}

// substituteRunError maps module errors to HTTP errors.
func substituteRunError(err error) (status int, code transport.ErrorCode, field *transport.ErrorField, logCause string) {
	if errors.Is(err, context.DeadlineExceeded) {
		return fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil, deadlineLogCause
	}
	var moduleErr *repository.Error
	if errors.As(err, &moduleErr) {
		switch moduleErr.Code {
		case repository.CodeInvalidRequest:
			return fiber.StatusBadRequest, transport.INVALIDREQUEST, fieldPathOf(moduleErr.Field), safeSubstituteCause("invalid substitute request", moduleErr.Field)
		case repository.CodeFoodObjectNotFound:
			return fiber.StatusNotFound, transport.FOODOBJECTNOTFOUND, fieldPathOf(moduleErr.Field), safeSubstituteCause("food object is absent from the catalog", moduleErr.Field)
		case repository.CodeInvalidPageIndex:
			return fiber.StatusUnprocessableEntity, transport.INVALIDPAGEINDEX, fieldPathOf(moduleErr.Field), safeSubstituteCause("page index is negative", moduleErr.Field)
		case repository.CodePageOutOfRange:
			return fiber.StatusUnprocessableEntity, transport.PAGEOUTOFRANGE, fieldPathOf(moduleErr.Field), safeSubstituteCause("page index is out of range", moduleErr.Field)
		case repository.CodeCatalogUnavailable:
			return fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil, err.Error()
		case repository.CodeInternalError:
			return fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error()
		}
	}
	return fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error()
}

// valueKind identifies an accepted JSON value type.
type valueKind int

const (
	kindObject valueKind = iota
	kindNumber
	kindString
)

// fieldSpec describes one request field.
type fieldSpec struct {
	key    string
	path   string
	kind   valueKind
	nested *objectSpec
}

// objectSpec describes a closed JSON object.
type objectSpec struct {
	fields []fieldSpec
}

// substituteRequestSpec defines the accepted request shape.
var substituteRequestSpec = &objectSpec{fields: []fieldSpec{
	{key: "foodObjectId", path: "foodObjectId", kind: kindNumber},
	{key: "pageIndex", path: "pageIndex", kind: kindNumber},
}}

// decodeSubstituteRequest strictly decodes one request object.
func decodeSubstituteRequest(c fiber.Ctx) (transport.SubstituteSearchRequest, *transport.ErrorField, error) {
	var req transport.SubstituteSearchRequest
	mediaType, _, err := mime.ParseMediaType(c.Get(fiber.HeaderContentType))
	if err != nil || mediaType != "application/json" {
		return req, nil, errors.New("Content-Type is not application/json")
	}

	body := c.Body()
	if len(body) == 0 {
		return req, nil, errors.New("request body is empty")
	}
	if !json.Valid(body) {
		return req, nil, errors.New("request body is not one valid JSON document")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	members, field, err := readStrictObject(dec, substituteRequestSpec)
	if err != nil {
		return req, field, err
	}

	req.FoodObjectId, err = strictInt32(members["foodObjectId"].(json.Number), "foodObjectId")
	if err != nil {
		return req, fieldPathOf("foodObjectId"), err
	}
	req.PageIndex, err = strictInt32(members["pageIndex"].(json.Number), "pageIndex")
	if err != nil {
		return req, fieldPathOf("pageIndex"), err
	}
	return req, nil, nil
}

// readStrictObject reads one closed JSON object.
func readStrictObject(dec *json.Decoder, spec *objectSpec) (map[string]any, *transport.ErrorField, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, nil, err
	}
	open, ok := tok.(json.Delim)
	if !ok || open != '{' {
		return nil, nil, errors.New("request body must be one JSON object")
	}
	return readStrictMembers(dec, spec)
}

// readStrictMembers reads all members of an object.
func readStrictMembers(dec *json.Decoder, spec *objectSpec) (map[string]any, *transport.ErrorField, error) {
	byKey := make(map[string]*fieldSpec, len(spec.fields))
	for i := range spec.fields {
		byKey[spec.fields[i].key] = &spec.fields[i]
	}
	seen := make(map[string]bool, len(spec.fields))
	members := make(map[string]any, len(spec.fields))
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, nil, err
		}
		if close, ok := tok.(json.Delim); ok && close == '}' {
			for i := range spec.fields {
				if !seen[spec.fields[i].key] {
					return nil, fieldPathOf(spec.fields[i].path), fmt.Errorf("required field %q is missing", spec.fields[i].key)
				}
			}
			return members, nil, nil
		}
		key, ok := tok.(string)
		if !ok {
			return nil, nil, errors.New("object member name is not a string")
		}
		field, known := byKey[key]
		if !known {
			return nil, nil, errors.New("request body contains an unknown field")
		}
		if seen[key] {
			return nil, fieldPathOf(field.path), fmt.Errorf("field %q is duplicated", key)
		}
		seen[key] = true
		value, valueField, err := readStrictValue(dec, field)
		if err != nil {
			return nil, valueField, err
		}
		members[key] = value
	}
}

// readStrictValue reads and validates one JSON value.
func readStrictValue(dec *json.Decoder, field *fieldSpec) (any, *transport.ErrorField, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, nil, err
	}
	switch v := tok.(type) {
	case json.Delim:
		switch v {
		case '{':
			if field.kind != kindObject {
				return nil, fieldPathOf(field.path), fmt.Errorf("field %q must be an object", field.key)
			}
			return readStrictMembers(dec, field.nested)
		case '[':
			return nil, fieldPathOf(field.path), fmt.Errorf("field %q must not be an array", field.key)
		default:
			return nil, nil, errors.New("unexpected closing delimiter in request body")
		}
	case nil:
		return nil, fieldPathOf(field.path), fmt.Errorf("field %q must not be null", field.key)
	case json.Number:
		if field.kind != kindNumber {
			return nil, fieldPathOf(field.path), fmt.Errorf("field %q must be a number", field.key)
		}
		return v, nil, nil
	case string:
		if field.kind != kindString {
			return nil, fieldPathOf(field.path), fmt.Errorf("field %q must be a string", field.key)
		}
		return v, nil, nil
	case bool:
		return nil, fieldPathOf(field.path), fmt.Errorf("field %q must not be a boolean", field.key)
	}
	return nil, nil, errors.New("unexpected JSON value")
}

// fieldPathOf returns a transport error field pointer.
func fieldPathOf(path string) *transport.ErrorField {
	field := transport.ErrorField(path)
	return &field
}

// strictInt32 parses one request integer.
func strictInt32(number json.Number, field string) (int32, error) {
	v, err := strconv.ParseInt(number.String(), 10, 32)
	if err != nil {
		return 0, fmt.Errorf("field %s is not a valid int32", field)
	}
	return int32(v), nil
}

// substituteResponse maps a page to transport values.
func substituteResponse(page *repository.Page) transport.SubstituteSearchResponse {
	items := make([]transport.SubstituteItem, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, transport.SubstituteItem{
			FoodObjectId: item.FoodObjectID,
			Names: transport.LocalizedNames{
				En: item.Names.En,
				Pl: item.Names.Pl,
			},
			ImageKey: item.ImageKey,
			MacroProfile: transport.MacroProfile{
				Protein:      item.MacroProfile.Protein,
				Carbohydrate: item.MacroProfile.Carbohydrate,
				Fat:          item.MacroProfile.Fat,
			},
			BaseUnit:          transport.SubstituteItemBaseUnit(item.BaseUnit),
			Serving:           item.Serving,
			SimilarityPercent: item.SimilarityPercent,
		})
	}
	return transport.SubstituteSearchResponse{
		PageIndex:          page.PageIndex,
		TotalEligibleCount: int32(page.TotalEligibleCount),
		HasMore:            page.HasMore,
		SelectedFood: transport.SelectedFood{
			FoodObjectId: page.SelectedFood.FoodObjectID,
			Names: transport.LocalizedNames{
				En: page.SelectedFood.Names.En,
				Pl: page.SelectedFood.Names.Pl,
			},
			MacroProfile: transport.MacroProfile{
				Protein:      page.SelectedFood.MacroProfile.Protein,
				Carbohydrate: page.SelectedFood.MacroProfile.Carbohydrate,
				Fat:          page.SelectedFood.MacroProfile.Fat,
			},
			BaseUnit: transport.SelectedFoodBaseUnit(page.SelectedFood.BaseUnit),
			Serving:  page.SelectedFood.Serving,
		},
		Items: items,
	}
}
