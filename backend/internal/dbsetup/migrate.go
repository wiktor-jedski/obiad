// Package dbsetup applies versioned SQL migrations.
package dbsetup

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	sqlfiles "obiad/backend/internal/repository/sql"
)

// Migration describes one SQL migration.
type Migration struct {
	// Version is the migration version.
	Version int
	// Name is the migration name.
	Name string
	// SQL is the migration body.
	SQL string
}

// Load reads and sorts SQL migrations from fsys.
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

const advisoryLockKey int64 = 0x0B1AD0001

// Apply runs each pending migration in ascending order.
// Each migration and its record commit together.
func Apply(ctx context.Context, conn *pgx.Conn, fsys fs.FS) (int, error) {
	migrations, err := Load(fsys)
	if err != nil {
		return 0, err
	}

	// The session lock serializes concurrent migration runs.
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", advisoryLockKey); err != nil {
		return 0, fmt.Errorf("acquire migration lock: %w", err)
	}
	// Unlocking is best effort; closing the connection releases the lock.
	defer conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", advisoryLockKey) //nolint:errcheck

	schemaMigrationsSQL, err := fs.ReadFile(sqlfiles.Setup, "setup/schema_migrations.sql")
	if err != nil {
		return 0, fmt.Errorf("read schema migrations setup SQL: %w", err)
	}
	if _, err := conn.Exec(ctx, string(schemaMigrationsSQL)); err != nil {
		return 0, fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := 0
	for _, m := range migrations {
		var existing int
		err := conn.QueryRow(ctx, "SELECT version FROM schema_migrations WHERE version = $1", m.Version).Scan(&existing)
		if err == nil {
			continue
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

// applyOne commits one migration and its record atomically.
func applyOne(ctx context.Context, conn *pgx.Conn, m Migration) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("migration %d (%s): begin: %w", m.Version, m.Name, err)
	}
	// Rollback is a no-op after a successful commit.
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	// Simple protocol executes multi-statement migration files.
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
