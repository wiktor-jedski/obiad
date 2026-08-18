// Package server composes the Fiber v3 HTTP application for the Obiad
// backend process (ARCH-009, ARCH-016). It reads the SELECT-only runtime
// database credential, configures a pgx pool with zero minimum and four
// maximum connections, and exposes the unversioned GET /health readiness
// endpoint (ARCH-009).
//
// The composition adds no CORS, TLS, authentication, cookies, rate limiter,
// or third-party runtime service (ARCH-016). The production command binds to
// the ISSUE-004-resolved loopback address DefaultListenAddr and has no
// listen-address configuration; tests compose the application on
// 127.0.0.1:0 instead (ISSUE-004).
package server

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultListenAddr is the ISSUE-004-resolved loopback address
// backend/cmd/server binds. The command has no listen-address configuration
// (no flag or environment variable): the loopback bind is fixed so the POC
// keeps the minimum local network surface (ARCH-016).
const DefaultListenAddr = "127.0.0.1:8080"

// healthPingTimeout bounds the PostgreSQL ping of each /health request so a
// readiness check can never hang on an unresponsive server (ARCH-009).
const healthPingTimeout = time.Second

// healthStatus is the exact JSON body of the readiness endpoint: one status
// field and no configuration, credential, version, or dependency details
// (ARCH-009).
type healthStatus struct {
	Status string `json:"status"`
}

// Compose builds the Fiber v3 application over a pgx pool connected with the
// runtime database credential. The pool keeps zero minimum and four maximum
// connections (ARCH-016). The returned application serves the unversioned
// GET /health route; the caller owns starting the listener and closing the
// pool.
func Compose(runtimeDatabaseURL string) (*fiber.App, *pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(runtimeDatabaseURL)
	if err != nil {
		return nil, nil, err
	}
	cfg.MinConns = 0
	cfg.MaxConns = 4

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, nil, err
	}

	app := fiber.New()
	app.Get("/health", healthHandler(pool))
	return app, pool, nil
}

// healthHandler returns the unversioned GET /health handler (ARCH-009). It
// performs a bounded PostgreSQL ping through the runtime pool and returns
// exactly 200 {"status":"ready"} when request processing can use PostgreSQL,
// or 503 {"status":"unavailable"} otherwise. Neither body exposes
// configuration, credentials, version data, or dependency details.
func healthHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), healthPingTimeout)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(healthStatus{Status: "unavailable"})
		}
		return c.JSON(healthStatus{Status: "ready"})
	}
}
