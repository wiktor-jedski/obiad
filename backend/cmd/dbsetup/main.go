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

func migrationsDir() fs.FS {
	dir, err := fs.Sub(sqlmigrations.Migrations, "migrations")
	if err != nil {
		panic(err)
	}
	return dir
}
