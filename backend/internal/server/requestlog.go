// Request logging for the Fiber application (ARCH-019): every request is
// emitted as one structured log record with request ID, method, route
// template, HTTP status, duration, the stable error code, and the internal
// cause when an error occurred. Sensitive values never reach the log: the
// Search Query text, quantities, request bodies, SQL parameters, database
// credentials, and stack details are excluded, and every logged value is
// sanitized against log injection (ARCH-019, golang-security logging
// guidance).
//
// The request-log middleware emits the record for every request that
// traverses the middleware chain with a known outcome. A request whose
// request line fasthttp could not parse (malformed query encoding) cannot
// traverse the chain with a written response: the app error handler answers
// and logs it instead (errorHandler). The two paths coordinate through
// requestLogEmittedKey so exactly one record is emitted per request.

package server

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/gofiber/fiber/v3"
)

// Request-log context keys. Handlers store the stable error code and the
// internal cause on the Fiber context; the request-log middleware picks them
// up and emits them. The keys are package-private and no client input is
// ever stored under them.
const (
	// requestLogCodeKey holds the stable error code of a failed request.
	requestLogCodeKey = "obiad.request.error_code"
	// requestLogCauseKey holds the sanitized internal cause of a failed
	// request. It never appears in a response (ARCH-008).
	requestLogCauseKey = "obiad.request.error_cause"
	// requestLogEmittedKey marks that the request-log middleware already
	// emitted the record, so the app error handler does not emit a second
	// record for the same request.
	requestLogEmittedKey = "obiad.request.log_emitted"
)

// requestIDCounter is the fallback source of request IDs when crypto/rand is
// unavailable. crypto/rand cannot fail on supported platforms, so the
// fallback is defense in depth: the log never carries an empty or reused
// request ID.
var requestIDCounter atomic.Uint64

// newRequestID returns a fresh unpredictable request ID: 16 bytes from
// crypto/rand encoded as 32 hex characters (golang-security: crypto/rand, not
// math/rand, for identifiers an attacker must not be able to predict).
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%x-%d", time.Now().UnixNano(), requestIDCounter.Add(1))
	}
	return hex.EncodeToString(b[:])
}

// sanitizeLogText removes control characters and other non-printable runes
// from a value before it reaches the log sink so user-influenced input can
// never inject log structure (golang-security logging guidance). slog's JSON
// handler also escapes values; this is the second, explicit layer.
func sanitizeLogText(s string) string {
	if !strings.ContainsFunc(s, unicode.IsControl) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if !unicode.IsControl(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// statusFromError derives the HTTP status of an error returned from the
// middleware chain: a *fiber.Error carries its status code; any other error
// is an unexpected internal failure.
func statusFromError(err error) int {
	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) && fiberErr != nil {
		return fiberErr.Code
	}
	return fiber.StatusInternalServerError
}

// routeTemplate returns the registered route template of the matched route
// for the request log (ARCH-019): static patterns log the pattern itself
// ("/api/v1/food-suggestions"), and parameterized patterns would log their
// ":param" placeholders. A request that never matched a route has no
// template, so the empty string is logged.
func routeTemplate(c fiber.Ctx) string {
	return c.Route().Path
}

// logRequest emits one structured request record (ARCH-019). code is the
// stable error code of a failed request and cause its sanitized internal
// cause; both are omitted on success. Query text, quantities, request
// bodies, SQL parameters, credentials, and stack details are never passed
// in by callers.
func logRequest(logger *slog.Logger, requestID, method, route string, status int, duration time.Duration, code, cause string) {
	attrs := []any{
		"request_id", requestID,
		"method", sanitizeLogText(method),
		"route", sanitizeLogText(route),
		"status", status,
		"duration_ms", float64(duration.Microseconds()) / 1000.0,
	}
	if code != "" {
		attrs = append(attrs, "code", code)
	}
	if cause != "" {
		attrs = append(attrs, "cause", sanitizeLogText(cause))
	}
	logger.Info("request", attrs...)
}

// requestLogger returns the Fiber middleware that emits one structured log
// record per request (ARCH-019): request ID, method, route template, status,
// duration, stable error code, and internal cause, with query text,
// quantities, request bodies, SQL parameters, credentials, and stack details
// excluded.
//
// The middleware logs after the handler chain has determined the outcome.
// When the chain returns an error (not found, method not allowed, or an
// unexpected handler failure), the status is derived from the error because
// the app error handler writes the response afterwards. When the chain
// returns no error but never matched a route, the request could not be
// parsed by fasthttp (malformed query encoding): no handler wrote a
// response, the fasthttp response still carries its implicit default status,
// and the app error handler answers and logs the request. The middleware
// defers to it so no placeholder record is emitted.
func requestLogger(logger *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		requestID := newRequestID()
		err := c.Next()
		status := c.Response().StatusCode()
		if err != nil {
			status = statusFromError(err)
		} else if !c.Matched() {
			// The response is still pending: the app error handler (malformed
			// request path) owns the record for this request.
			return nil
		}
		code, _ := c.Locals(requestLogCodeKey).(string)
		cause, _ := c.Locals(requestLogCauseKey).(string)
		c.Locals(requestLogEmittedKey, true)
		logRequest(logger, requestID, c.Method(), routeTemplate(c), status, time.Since(start), code, cause)
		return err
	}
}

// errorHandler is the app-level error handler. Two kinds of errors reach it:
//
//   - malformed requests whose request line fasthttp could not parse (the
//     only 400 errors that reach the app error handler, because the
//     application handlers map every failure themselves). Those are answered
//     with the stable 400 INVALID_REQUEST JSON error without a field
//     (ISSUE-004) and are logged here because the request-log middleware
//     could not observe their outcome;
//   - router-level errors (not found, method not allowed) and unexpected
//     handler errors, which the request-log middleware already logged and
//     which keep the Fiber default behavior.
func errorHandler(logger *slog.Logger) fiber.ErrorHandler {
	return func(c fiber.Ctx, err error) error {
		if _, emitted := c.Locals(requestLogEmittedKey).(bool); !emitted {
			start := time.Now()
			code := ""
			if fiberErr, ok := err.(*fiber.Error); ok && fiberErr != nil && fiberErr.Code == fiber.StatusBadRequest {
				code = codeInvalidRequest
			}
			logRequest(logger, newRequestID(), c.Method(), "", statusFromError(err), time.Since(start), code, sanitizeLogText(err.Error()))
		}
		if fiberErr, ok := err.(*fiber.Error); ok && fiberErr != nil && fiberErr.Code == fiber.StatusBadRequest {
			return c.Status(fiber.StatusBadRequest).JSON(transportError(codeInvalidRequest, nil))
		}
		return fiber.DefaultErrorHandler(c, err)
	}
}
