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

// codeInvalidRequest identifies malformed query parameters.
const codeInvalidRequest = "INVALID_REQUEST"

// suggestionsHandler serves food suggestions.
func suggestionsHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		params, field, err := readSuggestionParams(c)
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

		suggest, err := repository.NewSuggest(poolConn.Conn())
		if err != nil {
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

// readSuggestionParams validates and decodes query parameters.
func readSuggestionParams(c fiber.Ctx) (params transport.GetFoodSuggestionsParams, field *transport.ErrorField, err error) {
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

// validateQueryEncoding rejects malformed percent escapes.
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

// isHexDigit reports whether b is hexadecimal.
func isHexDigit(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')
}

// suggestionRunError maps module errors to HTTP errors.
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

// fieldQuery returns the query error field.
func fieldQuery() *transport.ErrorField {
	field := transport.Query
	return &field
}

// fieldLanguage returns the language error field.
func fieldLanguage() *transport.ErrorField {
	field := transport.Language
	return &field
}

// writeError records safe log data and writes a stable response.
func writeError(c fiber.Ctx, status int, code transport.ErrorCode, field *transport.ErrorField, safeLogCause string) error {
	c.Locals(requestLogCodeKey, string(code))
	if safeLogCause != "" {
		c.Locals(requestLogCauseKey, sanitizeLogText(safeLogCause))
	}
	return c.Status(status).JSON(transport.Error{Code: code, Field: field})
}

// suggestionsResponse maps domain suggestions to transport values.
func suggestionsResponse(suggestions []repository.Suggestion) transport.FoodSuggestionsResponse {
	items := make([]transport.FoodSuggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
		allowed := make([]transport.AllowedQuantity, 0, len(suggestion.AllowedQuantities))
		for _, quantity := range suggestion.AllowedQuantities {
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
