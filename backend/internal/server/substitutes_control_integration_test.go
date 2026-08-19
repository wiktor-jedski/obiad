package server

// Integration tests for task 20 (ARCH-005, ARCH-006, ARCH-008, ARCH-016,
// ARCH-019, ARCH-022): Substitute request control and failure handling.
// They require a real PostgreSQL server. Each test creates its isolated
// disposable database — plus the schema-owner, SELECT-only runtime, and
// unprivileged login roles the local deployment setup creates before
// dbsetup runs (ARCH-016, ISSUE-001) — through the shared testdb support,
// runs the real setup command against it, grants the runtime role catalog
// SELECT exactly as the local deployment setup does, composes the real
// Fiber v3 application over the runtime pool, and serves it on an actual
// loopback listener (127.0.0.1:0, the ISSUE-004 test-composition address)
// that real HTTP clients call through real pgx.
//
// The validation test proves the ISSUE-005-resolved request-control
// contract of POST /api/v1/substitutes/search: the accepted 4 KiB and
// rejected 4 KiB-plus-one request-body boundaries (413 REQUEST_BODY_TOO_LARGE
// without a field), enforced as a route-aware pre-read ingress cap — a raw
// request declaring a 100,000-byte Content-Length or a 100,000-byte chunk
// is rejected while the request is read, before the body is buffered, and
// an unrelated route keeps its default body limit; the strict
// content-type rule, the empty, malformed, trailing, unknown-key,
// duplicate-key, missing, null, and wrong-typed structural failures
// (400 INVALID_REQUEST with the exact field or omission), the semantic
// quantity, unit, Serving, and range failures (the specific 422 stable
// codes with their exact ISSUE-005 fields), and PAGE_OUT_OF_RANGE for every
// nonzero page index. The failures test proves every applicable stable
// server error — 400, 404, 413, 422, 503, 504, and 500 — with the exact
// ISSUE-005 field or omission and no response leakage, in isolated real
// database-outage, pool-blocking, deadline, and catalog-invariant
// scenarios, proves that the single 450 ms deadline reaches blocked pgx
// work and cancels it, and proves no retry: one catalog query per request,
// a maximum of four concurrent queries for a five-request pool-exhaustion
// batch, and every deadline response well under two deadlines. The log
// test proves the structured request-log fields and the sensitive-value
// exclusions: request ID, method, route template, status, duration, stable
// code, and an exact stable safe internal cause, with Food Quantities,
// units, unknown-key names, numeric tokens, request bodies, SQL text,
// credentials, and stack details excluded (P04-G2, P04-G4).
//
// The explicit ISSUE-003 and ISSUE-005 zero-result deviation is preserved:
// no test introduces a fake or unsupported catalog fixture to force a
// successful zero-item response, because zero eligible Substitutes are
// unreachable with the supported deterministic catalog.

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

// canonicalSubstituteBody is the closed ISSUE-005 request the semantic and
// failure tests send: Pizza Margherita (ID 1, solid, Serving 350 g) at one
// Serving, page 0. It is valid, small, and deterministic.
const canonicalSubstituteBody = `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`

// postSubstitutesResult performs a real POST /api/v1/substitutes/search
// request with the given Content-Type (empty means the header is left
// absent) and raw body and returns the httpResult for the stable-error
// assertions.
func postSubstitutesResult(t *testing.T, baseURL string, contentType string, body string) httpResult {
	t.Helper()
	status, responseBody, responseContentType := postSubstitutes(t, baseURL, contentType, body)
	return httpResult{status: status, body: responseBody, contentType: responseContentType}
}

// postTo performs a real POST of body to the given path with the given
// Content-Type and returns the status, the raw response body, and the
// response Content-Type header. It is used for unrelated-route requests
// that the substitutes helper cannot express (route-awareness proof).
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

// partialRawRequest writes head to a fresh TCP connection to addr and then
// reads the response without sending any further bytes. It proves the
// pre-read 4 KiB ingress limit: a request whose declared Content-Length or
// declared chunk already exceeds the limit must be rejected with the exact
// 413 response while the client has sent only the head. If the server tried
// to buffer the full declared body first, it would block on the missing
// bytes and the read deadline would expire instead, failing the test.
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

// TestSubstituteSearchValidationHTTPIntegration verifies the ISSUE-005-
// resolved request-control contract of POST /api/v1/substitutes/search over
// an actual loopback Fiber listener backed by disposable real PostgreSQL:
// the accepted 4 KiB and rejected 4 KiB-plus-one request-body boundaries
// (the limit fires before Content-Type and JSON processing, so even a
// structurally valid 4 KiB-plus-one body is refused with
// 413 REQUEST_BODY_TOO_LARGE without a field); the strict
// application/json Content-Type rule; the structural failures (empty,
// malformed, trailing, unknown-key, duplicate-key, missing, null, and
// wrong-typed known fields) with the exact ISSUE-005 field or omission;
// the semantic quantity, unit, Serving, and range failures with their
// specific stable 422 codes and exact fields, including the accepted
// 100,000 g and 100,000 ml converted-value boundaries and the rejected
// 100,001 boundaries; a nonpositive Food Object ID as
// 400 INVALID_REQUEST with foodObjectId; a negative page as
// 422 INVALID_PAGE_INDEX with pageIndex; and PAGE_OUT_OF_RANGE with
// pageIndex for every nonzero page (P04-G2, P04-G4).
func TestSubstituteSearchValidationHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	// The accepted 4 KiB boundary: a request body of exactly 4096 bytes —
	// the canonical closed object padded with trailing whitespace — is
	// accepted and returns the exact page-0 success envelope.
	padded4096 := canonicalSubstituteBody + strings.Repeat(" ", maxRequestBodyBytes-len(canonicalSubstituteBody))
	if len(padded4096) != maxRequestBodyBytes {
		t.Fatalf("padded boundary body length %d, want %d", len(padded4096), maxRequestBodyBytes)
	}
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, padded4096)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	// The rejected 4 KiB-plus-one boundary: the same closed object with one
	// more trailing byte is structurally valid JSON, so only the size guard
	// can reject it. It returns the exact 413 REQUEST_BODY_TOO_LARGE error
	// without a field and without any internal cause. The pre-read ingress
	// cap (fasthttp HeaderReceived in Compose) rejects it while the request
	// is read, before the body is buffered or any handler runs.
	oversized4097 := canonicalSubstituteBody + strings.Repeat(" ", maxRequestBodyBytes+1-len(canonicalSubstituteBody))
	if len(oversized4097) != maxRequestBodyBytes+1 {
		t.Fatalf("oversized boundary body length %d, want %d", len(oversized4097), maxRequestBodyBytes+1)
	}
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, oversized4097), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	// Pre-read Content-Length rejection: a raw request that declares a
	// 100,000-byte body and sends only the request head — no body bytes at
	// all — must still receive the exact 413 response promptly. If the
	// server buffered the declared body before enforcing the limit, it would
	// block waiting for the missing bytes and the read deadline would expire
	// instead. This proves the limit is an ingress cap, not a post-read
	// check, so a client can never stream a large entity into memory.
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

	// Pre-read chunked rejection: a raw request with a chunked body whose
	// first declared chunk is 100,000 bytes (hex 186a0) is rejected at the
	// chunk-size line, before any chunk payload is read — the client never
	// sends the 100,000 bytes. A server that buffered the body first would
	// block on the missing chunk payload and time out instead.
	chunkedHead := "POST /api/v1/substitutes/search HTTP/1.1\r\n" +
		"Host: " + base.Host + "\r\n" +
		"Content-Type: application/json\r\n" +
		"Transfer-Encoding: chunked\r\n" +
		"Connection: close\r\n" +
		"\r\n" +
		"186a0\r\n" // declares a 100,000-byte chunk; the payload is never sent
	assertError(t, partialRawRequest(t, base.Host, chunkedHead), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	// The ingress cap is route-aware: an unrelated route keeps the
	// server-wide default body limit. A POST to the suggestion route with a
	// body far over 4 KiB is not rejected as 413; it reaches routing and is
	// answered 405 Method Not Allowed.
	unrelatedBody := `{"query":` + strconv.Quote(strings.Repeat("x", 10000)) + `}`
	status, _, _ = postTo(t, baseURL, "/api/v1/food-suggestions", jsonType, unrelatedBody)
	if status != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/v1/food-suggestions with an over-4-KiB body status %d, want 405 (the ingress limit must be route-aware)", status)
	}

	// The 4 KiB limit fires before the Content-Type check: an oversized body
	// with a non-JSON Content-Type is refused as 413 (the resource guard
	// precedes the semantic media-type rule), while a small body with the
	// same Content-Type is the ordinary 400 INVALID_REQUEST without a field.
	assertError(t, postSubstitutesResult(t, baseURL, "text/plain", oversized4097), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")
	assertError(t, postSubstitutesResult(t, baseURL, "text/plain", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	// Strict Content-Type: a missing Content-Type and any other media type
	// return 400 INVALID_REQUEST without a field (ISSUE-005). A parameter on
	// application/json does not change the media type and is accepted.
	assertError(t, postSubstitutesResult(t, baseURL, "", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")
	assertError(t, postSubstitutesResult(t, baseURL, "application/x-www-form-urlencoded", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")
	assertError(t, postSubstitutesResult(t, baseURL, "application/json-patch+json", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")
	status, _, _ = postSubstitutes(t, baseURL, jsonType+"; charset=utf-8", canonicalSubstituteBody)
	if status != http.StatusOK {
		t.Fatalf("application/json; charset=utf-8 request status %d, want 200", status)
	}

	// Structural failures return 400 INVALID_REQUEST without a field:
	// empty, whitespace-only, and malformed bodies, trailing JSON, and an
	// unknown key at the root (closed request object, ISSUE-005).
	structuralCases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"whitespace-only body", "   "},
		{"unterminated object", `{"foodObjectId":1`},
		{"trailing text", canonicalSubstituteBody + " x"},
		{"trailing second object", canonicalSubstituteBody + canonicalSubstituteBody},
		{"unknown root key", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0,"extra":1}`},
	}
	for _, tc := range structuralCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			assertError(t, postSubstitutesResult(t, baseURL, jsonType, tc.body), http.StatusBadRequest, "INVALID_REQUEST", "")
		})
	}

	// Known-field structural failures return 400 INVALID_REQUEST with the
	// exact ISSUE-005 field path: a missing, duplicate, null, or wrong-typed
	// known field at the root or the nested quantity object.
	fieldCases := []struct {
		name  string
		body  string
		field string
	}{
		{"missing foodObjectId", `{"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, "foodObjectId"},
		{"duplicate quantity.unit", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving","unit":"g"},"pageIndex":0}`, "quantity.unit"},
		{"null pageIndex", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":null}`, "pageIndex"},
		{"wrong-typed quantity.value", `{"foodObjectId":1,"quantity":{"value":"100","unit":"serving"},"pageIndex":0}`, "quantity.value"},
		{"wrong-typed quantity object", `{"foodObjectId":1,"quantity":5,"pageIndex":0}`, "quantity"},
		{"fractional foodObjectId", `{"foodObjectId":1.5,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, "foodObjectId"},
	}
	for _, tc := range fieldCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			assertError(t, postSubstitutesResult(t, baseURL, jsonType, tc.body), http.StatusBadRequest, "INVALID_REQUEST", tc.field)
		})
	}

	// A nonpositive Food Object ID is semantically invalid but structurally
	// valid: it reaches the Module and returns 400 INVALID_REQUEST with
	// foodObjectId (ISSUE-005).
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":0,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`), http.StatusBadRequest, "INVALID_REQUEST", "foodObjectId")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":-5,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`), http.StatusBadRequest, "INVALID_REQUEST", "foodObjectId")

	// Semantic quantity failures: a nonpositive, negative, or fractional
	// direct base value and a nonpositive Serving count return
	// 422 INVALID_QUANTITY with quantity.value; an unsupported unit returns
	// 422 INVALID_QUANTITY with quantity.unit (ISSUE-005).
	invalidQuantityCases := []struct {
		name  string
		body  string
		field string
	}{
		{"zero direct grams", `{"foodObjectId":5,"quantity":{"value":0,"unit":"g"},"pageIndex":0}`, "quantity.value"},
		{"negative direct grams", `{"foodObjectId":5,"quantity":{"value":-5,"unit":"g"},"pageIndex":0}`, "quantity.value"},
		{"fractional direct grams", `{"foodObjectId":5,"quantity":{"value":1.5,"unit":"g"},"pageIndex":0}`, "quantity.value"},
		{"zero Serving count", `{"foodObjectId":1,"quantity":{"value":0,"unit":"serving"},"pageIndex":0}`, "quantity.value"},
		{"negative Serving count", `{"foodObjectId":1,"quantity":{"value":-1,"unit":"serving"},"pageIndex":0}`, "quantity.value"},
		{"unsupported unit", `{"foodObjectId":1,"quantity":{"value":1,"unit":"kg"},"pageIndex":0}`, "quantity.unit"},
		{"empty unit", `{"foodObjectId":1,"quantity":{"value":1,"unit":""},"pageIndex":0}`, "quantity.unit"},
	}
	for _, tc := range invalidQuantityCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			assertError(t, postSubstitutesResult(t, baseURL, jsonType, tc.body), http.StatusUnprocessableEntity, "INVALID_QUANTITY", tc.field)
		})
	}

	// Physical State unit mismatch: a gram quantity for the liquid Milk
	// (ID 10) and a millilitre quantity for the solid Pizza Margherita
	// (ID 1) return 422 QUANTITY_UNIT_MISMATCH with quantity.unit
	// (ARCH-018, ISSUE-005).
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":10,"quantity":{"value":100,"unit":"g"},"pageIndex":0}`), http.StatusUnprocessableEntity, "QUANTITY_UNIT_MISMATCH", "quantity.unit")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,"quantity":{"value":100,"unit":"ml"},"pageIndex":0}`), http.StatusUnprocessableEntity, "QUANTITY_UNIT_MISMATCH", "quantity.unit")

	// Unavailable Serving: a Serving-count quantity for Chicken breast
	// (ID 5, which has no stored Serving) returns
	// 422 SERVING_UNAVAILABLE with quantity.unit (ARCH-018, ISSUE-005).
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":5,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`), http.StatusUnprocessableEntity, "SERVING_UNAVAILABLE", "quantity.unit")

	// Converted-value range: a direct quantity over 100,000 g or 100,000 ml
	// and a Serving conversion over the 100,000 base-unit limit return
	// 422 QUANTITY_OUT_OF_RANGE with quantity.value. The exact boundaries —
	// 100,000 g, 100,000 ml, and a Serving conversion landing exactly on
	// 100,000 g (1000 × the 100 g Coleslaw Serving) — are accepted
	// (ARCH-018, ISSUE-005).
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":5,"quantity":{"value":100001,"unit":"g"},"pageIndex":0}`), http.StatusUnprocessableEntity, "QUANTITY_OUT_OF_RANGE", "quantity.value")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":10,"quantity":{"value":100001,"unit":"ml"},"pageIndex":0}`), http.StatusUnprocessableEntity, "QUANTITY_OUT_OF_RANGE", "quantity.value")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":32,"quantity":{"value":1001,"unit":"serving"},"pageIndex":0}`), http.StatusUnprocessableEntity, "QUANTITY_OUT_OF_RANGE", "quantity.value")
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, `{"foodObjectId":5,"quantity":{"value":100000,"unit":"g"},"pageIndex":0}`)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, `{"foodObjectId":10,"quantity":{"value":100000,"unit":"ml"},"pageIndex":0}`)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, `{"foodObjectId":32,"quantity":{"value":1000,"unit":"serving"},"pageIndex":0}`)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	// Page index failures: a negative page returns
	// 422 INVALID_PAGE_INDEX with pageIndex, and every nonzero page —
	// including the minimum page 1, the page-size boundary 3, and the
	// int32 maximum — returns 422 PAGE_OUT_OF_RANGE with pageIndex until
	// Phase 11 (ISSUE-005).
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":-1}`), http.StatusUnprocessableEntity, "INVALID_PAGE_INDEX", "pageIndex")
	for _, page := range []string{"1", "2", "3", "2147483647"} {
		body := `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":` + page + `}`
		assertError(t, postSubstitutesResult(t, baseURL, jsonType, body), http.StatusUnprocessableEntity, "PAGE_OUT_OF_RANGE", "pageIndex")
	}
}

// substituteResult is the outcome of one real substitute request performed
// from a non-test goroutine (which must not call t.Fatal).
type substituteResult struct {
	status      int
	body        string
	contentType string
	elapsed     time.Duration
	err         error
}

// postSubstitutesResultAsync performs a real POST /api/v1/substitutes/search
// request with the canonical body and returns the outcome without touching
// the testing.T: it is safe to call from a goroutine.
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

// TestSubstituteSearchFailuresHTTPIntegration verifies every substitute-
// relevant stable server error over an actual loopback Fiber listener backed
// by disposable real PostgreSQL, in isolated scenarios, without response
// leakage or retry: malformed JSON returns 400 INVALID_REQUEST; an absent
// positive Food Object ID returns 404 FOOD_OBJECT_NOT_FOUND with
// foodObjectId; an oversized body returns 413 REQUEST_BODY_TOO_LARGE; a
// nonzero page returns 422 PAGE_OUT_OF_RANGE with pageIndex; a catalog
// storage outage returns 503 CATALOG_UNAVAILABLE; the single 450 ms request
// deadline reaches blocked pgx work and returns 504 SEARCH_TIMEOUT, also
// when the four-connection pool is exhausted; and catalog-invariant rows
// return 500 INTERNAL_ERROR. Every failed request is a single attempt — the
// elapsed time stays under two deadlines and no second catalog query ever
// appears — and no response carries an internal cause, SQL text, or
// credential (P04-G2, P04-G4).
func TestSubstituteSearchFailuresHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	// Warm the pool with one successful request (the exact page-0 envelope),
	// so the outage scenario below exercises both a request over a
	// previously live pooled connection and a request that must create a
	// new connection.
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, canonicalSubstituteBody)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	// The client-parameter stable errors with the exact ISSUE-005 field or
	// omission and no response leakage: 400 without a field (malformed
	// JSON), 404 with foodObjectId (absent positive ID), 413 without a
	// field (a distinctive oversized body), and 422 with pageIndex (a
	// nonzero page; every nonzero page is covered by the validation test).
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,`), http.StatusBadRequest, "INVALID_REQUEST", "")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":9999,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`), http.StatusNotFound, "FOOD_OBJECT_NOT_FOUND", "foodObjectId")
	oversizedBody := `{"foodObjectId":1,` + strings.Repeat("secret-padding-token-xyz-", 170) + `"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, oversizedBody), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":1}`), http.StatusUnprocessableEntity, "PAGE_OUT_OF_RANGE", "pageIndex")

	// Isolated storage outage: the admin drops the disposable database,
	// terminating every backend including the pool's connections. Both a
	// request over a dead pooled connection and a request that must create
	// a new connection fail with the stable 503 CATALOG_UNAVAILABLE, no
	// field, and no internal cause, SQL text, or credentials in the
	// response. The pool performs one attempt per request: the 450 ms
	// deadline bounds each single attempt and nothing retries it.
	adminConn := connect(t, adminDatabaseURL())
	if _, err := adminConn.Exec(ctx, "DROP DATABASE "+databaseName(t, db.RuntimeURL)+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop disposable database: %v", err)
	}
	for range 2 {
		assertError(t, postSubstitutesResult(t, baseURL, jsonType, canonicalSubstituteBody), http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
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
	assertError(t, postSubstitutesResult(t, invariantBaseURL, jsonType, canonicalSubstituteBody), http.StatusInternalServerError, "INTERNAL_ERROR", "")

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
	reqDone := make(chan substituteResult, 1)
	go func() {
		reqDone <- postSubstitutesResultAsync(lockedBaseURL, canonicalSubstituteBody)
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

// TestSubstituteRequestLogIntegration verifies the ARCH-019 structured
// request logs of POST /api/v1/substitutes/search over an actual loopback
// Fiber listener backed by disposable real PostgreSQL: every request
// produces one JSON record with request ID, method, route template, status,
// duration, and, for failures, the stable error code and the internal
// cause. Adversarial requests carry distinctive Food Quantity values,
// units, unknown-key names, numeric tokens, Content-Type values, and body
// padding, and every record is asserted to carry the exact stable safe
// cause and to exclude those tokens, the raw request bodies, SQL
// parameters, database credentials, and stack details (P04-G2, P04-G4).
func TestSubstituteRequestLogIntegration(t *testing.T) {
	db := newSetupDB(t)
	var logs logBuffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
	baseURL, _ := startServerWithLogger(t, db.RuntimeURL, logger)
	const jsonType = "application/json"

	// The runtime password proves credential exclusion: no record may ever
	// carry it (the password never appears in any logged cause because pgx
	// redacts it and the adapter never logs it).
	runtimeURL, err := url.Parse(db.RuntimeURL)
	if err != nil {
		t.Fatalf("parse runtime URL: %v", err)
	}
	runtimePassword, _ := runtimeURL.User.Password()
	baseForbidden := []string{runtimePassword, "food_objects", "password", "goroutine", ".go:", "INSERT", "UPDATE"}

	// 1. A successful request with a distinctive quantity value 4321 and
	// unit g in the body: the record has the required fields, no code, and
	// no cause, and never echoes the request body — the raw body text is
	// the forbidden token.
	successBody := `{"foodObjectId":5,"quantity":{"value":4321,"unit":"g"},"pageIndex":0}`
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, successBody)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)

	// 2. An unknown key with a distinctive name: 400 INVALID_REQUEST without
	// a field, and the record's cause is the fixed "request body contains
	// an unknown field" — the client-supplied key name must never reach the
	// log (the task-20 safe-cause boundary, F-1).
	unknownKeyBody := `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0,"secret-unknown-key-xyz":1}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, unknownKeyBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	// 3. A converted-quantity range failure with a distinctive value 1E9
	// (g, on the solid Chicken breast): 422 QUANTITY_OUT_OF_RANGE with
	// quantity.value, and the record's cause is the fixed
	// "converted quantity exceeds the base-unit limit (field
	// quantity.value)" — neither the value nor the unit must reach the log
	// (the Module cause text carries both; F-1).
	rangeBody := `{"foodObjectId":5,"quantity":{"value":1E9,"unit":"g"},"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, rangeBody), http.StatusUnprocessableEntity, "QUANTITY_OUT_OF_RANGE", "quantity.value")

	// 4. A wrong-typed Food Object ID with a distinctive out-of-int32
	// numeric token 1E12: 400 INVALID_REQUEST with foodObjectId, and the
	// record's cause is the fixed "field foodObjectId is not a valid int32"
	// — the raw numeric token must never reach the log.
	bigIDBody := `{"foodObjectId":1E12,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, bigIDBody), http.StatusBadRequest, "INVALID_REQUEST", "foodObjectId")

	// 5. A non-JSON Content-Type with a distinctive header value: 400
	// INVALID_REQUEST without a field, and the record's cause is the fixed
	// "Content-Type is not application/json" — the client-supplied header
	// value must never reach the log.
	assertError(t, postSubstitutesResult(t, baseURL, "secret-content-type-xyz", canonicalSubstituteBody), http.StatusBadRequest, "INVALID_REQUEST", "")

	// 6. A missing positive Food Object: 404 FOOD_OBJECT_NOT_FOUND with
	// foodObjectId, and the record's cause is the fixed
	// "food object is absent from the catalog (field foodObjectId)" — the
	// absent ID must never reach the log.
	notFoundBody := `{"foodObjectId":9999,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, notFoundBody), http.StatusNotFound, "FOOD_OBJECT_NOT_FOUND", "foodObjectId")

	// 7. An oversized body with a distinctive padding token: 413
	// REQUEST_BODY_TOO_LARGE without a field, and the record's cause is the
	// fixed "request body exceeds the 4 KiB limit" — the body padding must
	// never reach the log.
	oversizedBody := `{"foodObjectId":1,` + strings.Repeat("secret-padding-token-xyz-", 170) + `"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	assertError(t, postSubstitutesResult(t, baseURL, jsonType, oversizedBody), http.StatusRequestEntityTooLarge, "REQUEST_BODY_TOO_LARGE", "")

	// 8. A deadline expiry: with the schema owner holding an ACCESS
	// EXCLUSIVE lock on food_objects, a valid request blocks in the catalog
	// SELECT until the single 450 ms deadline cancels pgx and the response
	// is 504 SEARCH_TIMEOUT; the record carries the stable code and the
	// fixed deadline cause text.
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
	// Every record forbids the raw request body text and its distinctive
	// client-supplied tokens: a record that echoed any request value, unit,
	// unknown key, numeric token, Content-Type value, or body padding would
	// fail. The causes are asserted exactly below, so the forbidden-token
	// scan is the second, explicit no-leakage layer.
	forbiddenByRecord := [][]string{
		append(append([]string{}, baseForbidden...), successBody),
		append(append([]string{}, baseForbidden...), unknownKeyBody, "secret-unknown-key-xyz"),
		append(append([]string{}, baseForbidden...), rangeBody, "1E9"),
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
		{http.StatusUnprocessableEntity, "QUANTITY_OUT_OF_RANGE", "converted quantity exceeds the base-unit limit (field quantity.value)", "/api/v1/substitutes/search"},
		{http.StatusBadRequest, "INVALID_REQUEST", "field foodObjectId is not a valid int32", "/api/v1/substitutes/search"},
		{http.StatusBadRequest, "INVALID_REQUEST", "Content-Type is not application/json", "/api/v1/substitutes/search"},
		{http.StatusNotFound, "FOOD_OBJECT_NOT_FOUND", "food object is absent from the catalog (field foodObjectId)", "/api/v1/substitutes/search"},
		// The pre-read ingress cap rejected this body while the request was
		// read, before any Fiber handler ran: no route matched, so the app
		// error handler's record has no route template (the same convention
		// as malformed requests that never reach the router).
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
