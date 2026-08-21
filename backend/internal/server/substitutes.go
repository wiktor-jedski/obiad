// Package-level file for the Fiber Adapter of the versioned
// POST /api/v1/substitutes/search route (tasks 19 and 20; ARCH-005,
// ARCH-008, ARCH-016, ARCH-019, ARCH-022). The adapter enforces the
// 4 KiB request-body limit, accepts only the application/json
// Content-Type, strictly decodes one closed generated
// SubstituteSearchRequest object at the HTTP boundary — rejecting empty,
// malformed, or trailing JSON, unknown keys, and duplicate keys at every
// nesting level — derives one 450 ms request context (ARCH-019) and passes
// it through pool Acquire and the concrete Find Substitute Page Run
// operation to pgx, maps every failure to the ISSUE-005-resolved stable
// HTTP status, code, and optional field, and serializes the exact
// generated page-0 SubstituteSearchResponse envelope with omitted-not-null
// optional image keys. Generated transport values never enter the Module,
// and Module domain values never reach the wire un-mapped (ISSUE-005).

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

// maxRequestBodyBytes is the request-body limit of POST
// /api/v1/substitutes/search (ARCH-008, ISSUE-005): a body over 4 KiB
// (4096 bytes) is rejected with the stable 413 REQUEST_BODY_TOO_LARGE
// response without a field, and a body of exactly 4 KiB is accepted. The
// limit is enforced as a pre-read ingress cap through the fasthttp
// HeaderReceived hook in Compose, so an oversized body is rejected while
// the request is read, before any handler runs and before the body is
// buffered. This constant is the single source of the 4 KiB value for both
// the ingress cap and the handler-level backstop below.
const maxRequestBodyBytes = 4096

// substitutesHandler returns the Fiber handler for the versioned
// POST /api/v1/substitutes/search route (ARCH-008). It enforces the 4 KiB
// request-body limit (413 REQUEST_BODY_TOO_LARGE without a field before any
// body processing), accepts only the application/json Content-Type,
// strictly decodes one closed generated request object (ISSUE-005: empty,
// malformed, or trailing JSON, unknown keys, and duplicate keys at every
// nesting level are rejected; a missing, duplicate, null, or wrong-typed
// known field carries its ISSUE-005 field path), derives one 450 ms request
// context (ARCH-019) and passes it through pool Acquire and the concrete
// Find Substitute Page Run operation to pgx, maps every failure to the
// ISSUE-005-resolved stable status, code, and optional field, and
// serializes the exact generated page-0 envelope with omitted-not-null
// optional image keys. Generated transport values never enter the Module
// (ARCH-008).
func substitutesHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// The 4 KiB request-body limit is enforced pre-read by the fasthttp
		// HeaderReceived ingress cap in Compose, so a body over 4096 bytes
		// is rejected before this handler runs. This byte check is the
		// handler-level backstop: if the ingress cap ever did not apply, the
		// request still fails with the exact stable 413 REQUEST_BODY_TOO_LARGE
		// response, without a field, before any JSON processing (ARCH-008,
		// ISSUE-005).
		if len(c.Body()) > maxRequestBodyBytes {
			return writeError(c, fiber.StatusRequestEntityTooLarge, transport.REQUESTBODYTOOLARGE, nil, "request body exceeds the 4 KiB limit")
		}

		req, field, err := decodeSubstituteRequest(c)
		if err != nil {
			// A missing or non-JSON Content-Type, empty, malformed, or
			// trailing JSON, and an unknown key return 400 INVALID_REQUEST
			// without a field; a missing, duplicate, null, or wrong-typed
			// known field returns 400 INVALID_REQUEST with its ISSUE-005
			// field path.
			return writeError(c, fiber.StatusBadRequest, transport.INVALIDREQUEST, field, err.Error())
		}

		// ARCH-019: one 450 ms context bounds the whole substitute request —
		// pool Acquire, Find Substitute Page Run, and the pgx catalog read.
		// No retry occurs anywhere in the chain; when the deadline fires,
		// the context cancels pgx and the request fails with the stable
		// SEARCH_TIMEOUT code (ISSUE-005).
		ctx, cancel := context.WithTimeout(c.Context(), requestDeadline)
		defer cancel()

		poolConn, err := pool.Acquire(ctx)
		if err != nil {
			// Acquire blocks while the four-connection pool is exhausted and
			// fails when no connection can serve the read (ARCH-016). A
			// deadline expiry is SEARCH_TIMEOUT; every other acquire failure
			// means the catalog storage is unavailable (ISSUE-005).
			if errors.Is(err, context.DeadlineExceeded) {
				return writeError(c, fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil, err.Error())
			}
			return writeError(c, fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil, err.Error())
		}
		defer poolConn.Release()

		find, err := repository.NewFindSubstitutePage(poolConn.Conn())
		if err != nil {
			// The embedded catalog SELECT cannot be read: an unexpected
			// internal failure, never a client error.
			return writeError(c, fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error())
		}

		page, err := find.Run(ctx, repository.SubstituteInput{
			FoodObjectID: req.FoodObjectId,
			Quantity: repository.FoodQuantity{
				Value: req.Quantity.Value,
				Unit:  repository.Unit(req.Quantity.Unit),
			},
		}, req.PageIndex)
		if err != nil {
			status, code, field, logCause := substituteRunError(err)
			return writeError(c, status, code, field, logCause)
		}
		return c.JSON(substituteResponse(page))
	}
}

// deadlineLogCause is the fixed internal cause text of a substitute request
// whose 450 ms deadline expired while reading the catalog (ARCH-019). The
// fixed text keeps the request log free of any pgx or query detail.
const deadlineLogCause = "request deadline expired while reading the catalog"

// safeSubstituteCause returns the stable internal cause text of one
// substitute client failure: a fixed description and the fixed ISSUE-005
// field path. It never contains client values (Food Quantities, units,
// Food Object IDs, page indexes) or request body text (ARCH-019,
// golang-security logging guidance).
func safeSubstituteCause(description, field string) string {
	if field == "" {
		return description
	}
	return description + " (field " + field + ")"
}

// substituteRunError maps one Find Substitute Page Module failure to the
// ISSUE-005-resolved stable HTTP status, code, optional field, and the safe
// internal cause text for the request log. Deadline expiry (the 450 ms
// request context reached pgx) is SEARCH_TIMEOUT no matter how the failure
// surfaces from the Module. Client failures derive the log cause only from
// the stable code and the fixed ISSUE-005 field path: the Module cause text
// contains the client Food Quantity values, units, Food Object IDs, and
// page indexes, which must never reach the log (ARCH-019). Server failures
// (storage, invariant, unexpected) keep the server-generated pgx or
// catalog-invariant cause, which contains no client input. Client failures
// carry their field; server failures carry none and expose no internal
// cause in the response.
func substituteRunError(err error) (status int, code transport.ErrorCode, field *transport.ErrorField, logCause string) {
	if errors.Is(err, context.DeadlineExceeded) {
		return fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil, deadlineLogCause
	}
	var moduleErr *repository.Error
	if errors.As(err, &moduleErr) {
		switch moduleErr.Code {
		case repository.CodeInvalidRequest:
			// A nonpositive Food Object ID (ISSUE-005: 400 INVALID_REQUEST
			// with field foodObjectId). The strict decoder already
			// classifies every structural foodObjectId failure.
			return fiber.StatusBadRequest, transport.INVALIDREQUEST, fieldPathOf(moduleErr.Field), safeSubstituteCause("invalid substitute request", moduleErr.Field)
		case repository.CodeFoodObjectNotFound:
			return fiber.StatusNotFound, transport.FOODOBJECTNOTFOUND, fieldPathOf(moduleErr.Field), safeSubstituteCause("food object is absent from the catalog", moduleErr.Field)
		case repository.CodeInvalidQuantity:
			// The Module reports the exact ISSUE-005 field: quantity.value
			// for a nonpositive or nonintegral direct value or a
			// nonpositive Serving count, quantity.unit for an unsupported
			// unit.
			return fiber.StatusUnprocessableEntity, transport.INVALIDQUANTITY, fieldPathOf(moduleErr.Field), safeSubstituteCause("invalid substitute quantity", moduleErr.Field)
		case repository.CodeQuantityUnitMismatch:
			return fiber.StatusUnprocessableEntity, transport.QUANTITYUNITMISMATCH, fieldPathOf(moduleErr.Field), safeSubstituteCause("quantity unit does not match the food object physical state", moduleErr.Field)
		case repository.CodeServingUnavailable:
			return fiber.StatusUnprocessableEntity, transport.SERVINGUNAVAILABLE, fieldPathOf(moduleErr.Field), safeSubstituteCause("food object has no stored serving", moduleErr.Field)
		case repository.CodeQuantityOutOfRange:
			return fiber.StatusUnprocessableEntity, transport.QUANTITYOUTOFRANGE, fieldPathOf(moduleErr.Field), safeSubstituteCause("converted quantity exceeds the base-unit limit", moduleErr.Field)
		case repository.CodeInvalidPageIndex:
			return fiber.StatusUnprocessableEntity, transport.INVALIDPAGEINDEX, fieldPathOf(moduleErr.Field), safeSubstituteCause("page index is negative", moduleErr.Field)
		case repository.CodePageOutOfRange:
			return fiber.StatusUnprocessableEntity, transport.PAGEOUTOFRANGE, fieldPathOf(moduleErr.Field), safeSubstituteCause("page index is out of range: only page 0 exists until Phase 11", moduleErr.Field)
		case repository.CodeCatalogUnavailable:
			return fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil, err.Error()
		case repository.CodeInternalError:
			return fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error()
		}
	}
	return fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error()
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
//
// Syntax precedence (task-19 repair): the complete body must first be one
// valid JSON document (json.Valid) before any known-field classification.
// A truncated or malformed document is rejected without a field no matter
// what a partial token walk would have classified — {"foodObjectId":true
// and {"foodObjectId":[] are malformed, not wrong-typed-field failures.
// Only a syntactically complete document reaches the strict object walk,
// where a wrong-typed or null known field carries its exact field path.
func decodeSubstituteRequest(c fiber.Ctx) (transport.SubstituteSearchRequest, *transport.ErrorField, error) {
	var req transport.SubstituteSearchRequest
	mediaType, _, err := mime.ParseMediaType(c.Get(fiber.HeaderContentType))
	if err != nil || mediaType != "application/json" {
		// The cause is fixed text: the client-supplied Content-Type header
		// value never reaches the request log (ARCH-019).
		return req, nil, errors.New("Content-Type is not application/json")
	}

	body := c.Body()
	if len(body) == 0 {
		return req, nil, errors.New("request body is empty")
	}
	// The body must be exactly one syntactically complete JSON document:
	// json.Valid rejects truncated, malformed, and trailing JSON, and a
	// top-level value that is not the closed request object is rejected by
	// readStrictObject — both without a field (ISSUE-005). The gate makes
	// every wrong-type or null token the walk sees afterwards belong to a
	// complete document, so its field path is exact.
	if !json.Valid(body) {
		return req, nil, errors.New("request body is not one valid JSON document")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	members, field, err := readStrictObject(dec, substituteRequestSpec)
	if err != nil {
		return req, field, err
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
			// (ISSUE-005). The cause is fixed text: the client-supplied key
			// name never reaches the request log (ARCH-019).
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

// readStrictValue reads one JSON value and enforces the accepted kind of
// field. The caller has already proven the whole body is one valid JSON
// document (decodeSubstituteRequest), so every token here belongs to a
// syntactically complete value: a null or wrong-typed known field carries
// the field's exact ISSUE-005 path. The premature-closing-delimiter branch
// is unreachable after that gate and stays malformed without a field as a
// defensive boundary.
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
// failure). The cause names only the fixed known field: the client-supplied
// numeric token never reaches the request log (ARCH-019).
func strictInt32(number json.Number, field string) (int32, error) {
	v, err := strconv.ParseInt(number.String(), 10, 32)
	if err != nil {
		return 0, fmt.Errorf("field %s is not a valid int32", field)
	}
	return int32(v), nil
}

// strictFloat64 converts a validated JSON number token to the float64 of
// one generated request field, rejecting values that do not fit the double
// range with the field's ISSUE-005 path (a generated double decode
// failure). The cause names only the fixed known field: the client-supplied
// numeric token never reaches the request log (ARCH-019).
func strictFloat64(number json.Number, field string) (float64, error) {
	v, err := strconv.ParseFloat(number.String(), 64)
	if err != nil {
		return 0, fmt.Errorf("field %s is not a valid double", field)
	}
	return v, nil
}

// substituteResponse maps the domain page returned by the Find Substitute
// Page Module to the generated OpenAPI response envelope at the HTTP
// boundary (ARCH-008, ISSUE-005, ISSUE-010): the echoed page index, the
// total eligible count, hasMore, the input macronutrients at the committed
// quantity, and zero to three items, each with the stable positive Food
// Object ID, both required localized names, the optional image key (omitted
// when the Food Object has no image, never null), the whole Matched
// Quantity in the candidate base unit, the scaled macronutrients, and the
// whole similarity percentage, and no unknown fields.
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
		InputMacronutrients: transport.Macronutrients{
			Protein:      page.InputMacronutrients.Protein,
			Carbohydrate: page.InputMacronutrients.Carbohydrate,
			Fat:          page.InputMacronutrients.Fat,
		},
		Items: items,
	}
}
