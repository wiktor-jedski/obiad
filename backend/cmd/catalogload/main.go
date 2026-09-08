package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"

	"obiad/backend/internal/catalogload"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("catalogload: %v", err)
	}
}

func run() error {
	if len(os.Args) != 2 || os.Args[1] == "" {
		return errors.New("usage: catalogload CATALOG_FILE")
	}
	url := os.Getenv("OBIAD_SCHEMA_OWNER_DATABASE_URL")
	if url == "" {
		return errors.New("OBIAD_SCHEMA_OWNER_DATABASE_URL is not set")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := catalogload.Run(ctx, url, os.Args[1]); err != nil {
		return err
	}
	log.Print("catalog replaced")
	return nil
}
