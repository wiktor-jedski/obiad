package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"obiad/backend/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
	if err := run(logger); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func run(logger *slog.Logger) error {
	url := os.Getenv("OBIAD_RUNTIME_DATABASE_URL")
	if url == "" {
		return errors.New("OBIAD_RUNTIME_DATABASE_URL is not set")
	}

	app, pool, err := server.Compose(url, logger)
	if err != nil {
		return fmt.Errorf("compose server: %w", err)
	}
	defer pool.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- app.Listen(server.DefaultListenAddr)
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("listen on %s: %w", server.DefaultListenAddr, err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return app.ShutdownWithContext(shutdownCtx)
	}
}
