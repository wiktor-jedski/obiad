// Command dbsetup is the Database Setup Module (ARCH-007): it applies the
// embedded versioned migrations to PostgreSQL before Fiber starts. It connects
// with the schema-owner credential supplied by OBIAD_SCHEMA_OWNER_DATABASE_URL
// and exits non-zero on any failure. dbsetup never creates database users,
// applies privileges, or reads the runtime connection; the local deployment
// setup creates both roles before this command runs and grants the runtime
// role SELECT-only catalog access afterwards (ARCH-016, ISSUE-001).
//
// Credential contract (credentials are environment-provided, never committed):
//
//	OBIAD_SCHEMA_OWNER_DATABASE_URL  schema-owner connection used by dbsetup
//	OBIAD_RUNTIME_DATABASE_URL       SELECT-only connection read by the later
//	                                 Fiber process (ARCH-016)
//
// Usage:
//
//	OBIAD_SCHEMA_OWNER_DATABASE_URL=postgres://… go run ./cmd/dbsetup
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/dbsetup"
	sqlmigrations "obiad/backend/internal/repository/sql"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("dbsetup: %v", err)
	}
}

func run() (runErr error) {
	url := os.Getenv("OBIAD_SCHEMA_OWNER_DATABASE_URL")
	if url == "" {
		return errors.New("OBIAD_SCHEMA_OWNER_DATABASE_URL is not set")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() {
		if err := conn.Close(context.Background()); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("close connection: %w", err))
		}
	}()

	applied, err := dbsetup.Apply(ctx, conn, migrationsDir())
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	log.Printf("applied %d pending migration(s)", applied)
	return nil
}

// migrationsDir returns the embedded migration files rooted at the directory
// that contains the NNNN_description.sql files.
func migrationsDir() fs.FS {
	dir, err := fs.Sub(sqlmigrations.Migrations, "migrations")
	if err != nil {
		panic(err) // the embedded migrations directory always exists
	}
	return dir
}
