package server

// Integration tests for task 19 (ARCH-005, ARCH-008, ARCH-016, ARCH-019,
// ARCH-022): the Fiber Adapter for POST /api/v1/substitutes/search. They
// require a real PostgreSQL server. Each test creates its isolated
// disposable database — plus the schema-owner, SELECT-only runtime, and
// unprivileged login roles the local deployment setup creates before
// dbsetup runs (ARCH-016, ISSUE-001) — through the shared testdb support,
// runs the real setup command against it, grants the runtime role catalog
// SELECT exactly as the local deployment setup does, composes the real
// Fiber v3 application over the runtime pool, and serves it on an actual
// loopback listener (127.0.0.1:0, the ISSUE-004 test-composition address)
// that real HTTP clients call.
//
// TestSubstituteSearchHTTPIntegration proves the exact ISSUE-005 success
// contract (P04-G4): the strict page-0 success field sets with no unknown
// fields at any nesting level, the designated page-0 order and exact
// display values for the three seeded inputs, three unique items, the exact
// totalEligibleCount and hasMore, both localized names, omitted and present
// image keys, serving/g/ml inputs, and solid g plus liquid ml whole Matched
// Quantity outputs. TestSubstituteSearchContractHTTPIntegration proves the
// task-19 strict decoder paths: only application/json is accepted, and
// empty, malformed, trailing, unknown-key, and duplicate-key JSON at every
// nesting level are rejected with 400 INVALID_REQUEST — without a field for
// structural failures and unknown keys, and with the exact ISSUE-005 field
// path for missing, duplicate, null, or wrong-typed known fields. The
// admin connection comes from OBIAD_TEST_ADMIN_DATABASE_URL or from
// libpq-style environment variables; no credential is committed and tests
// skip when no server is reachable.

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"obiad/backend/internal/transport"
)

// postSubstitutes performs a real POST /api/v1/substitutes/search request
// with the given Content-Type (empty means the header is left absent) and
// raw body and returns the status, the raw response body, and the
// response Content-Type header.
func postSubstitutes(t *testing.T, baseURL string, contentType string, body string) (status int, responseBody string, responseContentType string) {
	t.Helper()
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/substitutes/search", strings.NewReader(body))
	if err != nil {
		t.Fatalf("build POST /api/v1/substitutes/search request: %v", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /api/v1/substitutes/search (body %q): %v", body, err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close substitutes search response body: %v", err)
		}
	}()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read substitutes search body: %v", err)
	}
	return resp.StatusCode, string(raw), resp.Header.Get("Content-Type")
}

// assertSubstituteSuccessEnvelope asserts the exact ISSUE-005 success shape
// of a substitute search response: status 200, application/json, and a body
// with no unknown fields at any nesting level — exactly the pageIndex,
// totalEligibleCount, hasMore, and items envelope, every item with exactly
// foodObjectId, names, matchedQuantity, macronutrients, and
// similarityPercent plus the optional imageKey exactly when present, names
// with exactly en and pl, matchedQuantity with exactly value and unit, and
// macronutrients with exactly protein, carbohydrate, and fat
// (additionalProperties: false). It returns the decoded generated envelope.
func assertSubstituteSuccessEnvelope(t *testing.T, status int, body string, contentType string) transport.SubstituteSearchResponse {
	t.Helper()
	if status != http.StatusOK {
		t.Fatalf("POST /api/v1/substitutes/search status %d, want 200 (body %s)", status, body)
	}
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type %q, want application/json", contentType)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		t.Fatalf("body %q is not valid JSON: %v", body, err)
	}
	assertExactFieldSet(t, envelope, "response envelope", "pageIndex", "totalEligibleCount", "hasMore", "items")
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["items"], &items); err != nil {
		t.Fatalf("items %q is not a JSON array: %v", envelope["items"], err)
	}
	for i, item := range items {
		// imageKey is optional: present exactly when the Food Object has an
		// image and never null (ISSUE-005). The per-item value assertions
		// below also pin the present key to the seeded opaque key.
		wantFields := []string{"foodObjectId", "names", "matchedQuantity", "macronutrients", "similarityPercent"}
		if _, ok := item["imageKey"]; ok {
			wantFields = append(wantFields, "imageKey")
		}
		assertExactFieldSet(t, item, "item", wantFields...)
		var names map[string]json.RawMessage
		if err := json.Unmarshal(item["names"], &names); err != nil {
			t.Fatalf("item %d names %q is not a JSON object: %v", i, item["names"], err)
		}
		assertExactFieldSet(t, names, "names", "en", "pl")
		var matched map[string]json.RawMessage
		if err := json.Unmarshal(item["matchedQuantity"], &matched); err != nil {
			t.Fatalf("item %d matchedQuantity %q is not a JSON object: %v", i, item["matchedQuantity"], err)
		}
		assertExactFieldSet(t, matched, "matchedQuantity", "value", "unit")
		var macros map[string]json.RawMessage
		if err := json.Unmarshal(item["macronutrients"], &macros); err != nil {
			t.Fatalf("item %d macronutrients %q is not a JSON object: %v", i, item["macronutrients"], err)
		}
		assertExactFieldSet(t, macros, "macronutrients", "protein", "carbohydrate", "fat")
	}
	var response transport.SubstituteSearchResponse
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		t.Fatalf("body %q does not match the generated SubstituteSearchResponse: %v", body, err)
	}
	return response
}

// wantSubstituteItem is one exact ISSUE-005 page-0 success expectation: the
// stable Food Object ID, both localized names, the optional image key (nil
// when omitted), the whole Matched Quantity value and unit, the three
// scaled macronutrients, and the whole similarity percentage.
type wantSubstituteItem struct {
	id                int32
	en                string
	pl                string
	imageKey          *string
	matchedValue      int64
	matchedUnit       transport.MatchedQuantityUnit
	protein           float64
	carbohydrate      float64
	fat               float64
	similarityPercent int32
}

// assertSubstituteItem checks one decoded substitute item against an exact
// expectation (task 19, P04-G4).
func assertSubstituteItem(t *testing.T, item transport.SubstituteItem, want wantSubstituteItem) {
	t.Helper()
	if item.FoodObjectId != want.id {
		t.Fatalf("item has ID %d, want %d", item.FoodObjectId, want.id)
	}
	if item.Names.En != want.en || item.Names.Pl != want.pl {
		t.Fatalf("item %d names %+v, want en=%q pl=%q", item.FoodObjectId, item.Names, want.en, want.pl)
	}
	if want.imageKey == nil {
		if item.ImageKey != nil {
			t.Fatalf("item %d imageKey %q, want it omitted", item.FoodObjectId, *item.ImageKey)
		}
	} else if item.ImageKey == nil || *item.ImageKey != *want.imageKey {
		t.Fatalf("item %d imageKey %v, want %q", item.FoodObjectId, item.ImageKey, *want.imageKey)
	}
	if item.MatchedQuantity.Value != want.matchedValue || item.MatchedQuantity.Unit != want.matchedUnit {
		t.Fatalf("item %d matchedQuantity %+v, want value %d unit %q", item.FoodObjectId, item.MatchedQuantity, want.matchedValue, want.matchedUnit)
	}
	if item.Macronutrients.Protein != want.protein || item.Macronutrients.Carbohydrate != want.carbohydrate || item.Macronutrients.Fat != want.fat {
		t.Fatalf("item %d macronutrients (%v, %v, %v), want (%v, %v, %v)", item.FoodObjectId, item.Macronutrients.Protein, item.Macronutrients.Carbohydrate, item.Macronutrients.Fat, want.protein, want.carbohydrate, want.fat)
	}
	if item.SimilarityPercent != want.similarityPercent {
		t.Fatalf("item %d similarityPercent %d, want %d", item.FoodObjectId, item.SimilarityPercent, want.similarityPercent)
	}
}

// assertSubstitutePage checks the exact page-0 envelope of a decoded
// substitute response: the echoed page index 0, the total eligible count,
// hasMore, exactly three unique items in the designated order, and each
// item's exact values.
func assertSubstitutePage(t *testing.T, response transport.SubstituteSearchResponse, totalEligibleCount int32, hasMore bool, wants ...wantSubstituteItem) {
	t.Helper()
	if response.PageIndex != 0 {
		t.Fatalf("pageIndex %d, want 0", response.PageIndex)
	}
	if response.TotalEligibleCount != totalEligibleCount {
		t.Fatalf("totalEligibleCount %d, want %d", response.TotalEligibleCount, totalEligibleCount)
	}
	if response.HasMore != hasMore {
		t.Fatalf("hasMore %v, want %v", response.HasMore, hasMore)
	}
	if len(response.Items) != len(wants) {
		t.Fatalf("page 0 has %d items, want %d", len(response.Items), len(wants))
	}
	seen := make(map[int32]bool, len(response.Items))
	for i, want := range wants {
		if seen[response.Items[i].FoodObjectId] {
			t.Fatalf("page 0 item ID %d is not unique", response.Items[i].FoodObjectId)
		}
		seen[response.Items[i].FoodObjectId] = true
		assertSubstituteItem(t, response.Items[i], want)
	}
}

// strPtr returns a pointer to s for the optional image-key expectations.
func strPtr(s string) *string { return &s }

// assertInvalidRequest asserts one task-19 strict-decoder failure: status
// 400, application/json, and the exact generated Error JSON with the stable
// code INVALID_REQUEST and the given ISSUE-005 field path (empty for
// structural failures and unknown keys) and no other fields.
func assertInvalidRequest(t *testing.T, status int, body string, contentType string, wantField transport.ErrorField) {
	t.Helper()
	if status != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 (body %s)", status, body)
	}
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type %q, want application/json", contentType)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		t.Fatalf("body %q is not valid JSON: %v", body, err)
	}
	if wantField == "" {
		assertExactFieldSet(t, envelope, "error envelope", "code")
		if string(envelope["code"]) != strconv.Quote("INVALID_REQUEST") {
			t.Fatalf("code %s, want INVALID_REQUEST", envelope["code"])
		}
		return
	}
	assertExactFieldSet(t, envelope, "error envelope", "code", "field")
	if string(envelope["code"]) != strconv.Quote("INVALID_REQUEST") {
		t.Fatalf("code %s, want INVALID_REQUEST", envelope["code"])
	}
	if string(envelope["field"]) != strconv.Quote(string(wantField)) {
		t.Fatalf("field %s, want %q", envelope["field"], wantField)
	}
}

// TestSubstituteSearchHTTPIntegration verifies the Fiber Adapter for
// POST /api/v1/substitutes/search over an actual loopback Fiber listener
// backed by disposable real PostgreSQL (P04-G4): the strict page-0 success
// field sets with no unknown fields, the designated page-0 order and exact
// display values for the three seeded inputs, three unique items,
// totalEligibleCount, hasMore, both localized names, omitted and present
// image keys, serving/g/ml inputs, and solid g plus liquid ml whole Matched
// Quantity outputs.
func TestSubstituteSearchHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	// P04-G4: Pizza Margherita at one Serving (350 g) — the designated
	// eligible count 36, hasMore true, the designated page-0 order [13, 29,
	// 26], three unique items, both localized names, the present gyoza
	// image key on ID 13 and omitted image keys on IDs 29 and 26, and whole
	// solid-gram Matched Quantities with the exact scaled macronutrients
	// and whole similarity percentages.
	status, body, contentType := postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`)
	pizza := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSubstitutePage(t, pizza, 36, true,
		wantSubstituteItem{id: 13, en: "Gyoza", pl: "Pierożki gyoza", imageKey: strPtr("gyoza"), matchedValue: 438, matchedUnit: transport.MatchedQuantityUnitG, protein: 35, carbohydrate: 105, fat: 35, similarityPercent: 100},
		wantSubstituteItem{id: 29, en: "Paella", pl: "Paella", matchedValue: 557, matchedUnit: transport.MatchedQuantityUnitG, protein: 44.6, carbohydrate: 111.5, fat: 27.9, similarityPercent: 100},
		wantSubstituteItem{id: 26, en: "Pancakes", pl: "Naleśniki", matchedValue: 440, matchedUnit: transport.MatchedQuantityUnitG, protein: 26.4, carbohydrate: 123.1, fat: 30.8, similarityPercent: 99},
	)

	// P04-G4: Chicken breast at 100 g — the designated eligible count 37,
	// hasMore true, page-0 IDs [23, 11, 6], and every image key omitted
	// (none of the three candidates has a seeded image).
	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":5,"quantity":{"value":100,"unit":"g"},"pageIndex":0}`)
	chicken := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSubstitutePage(t, chicken, 37, true,
		wantSubstituteItem{id: 23, en: "Turkey breast", pl: "Pierś z indyka", matchedValue: 117, matchedUnit: transport.MatchedQuantityUnitG, protein: 33.8, carbohydrate: 0, fat: 2.3, similarityPercent: 100},
		wantSubstituteItem{id: 11, en: "Skyr yogurt", pl: "Jogurt skyr", matchedValue: 253, matchedUnit: transport.MatchedQuantityUnitG, protein: 27.8, carbohydrate: 10.1, fat: 0.5, similarityPercent: 94},
		wantSubstituteItem{id: 6, en: "Pork chop", pl: "Kotlet wieprzowy", matchedValue: 67, matchedUnit: transport.MatchedQuantityUnitG, protein: 18, carbohydrate: 0, fat: 9.4, similarityPercent: 93},
	)

	// P04-G4: Milk at 100 ml — the designated eligible count 37, hasMore
	// true, page-0 IDs [33, 3, 21], and whole Matched Quantity outputs in
	// both candidate base units: millilitres for the liquid Mondongo and
	// grams for the solid Lasagna and Beef cheeseburger (ARCH-013).
	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":10,"quantity":{"value":100,"unit":"ml"},"pageIndex":0}`)
	milk := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSubstitutePage(t, milk, 37, true,
		wantSubstituteItem{id: 33, en: "Mondongo", pl: "Zupa mondongo", matchedValue: 53, matchedUnit: transport.MatchedQuantityUnitMl, protein: 3.7, carbohydrate: 4.2, fat: 2.1, similarityPercent: 99},
		wantSubstituteItem{id: 3, en: "Lasagna", pl: "Lazania", matchedValue: 28, matchedUnit: transport.MatchedQuantityUnitG, protein: 2.5, carbohydrate: 5.1, fat: 2.3, similarityPercent: 99},
		wantSubstituteItem{id: 21, en: "Beef cheeseburger", pl: "Cheeseburger wołowy", matchedValue: 19, matchedUnit: transport.MatchedQuantityUnitG, protein: 2.5, carbohydrate: 4.6, fat: 2.5, similarityPercent: 99},
	)
}

// TestSubstituteSearchContractHTTPIntegration verifies the task-19 strict
// decoder paths of POST /api/v1/substitutes/search over an actual loopback
// Fiber listener backed by disposable real PostgreSQL: only the
// application/json Content-Type is accepted, and empty, malformed,
// trailing, unknown-key, and duplicate-key JSON at every nesting level are
// rejected with 400 INVALID_REQUEST — without a field for structural
// failures and unknown keys, and with the exact ISSUE-005 field path for
// missing, duplicate, null, or wrong-typed known fields. The canonical
// request proves the strict decoder accepts exactly the closed generated
// object and nothing else.
func TestSubstituteSearchContractHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	// The canonical closed request the strict decoder accepts.
	valid := `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	status, body, _ := postSubstitutes(t, baseURL, jsonType, valid)
	if status != http.StatusOK {
		t.Fatalf("canonical request status %d, want 200 (body %s)", status, body)
	}
	// application/json with a parameter is still application/json; a
	// trailing newline after the object is whitespace, not trailing JSON.
	status, _, _ = postSubstitutes(t, baseURL, jsonType+"; charset=utf-8", valid)
	if status != http.StatusOK {
		t.Fatalf("application/json; charset=utf-8 request status %d, want 200", status)
	}
	status, _, _ = postSubstitutes(t, baseURL, jsonType, valid+"\n")
	if status != http.StatusOK {
		t.Fatalf("request with trailing whitespace status %d, want 200", status)
	}
	// JSON object member order is insignificant: a reordered, spaced
	// request with the nested unit before the value is the same closed
	// object and must be accepted.
	reordered := "{\n  \"pageIndex\": 0,\n  \"quantity\": { \"unit\": \"serving\", \"value\": 1 },\n  \"foodObjectId\": 1\n}"
	status, body, _ = postSubstitutes(t, baseURL, jsonType, reordered)
	if status != http.StatusOK {
		t.Fatalf("reordered spaced request status %d, want 200 (body %s)", status, body)
	}

	// Content-Type: only application/json. A missing Content-Type and any
	// other media type return 400 INVALID_REQUEST without a field
	// (ISSUE-005).
	contentTypeCases := []struct {
		name        string
		contentType string
	}{
		{"missing Content-Type", ""},
		{"text/plain", "text/plain"},
		{"application/x-www-form-urlencoded", "application/x-www-form-urlencoded"},
		{"application/json-patch+json", "application/json-patch+json"},
	}
	for _, tc := range contentTypeCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, tc.contentType, valid)
			assertInvalidRequest(t, status, body, contentType, "")
		})
	}

	// Structural JSON failures: empty, whitespace-only, and malformed
	// bodies, and a top-level value that is not the closed request object,
	// return 400 INVALID_REQUEST without a field.
	structuralCases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"whitespace-only body", "   "},
		{"unterminated object", `{"foodObjectId":1`},
		{"null body", "null"},
		{"array body", `[{"foodObjectId":1}]`},
		{"string body", `"foodObjectId"`},
		{"number body", "123"},
		{"trailing text", valid + " x"},
		{"trailing second object", valid + valid},
		{"trailing null", valid + " null"},
	}
	for _, tc := range structuralCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, "")
		})
	}

	// Unknown keys at every nesting level return 400 INVALID_REQUEST without
	// a field (closed request objects, ISSUE-005).
	unknownCases := []struct {
		name string
		body string
	}{
		{"unknown root key", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0,"extra":1}`},
		{"unknown quantity key", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving","extra":1},"pageIndex":0}`},
		{"duplicate unknown key", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0,"extra":1,"extra":2}`},
	}
	for _, tc := range unknownCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, "")
		})
	}

	// Duplicate keys at every nesting level return 400 INVALID_REQUEST with
	// the duplicated known field's ISSUE-005 path.
	duplicateCases := []struct {
		name  string
		body  string
		field transport.ErrorField
	}{
		{"duplicate foodObjectId", `{"foodObjectId":1,"foodObjectId":2,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
		{"duplicate quantity", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"quantity":{"value":2,"unit":"g"},"pageIndex":0}`, transport.Quantity},
		{"duplicate pageIndex", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0,"pageIndex":1}`, transport.PageIndex},
		{"duplicate quantity.value", `{"foodObjectId":1,"quantity":{"value":1,"value":2,"unit":"serving"},"pageIndex":0}`, transport.QuantityValue},
		{"duplicate quantity.unit", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving","unit":"g"},"pageIndex":0}`, transport.QuantityUnit},
	}
	for _, tc := range duplicateCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, tc.field)
		})
	}

	// Missing required fields return 400 INVALID_REQUEST with the missing
	// field's ISSUE-005 path.
	missingCases := []struct {
		name  string
		body  string
		field transport.ErrorField
	}{
		{"missing foodObjectId", `{"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
		{"missing quantity", `{"foodObjectId":1,"pageIndex":0}`, transport.Quantity},
		{"missing pageIndex", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"}}`, transport.PageIndex},
		{"missing quantity.value", `{"foodObjectId":1,"quantity":{"unit":"serving"},"pageIndex":0}`, transport.QuantityValue},
		{"missing quantity.unit", `{"foodObjectId":1,"quantity":{"value":1},"pageIndex":0}`, transport.QuantityUnit},
	}
	for _, tc := range missingCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, tc.field)
		})
	}

	// Null known fields return 400 INVALID_REQUEST with the field's
	// ISSUE-005 path (ISSUE-005: a null known field is a structural
	// failure).
	nullCases := []struct {
		name  string
		body  string
		field transport.ErrorField
	}{
		{"null foodObjectId", `{"foodObjectId":null,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
		{"null quantity", `{"foodObjectId":1,"quantity":null,"pageIndex":0}`, transport.Quantity},
		{"null pageIndex", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":null}`, transport.PageIndex},
		{"null quantity.value", `{"foodObjectId":1,"quantity":{"value":null,"unit":"serving"},"pageIndex":0}`, transport.QuantityValue},
		{"null quantity.unit", `{"foodObjectId":1,"quantity":{"value":1,"unit":null},"pageIndex":0}`, transport.QuantityUnit},
	}
	for _, tc := range nullCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, tc.field)
		})
	}

	// Wrong-typed known fields return 400 INVALID_REQUEST with the field's
	// ISSUE-005 path: a non-number where a number is required, a non-string
	// unit, an array or scalar where the quantity object is required, a
	// fractional or out-of-int32-range number for an int32 field, and a
	// number that does not fit the double range.
	wrongTypeCases := []struct {
		name  string
		body  string
		field transport.ErrorField
	}{
		{"string foodObjectId", `{"foodObjectId":"1","quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
		{"boolean pageIndex", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":true}`, transport.PageIndex},
		{"number quantity", `{"foodObjectId":1,"quantity":5,"pageIndex":0}`, transport.Quantity},
		{"array quantity", `{"foodObjectId":1,"quantity":[1],"pageIndex":0}`, transport.Quantity},
		{"string quantity.value", `{"foodObjectId":1,"quantity":{"value":"100","unit":"serving"},"pageIndex":0}`, transport.QuantityValue},
		{"boolean quantity.value", `{"foodObjectId":1,"quantity":{"value":true,"unit":"serving"},"pageIndex":0}`, transport.QuantityValue},
		{"number quantity.unit", `{"foodObjectId":1,"quantity":{"value":1,"unit":5},"pageIndex":0}`, transport.QuantityUnit},
		{"fractional foodObjectId", `{"foodObjectId":1.5,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
		{"out-of-int32 foodObjectId", `{"foodObjectId":2147483648,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
		{"out-of-int32 pageIndex", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":2147483648}`, transport.PageIndex},
		{"out-of-double quantity.value", `{"foodObjectId":1,"quantity":{"value":1e400,"unit":"serving"},"pageIndex":0}`, transport.QuantityValue},
	}
	for _, tc := range wrongTypeCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, tc.field)
		})
	}
}
