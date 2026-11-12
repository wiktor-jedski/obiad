package server

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"obiad/backend/internal/repository"
	"obiad/backend/internal/transport"
)

// randomFoodHandler selects one food from the full catalog on every request.
func randomFoodHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set(fiber.HeaderCacheControl, "no-store")
		ctx, cancel := context.WithTimeout(c.Context(), requestDeadline)
		defer cancel()

		poolConn, err := pool.Acquire(ctx)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return writeError(c, fiber.StatusGatewayTimeout, transport.SEARCHTIMEOUT, nil, deadlineLogCause)
			}
			return writeError(c, fiber.StatusServiceUnavailable, transport.CATALOGUNAVAILABLE, nil, err.Error())
		}
		defer poolConn.Release()

		id, err := repository.RandomFoodID(ctx, poolConn.Conn())
		if err != nil {
			status, code, field := suggestionRunError(err)
			cause := err.Error()
			if errors.Is(err, context.DeadlineExceeded) {
				cause = deadlineLogCause
			}
			return writeError(c, status, code, field, cause)
		}
		return c.JSON(transport.RandomFoodResponse{FoodObjectId: id})
	}
}
