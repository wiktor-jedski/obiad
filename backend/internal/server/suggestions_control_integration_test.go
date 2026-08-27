package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/transport"
)

const maxQueryCodePoints = 128

type httpResult struct {
	status      int
	body        string
	contentType string
}

func getSuggestionsURL(t *testing.T, baseURL, rawPath string) httpResult {
	t.Helper()
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(baseURL + rawPath)
	if err != nil {
		t.Fatalf("GET %s: %v", rawPath, err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close %s response body: %v", rawPath, err)
		}
	}()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s body: %v", rawPath, err)
	}
	return httpResult{status: resp.StatusCode, body: string(raw), contentType: resp.Header.Get("Content-Type")}
}

func assertError(t *testing.T, result httpResult, wantStatus int, wantCode string, wantField string) {
	t.Helper()
	status, body, contentType := result.status, result.body, result.contentType
	if status != wantStatus {
		t.Fatalf("response status %d, want %d (body %s)", status, wantStatus, body)
	}
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type %q, want application/json", contentType)
	}
	want := `{"code":` + strconv.Quote(wantCode)
	if wantField != "" {
		want += `,"field":` + strconv.Quote(wantField)
	}
	want += "}"
	if body != want {
		t.Fatalf("body %q, want exactly %q (no unknown fields, no internal cause)", body, want)
	}
	for _, forbidden := range []string{
		"food_objects", "SELECT", "INSERT", "UPDATE", "password", "goroutine", ".go:", "stack",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("error response %q leaks forbidden content %q", body, forbidden)
		}
	}
}

func parseRawResponse(t *testing.T, raw []byte) (status int, contentType string, body string) {
	t.Helper()
	head, rest, found := bytes.Cut(raw, []byte("\r\n\r\n"))
	if !found {
		t.Fatalf("raw response %q has no header/body separator", raw)
	}
	lines := strings.Split(string(head), "\r\n")
	fields := strings.Fields(lines[0])
	if len(fields) < 2 {
		t.Fatalf("raw response status line %q", lines[0])
	}
	status, err := strconv.Atoi(fields[1])
	if err != nil {
		t.Fatalf("raw response status %q: %v", fields[1], err)
	}
	for _, line := range lines[1:] {
		if name, value, ok := strings.Cut(line, ":"); ok && strings.EqualFold(strings.TrimSpace(name), "Content-Type") {
			contentType = strings.TrimSpace(value)
		}
	}
	return status, contentType, string(rest)
}

func rawRequest(t *testing.T, addr, raw string) (status int, contentType string, body string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp4", addr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			t.Errorf("close raw request connection: %v", err)
		}
	}()
	if err := conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatalf("set connection deadline: %v", err)
	}
	if _, err := conn.Write([]byte(raw)); err != nil {
		t.Fatalf("write raw request: %v", err)
	}
	data, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read raw response: %v", err)
	}
	return parseRawResponse(t, data)
}

type suggestionResult struct {
	status      int
	body        string
	contentType string
	elapsed     time.Duration
	err         error
}

func getSuggestionsResult(addr, query, language string) suggestionResult {
	u := addr + "/api/v1/food-suggestions?query=" + url.QueryEscape(query) + "&language=" + url.QueryEscape(language)
	client := &http.Client{Timeout: 10 * time.Second}
	start := time.Now()
	resp, err := client.Get(u)
	if err != nil {
		return suggestionResult{err: err}
	}
	raw, readErr := io.ReadAll(resp.Body)
	closeErr := resp.Body.Close()
	if readErr != nil {
		return suggestionResult{err: readErr}
	}
	if closeErr != nil {
		return suggestionResult{err: fmt.Errorf("close response body: %w", closeErr)}
	}
	return suggestionResult{
		status:      resp.StatusCode,
		body:        string(raw),
		contentType: resp.Header.Get("Content-Type"),
		elapsed:     time.Since(start),
	}
}

const catalogQueryPrefix = "-- Persistence SELECT for the private concrete PostgreSQL Catalog Loader"

func runtimeCatalogQueryCount(t *testing.T, admin *pgx.Conn, role string) int {
	t.Helper()
	var count int
	if err := admin.QueryRow(context.Background(),
		`SELECT count(*) FROM pg_stat_activity WHERE usename = $1 AND state = 'active' AND query LIKE '`+catalogQueryPrefix+`%'`,
		role,
	).Scan(&count); err != nil {
		t.Fatalf("read pg_stat_activity: %v", err)
	}
	return count
}

type blockedQuerySampler struct {
	admin  *pgx.Conn
	role   string
	stopCh chan struct{}
	doneCh chan struct{}
	mu     sync.Mutex
	max    int
}

func newBlockedQuerySampler(t *testing.T, role string) *blockedQuerySampler {
	t.Helper()
	return &blockedQuerySampler{
		admin:  connect(t, adminDatabaseURL()),
		role:   role,
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}

func (s *blockedQuerySampler) start() {
	go func() {
		defer close(s.doneCh)
		for {
			select {
			case <-s.stopCh:
				return
			default:
			}
			var count int
			err := s.admin.QueryRow(context.Background(),
				`SELECT count(*) FROM pg_stat_activity WHERE usename = $1 AND state = 'active' AND query LIKE '`+catalogQueryPrefix+`%'`,
				s.role,
			).Scan(&count)
			if err == nil {
				s.mu.Lock()
				if count > s.max {
					s.max = count
				}
				s.mu.Unlock()
			}
			time.Sleep(15 * time.Millisecond)
		}
	}()
}

func (s *blockedQuerySampler) stop() {
	close(s.stopCh)
	<-s.doneCh
}

func (s *blockedQuerySampler) maxObserved() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.max
}

func waitForBlockedQuery(t *testing.T, admin *pgx.Conn, role string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if runtimeCatalogQueryCount(t, admin, role) >= 1 {
			return true
		}
		time.Sleep(25 * time.Millisecond)
	}
	return false
}

func waitForNoBlockedQuery(t *testing.T, admin *pgx.Conn, role string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if runtimeCatalogQueryCount(t, admin, role) == 0 {
			return true
		}
		time.Sleep(25 * time.Millisecond)
	}
	return false
}

func TestFoodSuggestionValidationHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)

	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?language=en"), 400, "INVALID_REQUEST", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a"), 400, "INVALID_REQUEST", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&query=b&language=en"), 400, "INVALID_REQUEST", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=en&language=pl"), 400, "INVALID_REQUEST", "language")

	base, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse server base URL %q: %v", baseURL, err)
	}
	raw := "GET /api/v1/food-suggestions?query=a\x01b&language=en HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	status, contentType, body := rawRequest(t, base.Host, raw)
	assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusBadRequest, "INVALID_REQUEST", "")

	malformedQuery := []string{
		"query=%ZZ&language=en",
		"query=%0G&language=en",
		"query=%&language=en",
		"query=%0&language=en",
		"query=a&language=%ZZ",
		"query=a&language=%G0",
		"query=a&language=%",
		"query=a&language=%0",
	}
	for _, queryString := range malformedQuery {
		raw := "GET /api/v1/food-suggestions?" + queryString + " HTTP/1.1\r\n" +
			"Host: " + base.Host + "\r\n" +
			"Connection: close\r\n" +
			"\r\n"
		status, contentType, body := rawRequest(t, base.Host, raw)
		assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusBadRequest, "INVALID_REQUEST", "")
	}

	lockedDB := newSetupDB(t)
	lockedBaseURL, _ := startServer(t, lockedDB.RuntimeURL)
	lockedOwner := connect(t, lockedDB.OwnerURL)
	if _, err := lockedOwner.Exec(context.Background(), "BEGIN"); err != nil {
		t.Fatalf("begin lock transaction: %v", err)
	}
	if _, err := lockedOwner.Exec(context.Background(), "LOCK TABLE food_objects IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatalf("lock food_objects in ACCESS EXCLUSIVE MODE: %v", err)
	}
	t.Cleanup(func() {
		_, _ = lockedOwner.Exec(context.Background(), "ROLLBACK")
	})
	lockedBase, err := url.Parse(lockedBaseURL)
	if err != nil {
		t.Fatalf("parse locked server base URL %q: %v", lockedBaseURL, err)
	}
	start := time.Now()
	raw = "GET /api/v1/food-suggestions?query=%ZZ&language=en HTTP/1.1\r\n" +
		"Host: " + lockedBase.Host + "\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	status, contentType, body = rawRequest(t, lockedBase.Host, raw)
	assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusBadRequest, "INVALID_REQUEST", "")
	if elapsed := time.Since(start); elapsed >= 200*time.Millisecond {
		t.Fatalf("malformed request took %v with the catalog locked, want well under the 450 ms deadline: malformed encoding must be rejected before any pgx attempt (a catalog query would block until the deadline)", elapsed)
	}
	control := getSuggestionsResult(lockedBaseURL, "pizza", "en")
	if control.err != nil {
		t.Fatalf("locked control request: %v", control.err)
	}
	assertError(t, httpResult{status: control.status, body: control.body, contentType: control.contentType}, http.StatusGatewayTimeout, "SEARCH_TIMEOUT", "")
	if control.elapsed < 350*time.Millisecond || control.elapsed > 900*time.Millisecond {
		t.Fatalf("locked control request returned after %v, want about 450 ms (the lock must block catalog reads for the no-pgx proof to be meaningful)", control.elapsed)
	}

	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=&language=en"), 422, "INVALID_SEARCH_QUERY", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape("   ")+"&language=en"), 422, "INVALID_SEARCH_QUERY", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape("\u00a0\u00a0\u3000")+"&language=en"), 422, "INVALID_SEARCH_QUERY", "query")

	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=%FF%FE&language=en"), 422, "INVALID_SEARCH_QUERY", "query")

	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape(strings.Repeat("a", maxQueryCodePoints+1))+"&language=en"), 422, "QUERY_TOO_LONG", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape(strings.Repeat("e\u0301", maxQueryCodePoints+1))+"&language=en"), 422, "QUERY_TOO_LONG", "query")

	getSuggestionsEnvelope(t, baseURL, strings.Repeat("a", maxQueryCodePoints), "en")
	getSuggestionsEnvelope(t, baseURL, strings.Repeat("e\u0301", maxQueryCodePoints), "en")
	getSuggestionsEnvelope(t, baseURL, "a"+strings.Repeat(" ", 200)+"b", "en")

	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=fr"), 422, "UNSUPPORTED_LANGUAGE", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=EN"), 422, "UNSUPPORTED_LANGUAGE", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=%FF"), 422, "UNSUPPORTED_LANGUAGE", "language")

	nfc := getSuggestionsEnvelope(t, baseURL, "pierś z kurczaka", "pl")
	nfd := getSuggestionsEnvelope(t, baseURL, "pier"+"s\u0301"+" z kurczaka", "pl")
	assertSameOrder(t, nfd, nfc)
	assertSuggestionItem(t, nfc.Items[0], "Chicken breast", "Pierś z kurczaka", 100, transport.FoodQuantityUnitG)
}

func TestFoodSuggestionFailuresHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)

	getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")

	adminConn := connect(t, adminDatabaseURL())
	if _, err := adminConn.Exec(ctx, "DROP DATABASE "+databaseName(t, db.RuntimeURL)+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop disposable database: %v", err)
	}
	for i := 0; i < 2; i++ {
		status, body, contentType := getSuggestions(t, baseURL, "pizza", "en")
		assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
	}

	invariantDB := newSetupDB(t)
	invariantBaseURL, _ := startServer(t, invariantDB.RuntimeURL)
	invariantOwner := connect(t, invariantDB.OwnerURL)
	if _, err := invariantOwner.Exec(ctx, "ALTER TABLE food_objects DROP CONSTRAINT food_objects_macro_profile_not_all_zero"); err != nil {
		t.Fatalf("drop macro profile constraint: %v", err)
	}
	if _, err := invariantOwner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (39, '{"en": "Zero", "pl": "Zero"}'::jsonb, 'solid', 0, 0, 0)`); err != nil {
		t.Fatalf("insert all-zero Macro Profile fixture row: %v", err)
	}
	status, body, contentType := getSuggestions(t, invariantBaseURL, "pizza", "en")
	assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusInternalServerError, "INTERNAL_ERROR", "")

	lockedDB := newSetupDB(t)
	lockedBaseURL, _ := startServer(t, lockedDB.RuntimeURL)
	lockedOwner := connect(t, lockedDB.OwnerURL)
	if _, err := lockedOwner.Exec(ctx, "BEGIN"); err != nil {
		t.Fatalf("begin lock transaction: %v", err)
	}
	if _, err := lockedOwner.Exec(ctx, "LOCK TABLE food_objects IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatalf("lock food_objects in ACCESS EXCLUSIVE MODE: %v", err)
	}
	t.Cleanup(func() {
		_, _ = lockedOwner.Exec(context.Background(), "ROLLBACK")
	})

	sampler := newBlockedQuerySampler(t, lockedDB.RuntimeRole)
	sampler.start()
	reqDone := make(chan suggestionResult, 1)
	go func() {
		reqDone <- getSuggestionsResult(lockedBaseURL, "pizza", "en")
	}()
	if !waitForBlockedQuery(t, adminConn, lockedDB.RuntimeRole, 400*time.Millisecond) {
		sampler.stop()
		t.Fatal("the catalog SELECT was never observed in PostgreSQL; the 450 ms deadline did not reach pgx")
	}
	deadlineResult := <-reqDone
	sampler.stop()
	if deadlineResult.err != nil {
		t.Fatalf("deadline request: %v", deadlineResult.err)
	}
	assertError(t, httpResult{status: deadlineResult.status, body: deadlineResult.body, contentType: deadlineResult.contentType}, http.StatusGatewayTimeout, "SEARCH_TIMEOUT", "")
	if deadlineResult.elapsed < 350*time.Millisecond || deadlineResult.elapsed > 900*time.Millisecond {
		t.Fatalf("deadline request returned after %v, want about 450 ms and strictly under 900 ms (single attempt, no retry)", deadlineResult.elapsed)
	}
	if got := sampler.maxObserved(); got != 1 {
		t.Fatalf("the deadline request ran %d concurrent catalog queries at most, want exactly 1 (one SELECT per request, no retry)", got)
	}
	if !waitForNoBlockedQuery(t, adminConn, lockedDB.RuntimeRole, 2*time.Second) {
		t.Fatal("a runtime backend stayed blocked in the catalog SELECT after SEARCH_TIMEOUT; the deadline did not cancel pgx")
	}

	const workers = 5
	startCh := make(chan struct{})
	results := make([]suggestionResult, workers)
	var wg sync.WaitGroup
	batchSampler := newBlockedQuerySampler(t, lockedDB.RuntimeRole)
	batchSampler.start()
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-startCh
			results[i] = getSuggestionsResult(lockedBaseURL, "pizza", "en")
		}(i)
	}
	close(startCh)
	wg.Wait()
	batchSampler.stop()
	for i, result := range results {
		if result.err != nil {
			t.Fatalf("pool-blocked request %d: %v", i, result.err)
		}
		assertError(t, httpResult{status: result.status, body: result.body, contentType: result.contentType}, http.StatusGatewayTimeout, "SEARCH_TIMEOUT", "")
		if result.elapsed < 350*time.Millisecond || result.elapsed > 900*time.Millisecond {
			t.Fatalf("pool-blocked request %d returned after %v, want about 450 ms and strictly under 900 ms (single attempt, no retry)", i, result.elapsed)
		}
	}
	if got := batchSampler.maxObserved(); got != workers-1 {
		t.Fatalf("the pool-blocking batch ran at most %d concurrent catalog queries, want exactly 4 (four requests with connections; the fifth never issued a query, no acquire retry)", got)
	}
	if !waitForNoBlockedQuery(t, adminConn, lockedDB.RuntimeRole, 2*time.Second) {
		t.Fatal("a runtime backend stayed blocked in the catalog SELECT after the pool-blocking batch; the deadlines did not cancel pgx")
	}
}

type logBuffer struct {
	mu    sync.Mutex
	lines []string
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lines = append(b.lines, string(p))
	return len(p), nil
}

func (b *logBuffer) snapshot() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.lines...)
}

type logRecord struct {
	RequestID  string  `json:"request_id"`
	Method     string  `json:"method"`
	Route      string  `json:"route"`
	Status     int     `json:"status"`
	DurationMs float64 `json:"duration_ms"`
	Code       string  `json:"code"`
	Cause      string  `json:"cause"`
}

func assertRequestLog(t *testing.T, record logRecord, wantMethod string, wantStatus int, wantCode, wantCauseSubstring, wantRoute string, forbidden []string) {
	t.Helper()
	if record.RequestID == "" {
		t.Fatalf("log record %+v has an empty request_id", record)
	}
	if record.Method != wantMethod {
		t.Fatalf("log record %+v method %q, want %q", record, record.Method, wantMethod)
	}
	if record.Route != wantRoute {
		t.Fatalf("log record %+v route %q, want %q (the route template)", record, record.Route, wantRoute)
	}
	if record.Status != wantStatus {
		t.Fatalf("log record %+v status %d, want %d", record, record.Status, wantStatus)
	}
	if record.DurationMs < 0 {
		t.Fatalf("log record %+v has negative duration %v", record, record.DurationMs)
	}
	if wantCode == "" {
		if record.Code != "" {
			t.Fatalf("successful log record %+v carries an error code %q", record, record.Code)
		}
		if record.Cause != "" {
			t.Fatalf("successful log record %+v carries an internal cause %q", record, record.Cause)
		}
	} else {
		if record.Code != wantCode {
			t.Fatalf("log record %+v code %q, want %q", record, record.Code, wantCode)
		}
		if wantCauseSubstring != "" && !strings.Contains(record.Cause, wantCauseSubstring) {
			t.Fatalf("log record %+v cause %q does not contain %q (internal cause must be logged server-side)", record, record.Cause, wantCauseSubstring)
		}
	}
	for _, sensitive := range forbidden {
		if strings.Contains(record.RequestID, sensitive) || strings.Contains(record.Method, sensitive) ||
			strings.Contains(record.Route, sensitive) || strings.Contains(record.Code, sensitive) ||
			strings.Contains(record.Cause, sensitive) {
			t.Fatalf("log record %+v leaks sensitive value %q", record, sensitive)
		}
	}
}

func TestSuggestionRequestLogIntegration(t *testing.T) {
	db := newSetupDB(t)
	var logs logBuffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
	baseURL, _ := startServerWithLogger(t, db.RuntimeURL, logger)

	runtimeURL, err := url.Parse(db.RuntimeURL)
	if err != nil {
		t.Fatalf("parse runtime URL: %v", err)
	}
	runtimePassword, _ := runtimeURL.User.Password()
	queryTokens := []string{"pizza", "secret-query-token-xyz"}

	getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")
	getSuggestionsEnvelope(t, baseURL, "secret-query-token-xyz", "en")
	invalidUTF8 := getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=%FF%FE&language=en")
	assertError(t, invalidUTF8, http.StatusUnprocessableEntity, "INVALID_SEARCH_QUERY", "query")
	unsupportedLanguage := "secret-language-token-xyz"
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language="+url.QueryEscape(unsupportedLanguage)), http.StatusUnprocessableEntity, "UNSUPPORTED_LANGUAGE", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?language=en"), http.StatusBadRequest, "INVALID_REQUEST", "query")
	base, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse server base URL %q: %v", baseURL, err)
	}
	raw := "GET /api/v1/food-suggestions?query=a\x01b&language=en HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	rawStatus, rawContentType, rawBody := rawRequest(t, base.Host, raw)
	assertError(t, httpResult{status: rawStatus, body: rawBody, contentType: rawContentType}, http.StatusBadRequest, "INVALID_REQUEST", "")

	lines := logs.snapshot()
	if len(lines) != 6 {
		t.Fatalf("captured %d log records, want exactly 6 (one per request): %q", len(lines), lines)
	}
	records := make([]logRecord, 0, len(lines))
	seenRequestIDs := make(map[string]bool, len(lines))
	for _, line := range lines {
		var record logRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line %q is not one JSON record: %v", line, err)
		}
		records = append(records, record)
		if seenRequestIDs[record.RequestID] {
			t.Fatalf("log records reuse request ID %q; every request must get a fresh ID", record.RequestID)
		}
		seenRequestIDs[record.RequestID] = true
	}

	forbidden := append([]string{}, queryTokens...)
	forbidden = append(forbidden, unsupportedLanguage, runtimePassword, "food_objects", "password", "goroutine", ".go:", "INSERT", "UPDATE")
	wantRoute := "/api/v1/food-suggestions"
	assertRequestLog(t, records[0], "GET", http.StatusOK, "", "", wantRoute, forbidden)
	assertRequestLog(t, records[1], "GET", http.StatusOK, "", "", wantRoute, forbidden)
	assertRequestLog(t, records[2], "GET", http.StatusUnprocessableEntity, "INVALID_SEARCH_QUERY", "not valid UTF-8", wantRoute, forbidden)
	assertRequestLog(t, records[3], "GET", http.StatusUnprocessableEntity, "UNSUPPORTED_LANGUAGE", "unsupported Interface Language", wantRoute, forbidden)
	assertRequestLog(t, records[4], "GET", http.StatusBadRequest, "INVALID_REQUEST", "missing", wantRoute, forbidden)
	assertRequestLog(t, records[5], "GET", http.StatusBadRequest, "INVALID_REQUEST", "", "", forbidden)
}

func TestUnexpectedHandlerErrorHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	var logs logBuffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
	baseURL, _ := startServerWithLogger(t, db.RuntimeURL, logger, func(app *fiber.App) {
		app.Get("/force-unexpected-error", func(c fiber.Ctx) error {
			return errors.New("forced unexpected handler failure")
		})
		app.Get("/force-unexpected-fiber-error", func(c fiber.Ctx) error {
			return fiber.NewError(fiber.StatusTeapot, "forced teapot failure")
		})
	})

	cases := []struct {
		path  string
		cause string
	}{
		{"/force-unexpected-error", "forced unexpected handler failure"},
		{"/force-unexpected-fiber-error", "forced teapot failure"},
	}
	client := &http.Client{Timeout: 10 * time.Second}
	for _, tc := range cases {
		resp, err := client.Get(baseURL + tc.path)
		if err != nil {
			t.Fatalf("GET %s: %v", tc.path, err)
		}
		rawBody, readErr := io.ReadAll(resp.Body)
		closeErr := resp.Body.Close()
		if readErr != nil {
			t.Fatalf("read %s body: %v", tc.path, readErr)
		}
		if closeErr != nil {
			t.Fatalf("close %s response body: %v", tc.path, closeErr)
		}
		assertError(t, httpResult{status: resp.StatusCode, body: string(rawBody), contentType: resp.Header.Get("Content-Type")}, http.StatusInternalServerError, "INTERNAL_ERROR", "")
		if strings.Contains(string(rawBody), "forced") {
			t.Fatalf("unexpected-failure response %q leaks the internal cause", rawBody)
		}
	}

	lines := logs.snapshot()
	if len(lines) != 2 {
		t.Fatalf("captured %d log records, want exactly 2 (one per forced failure): %q", len(lines), lines)
	}
	forbidden := []string{"food_objects", "password", "goroutine", ".go:", "INSERT", "UPDATE"}
	for i, line := range lines {
		var record logRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line %q is not one JSON record: %v", line, err)
		}
		assertRequestLog(t, record, "GET", http.StatusInternalServerError, "INTERNAL_ERROR", cases[i].cause, cases[i].path, forbidden)
	}
}
