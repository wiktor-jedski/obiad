package server

// Integration tests for task 14 (ARCH-008, ARCH-016, ARCH-019, ARCH-022):
// suggestion request control and failure handling. They require a real
// PostgreSQL server. Each test creates its isolated disposable database plus
// the schema-owner, SELECT-only runtime, and unprivileged login roles through
// the shared testdb support, runs the real setup command against it, grants
// the runtime role catalog SELECT exactly as the local deployment setup does,
// composes the real Fiber v3 application over the runtime pool, and serves it
// on an actual loopback listener (127.0.0.1:0, the ISSUE-004 test-composition
// address) that real HTTP clients call through real pgx.
//
// The validation test proves the ISSUE-004-resolved invalid-input mappings
// (missing, duplicated, malformed, normalized-empty, overlong, invalid-UTF-8,
// and unsupported-language inputs, including the post-normalization
// 128-code-point boundary and canonical equivalence for decomposed Unicode).
// The failures test proves the suggestion-relevant stable server errors with
// isolated real database outage, pool-blocking, and catalog-invariant
// scenarios, without response leakage or retry, and proves that the 450 ms
// deadline reaches pgx and returns SEARCH_TIMEOUT. The log test proves the
// structured request-log fields and the sensitive-value exclusions
// (P03-G2, P03-G9, P03-G10).

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

// maxQueryCodePoints is the largest accepted normalized Search Query in
// Unicode code points (ARCH-017); it mirrors the repository constant so the
// HTTP tests can build boundary queries without exporting Module internals.
const maxQueryCodePoints = 128

// httpResult is the outcome of one real HTTP request: status, raw body, and
// Content-Type header.
type httpResult struct {
	status      int
	body        string
	contentType string
}

// getSuggestionsURL performs a real GET /api/v1/food-suggestions request to
// the given raw URL path (already escaped by the caller) and returns the
// outcome. It is used for requests that the QueryEscape-based
// getSuggestions helper cannot express: missing or duplicated parameters and
// raw percent-encoded invalid UTF-8.
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

// assertError asserts the exact ISSUE-004 error response of one request: the
// HTTP status, the stable code, the optional field, application/json content
// type, and no unknown fields or internal cause. The exact body match proves
// the response never leaks SQL text, stack details, internal causes, or the
// offending input; the forbidden-substring check is a second, explicit
// no-leakage layer.
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

// parseRawResponse splits one raw HTTP/1.1 response into its status code,
// Content-Type header, and body.
func parseRawResponse(t *testing.T, raw []byte) (status int, contentType string, body string) {
	t.Helper()
	head, rest, found := bytes.Cut(raw, []byte("\r\n\r\n"))
	if !found {
		t.Fatalf("raw response %q has no header/body separator", raw)
	}
	lines := strings.Split(string(head), "\r\n")
	fields := strings.Fields(lines[0]) // "HTTP/1.1 400 Bad Request"
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

// rawRequest sends one raw HTTP/1.1 request over a fresh TCP connection to
// addr and returns the parsed response. It is used for requests that no HTTP
// client library can produce: a request line whose query encoding fasthttp
// cannot parse (malformed query encoding, ISSUE-004).
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

// suggestionResult is the outcome of one real suggestion request performed
// from a non-test goroutine (which must not call t.Fatal).
type suggestionResult struct {
	status      int
	body        string
	contentType string
	elapsed     time.Duration
	err         error
}

// getSuggestionsResult performs a real GET /api/v1/food-suggestions request
// and returns the outcome without touching the testing.T: it is safe to call
// from a goroutine.
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

// catalogQueryPrefix is the stable leading comment of the embedded catalog
// SELECT (backend/internal/repository/sql/catalog/load_food_objects.sql).
// pg_stat_activity truncates query text to track_activity_query_size (1024
// bytes by default), and the 1371-byte embedded statement keeps its SELECT
// part — including "FROM food_objects" — beyond the truncation. The header
// comment is within the first 1024 bytes and uniquely identifies the
// statement, so matching it proves a runtime backend is executing the catalog
// SELECT.
const catalogQueryPrefix = "-- Persistence SELECT for the private concrete PostgreSQL Catalog Loader"

// runtimeCatalogQueryCount returns how many backends of role currently
// execute the catalog SELECT inside PostgreSQL (state active). A query
// blocked on a table lock counts, which proves the deadline reaches pgx.
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

// blockedQuerySampler continuously samples how many backends of the runtime
// role are executing the catalog SELECT inside PostgreSQL and records the
// maximum concurrency observed. The server performs one fresh SELECT per
// request and never retries, so a single request must show a maximum of one
// blocked query and a batch against the four-connection pool a maximum of
// four — a retried query would push the maximum higher. The sampler owns its
// own admin connection because it runs on a separate goroutine.
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

// waitForBlockedQuery polls pg_stat_activity until at least one backend of
// role shows the catalog SELECT active (blocked) inside PostgreSQL, or until
// timeout elapses. It returns whether the blocked query was observed.
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

// waitForNoBlockedQuery polls pg_stat_activity until no backend of role is
// executing the catalog SELECT anymore, or until timeout elapses. It returns
// whether the backends went idle, proving the deadline cancellation reached
// PostgreSQL.
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

// TestFoodSuggestionValidationHTTPIntegration verifies the ISSUE-004-resolved
// invalid-input mappings of GET /api/v1/food-suggestions over an actual
// loopback Fiber listener backed by disposable real PostgreSQL: missing and
// duplicated required parameters return 400 INVALID_REQUEST with the offending
// field; malformed query encoding returns 400 INVALID_REQUEST without a field;
// normalized-empty (present-but-empty, ASCII-whitespace-only, and
// Unicode-whitespace-only) and invalid-UTF-8 Search Queries return
// 422 INVALID_SEARCH_QUERY with query; an overlong Search Query returns
// 422 QUERY_TOO_LONG with query, measured after normalization (the
// post-normalization 128-code-point boundary: raw queries of 256 code points
// that compose or collapse to 128 or fewer are accepted, raw 129-code-point
// queries are rejected); a language other than exact en or pl, including
// invalid UTF-8, returns 422 UNSUPPORTED_LANGUAGE with language; and
// canonically equivalent decomposed Unicode produces the same ordered
// suggestions as its NFC form (P03-G2).
func TestFoodSuggestionValidationHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)

	// Missing and duplicated required parameters: 400 INVALID_REQUEST with
	// the offending field (ISSUE-004). A present-but-empty parameter is not
	// missing — it reaches normalization.
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?language=en"), 400, "INVALID_REQUEST", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a"), 400, "INVALID_REQUEST", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&query=b&language=en"), 400, "INVALID_REQUEST", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=en&language=pl"), 400, "INVALID_REQUEST", "language")

	// Malformed query encoding: a control byte in the request-target makes the
	// request line unparseable for fasthttp, so no HTTP client library can
	// produce it. The app error handler answers 400 INVALID_REQUEST without a
	// field (ISSUE-004).
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

	// Malformed percent escapes in the raw query encoding: fasthttp's query
	// decoder keeps an invalid escape (e.g. %ZZ) or an incomplete one (e.g.
	// %0, a trailing %) as literal text, so the adapter validates the raw
	// query bytes itself before any decoding and rejects every malformed
	// escape with 400 INVALID_REQUEST without a field (ISSUE-004). net/http
	// refuses to send invalid escapes, so these fixtures go over raw TCP.
	malformedQuery := []string{
		"query=%ZZ&language=en", // invalid hexadecimal digits in query
		"query=%0G&language=en", // invalid second hex digit in query
		"query=%&language=en",   // trailing percent in query
		"query=%0&language=en",  // incomplete escape in query
		"query=a&language=%ZZ",  // invalid hexadecimal digits in language
		"query=a&language=%G0",  // invalid first hex digit in language
		"query=a&language=%",    // trailing percent in language
		"query=a&language=%0",   // incomplete escape in language
	}
	for _, queryString := range malformedQuery {
		raw := "GET /api/v1/food-suggestions?" + queryString + " HTTP/1.1\r\n" +
			"Host: " + base.Host + "\r\n" +
			"Connection: close\r\n" +
			"\r\n"
		status, contentType, body := rawRequest(t, base.Host, raw)
		assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusBadRequest, "INVALID_REQUEST", "")
	}

	// Malformed query encoding is rejected before any PostgreSQL access: on a
	// fresh disposable database whose catalog SELECT is blocked by an owner
	// ACCESS EXCLUSIVE lock (any real pgx read would stall until the 450 ms
	// deadline), the malformed request still returns the exact 400 response
	// promptly. A control request against the same locked server blocks until
	// the deadline and returns SEARCH_TIMEOUT, proving the lock is effective
	// and therefore that the malformed request really bypassed PostgreSQL.
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
	// Control: with the same lock held, a valid request reaches pgx, blocks,
	// and returns SEARCH_TIMEOUT at the 450 ms deadline.
	control := getSuggestionsResult(lockedBaseURL, "pizza", "en")
	if control.err != nil {
		t.Fatalf("locked control request: %v", control.err)
	}
	assertError(t, httpResult{status: control.status, body: control.body, contentType: control.contentType}, http.StatusGatewayTimeout, "SEARCH_TIMEOUT", "")
	if control.elapsed < 350*time.Millisecond || control.elapsed > 900*time.Millisecond {
		t.Fatalf("locked control request returned after %v, want about 450 ms (the lock must block catalog reads for the no-pgx proof to be meaningful)", control.elapsed)
	}

	// Normalized-empty Search Queries: present-but-empty, ASCII-whitespace-only,
	// and Unicode-whitespace-only (U+00A0, U+3000) all normalize to empty and
	// return 422 INVALID_SEARCH_QUERY with query (REQ-014, ISSUE-004).
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=&language=en"), 422, "INVALID_SEARCH_QUERY", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape("   ")+"&language=en"), 422, "INVALID_SEARCH_QUERY", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape("\u00a0\u00a0\u3000")+"&language=en"), 422, "INVALID_SEARCH_QUERY", "query")

	// Invalid-UTF-8 Search Query: raw percent-encoded bytes that do not form
	// valid UTF-8 return 422 INVALID_SEARCH_QUERY with query (ISSUE-004).
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=%FF%FE&language=en"), 422, "INVALID_SEARCH_QUERY", "query")

	// Overlong Search Queries: a raw 129-code-point query and a raw 258-code-
	// point query (129 NFC-composing pairs) both normalize above 128 code
	// points and return 422 QUERY_TOO_LONG with query (ARCH-017, ISSUE-004).
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape(strings.Repeat("a", maxQueryCodePoints+1))+"&language=en"), 422, "QUERY_TOO_LONG", "query")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query="+url.QueryEscape(strings.Repeat("e\u0301", maxQueryCodePoints+1))+"&language=en"), 422, "QUERY_TOO_LONG", "query")

	// The post-normalization 128-code-point boundary (ARCH-017): exactly 128
	// code points after NFC composition, whitespace collapsing, and lowercase
	// mapping are accepted. A raw 128-"a" query is the plain boundary; a raw
	// 256-code-point query of 128 decomposed é pairs composes to exactly 128
	// code points and is accepted; a raw 202-code-point query with 200 spaces
	// collapses to three code points and is accepted. Each accepted query
	// still returns the exact five-item success envelope.
	getSuggestionsEnvelope(t, baseURL, strings.Repeat("a", maxQueryCodePoints), "en")
	getSuggestionsEnvelope(t, baseURL, strings.Repeat("e\u0301", maxQueryCodePoints), "en")
	getSuggestionsEnvelope(t, baseURL, "a"+strings.Repeat(" ", 200)+"b", "en")

	// Unsupported language: any value other than the exact en or pl,
	// including invalid UTF-8, returns 422 UNSUPPORTED_LANGUAGE with language
	// (ISSUE-004). The exact-match rule rejects case variants too.
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=fr"), 422, "UNSUPPORTED_LANGUAGE", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=EN"), 422, "UNSUPPORTED_LANGUAGE", "language")
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language=%FF"), 422, "UNSUPPORTED_LANGUAGE", "language")

	// Canonical equivalence for decomposed Unicode (ARCH-017, REQ-014): the
	// NFC form "pierś z kurczaka" and the decomposed NFD form
	// "pier" + "s" + U+0301 + " z kurczaka" normalize to one identical query
	// and return the same ordered suggestions.
	nfc := getSuggestionsEnvelope(t, baseURL, "pierś z kurczaka", "pl")
	nfd := getSuggestionsEnvelope(t, baseURL, "pier"+"s\u0301"+" z kurczaka", "pl")
	assertSameOrder(t, nfd, nfc)
	assertSuggestionItem(t, nfc.Items[0], "Chicken breast", "Pierś z kurczaka", 100, transport.FoodQuantityUnitG)
}

// TestFoodSuggestionFailuresHTTPIntegration verifies every suggestion-relevant
// stable server error over an actual loopback Fiber listener backed by
// disposable real PostgreSQL, in isolated scenarios, without response leakage
// or retry: catalog storage outage returns 503 CATALOG_UNAVAILABLE;
// catalog-invariant rows return 500 INTERNAL_ERROR; the 450 ms request
// deadline reaches pgx and returns 504 SEARCH_TIMEOUT, also when the
// four-connection pool is exhausted; and every failed request is a single
// attempt — the elapsed time stays under two deadlines and no second catalog
// query ever appears (P03-G9).
func TestFoodSuggestionFailuresHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)

	// Warm the pool with one successful request (the exact five-item
	// envelope), so the outage scenario below exercises both a request over
	// a previously live pooled connection and a request that must create a
	// new connection.
	getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")

	// Isolated storage outage: the admin drops the disposable database,
	// terminating every backend including the pool's connections. Both a
	// request over a dead pooled connection and a request that must create a
	// new connection fail with the stable 503 CATALOG_UNAVAILABLE, no field,
	// and no internal cause, SQL text, or credentials in the response. The
	// pool performs one attempt per request: the 450 ms deadline bounds each
	// single attempt and nothing retries it.
	adminConn := connect(t, adminDatabaseURL())
	if _, err := adminConn.Exec(ctx, "DROP DATABASE "+databaseName(t, db.RuntimeURL)+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop disposable database: %v", err)
	}
	for i := 0; i < 2; i++ {
		status, body, contentType := getSuggestions(t, baseURL, "pizza", "en")
		assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
	}

	// Isolated catalog-invariant scenario: on a fresh disposable database the
	// schema owner drops the Macro Profile "not all zero" constraint and
	// inserts an all-zero row (the same isolated fixture the loader test
	// uses). PostgreSQL accepts the row, but it violates the ARCH-013 catalog
	// invariant, so the request fails with the stable 500 INTERNAL_ERROR, no
	// field, and no internal cause in the response.
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

	// Isolated deadline and pool-blocking scenario: on a fresh disposable
	// database the schema owner holds an ACCESS EXCLUSIVE lock on
	// food_objects in an open transaction, so every runtime catalog SELECT
	// blocks inside PostgreSQL. A single request's SELECT is observed blocked
	// in pg_stat_activity (the deadline reaches pgx), then the 450 ms
	// deadline cancels the pgx query and the response is 504 SEARCH_TIMEOUT.
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

	// The sampler observes every catalog query the server issues while the
	// request is in flight: a single request must show at most one blocked
	// query at any instant (one SELECT per request, no retry).
	sampler := newBlockedQuerySampler(t, lockedDB.RuntimeRole)
	sampler.start()
	reqDone := make(chan suggestionResult, 1)
	go func() {
		reqDone <- getSuggestionsResult(lockedBaseURL, "pizza", "en")
	}()
	// The catalog SELECT must become visible in PostgreSQL before the
	// deadline fires: if the 450 ms context did not reach pgx, no backend
	// would ever show it and the request would hang until the client timeout.
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
	// The deadline cancelled the pgx query: no runtime backend may stay
	// blocked in the catalog SELECT once the response arrived.
	if !waitForNoBlockedQuery(t, adminConn, lockedDB.RuntimeRole, 2*time.Second) {
		t.Fatal("a runtime backend stayed blocked in the catalog SELECT after SEARCH_TIMEOUT; the deadline did not cancel pgx")
	}

	// Pool blocking: five concurrent requests while the ACCESS EXCLUSIVE lock
	// is still held. The pool keeps zero minimum and four maximum connections
	// (ARCH-016), so four requests acquire a connection and block in the
	// catalog SELECT while the fifth blocks in pool Acquire. Every request
	// must fail with SEARCH_TIMEOUT at the ~450 ms deadline — the pool
	// exhaustion must not hang the server, a retry after the deadline would
	// double the elapsed time, and the fifth request must never issue a
	// catalog query (no acquire retry).
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

// logBuffer accumulates the JSON lines a test logger emits, synchronized so
// it is safe even if the server logs from concurrent request goroutines.
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

// logRecord is one structured request-log record (ARCH-019): request ID,
// method, route template, status, duration, stable error code, and internal
// cause. code and cause are omitted on success.
type logRecord struct {
	RequestID  string  `json:"request_id"`
	Method     string  `json:"method"`
	Route      string  `json:"route"`
	Status     int     `json:"status"`
	DurationMs float64 `json:"duration_ms"`
	Code       string  `json:"code"`
	Cause      string  `json:"cause"`
}

// assertRequestLog asserts the structured request-log contract for one
// request: the required fields are present with the expected values, the
// stable code and internal cause appear only when expected, and the record
// never carries query text, quantities, request bodies, SQL text,
// credentials, or stack details. The forbidden substrings are the distinct
// sensitive texts used by the test (query texts, request bodies, and the
// runtime password), so a log record that echoed any sensitive input fails
// here.
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

// TestSuggestionRequestLogIntegration verifies the ARCH-019 structured
// request logs over an actual loopback Fiber listener backed by disposable
// real PostgreSQL: every request produces one JSON record with request ID,
// method, route template, status, duration, and, for failures, the stable
// error code and the internal cause; and the records exclude the Search
// Query text, SQL parameters, database credentials, and stack details
// (P03-G10).
func TestSuggestionRequestLogIntegration(t *testing.T) {
	db := newSetupDB(t)
	var logs logBuffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
	baseURL, _ := startServerWithLogger(t, db.RuntimeURL, logger)

	// The runtime password proves credential exclusion: no record may ever
	// carry it (the password never appears in any logged cause because pgx
	// redacts it and the adapter never logs it).
	runtimeURL, err := url.Parse(db.RuntimeURL)
	if err != nil {
		t.Fatalf("parse runtime URL: %v", err)
	}
	runtimePassword, _ := runtimeURL.User.Password()
	queryTokens := []string{"pizza", "secret-query-token-xyz"}

	// A successful request: the record has the required fields, no code, and
	// no cause, and never echoes the query text.
	getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")
	// A successful request with a distinctive query text that must never
	// reach any log line.
	getSuggestionsEnvelope(t, baseURL, "secret-query-token-xyz", "en")
	// A validation failure: 422 INVALID_SEARCH_QUERY with the stable code and
	// the sanitized internal cause logged server-side.
	invalidUTF8 := getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=%FF%FE&language=en")
	assertError(t, invalidUTF8, http.StatusUnprocessableEntity, "INVALID_SEARCH_QUERY", "query")
	// An unsupported-language failure: 422 UNSUPPORTED_LANGUAGE. Its
	// client-controlled value must not reach the request log.
	unsupportedLanguage := "secret-language-token-xyz"
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?query=a&language="+url.QueryEscape(unsupportedLanguage)), http.StatusUnprocessableEntity, "UNSUPPORTED_LANGUAGE", "language")
	// A missing-parameter failure: 400 INVALID_REQUEST with the field.
	assertError(t, getSuggestionsURL(t, baseURL, "/api/v1/food-suggestions?language=en"), http.StatusBadRequest, "INVALID_REQUEST", "query")
	// A malformed request that never reaches the handler: the app error
	// handler answers 400 INVALID_REQUEST and logs the record itself.
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
	// The malformed request never matched a route: its record has no route
	// template, status 400, and the stable INVALID_REQUEST code.
	assertRequestLog(t, records[5], "GET", http.StatusBadRequest, "INVALID_REQUEST", "", "", forbidden)
}

// TestUnexpectedHandlerErrorHTTPIntegration verifies that an unexpected
// handler failure — one that is neither a router-level error nor a handled
// suggestion failure — is answered with the exact stable
// 500 {"code":"INTERNAL_ERROR"} response, with no field and no internal
// cause, while the sanitized internal cause appears only in the request log
// (ARCH-008, ISSUE-004, P03-G9). The failing routes are registered on the
// real composed application before the loopback listener starts, so the
// unexpected errors travel the exact production error path through Fiber.
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
		// Exact stable INTERNAL_ERROR response, no field, and no internal
		// cause: the response must not echo the forced failure text.
		assertError(t, httpResult{status: resp.StatusCode, body: string(rawBody), contentType: resp.Header.Get("Content-Type")}, http.StatusInternalServerError, "INTERNAL_ERROR", "")
		if strings.Contains(string(rawBody), "forced") {
			t.Fatalf("unexpected-failure response %q leaks the internal cause", rawBody)
		}
	}

	// Exactly one log record per request, with the stable code and the
	// sanitized internal cause server-side, the matched route template, and
	// no query, SQL, credential, or stack content.
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
