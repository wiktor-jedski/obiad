package server

import (
	"bytes"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/adaptor"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/valyala/fasthttp"
)

type metricRouteKey struct{}

const metricsPath = "/metrics"

func registerMetrics(app *fiber.App) {
	registry := prometheus.NewRegistry()
	labels := []string{"method", "route", "status"}
	requests := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "obiad_http_requests_total",
		Help: "Number of HTTP requests handled by Obiad.",
	}, labels)
	duration := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name: "obiad_http_request_duration_seconds",
		Help: "Time in seconds to handle an HTTP request.",
	}, labels)
	registry.MustRegister(requests, duration, collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	app.Use(func(c fiber.Ctx) error {
		err := c.Next()
		if c.Matched() {
			c.Locals(metricRouteKey{}, c.Route())
		}
		return err
	})
	app.Get(metricsPath, adaptor.HTTPHandler(promhttp.HandlerFor(registry, promhttp.HandlerOpts{})))

	observe := func(c *fasthttp.RequestCtx, start time.Time) {
		route := "unmatched"
		if matched, ok := c.UserValue(metricRouteKey{}).(*fiber.Route); ok {
			route = matched.Path
		} else if bytes.EqualFold(bytes.TrimRight(c.URI().PathOriginal(), "/"), []byte(metricsPath)) {
			return
		}
		if route == metricsPath {
			return
		}
		method := metricMethod(c.Method())
		status := strconv.Itoa(c.Response.StatusCode())
		requests.WithLabelValues(method, route, status).Inc()
		duration.WithLabelValues(method, route, status).Observe(time.Since(start).Seconds())
	}

	// Observe after Fiber writes the response, including errors that bypass the router.
	s := app.Server()
	handle, handleError := s.Handler, s.ErrorHandler
	s.Handler = func(c *fasthttp.RequestCtx) {
		handle(c)
		observe(c, c.Time())
	}
	s.ErrorHandler = func(c *fasthttp.RequestCtx, err error) {
		start := time.Now()
		handleError(c, err)
		observe(c, start)
	}
}

func metricMethod(raw []byte) string {
	for _, method := range fiber.DefaultMethods {
		if method == string(raw) {
			return method
		}
	}
	return "OTHER"
}
