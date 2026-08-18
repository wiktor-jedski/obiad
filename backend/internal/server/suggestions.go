// Package-level file for the Fiber Adapter of the versioned
// GET /api/v1/food-suggestions route (task 13; ARCH-004, ARCH-008,
// ARCH-017, ARCH-022). The adapter maps the generated transport query and
// response values only at the HTTP boundary: it reads the raw query string
// parameters into the generated GetFoodSuggestionsParams, calls the concrete
// Suggest Food Objects Run operation over one request-local runtime
// connection, and serializes the returned domain suggestions through the
// generated FoodSuggestionsResponse envelope. Generated transport values
// never enter the Module, and Module domain values never reach the wire
// un-mapped (ISSUE-004).

package server

import (
	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"obiad/backend/internal/repository"
	"obiad/backend/internal/transport"
)

// suggestionsHandler returns the Fiber handler for the versioned
// GET /api/v1/food-suggestions route (ARCH-008). It maps the raw HTTP query
// string parameters into the generated transport query type at the HTTP
// boundary, acquires one request-local runtime connection from the pool,
// runs the concrete Suggest Food Objects operation over it (ARCH-004,
// ARCH-006: one fresh embedded SELECT per request, no runtime cache, no
// retry), and serializes the exact five-item success envelope with stable
// Food Object IDs, both localized names, and backend-derived default Food
// Quantities (ISSUE-004).
func suggestionsHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Map the raw query string parameters into the generated transport
		// query values at the HTTP boundary (ARCH-008, ISSUE-004). The
		// generated enum type is a string, so any raw value reaches the
		// Module unchanged and the Module's language validation decides
		// whether it is one of the exact supported values.
		params := transport.GetFoodSuggestionsParams{
			Query:    c.Query("query"),
			Language: transport.GetFoodSuggestionsParamsLanguage(c.Query("language")),
		}

		poolConn, err := pool.Acquire(c.Context())
		if err != nil {
			return err
		}
		defer poolConn.Release()

		suggest, err := repository.NewSuggest(poolConn.Conn())
		if err != nil {
			return err
		}
		suggestions, err := suggest.Run(c.Context(), params.Query, repository.Language(params.Language))
		if err != nil {
			return err
		}
		return c.JSON(suggestionsResponse(suggestions))
	}
}

// suggestionsResponse maps the domain suggestions returned by the Suggest
// Module to the generated OpenAPI response envelope at the HTTP boundary
// (ARCH-008, ISSUE-004): exactly five items, each with the stable positive
// Food Object ID, both required localized names, and the backend-derived
// default Food Quantity, and no unknown fields.
func suggestionsResponse(suggestions []repository.Suggestion) transport.FoodSuggestionsResponse {
	items := make([]transport.FoodSuggestion, 0, len(suggestions))
	for _, suggestion := range suggestions {
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
		})
	}
	return transport.FoodSuggestionsResponse{Items: items}
}
