// Command server is the Fiber v3 backend process (ARCH-016). It reads the
// SELECT-only runtime database credential supplied by
// OBIAD_RUNTIME_DATABASE_URL, composes the Fiber application, and serves the
// unversioned GET /health readiness endpoint (ARCH-009) on the
// ISSUE-004-resolved loopback address 127.0.0.1:8080. The command has no
// listen-address configuration and adds no CORS, TLS, authentication,
// cookies, rate limiter, or third-party runtime service (ARCH-016).
//
// Credential contract (credentials are environment-provided, never committed):
//
//	OBIAD_RUNTIME_DATABASE_URL  SELECT-only connection read by Fiber (ARCH-016)
//
// The local deployment setup creates the runtime role and grants it SELECT on
// the Food Catalog tables before this command starts (ARCH-007, ISSUE-001);
// server never creates database users or applies privileges.
//
// Usage:
//
//	OBIAD_RUNTIME_DATABASE_URL=postgres://… go run ./cmd/server
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
