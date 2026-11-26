package server

import (
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	dto "github.com/prometheus/client_model/go"
	"github.com/prometheus/common/expfmt"

	"obiad/backend/internal/testdb"
)

func scrapeMetrics(t *testing.T, baseURL string) map[string]*dto.MetricFamily {
	t.Helper()
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(baseURL + "/metrics")
	if err != nil {
		t.Fatalf("scrape metrics: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close scrape: %v", err)
		}
	}()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("scrape: status %d, content type %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	var parser expfmt.TextParser
	families, err := parser.TextToMetricFamilies(resp.Body)
	if err != nil {
		t.Fatalf("parse metrics: %v", err)
	}
	return families
}

func TestHTTPMetricsIntegration(t *testing.T) {
	db := testdb.NewDB(t)
	baseURL, _ := startServerWithLogger(t, db.RuntimeURL, slog.New(slog.DiscardHandler), func(app *fiber.App) {
		app.Get("/items/:id", func(fiber.Ctx) error { return fiber.ErrTeapot })
	})
	host := strings.TrimPrefix(baseURL, "http://")
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/health", 200},
		{"GET", "/items/first", 500},
		{"GET", "/items/second?q=private", 500},
		{"GET", "/absent/first", 404},
		{"GET", "/absent/second", 404},
		{"POST", "/health", 405},
		{"FIRST", "/absent", 501},
		{"SECOND", "/absent", 501},
	} {
		req := tc.method + " " + tc.path + " HTTP/1.1\r\nHost: " + host + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
		status, _, _ := rawRequest(t, host, req)
		if status != tc.status {
			t.Fatalf("%s %s: status %d, want %d", tc.method, tc.path, status, tc.status)
		}
	}
	head := "POST /api/v1/substitutes/search HTTP/1.1\r\nHost: " + host + "\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n"
	if got := partialRawRequest(t, host, head); got.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized request: status %d, want 413", got.status)
	}

	scrapeMetrics(t, baseURL)
	families := scrapeMetrics(t, baseURL)
	for _, name := range []string{"go_goroutines", "process_cpu_seconds_total"} {
		if families[name] == nil {
			t.Errorf("missing %s", name)
		}
	}
	want := map[[3]string]float64{
		{"GET", "/health", "200"}:     1,
		{"GET", "/items/:id", "500"}:  2,
		{"GET", "unmatched", "404"}:   2,
		{"POST", "unmatched", "405"}:  1,
		{"OTHER", "unmatched", "501"}: 2,
		{"POST", "unmatched", "413"}:  1,
	}
	for name, typ := range map[string]dto.MetricType{
		"obiad_http_requests_total":           dto.MetricType_COUNTER,
		"obiad_http_request_duration_seconds": dto.MetricType_HISTOGRAM,
	} {
		family := families[name]
		if family == nil || family.GetType() != typ || len(family.GetMetric()) != len(want) {
			t.Fatalf("%s: want a %s with %d series, got %v", name, typ, len(want), family)
		}
		for _, metric := range family.GetMetric() {
			labels := make(map[string]string)
			for _, label := range metric.GetLabel() {
				labels[label.GetName()] = label.GetValue()
			}
			wantCount, ok := want[[3]string{labels["method"], labels["route"], labels["status"]}]
			if !ok || len(labels) != 3 {
				t.Fatalf("%s: unexpected labels %v", name, labels)
			}
			count := metric.GetCounter().GetValue()
			if typ == dto.MetricType_HISTOGRAM {
				hist := metric.GetHistogram()
				count = float64(hist.GetSampleCount())
				if len(hist.GetBucket()) == 0 || hist.GetSampleSum() <= 0 {
					t.Errorf("%s%v: missing duration observations", name, labels)
				}
			}
			if count != wantCount {
				t.Errorf("%s%v: count %v, want %v", name, labels, count, wantCount)
			}
		}
	}

	otherURL, _ := startServer(t, db.RuntimeURL)
	other := scrapeMetrics(t, otherURL)
	if other["obiad_http_requests_total"] != nil || other["obiad_http_request_duration_seconds"] != nil {
		t.Error("the second server includes observations from the first server")
	}
}
