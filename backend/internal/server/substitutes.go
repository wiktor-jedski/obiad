// Package-level file for the Fiber Adapter of the versioned
// POST /api/v1/substitutes/search route (task 19; ARCH-005, ARCH-008,
// ARCH-016, ARCH-019, ARCH-022). The adapter accepts only the
// application/json Content-Type, strictly decodes one closed generated
// SubstituteSearchRequest object at the HTTP boundary — rejecting empty,
// malformed, or trailing JSON, unknown keys, and duplicate keys at every
// nesting level — maps the valid generated values to the concrete Find
// Substitute Page domain input, calls the concrete Run operation, and
// serializes the exact generated page-0 SubstituteSearchResponse envelope
// with omitted-not-null optional image keys. Generated transport values
// never enter the Module, and Module domain values never reach the wire
// un-mapped (ISSUE-005).
//
// Task-19 scope boundary: the 4 KiB request-body limit, the 450 ms request
// deadline, and the stable ISSUE-005 mapping of Module failures (404
// FOOD_OBJECT_NOT_FOUND, the 422 semantic quantity, unit, Serving, range,
// and page codes, 503 CATALOG_UNAVAILABLE, 504 SEARCH_TIMEOUT) are owned
// by task 20. Until then every failure the strict decoder does not already
// classify is answered with the generic 500 INTERNAL_ERROR fallback and
// the sanitized internal cause reaches only the request log (ARCH-019).

package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"obiad/backend/internal/repository"
	"obiad/backend/internal/transport"
)

// substitutesHandler returns the Fiber handler for the versioned
// POST /api/v1/substitutes/search route (ARCH-008). It enforces the
// application/json Content-Type, strictly decodes one closed generated
// request object (ISSUE-005: empty, malformed, or trailing JSON, unknown
// keys, and duplicate keys at every nesting level are rejected; a missing,
// duplicate, null, or wrong-typed known field carries its ISSUE-005 field
// path), maps the valid generated values to the concrete Find Substitute
// Page domain input, calls the concrete Run operation, and serializes the
// exact generated page-0 envelope with omitted-not-null optional image
// keys. Generated transport values never enter the Module (ARCH-008).
func substitutesHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		req, field, err := decodeSubstituteRequest(c)
		if err != nil {
			// A missing or non-JSON Content-Type, empty, malformed, or
			// trailing JSON, and an unknown key return 400 INVALID_REQUEST
			// without a field; a missing, duplicate, null, or wrong-typed
			// known field returns 400 INVALID_REQUEST with its ISSUE-005
			// field path.
			return writeError(c, fiber.StatusBadRequest, transport.INVALIDREQUEST, field, err)
		}

		// The concrete Find Substitute Page operation (ARCH-005) runs over
		// one request-local catalog snapshot read through the SELECT-only
		// runtime pool (ARCH-016). The task-20 request control derives the
		// 450 ms deadline here; the Fiber request context already bounds
		// the read for now.
		poolConn, err := pool.Acquire(c.Context())
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err)
		}
		defer poolConn.Release()

		find, err := repository.NewFindSubstitutePage(poolConn.Conn())
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err)
		}

		page, err := find.Run(c.Context(), repository.SubstituteInput{
			FoodObjectID: req.FoodObjectId,
			Quantity: repository.FoodQuantity{
				Value: req.Quantity.Value,
				Unit:  repository.Unit(req.Quantity.Unit),
			},
		}, req.PageIndex)
		if err != nil {
			// Task 20 owns the stable ISSUE-005 mapping of Module failures
			// (404 FOOD_OBJECT_NOT_FOUND, the 422 semantic codes, 503
			// CATALOG_UNAVAILABLE, 504 SEARCH_TIMEOUT). Until then every
			// Module failure falls back to the generic 500 INTERNAL_ERROR
			// and the sanitized internal cause reaches only the request
			// log (ARCH-019).
			return writeError(c, fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err)
		}
		return c.JSON(substituteResponse(page))
	}
}

// valueKind enumerates the JSON value kinds the strict request decoder
// accepts for one field of the closed request object.
type valueKind int

const (
	kindObject valueKind = iota
	kindNumber
	kindString
)

// fieldSpec describes one required field of a closed request object at one
// nesting level: the JSON key, the ISSUE-005 error field path carried by a
// missing, duplicate, null, or wrong-typed known value, the accepted JSON
// kind, and the nested closed-object spec for kindObject fields.
type fieldSpec struct {
	key    string
	path   string
	kind   valueKind
	nested *objectSpec
}

// objectSpec is the closed-object schema of one request nesting level.
type objectSpec struct {
	fields []fieldSpec
}

// substituteRequestSpec is the ISSUE-005 closed substitute search request
// schema: the root requires foodObjectId (number), quantity (object), and
// pageIndex (number); the quantity object requires value (number) and unit
// (string). The generated shape does not encode the semantic quantity,
// unit, Physical State, and Serving rules — the Module enforces those
// (ISSUE-005).
var substituteRequestSpec = &objectSpec{fields: []fieldSpec{
	{key: "foodObjectId", path: "foodObjectId", kind: kindNumber},
	{key: "quantity", path: "quantity", kind: kindObject, nested: &objectSpec{fields: []fieldSpec{
		{key: "value", path: "quantity.value", kind: kindNumber},
		{key: "unit", path: "quantity.unit", kind: kindString},
	}}},
	{key: "pageIndex", path: "pageIndex", kind: kindNumber},
}}

// decodeSubstituteRequest strictly decodes one closed generated
// SubstituteSearchRequest object from the raw request at the HTTP boundary
// (task 19; ISSUE-005). It enforces the application/json Content-Type and
// rejects empty, malformed, or trailing JSON and unknown keys without a
// field, and a missing, duplicate, null, or wrong-typed known field with
// its ISSUE-005 field path. The returned field is nil for structural
// failures; err describes the sanitizable internal cause for the request
// log and never reaches a response.
func decodeSubstituteRequest(c fiber.Ctx) (transport.SubstituteSearchRequest, *transport.ErrorField, error) {
	var req transport.SubstituteSearchRequest
	mediaType, _, err := mime.ParseMediaType(c.Get(fiber.HeaderContentType))
	if err != nil || mediaType != "application/json" {
		return req, nil, fmt.Errorf("Content-Type %q is not application/json", c.Get(fiber.HeaderContentType))
	}

	body := c.Body()
	if len(body) == 0 {
		return req, nil, errors.New("request body is empty")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	members, field, err := readStrictObject(dec, substituteRequestSpec)
	if err != nil {
		return req, field, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		// A second JSON value or any non-whitespace byte after the request
		// object is trailing JSON (ISSUE-005), rejected without a field.
		return req, nil, errors.New("trailing JSON after the request object")
	}

	quantity := members["quantity"].(map[string]any)
	req.FoodObjectId, err = strictInt32(members["foodObjectId"].(json.Number), "foodObjectId")
	if err != nil {
		return req, fieldPathOf("foodObjectId"), err
	}
	req.PageIndex, err = strictInt32(members["pageIndex"].(json.Number), "pageIndex")
	if err != nil {
		return req, fieldPathOf("pageIndex"), err
	}
	req.Quantity.Value, err = strictFloat64(quantity["value"].(json.Number), "quantity.value")
	if err != nil {
		return req, fieldPathOf("quantity.value"), err
	}
	req.Quantity.Unit = transport.SubstitutionQuantityUnit(quantity["unit"].(string))
	return req, nil, nil
}

// readStrictObject reads one JSON object from dec — the opening '{', every
// member, and the closing '}' — and enforces the closed-object contract of
// spec: every key must be known, no key may repeat, every required field
// must be present, and every value must have the field's accepted kind. It
// returns the parsed members (json.Number, string, or a nested
// map[string]any) and the ISSUE-005 field path of the first known-field
// violation; an unknown key, a malformed value, and a non-object top level
// carry no field.
func readStrictObject(dec *json.Decoder, spec *objectSpec) (map[string]any, *transport.ErrorField, error) {
	tok, err := dec.Token()
	if err != nil {
		// io.EOF is an empty body and *json.SyntaxError a malformed one;
		// both are structural failures without a field.
		return nil, nil, err
	}
	open, ok := tok.(json.Delim)
	if !ok || open != '{' {
		return nil, nil, errors.New("request body must be one JSON object")
	}
	return readStrictMembers(dec, spec)
}

// readStrictMembers reads the members of an object whose opening '{' was
// already consumed, up to and including the closing '}'.
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
			// An unknown key is a closed-object violation without a field
			// (ISSUE-005).
			return nil, nil, fmt.Errorf("unknown field %q", key)
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

// readStrictValue reads one JSON value and enforces the accepted kind of
// field. A null or wrong-typed known field carries the field's ISSUE-005
// path; a structurally broken value (a premature closing delimiter) is
// malformed JSON and carries no field.
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
		default: // '}' or ']': a value cannot be a closing delimiter.
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
	return nil, nil, errors.New("unexpected JSON value") // unreachable
}

// fieldPathOf returns a pointer to the ISSUE-005 error field path of one
// known request field.
func fieldPathOf(path string) *transport.ErrorField {
	field := transport.ErrorField(path)
	return &field
}

// strictInt32 converts a validated JSON number token to the int32 of one
// generated request field, rejecting non-integral values and values outside
// the int32 range with the field's ISSUE-005 path (a generated int32 decode
// failure).
func strictInt32(number json.Number, field string) (int32, error) {
	v, err := strconv.ParseInt(number.String(), 10, 32)
	if err != nil {
		return 0, fmt.Errorf("field %q value %s is not an int32", field, number)
	}
	return int32(v), nil
}

// strictFloat64 converts a validated JSON number token to the float64 of
// one generated request field, rejecting values that do not fit the double
// range with the field's ISSUE-005 path (a generated double decode
// failure).
func strictFloat64(number json.Number, field string) (float64, error) {
	v, err := strconv.ParseFloat(number.String(), 64)
	if err != nil {
		return 0, fmt.Errorf("field %q value %s is not a finite double", field, number)
	}
	return v, nil
}

// substituteResponse maps the domain page returned by the Find Substitute
// Page Module to the generated OpenAPI response envelope at the HTTP
// boundary (ARCH-008, ISSUE-005): the echoed page index, the total eligible
// count, hasMore, and zero to three items, each with the stable positive
// Food Object ID, both required localized names, the optional image key
// (omitted when the Food Object has no image, never null), the whole
// Matched Quantity in the candidate base unit, the scaled macronutrients,
// and the whole similarity percentage, and no unknown fields.
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
			MatchedQuantity: transport.MatchedQuantity{
				Value: item.MatchedQuantity.Value,
				Unit:  transport.MatchedQuantityUnit(item.MatchedQuantity.Unit),
			},
			Macronutrients: transport.Macronutrients{
				Protein:      item.Protein,
				Carbohydrate: item.Carbohydrate,
				Fat:          item.Fat,
			},
			SimilarityPercent: item.SimilarityPercent,
		})
	}
	return transport.SubstituteSearchResponse{
		PageIndex:          page.PageIndex,
		TotalEligibleCount: int32(page.TotalEligibleCount),
		HasMore:            page.HasMore,
		Items:              items,
	}
}
