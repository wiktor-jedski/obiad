// Package server composes the HTTP application and handlers.
package server

import (
	"bytes"
	"context"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valyala/fasthttp"
)

// DefaultListenAddr is the fixed loopback listener address.
const DefaultListenAddr = "127.0.0.1:8080"

const healthPingTimeout = time.Second

const requestDeadline = 450 * time.Millisecond

type healthStatus struct {
	Status string `json:"status"`
}

// Compose builds the HTTP application and database pool.
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

	// HeaderReceived limits substitute request bodies before buffering.
	app.Server().HeaderReceived = func(h *fasthttp.RequestHeader) fasthttp.RequestConfig {
		var target fasthttp.URI
		if err := target.Parse(h.Host(), h.RequestURI()); err != nil {
			return fasthttp.RequestConfig{MaxRequestBodySize: maxRequestBodyBytes}
		}
		detection := lowerASCIIPath(target.PathOriginal())
		if len(detection) > 1 && detection[len(detection)-1] == '/' {
			detection = bytes.TrimRight(detection, "/")
		}
		if bytes.Equal(detection, []byte("/api/v1/substitutes/search")) {
			return fasthttp.RequestConfig{MaxRequestBodySize: maxRequestBodyBytes}
		}
		return fasthttp.RequestConfig{}
	}

	return app, pool, nil
}

// lowerASCIIPath lowercases ASCII path bytes in place.
func lowerASCIIPath(path []byte) []byte {
	for i, c := range path {
		if c >= 'A' && c <= 'Z' {
			path[i] = c | 0x20
		}
	}
	return path
}

// healthHandler returns the bounded readiness response.
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
