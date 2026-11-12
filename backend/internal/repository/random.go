package repository

import (
	"context"

	"github.com/jackc/pgx/v5"

	sqlfiles "obiad/backend/internal/repository/sql"
)

// RandomFoodID selects one existing ID without loading the catalog into memory.
// Each request is independent and may return the same ID again.
func RandomFoodID(ctx context.Context, conn *pgx.Conn) (int32, error) {
	var id int32
	if err := conn.QueryRow(ctx, sqlfiles.RandomFood).Scan(&id); err != nil {
		return 0, &Error{Code: CodeCatalogUnavailable, cause: err}
	}
	return id, nil
}
