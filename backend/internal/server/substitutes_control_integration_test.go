package server

import (
	"context"
	"encoding/json"
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
)

const canonicalSubstituteBody = `{"foodObjectId":1,"pageIndex":0}`

func postSubstitutesResult(t *testing.T, baseURL string, contentType string, body string) httpResult {
	t.Helper()
	status, responseBody, responseContentType := postSubstitutes(t, baseURL, contentType, body)
	return httpResult{status: status, body: responseBody, contentType: responseContentType}
}

func postTo(t *testing.T, baseURL, path, contentType, body string) (status int, responseBody string, responseContentType string) {
	t.Helper()
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPost, baseURL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build POST %s request: %v", path, err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s (body %q): %v", path, body, err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close %s response body: %v", path, err)
		}
	}()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s body: %v", path, err)
	}
	return resp.StatusCode, string(raw), resp.Header.Get("Content-Type")
}

func partialRawRequest(t *testing.T, addr, head string) httpResult {
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
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set connection deadline: %v", err)
	}
	if _, err := conn.Write([]byte(head)); err != nil {
		t.Fatalf("write raw request head: %v", err)
	}
	data, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read raw response: %v", err)
	}
	status, contentType, body := parseRawResponse(t, data)
	return httpResult{status: status, body: body, contentType: contentType}
}

func TestSubstituteSearchValidationHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	padded4096 := canonicalSubstituteBody + strings.Repeat(" ", maxRequestBodyBytes-len(canonicalSubstituteBody))
	if len(padded4096) != maxRequestBodyBytes {
		t.Fatalf("padded boundary body length %d, want %d", len(padded4096), maxRequestBodyBytes)
	}
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, padded4096)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	oversized4097 := canonicalSubstituteBody + strings.Repeat(" ", maxRequestBodyBytes+1-len(canonicalSubstituteBody))
	if len(oversized4097) != maxRequestBodyBytes+1 {
		t.Fatalf("oversized boundary body length %d, want %d", len(oversized4097), maxRequestBodyBytes+1)
	}
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, oversized4097), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	base, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse server base URL %q: %v", baseURL, err)
	}
	contentLengthHead := "POST /api/v1/substitutes/search HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: 100000\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	assertError(t, partialRawRequest(t, base.Host, contentLengthHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	chunkedHead := "POST /api/v1/substitutes/search HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Transfer-Encoding: chunked\r\n" +
		"Connection: close\r\n" +
		"\r\n" +
		"186a0\r\n"
	assertError(t, partialRawRequest(t, base.Host, chunkedHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	absoluteHead := "POST http://" + base.Host + "/api/v1/substitutes/search HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: 100000\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	assertError(t, partialRawRequest(t, base.Host, absoluteHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	absoluteChunkedHead := "POST http://" + base.Host + "/api/v1/substitutes/search?query=1 HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Transfer-Encoding: chunked\r\n" +
		"Connection: close\r\n" +
		"\r\n" +
		"186a0\r\n"
	assertError(t, partialRawRequest(t, base.Host, absoluteChunkedHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	expectHead := "POST http://" + base.Host + "/api/v1/substitutes/search HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Expect: 100-continue\r\n" +
		"Content-Length: 100000\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	expectResult := partialRawRequest(t, base.Host, expectHead)
	if expectResult.status != http.StatusContinue {
		t.Fatalf("Expect request status %d, want the 100 Continue preface (body %q)", expectResult.status, expectResult.body)
	}
	status, expectContentType, expectBody := parseRawResponse(t, []byte(expectResult.body))
	assertError(t, httpResult{status: status, body: expectBody, contentType: expectContentType}, http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	malformedHead := "POST http://127.0.0.1:notaport/api/v1/substitutes/search HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: 100000\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	assertError(t, partialRawRequest(t, base.Host, malformedHead), http.StatusBadRequest, "INVALID_REQUEST", "")

	encodedSlashBody := `{"foodObjectId":1,` + strings.Repeat("x", 10000) + `}`
	status, encodedSlashRespBody, _ := postTo(t, baseURL, "/api/v1/substitutes%2Fsearch", jsonType, encodedSlashBody)
	if status != http.StatusNotFound {
		t.Fatalf("POST /api/v1/substitutes%%2Fsearch status %d, want 404 (encoded slash is unrelated to the route; the cap must not over-apply, body %q)", status, encodedSlashRespBody)
	}

	uppercaseHead := "POST /API/V1/SUBSTITUTES/SEARCH HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: 100000\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	assertError(t, partialRawRequest(t, base.Host, uppercaseHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	trailingSlashHead := "POST /api/v1/substitutes/search/ HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Content-Length: 100000\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	assertError(t, partialRawRequest(t, base.Host, trailingSlashHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	unrelatedBody := `{"query":` + strconv.Quote(strings.Repeat("x", 10000)) + `}`
	status, _, _ = postTo(t, baseURL, "/api/v1/food-suggestions", jsonType, unrelatedBody)
	if status != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/v1/food-suggestions with an over-4-KiB body status %d, want 405 (the ingress limit must be route-aware)", status)
	}

	assertError(t, postSubstitutesResult(t, baseURL, "text/plain", oversized4097), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")
	assertError(t, postSubstitutesResult(t, baseURL, "text/plain", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	assertError(t, postSubstitutesResult(t, baseURL, "", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")
	assertError(t, postSubstitutesResult(t, baseURL, "application/x-www-form-urlencoded", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")
	assertError(t, postSubstitutesResult(t, baseURL, "application/json-patch+json", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")
	status, _, _ = postSubstitutes(t, baseURL, jsonType+"; charset=utf-8", canonicalSubstituteBody)
	if status != http.StatusOK {
		t.Fatalf("application/json; charset=utf-8 request status %d, want 200", status)
	}

	structuralCases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"whitespace-only body", "   "},
		{"unterminated object", `{"foodObjectId":1`},
		{"trailing text", canonicalSubstituteBody + " x"},
		{"trailing second object", canonicalSubstituteBody + canonicalSubstituteBody},
		{"unknown root key", `{"foodObjectId":1,"pageIndex":0,"extra":1}`},
		{"quantity field rejected as unknown", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`},
	}
	for _, tc := range structuralCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			assertError(t, postSubstitutesResult(t, baseURL, jsonType, tc.body), http.StatusBadRequest, "INVALID_REQUEST", "")
		})
	}

	fieldCases := []struct {
		name  string
		body  string
		field string
	}{
		{"missing foodObjectId", `{"pageIndex":0}`, "foodObjectId"},
		{"missing pageIndex", `{"foodObjectId":1}`, "pageIndex"},
		{"duplicate foodObjectId", `{"foodObjectId":1,"foodObjectId":2,"pageIndex":0}`, "foodObjectId"},
		{"duplicate pageIndex", `{"foodObjectId":1,"pageIndex":0,"pageIndex":1}`, "pageIndex"},
		{"null foodObjectId", `{"foodObjectId":null,"pageIndex":0}`, "foodObjectId"},
		{"null pageIndex", `{"foodObjectId":1,"pageIndex":null}`, "pageIndex"},
		{"wrong-typed foodObjectId", `{"foodObjectId":"1","pageIndex":0}`, "foodObjectId"},
		{"wrong-typed pageIndex", `{"foodObjectId":1,"pageIndex":true}`, "pageIndex"},
		{"fractional foodObjectId", `{"foodObjectId":1.5,"pageIndex":0}`, "foodObjectId"},
		{"fractional pageIndex", `{"foodObjectId":1,"pageIndex":1.5}`, "pageIndex"},
	}
	for _, tc := range fieldCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			assertError(t, postSubstitutesResult(t, baseURL, jsonType, tc.body), http.StatusBadRequest, "INVALID_REQUEST", tc.field)
		})
	}

	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":0,"pageIndex":0}`), http.StatusBadRequest, "INVALID_REQUEST", "foodObjectId")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":-5,"pageIndex":0}`), http.StatusBadRequest, "INVALID_REQUEST", "foodObjectId")

	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,"pageIndex":-1}`), http.StatusUnprocessableEntity, "INVALID_PAGE_INDEX", "pageIndex")
	for _, page := range []string{"1", "2", "3", "11"} {
		body := `{"foodObjectId":1,"pageIndex":` + page + `}`
		status, body, contentType := postSubstitutes(t, baseURL, jsonType, body)
		assertSubstituteSuccessEnvelope(t, status, body, contentType)
	}
	for _, page := range []string{"12", "13", "2147483647"} {
		body := `{"foodObjectId":1,"pageIndex":` + page + `}`
		assertError(t, postSubstitutesResult(t, baseURL, jsonType, body), http.StatusUnprocessableEntity, "PAGE_OUT_OF_RANGE", "pageIndex")
	}
}

type substituteResult struct {
	status      int
	body        string
	contentType string
	elapsed     time.Duration
	err         error
}

func postSubstitutesResultAsync(addr, body string) substituteResult {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPost, addr+"/api/v1/substitutes/search", strings.NewReader(body))
	if err != nil {
		return substituteResult{err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return substituteResult{err: err}
	}
	raw, readErr := io.ReadAll(resp.Body)
	closeErr := resp.Body.Close()
	if readErr != nil {
		return substituteResult{err: readErr}
	}
	if closeErr != nil {
		return substituteResult{err: closeErr}
	}
	return substituteResult{
		status:      resp.StatusCode,
		body:        string(raw),
		contentType: resp.Header.Get("Content-Type"),
		elapsed:     time.Since(start),
	}
}

func TestSubstituteSearchFailuresHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	status, body, contentType := postSubstitutes(t, baseURL, jsonType, canonicalSubstituteBody)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,`), http.StatusBadRequest, "INVALID_REQUEST", "")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":9999,"pageIndex":0}`), http.StatusNotFound, "FOOD_OBJECT_NOT_FOUND", "foodObjectId")
	oversizedBody := `{"foodObjectId":1,` + strings.Repeat("secret-padding-token-xyz-", 170) + `"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, oversizedBody), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,"pageIndex":12}`), http.StatusUnprocessableEntity, "PAGE_OUT_OF_RANGE", "pageIndex")

	adminConn := connect(t, adminDatabaseURL())
	if _, err := adminConn.Exec(ctx, "DROP DATABASE "+databaseName(t, db.RuntimeURL)+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop disposable database: %v", err)
	}
	for range 2 {
		assertError(t, postSubstitutesResult(t, baseURL, jsonType, canonicalSubstituteBody), http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
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
	assertError(t, postSubstitutesResult(t, invariantBaseURL, jsonType, canonicalSubstituteBody), http.StatusInternalServerError, "INTERNAL_ERROR", "")

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
	reqDone := make(chan substituteResult, 1)
	go func() {
		reqDone <- postSubstitutesResultAsync(lockedBaseURL, canonicalSubstituteBody)
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
	results := make([]substituteResult, workers)
	var wg sync.WaitGroup
	batchSampler := newBlockedQuerySampler(t, lockedDB.RuntimeRole)
	batchSampler.start()
	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-startCh
			results[i] = postSubstitutesResultAsync(lockedBaseURL, canonicalSubstituteBody)
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

func TestSubstituteRequestLogIntegration(t *testing.T) {
	db := newSetupDB(t)
	var logs logBuffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
	baseURL, _ := startServerWithLogger(t, db.RuntimeURL, logger)
	const jsonType = "application/json"

	runtimeURL, err := url.Parse(db.RuntimeURL)
	if err != nil {
		t.Fatalf("parse runtime URL: %v", err)
	}
	runtimePassword, _ := runtimeURL.User.Password()
	baseForbidden := []string{runtimePassword, "food_objects", "password", "goroutine", ".go:", "INSERT", "UPDATE"}

	successBody := `{"foodObjectId":5,"pageIndex":0}`
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, successBody)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	unknownKeyBody := `{"foodObjectId":1,"pageIndex":0,"secret-unknown-key-xyz":1}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, unknownKeyBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	unknownQuantityBody := `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, unknownQuantityBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	bigIDBody := `{"foodObjectId":1E12,"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, bigIDBody), http.StatusBadRequest, "INVALID_REQUEST", "foodObjectId")

	assertError(t, postSubstitutesResult(t, baseURL, "secret-content-type-xyz", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	notFoundBody := `{"foodObjectId":9999,"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, notFoundBody), http.StatusNotFound, "FOOD_OBJECT_NOT_FOUND", "foodObjectId")

	oversizedBody := `{"foodObjectId":1,` + strings.Repeat("secret-padding-token-xyz-", 170) + `"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, oversizedBody), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	owner := connect(t, db.OwnerURL)
	if _, err := owner.Exec(context.Background(), "BEGIN"); err != nil {
		t.Fatalf("begin lock transaction: %v", err)
	}
	if _, err := owner.Exec(context.Background(), "LOCK TABLE food_objects IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatalf("lock food_objects in ACCESS EXCLUSIVE MODE: %v", err)
	}
	t.Cleanup(func() {
		_, _ = owner.Exec(context.Background(), "ROLLBACK")
	})
	deadlineBody := canonicalSubstituteBody
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, deadlineBody), http.StatusGatewayTimeout, "SEARCH_TIMEOUT", "")

	lines := logs.snapshot()
	if len(lines) != 8 {
		t.Fatalf("captured %d log records, want exactly 8 (one per request): %q", len(lines), lines)
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
	forbiddenByRecord := [][]string{
		append(append([]string{}, baseForbidden...), successBody),
		append(append([]string{}, baseForbidden...), unknownKeyBody, "secret-unknown-key-xyz"),
		append(append([]string{}, baseForbidden...), unknownQuantityBody, "quantity"),
		append(append([]string{}, baseForbidden...), bigIDBody, "1E12"),
		append(append([]string{}, baseForbidden...), "secret-content-type-xyz"),
		append(append([]string{}, baseForbidden...), notFoundBody, "9999"),
		append(append([]string{}, baseForbidden...), oversizedBody, "secret-padding-token-xyz"),
		append(append([]string{}, baseForbidden...), deadlineBody),
	}
	want := []struct {
		status int
		code   string
		cause  string
		route  string
	}{
		{http.StatusOK, "", "", "/api/v1/substitutes/search"},
		{http.StatusBadRequest, "INVALID_REQUEST", "request body contains an unknown field", "/api/v1/substitutes/search"},
		{http.StatusBadRequest, "INVALID_REQUEST", "request body contains an unknown field", "/api/v1/substitutes/search"},
		{http.StatusBadRequest, "INVALID_REQUEST", "field foodObjectId is not a valid int32", "/api/v1/substitutes/search"},
		{http.StatusBadRequest, "INVALID_REQUEST", "Content-Type is not application/json", "/api/v1/substitutes/search"},
		{http.StatusNotFound, "FOOD_OBJECT_NOT_FOUND", "food object is absent from the catalog (field foodObjectId)", "/api/v1/substitutes/search"},
		{http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "request body exceeds the 4 KiB limit", ""},
		{http.StatusGatewayTimeout, "SEARCH_TIMEOUT", deadlineLogCause, "/api/v1/substitutes/search"},
	}
	for i, record := range records {
		assertRequestLog(t, record, http.MethodPost, want[i].status, want[i].code, "", want[i].route, forbiddenByRecord[i])
		if record.Cause != want[i].cause {
			t.Fatalf("log record %d cause %q, want exactly %q (no client values, units, unknown keys, numeric tokens, body text, SQL, credentials, or stack details)", i, record.Cause, want[i].cause)
		}
	}
}
