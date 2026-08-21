// Package-level file for the Fiber Adapter of the versioned
// GET /api/v1/food-suggestions route (tasks 13 and 14; ARCH-004, ARCH-008,
// ARCH-017, ARCH-019, ARCH-022). The adapter maps the generated transport
// query and response values only at the HTTP boundary: it reads the raw
// query string parameters into the generated GetFoodSuggestionsParams,
// enforces the ISSUE-004 parameter contract, derives the 450 ms request
// context (ARCH-019) and passes it through pool Acquire and the concrete
// Suggest Food Objects Run operation to pgx, maps every failure to the
// ISSUE-004-resolved stable HTTP status, code, and optional field, and
// serializes the returned domain suggestions through the generated
// FoodSuggestionsResponse envelope. Generated transport values never enter
// the Module, and Module domain values never reach the wire un-mapped
// (ISSUE-004).

package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"obiad/backend/internal/repository"
	"obiad/backend/internal/transport"
)

// codeInvalidRequest is the stable code of a malformed request: a missing or
// duplicated required parameter (with the offending field) or malformed
// query encoding (without a field) (ISSUE-004). It is a transport-level
// code, so it lives here rather than in the Module.
const codeInvalidRequest = "INVALID_REQUEST"

// suggestionsHandler returns the Fiber handler for the versioned
// GET /api/v1/food-suggestions route (ARCH-008). It maps the raw HTTP query
// string parameters into the generated transport query type at the HTTP
// boundary, enforces the ISSUE-004 parameter contract (exactly one query and
// one language parameter; a missing or duplicated parameter returns
// 400 INVALID_REQUEST with the offending field), derives one 450 ms request
// context (ARCH-019) and passes it through pool Acquire and the concrete
// Suggest Food Objects Run operation to pgx (one fresh embedded SELECT per
// request, no runtime cache, no retry), maps every failure to the
// ISSUE-004-resolved stable status, code, and optional field, and serializes
// the exact five-item success envelope with stable Food Object IDs, both
// localized names, and backend-derived default Food Quantities.
func suggestionsHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		params, field, err := readSuggestionParams(c)
		if err != nil {
			// Malformed query encoding (an invalid or incomplete percent
			// escape) returns 400 INVALID_REQUEST without a field; a missing
			// or duplicated required parameter returns 400 INVALID_REQUEST
			// with the offending field (ISSUE-004). Requests whose request
			// line fasthttp itself cannot parse (for example a control byte
			// in the request-target) never reach this handler: the app error
			// handler answers 400 INVALID_REQUEST without a field.
			return writeError(c, fiber.StatusBadRequest, transport.INVALIDREQUEST, field, err.Error())
		}

		// ARCH-019: one 450 ms context bounds the whole suggestion request —
		// pool Acquire, Suggest.Run, and the pgx catalog read. No retry
		// occurs anywhere in the chain; when the deadline fires, the context
		// cancels pgx and the request fails with the stable SEARCH_TIMEOUT.
		ctx, cancel := context.WithTimeout(c.Context(), requestDeadline)
		defer cancel()

		poolConn, err := pool.Acquire(ctx)
		if err != nil {
			// Acquire blocks while the four-connection pool is exhausted and
			// fails when no connection can serve the read (ARCH-016). A
			// deadline expiry is SEARCH_TIMEOUT; every other acquire failure
			// means the catalog storage is unavailable (ISSUE-004).
			if errors.Is(err, context.DeadlineExceeded) {
				return writeError(c, fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil, err.Error())
			}
			return writeError(c, fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil, err.Error())
		}
		defer poolConn.Release()

		suggest, err := repository.NewSuggest(poolConn.Conn())
		if err != nil {
			// The embedded catalog SELECT cannot be read: an unexpected
			// internal failure, never a client error.
			return writeError(c, fiber.StatusInternalServerError, transport.INTERNALERROR, nil, err.Error())
		}

		suggestions, err := suggest.Run(ctx, params.Query, repository.Language(params.Language))
		if err != nil {
			status, code, field := suggestionRunError(err)
			return writeError(c, status, code, field, err.Error())
		}
		return c.JSON(suggestionsResponse(suggestions))
	}
}

// readSuggestionParams reads the generated transport query values from the
// raw query string at the HTTP boundary (ARCH-008) and enforces the
// ISSUE-004 parameter contract: the raw query encoding must be well-formed,
// and exactly one query parameter and exactly one language parameter must be
// present. A malformed encoding (an invalid or incomplete percent escape
// such as %ZZ or %0) is rejected with 400 INVALID_REQUEST without a field
// before any decoding; a missing or duplicated parameter is rejected with
// the offending field. Presence and cardinality are checked on the raw
// fasthttp query arguments so a present-but-empty value ("?query=") is not
// mistaken for a missing parameter: it reaches the Module and fails
// normalization as INVALID_SEARCH_QUERY, exactly as ISSUE-004 resolves.
func readSuggestionParams(c fiber.Ctx) (params transport.GetFoodSuggestionsParams, field *transport.ErrorField, err error) {
	// fasthttp's query decoder is permissive: it keeps an invalid escape
	// (e.g. %ZZ) or an incomplete one (e.g. %0, a trailing %) as literal
	// text, so the raw encoding must be validated before any decoding,
	// otherwise malformed query encoding would reach the Module as ordinary
	// query text. The raw query string is exactly the bytes after '?' in the
	// request-target, untouched by decoding.
	if err := validateQueryEncoding(c.RequestCtx().URI().QueryString()); err != nil {
		return params, nil, err
	}
	args := c.RequestCtx().QueryArgs()
	for _, name := range []transport.ErrorField{transport.Query, transport.Language} {
		key := string(name)
		if !args.Has(key) {
			return params, &name, fmt.Errorf("required parameter %q is missing", key)
		}
		if len(args.PeekMulti(key)) > 1 {
			return params, &name, fmt.Errorf("required parameter %q is duplicated", key)
		}
	}
	params.Query = string(args.Peek("query"))
	params.Language = transport.GetFoodSuggestionsParamsLanguage(args.Peek("language"))
	return params, nil, nil
}

// validateQueryEncoding rejects every invalid or incomplete percent escape in
// a raw query string. A valid escape is '%' followed by exactly two
// hexadecimal digits; anything else — a '%' at the end, a '%' followed by one
// character, or a '%' followed by a non-hexadecimal digit ('%ZZ', '%0G') —
// makes the query encoding malformed. The error describes the byte offset
// only, so the internal cause never echoes query text into the log.
func validateQueryEncoding(raw []byte) error {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '%' {
			continue
		}
		if i+2 >= len(raw) {
			return fmt.Errorf("incomplete percent escape at query byte offset %d", i)
		}
		if !isHexDigit(raw[i+1]) || !isHexDigit(raw[i+2]) {
			return fmt.Errorf("invalid percent escape at query byte offset %d", i)
		}
		i += 2
	}
	return nil
}

// isHexDigit reports whether b is an ASCII hexadecimal digit.
func isHexDigit(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')
}

// suggestionRunError maps one Suggest Module failure to the
// ISSUE-004-resolved stable HTTP status, code, and optional field. Deadline
// expiry (the 450 ms request context reached pgx) is SEARCH_TIMEOUT no
// matter how the failure surfaces from the Module; client-parameter failures
// carry their field; server failures carry none and expose no internal
// cause.
func suggestionRunError(err error) (status int, code transport.ErrorCode, field *transport.ErrorField) {
	if errors.Is(err, context.DeadlineExceeded) {
		return fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil
	}
	var suggestErr *repository.Error
	if errors.As(err, &suggestErr) {
		switch suggestErr.Code {
		case repository.CodeInvalidSearchQuery:
			return fiber.StatusUnprocessableEntity, transport.INVALIDSEARCHQUERY, fieldQuery()
		case repository.CodeQueryTooLong:
			return fiber.StatusUnprocessableEntity, transport.QUERYTOOLONG, fieldQuery()
		case repository.CodeUnsupportedLanguage:
			return fiber.StatusUnprocessableEntity, transport.UNSUPPORTEDLANGUAGE, fieldLanguage()
		case repository.CodeCatalogUnavailable:
			return fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil
		case repository.CodeInternalError:
			return fiber.StatusInternalServerError, transport.INTERNALERROR, nil
		}
	}
	return fiber.StatusInternalServerError, transport.INTERNALERROR, nil
}

// fieldQuery and fieldLanguage return pointers to the only two fields the
// error schema permits (ISSUE-004).
func fieldQuery() *transport.ErrorField {
	field := transport.Query
	return &field
}

func fieldLanguage() *transport.ErrorField {
	field := transport.Language
	return &field
}

// writeError writes one stable error response shared by the suggestion and
// substitute search adapters: the exact generated error JSON with the
// stable code and optional field (ISSUE-004, ISSUE-005), and never an
// internal cause. The code and safeLogCause are recorded on the Fiber
// context so the request-log middleware emits them server-side (ARCH-019);
// the cause never reaches the response (ARCH-008, golang-security: log
// details server-side, return generic messages).
//
// safeLogCause must already be safe for the log: fixed text or a
// server-generated cause that contains no client values, request bodies,
// SQL parameters, credentials, or stack details. The writer sanitizes it
// against log injection but cannot remove sensitive data. Suggestion causes
// never echo query text, substitute decoder causes are fixed text, and
// substitute Module failures use safeSubstituteCause instead of their raw
// errors because those may contain client quantity values and units.
func writeError(c fiber.Ctx, status int, code transport.ErrorCode, field *transport.ErrorField, safeLogCause string) error {
	c.Locals(requestLogCodeKey, string(code))
	if safeLogCause != "" {
		c.Locals(requestLogCauseKey, sanitizeLogText(safeLogCause))
	}
	return c.Status(status).JSON(transport.Error{Code: code, Field: field})
}

// suggestionsResponse maps the domain suggestions returned by the Suggest
// Module to the generated OpenAPI response envelope at the HTTP boundary
// (ARCH-008, ISSUE-004, ISSUE-010): exactly five items, each with the stable
// positive Food Object ID, both required localized names, the backend-
// derived default Food Quantity, and the allowed quantity-editor units, and
// no unknown fields.
func suggestionsResponse(suggestions []repository.Suggestion) transport.FoodSuggestionsResponse {
	items := make([]transport.FoodSuggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
		allowed := make([]transport.AllowedQuantity, 0, len(suggestion.AllowedQuantities))
		for _, quantity := range suggestion.AllowedQuantities {
			// The Catalog Loader validates the ARCH-013 Serving invariant
			// before any suggestion is ranked, so every maximum value is a
			// positive whole number no larger than the int32 display range
			// and this conversion can never wrap (task-33 repair).
			allowed = append(allowed, transport.AllowedQuantity{
				Unit:         transport.AllowedQuantityUnit(quantity.Unit),
				MaximumValue: int32(quantity.MaximumValue),
			})
		}
		items = append(items, transport.FoodSuggestion{
			FoodObjectId: suggestion.FoodObjectID,
			Names: transport.LocalizedNames{
				En: suggestion.Names.En,
				Pl: suggestion.Names.Pl,
			},
			DefaultQuantity: transport.FoodQuantity{
				Value: float64(suggestion.DefaultQuantity.Value),
				Unit:  transport.FoodQuantityUnit(suggestion.DefaultQuantity.Unit),
			},
			AllowedQuantities: allowed,
		})
	}
	return transport.FoodSuggestionsResponse{Items: items}
}
