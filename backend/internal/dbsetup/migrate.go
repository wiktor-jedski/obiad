// Package dbsetup implements the Database Setup Module (ARCH-007): an explicit
// command applies the embedded versioned migrations to PostgreSQL before Fiber
// starts. The request-serving process never executes DDL.
package dbsetup

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Migration is one versioned SQL migration.
type Migration struct {
	// Version is the zero-padded ordinal from the migration file name.
	Version int
	// Name is the human-readable description from the migration file name.
	Name string
	// SQL is the migration body, applied in its own transaction.
	SQL string
}

// Load reads versioned migrations from fsys. fsys must be rooted at the
// migration files themselves: its entries are the NNNN_description.sql files,
// where NNNN is a zero-padded version. Migrations are returned in ascending
// version order; a duplicate version is an error.
func Load(fsys fs.FS) ([]Migration, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, fmt.Errorf("read migrations: %w", err)
	}
	byVersion := make(map[int]Migration, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		base := e.Name()
		dot := strings.LastIndexByte(base, '.')
		if dot < 0 || base[dot:] != ".sql" {
			continue
		}
		stem := base[:dot]
		underscore := strings.IndexByte(stem, '_')
		if underscore < 0 {
			return nil, fmt.Errorf("migration %q: want NNNN_description.sql", base)
		}
		version, err := strconv.Atoi(stem[:underscore])
		if err != nil {
			return nil, fmt.Errorf("migration %q: version %q is not an integer", base, stem[:underscore])
		}
		body, err := fs.ReadFile(fsys, base)
		if err != nil {
			return nil, fmt.Errorf("migration %q: read: %w", base, err)
		}
		if _, dup := byVersion[version]; dup {
			return nil, fmt.Errorf("migration %q: duplicate version %d", base, version)
		}
		byVersion[version] = Migration{Version: version, Name: stem[underscore+1:], SQL: string(body)}
	}
	migrations := make([]Migration, 0, len(byVersion))
	for _, m := range byVersion {
		migrations = append(migrations, m)
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].Version < migrations[j].Version })
	return migrations, nil
}

// advisoryLockKey serializes concurrent runners on one database. It is a fixed
// constant derived from the module name "obiad".
const advisoryLockKey int64 = 0x0B1AD0001

// Apply applies every pending migration in fsys to conn in ascending version
// order. Each migration runs in one transaction together with its
// schema_migrations bookkeeping row, so a failed migration leaves no partial
// schema and no record. Already applied versions are skipped, which makes the
// runner idempotent and safe to run repeatedly. Apply returns the number of
// migrations it applied.
func Apply(ctx context.Context, conn *pgx.Conn, fsys fs.FS) (int, error) {
	migrations, err := Load(fsys)
	if err != nil {
		return 0, err
	}

	// Serialize concurrent runners; the lock lives on this connection, so a
	// single defer is sufficient regardless of errors.
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", advisoryLockKey); err != nil {
		return 0, fmt.Errorf("acquire migration lock: %w", err)
	}
	// Unlock best effort; the session lock dies with the connection anyway.
	defer conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", advisoryLockKey) //nolint:errcheck

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		name       TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return 0, fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := 0
	for _, m := range migrations {
		var existing int
		err := conn.QueryRow(ctx, "SELECT version FROM schema_migrations WHERE version = $1", m.Version).Scan(&existing)
		if err == nil {
			continue // already applied
		}
		if err != pgx.ErrNoRows {
			return applied, fmt.Errorf("migration %d (%s): check applied: %w", m.Version, m.Name, err)
		}
		if err := applyOne(ctx, conn, m); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, nil
}

// applyOne runs one migration in a transaction. The migration body and its
// bookkeeping row commit or roll back together.
func applyOne(ctx context.Context, conn *pgx.Conn, m Migration) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("migration %d (%s): begin: %w", m.Version, m.Name, err)
	}
	// A no-op after Commit; keeps the transaction from lingering on error.
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	// Simple protocol so multi-statement migration files execute as one batch.
	if _, err := tx.Exec(ctx, m.SQL, pgx.QueryExecModeSimpleProtocol); err != nil {
		return fmt.Errorf("migration %d (%s): execute: %w", m.Version, m.Name, err)
	}
	if _, err := tx.Exec(ctx,
		"INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
		m.Version, m.Name); err != nil {
		return fmt.Errorf("migration %d (%s): record: %w", m.Version, m.Name, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("migration %d (%s): commit: %w", m.Version, m.Name, err)
	}
	return nil
}
