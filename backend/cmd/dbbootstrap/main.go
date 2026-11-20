package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/dbbootstrap"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("dbbootstrap: %v", err)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return errors.New("usage: dbbootstrap roles|grants")
	}
	admin, err := pgx.ParseConfig("")
	if err != nil {
		return errors.New("invalid PostgreSQL admin connection settings")
	}
	if admin.User != "postgres" || admin.Database != "postgres" {
		return errors.New("set PGUSER=postgres and PGDATABASE=postgres")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	target := dbbootstrap.Target{Database: "obiad", Owner: "obiad_owner", Runtime: "obiad_runtime"}
	return target.Apply(ctx, admin, os.Args[1], os.Getenv("OBIAD_OWNER_PASSWORD"), os.Getenv("OBIAD_RUNTIME_PASSWORD"))
}
