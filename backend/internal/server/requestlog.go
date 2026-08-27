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

// Request log keys carry error details between handlers.
const (
	requestLogCodeKey  = "obiad.request.error_code"
	requestLogCauseKey = "obiad.request.error_cause"
)

// newRequestID returns a random request identifier.
func newRequestID() string {
	var b [16]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// sanitizeLogText removes control characters from log text.
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

// routeTemplate returns the matched route path.
func routeTemplate(c fiber.Ctx) string {
	return c.Route().Path
}

// logRequest emits one structured request record.
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

// requestLogger logs completed requests.
func requestLogger(logger *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		requestID := newRequestID()
		err := c.Next()
		if err != nil {
			return err
		}
		if !c.Matched() {
			return nil
		}
		code, _ := c.Locals(requestLogCodeKey).(string)
		cause, _ := c.Locals(requestLogCauseKey).(string)
		logRequest(logger, requestID, c.Method(), routeTemplate(c), c.Response().StatusCode(), time.Since(start), code, cause)
		return nil
	}
}

// errorHandler logs failures and returns stable responses.
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
		case matched && fiberErr != nil && fiberErr.Code == fiber.StatusRequestEntityTooLarge:
			logRequest(logger, requestID, c.Method(), route, fiber.StatusRequestEntityTooLarge, time.Since(start), string(transport.REQUESTBODYTOOLARGE), "request body exceeds the 4 KiB limit")
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(transport.Error{Code: transport.REQUESTBODYTOOLARGE})
		case matched && fiberErr != nil && (fiberErr.Code == fiber.StatusNotFound || fiberErr.Code == fiber.StatusMethodNotAllowed):
			logRequest(logger, requestID, c.Method(), route, fiberErr.Code, time.Since(start), "", sanitizeLogText(err.Error()))
			return fiber.DefaultErrorHandler(c, err)
		default:
			logRequest(logger, requestID, c.Method(), route, fiber.StatusInternalServerError, time.Since(start), string(transport.INTERNALERROR), sanitizeLogText(err.Error()))
			return c.Status(fiber.StatusInternalServerError).JSON(transport.Error{Code: transport.INTERNALERROR})
		}
	}
}
