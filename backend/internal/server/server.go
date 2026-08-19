// Package server composes the Fiber v3 HTTP application for the Obiad
// backend process (ARCH-009, ARCH-016, ARCH-019). It reads the SELECT-only
// runtime database credential, configures a pgx pool with zero minimum and
// four maximum connections, and exposes the unversioned GET /health
// readiness endpoint (ARCH-009), the versioned GET /api/v1/food-suggestions
// suggestion route (ARCH-008), and the versioned POST
// /api/v1/substitutes/search substitute search route (task 19; ARCH-005,
// ARCH-008).
//
// The composition adds no CORS, TLS, authentication, cookies, rate limiter,
// or third-party runtime service (ARCH-016). The production command binds to
// the ISSUE-004-resolved loopback address DefaultListenAddr and has no
// listen-address configuration; tests compose the application on
// 127.0.0.1:0 instead (ISSUE-004).
//
// Every request is bounded by the request control and failure mechanism
// (ARCH-019): suggestion and substitute search requests derive a 450 ms
// context that bounds pool Acquire, the operation Module, and the pgx
// catalog read, no retry occurs anywhere, and every failure maps to the
// ISSUE-004 or ISSUE-005 stable status, code, and optional field.
// Structured request logs are emitted through the injected logger (slog
// JSON in production) with request ID, method, route template, status,
// duration, stable error code, and internal cause, excluding query text,
// quantities, request bodies, SQL parameters, credentials, and stack
// details.
package server

import (
	"context"
	"log/slog"
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

// requestDeadline is the end-to-end bound on one suggestion or substitute
// search request (ARCH-019): the Fiber handler derives a 450 ms context and
// passes it through pool Acquire, the operation Run, and the pgx catalog
// read. No retry happens anywhere; when the deadline fires, the context
// cancels pgx and the request fails with the stable SEARCH_TIMEOUT code
// (ISSUE-004, ISSUE-005).
const requestDeadline = 450 * time.Millisecond

// healthStatus is the exact JSON body of the readiness endpoint: one status
// field and no configuration, credential, version, or dependency details
// (ARCH-009).
type healthStatus struct {
	Status string `json:"status"`
}

// Compose builds the Fiber v3 application over a pgx pool connected with the
// runtime database credential. The pool keeps zero minimum and four maximum
// connections (ARCH-016). The returned application serves the unversioned
// GET /health route, the versioned GET /api/v1/food-suggestions route, and
// the versioned POST /api/v1/substitutes/search route; the caller owns
// starting the listener and closing the pool. Structured request logs
// (ARCH-019) are emitted through logger; when logger is nil, slog.Default
// is used.
func Compose(runtimeDatabaseURL string, logger *slog.Logger) (*fiber.App, *pgxpool.Pool, error) {
	if logger == nil {
		logger = slog.Default()
	}
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

	app := fiber.New(fiber.Config{ErrorHandler: errorHandler(logger)})
	app.Use(requestLogger(logger))
	app.Get("/health", healthHandler(pool))
	app.Get("/api/v1/food-suggestions", suggestionsHandler(pool))
	app.Post("/api/v1/substitutes/search", substitutesHandler(pool))
	return app, pool, nil
}

// healthHandler returns the unversioned GET /health handler (ARCH-009). It
// performs a bounded PostgreSQL ping through the runtime pool and returns
// exactly 200 {"status":"ready"} when request processing can use PostgreSQL,
// or 503 {"status":"unavailable"} otherwise. Neither body exposes
// configuration, credentials, version data, or dependency details. The ping
// failure is recorded on the request log as the internal cause (ARCH-019).
func healthHandler(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), healthPingTimeout)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			c.Locals(requestLogCauseKey, sanitizeLogText(err.Error()))
			return c.Status(fiber.StatusServiceUnavailable).JSON(healthStatus{Status: "unavailable"})
		}
		return c.JSON(healthStatus{Status: "ready"})
	}
}
