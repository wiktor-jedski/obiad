// Request logging for the Fiber application (ARCH-019): every request is
// emitted as one structured log record with request ID, method, route
// template, HTTP status, duration, the stable error code, and the internal
// cause when an error occurred. Sensitive values never reach the log: the
// Search Query text, quantities, request bodies, SQL parameters, database
// credentials, and stack details are excluded, and every logged value is
// sanitized against log injection (ARCH-019, golang-security logging
// guidance).
//
// The request-log middleware emits the record for requests whose handler
// chain completes without an error. Every error outcome — router-level
// not-found or method-not-allowed, requests whose request line fasthttp could
// not parse (malformed query encoding), and unexpected handler failures — is
// answered and logged by the app error handler (errorHandler), so exactly one
// record is emitted per request.

package server

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode"

	"github.com/gofiber/fiber/v3"

	"obiad/backend/internal/transport"
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
)

// newRequestID returns a fresh unpredictable request ID: 16 bytes from
// crypto/rand encoded as 32 hex characters (golang-security: crypto/rand, not
// math/rand, for identifiers an attacker must not be able to predict).
func newRequestID() string {
	var b [16]byte
	rand.Read(b[:])
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
// record per successful request (ARCH-019): request ID, method, route
// template, status, duration, stable error code, and internal cause, with
// query text, quantities, request bodies, SQL parameters, credentials, and
// stack details excluded.
//
// The middleware logs only outcomes the handler chain fully determines
// without an error: a handler either wrote the response (success) or the
// chain returned no error but never matched a route (the fasthttp error
// path). Every error outcome — router-level not-found or method-not-allowed,
// malformed request lines, and unexpected handler failures — is deferred to
// the app error handler (errorHandler), which owns the record and the stable
// response for those requests, so exactly one record is emitted per request.
func requestLogger(logger *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		requestID := newRequestID()
		err := c.Next()
		if err != nil {
			// The app error handler answers and logs this request (router
			// 404/405, unexpected handler failure).
			return err
		}
		if !c.Matched() {
			// No handler wrote a response: the request line could not be
			// parsed by fasthttp (malformed query encoding), and the app
			// error handler answers and logs the request.
			return nil
		}
		code, _ := c.Locals(requestLogCodeKey).(string)
		cause, _ := c.Locals(requestLogCauseKey).(string)
		logRequest(logger, requestID, c.Method(), routeTemplate(c), c.Response().StatusCode(), time.Since(start), code, cause)
		return nil
	}
}

// errorHandler is the app-level error handler. It answers and logs every
// request whose outcome the middleware could not determine, so exactly one
// record is emitted per request:
//
//   - malformed requests whose request line fasthttp could not parse (a
//     control byte in the request-target) are answered with the stable
//     400 INVALID_REQUEST JSON error without a field (ISSUE-004);
//   - router-level not-found (404) and method-not-allowed (405) errors keep
//     the Fiber default behavior and have no stable error code;
//   - every other error — an unexpected handler failure — is answered with
//     the exact stable 500 {"code":"INTERNAL_ERROR"} response with no field
//     and no internal cause; the sanitized internal cause appears only in
//     the request log (ARCH-008, golang-security: log details server-side,
//     return generic messages).
func errorHandler(logger *slog.Logger) fiber.ErrorHandler {
	return func(c fiber.Ctx, err error) error {
		start := time.Now()
		requestID := newRequestID()
		route := ""
		if c.Matched() {
			route = c.Route().Path
		}
		var fiberErr *fiber.Error
		matched := errors.As(err, &fiberErr)
		switch {
		case matched && fiberErr != nil && fiberErr.Code == fiber.StatusBadRequest:
			logRequest(logger, requestID, c.Method(), route, fiber.StatusBadRequest, time.Since(start), codeInvalidRequest, sanitizeLogText(err.Error()))
			return c.Status(fiber.StatusBadRequest).JSON(transport.Error{Code: codeInvalidRequest})
		case matched && fiberErr != nil && (fiberErr.Code == fiber.StatusNotFound || fiberErr.Code == fiber.StatusMethodNotAllowed):
			logRequest(logger, requestID, c.Method(), route, fiberErr.Code, time.Since(start), "", sanitizeLogText(err.Error()))
			return fiber.DefaultErrorHandler(c, err)
		default:
			logRequest(logger, requestID, c.Method(), route, fiber.StatusInternalServerError, time.Since(start), string(transport.INTERNALERROR), sanitizeLogText(err.Error()))
			return c.Status(fiber.StatusInternalServerError).JSON(transport.Error{Code: transport.INTERNALERROR})
		}
	}
}
