package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"obiad/backend/internal/transport"
)

func getSuggestions(t *testing.T, baseURL string, query string, language string) (status int, body string, contentType string) {
	t.Helper()
	u := baseURL + "/api/v1/food-suggestions?query=" + url.QueryEscape(query) + "&language=" + url.QueryEscape(language)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		t.Fatalf("GET /api/v1/food-suggestions?query=%q&language=%q: %v", query, language, err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close food-suggestions response body: %v", err)
		}
	}()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read food-suggestions body: %v", err)
	}
	return resp.StatusCode, string(raw), resp.Header.Get("Content-Type")
}

func getSuggestionsEnvelope(t *testing.T, baseURL string, query string, language string) transport.FoodSuggestionsResponse {
	t.Helper()
	status, body, contentType := getSuggestions(t, baseURL, query, language)
	return assertSuccessEnvelope(t, status, body, contentType)
}

func assertSuccessEnvelope(t *testing.T, status int, body string, contentType string) transport.FoodSuggestionsResponse {
	t.Helper()
	if status != http.StatusOK {
		t.Fatalf("GET /api/v1/food-suggestions status %d, want 200 (body %s)", status, body)
	}
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type %q, want application/json", contentType)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		t.Fatalf("body %q is not valid JSON: %v", body, err)
	}
	assertExactFieldSet(t, envelope, "response envelope", "items")
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["items"], &items); err != nil {
		t.Fatalf("items %q is not a JSON array: %v", envelope["items"], err)
	}
	for i, item := range items {
		assertExactFieldSet(t, item, "item", "foodObjectId", "names", "defaultQuantity", "allowedQuantities")
		var names map[string]json.RawMessage
		if err := json.Unmarshal(item["names"], &names); err != nil {
			t.Fatalf("item %d names %q is not a JSON object: %v", i, item["names"], err)
		}
		assertExactFieldSet(t, names, "names", "en", "pl")
		var quantity map[string]json.RawMessage
		if err := json.Unmarshal(item["defaultQuantity"], &quantity); err != nil {
			t.Fatalf("item %d defaultQuantity %q is not a JSON object: %v", i, item["defaultQuantity"], err)
		}
		assertExactFieldSet(t, quantity, "defaultQuantity", "value", "unit")
		var allowed []map[string]json.RawMessage
		if err := json.Unmarshal(item["allowedQuantities"], &allowed); err != nil {
			t.Fatalf("item %d allowedQuantities %q is not a JSON array: %v", i, item["allowedQuantities"], err)
		}
		if len(allowed) < 1 || len(allowed) > 2 {
			t.Fatalf("item %d has %d allowed quantities, want one or two (body %s)", i, len(allowed), body)
		}
		for _, quantityEntry := range allowed {
			assertExactFieldSet(t, quantityEntry, "allowedQuantity", "unit", "maximumValue")
		}
	}
	var response transport.FoodSuggestionsResponse
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		t.Fatalf("body %q does not match the generated FoodSuggestionsResponse: %v", body, err)
	}
	if len(response.Items) != 5 {
		t.Fatalf("response has %d items, want exactly five (body %s)", len(response.Items), body)
	}
	seen := make(map[int32]bool, len(response.Items))
	for _, item := range response.Items {
		if seen[item.FoodObjectId] {
			t.Fatalf("response contains duplicate suggestion ID %d (body %s)", item.FoodObjectId, body)
		}
		seen[item.FoodObjectId] = true
		if item.FoodObjectId < 1 {
			t.Fatalf("suggestion ID %d is not a positive 32-bit integer (body %s)", item.FoodObjectId, body)
		}
		if item.Names.En == "" || item.Names.Pl == "" {
			t.Fatalf("suggestion ID %d carries empty localized names %+v (body %s)", item.FoodObjectId, item.Names, body)
		}
		if item.DefaultQuantity.Value < 1 {
			t.Fatalf("suggestion ID %d has nonpositive default quantity value %v (body %s)", item.FoodObjectId, item.DefaultQuantity.Value, body)
		}
		if len(item.AllowedQuantities) < 1 || len(item.AllowedQuantities) > 2 {
			t.Fatalf("suggestion ID %d has %d allowed quantities, want one or two (body %s)", item.FoodObjectId, len(item.AllowedQuantities), body)
		}
	}
	return response
}

func assertExactFieldSet(t *testing.T, object map[string]json.RawMessage, label string, want ...string) {
	t.Helper()
	if len(object) != len(want) {
		t.Fatalf("%s fields %v, want exactly %v", label, keysOf(object), want)
	}
	for _, field := range want {
		if _, ok := object[field]; !ok {
			t.Fatalf("%s is missing field %q (fields %v)", label, field, keysOf(object))
		}
	}
}

func keysOf(object map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(object))
	for k := range object {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func assertOrderedIDs(t *testing.T, response transport.FoodSuggestionsResponse, want ...int32) {
	t.Helper()
	if len(response.Items) != len(want) {
		t.Fatalf("got %d suggestions with IDs %v, want %d IDs %v", len(response.Items), responseIDs(response), len(want), want)
	}
	for i, id := range want {
		if response.Items[i].FoodObjectId != id {
			t.Fatalf("suggestion %d has ID %d, want %d (full order %v)", i, response.Items[i].FoodObjectId, id, responseIDs(response))
		}
	}
}

func responseIDs(response transport.FoodSuggestionsResponse) []int32 {
	ids := make([]int32, len(response.Items))
	for i, item := range response.Items {
		ids[i] = item.FoodObjectId
	}
	return ids
}

func assertSuggestionItem(t *testing.T, item transport.FoodSuggestion, en, pl string, quantityValue float64, quantityUnit transport.FoodQuantityUnit) {
	t.Helper()
	if item.Names.En != en || item.Names.Pl != pl {
		t.Fatalf("suggestion ID %d names %+v, want en=%q pl=%q", item.FoodObjectId, item.Names, en, pl)
	}
	if item.DefaultQuantity.Value != quantityValue || item.DefaultQuantity.Unit != quantityUnit {
		t.Fatalf("suggestion ID %d default quantity %+v, want %v %s", item.FoodObjectId, item.DefaultQuantity, quantityValue, quantityUnit)
	}
}

type wantAllowedQuantity struct {
	unit         transport.AllowedQuantityUnit
	maximumValue int32
}

func assertAllowedQuantities(t *testing.T, item transport.FoodSuggestion, want ...wantAllowedQuantity) {
	t.Helper()
	if len(item.AllowedQuantities) != len(want) {
		t.Fatalf("suggestion ID %d has %d allowed quantities %+v, want %d", item.FoodObjectId, len(item.AllowedQuantities), item.AllowedQuantities, len(want))
	}
	seen := make(map[transport.AllowedQuantityUnit]bool, len(item.AllowedQuantities))
	for i, got := range item.AllowedQuantities {
		if got.MaximumValue < 1 {
			t.Fatalf("suggestion ID %d allowed quantity %d has nonpositive maximum value %d", item.FoodObjectId, i, got.MaximumValue)
		}
		if seen[got.Unit] {
			t.Fatalf("suggestion ID %d repeats allowed unit %q", item.FoodObjectId, got.Unit)
		}
		seen[got.Unit] = true
		if got.Unit != want[i].unit || got.MaximumValue != want[i].maximumValue {
			t.Fatalf("suggestion ID %d allowed quantity %d is (%v, %d), want (%v, %d)", item.FoodObjectId, i, got.Unit, got.MaximumValue, want[i].unit, want[i].maximumValue)
		}
	}
	if len(item.AllowedQuantities) == 2 && item.AllowedQuantities[0].Unit != transport.AllowedQuantityUnitServing {
		t.Fatalf("suggestion ID %d: the default serving unit must be first, got %v first", item.FoodObjectId, item.AllowedQuantities[0].Unit)
	}
}

func assertSameOrder(t *testing.T, got, want transport.FoodSuggestionsResponse) {
	t.Helper()
	if len(got.Items) != len(want.Items) {
		t.Fatalf("got %d items, want %d", len(got.Items), len(want.Items))
	}
	for i := range got.Items {
		if !reflect.DeepEqual(got.Items[i], want.Items[i]) {
			t.Fatalf("item %d differs: got %+v, want %+v", i, got.Items[i], want.Items[i])
		}
	}
}

func TestFoodSuggestionsHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)

	enPizza := getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")
	assertOrderedIDs(t, enPizza, 1, 2, 8, 12, 3)

	plPizza := getSuggestionsEnvelope(t, baseURL, "pizza margherita", "pl")
	assertOrderedIDs(t, plPizza, 1, 2, 3, 29, 35)

	enNone := getSuggestionsEnvelope(t, baseURL, "zzzzzz", "en")
	assertOrderedIDs(t, enNone, 13, 18, 16, 15, 10)

	plNone := getSuggestionsEnvelope(t, baseURL, "zzzzzz", "pl")
	assertOrderedIDs(t, plNone, 38, 16, 15, 3, 18)

	pizza := getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")
	assertOrderedIDs(t, pizza, 1, 2, 8, 12, 3)
	assertSuggestionItem(t, pizza.Items[0], "Pizza Margherita", "Pizza margherita", 1, transport.FoodQuantityUnitServing)

	chicken := getSuggestionsEnvelope(t, baseURL, "chicken breast", "en")
	assertOrderedIDs(t, chicken, 5, 23, 7, 36, 15)
	assertSuggestionItem(t, chicken.Items[0], "Chicken breast", "Pierś z kurczaka", 100, transport.FoodQuantityUnitG)

	milk := getSuggestionsEnvelope(t, baseURL, "milk", "en")
	assertOrderedIDs(t, milk, 10, 14, 30, 13, 16)
	assertSuggestionItem(t, milk.Items[0], "Milk", "Mleko", 100, transport.FoodQuantityUnitMl)

	assertAllowedQuantities(t, pizza.Items[0],
		wantAllowedQuantity{unit: transport.AllowedQuantityUnitServing, maximumValue: 285},
		wantAllowedQuantity{unit: transport.AllowedQuantityUnitG, maximumValue: 100000},
	)
	assertAllowedQuantities(t, chicken.Items[0],
		wantAllowedQuantity{unit: transport.AllowedQuantityUnitG, maximumValue: 100000},
	)
	assertAllowedQuantities(t, milk.Items[0],
		wantAllowedQuantity{unit: transport.AllowedQuantityUnitMl, maximumValue: 100000},
	)
	pho := getSuggestionsEnvelope(t, baseURL, "pho", "en")
	if pho.Items[0].FoodObjectId != 30 {
		t.Fatalf("query \"pho\" ranks ID %d first, want the exact match Pho (ID 30)", pho.Items[0].FoodObjectId)
	}
	assertAllowedQuantities(t, pho.Items[0],
		wantAllowedQuantity{unit: transport.AllowedQuantityUnitServing, maximumValue: 250},
		wantAllowedQuantity{unit: transport.AllowedQuantityUnitMl, maximumValue: 100000},
	)

	caseVariant := getSuggestionsEnvelope(t, baseURL, "  PiZzA  MARGHERITA ", "en")
	assertSameOrder(t, caseVariant, enPizza)

	nbVariant := getSuggestionsEnvelope(t, baseURL, "pizza\u00a0\u00a0margherita", "en")
	assertSameOrder(t, nbVariant, enPizza)

	zForm := getSuggestionsEnvelope(t, baseURL, "pierozki gyoza", "pl")
	assertOrderedIDs(t, zForm, 13, 23, 4, 5, 25)
	assertSuggestionItem(t, zForm.Items[0], "Gyoza", "Pierożki gyoza", 1, transport.FoodQuantityUnitServing)

	accentedForm := getSuggestionsEnvelope(t, baseURL, "pierożki gyoza", "pl")
	assertOrderedIDs(t, accentedForm, 13, 4, 23, 5, 25)
	assertSuggestionItem(t, accentedForm.Items[0], "Gyoza", "Pierożki gyoza", 1, transport.FoodQuantityUnitServing)
	if zForm.Items[1].FoodObjectId == accentedForm.Items[1].FoodObjectId {
		t.Fatalf("the z-form and ż-form queries must rank differently: both put ID %d at rank 2", zForm.Items[1].FoodObjectId)
	}
}

func TestFoodSuggestionRankingHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	ctx := context.Background()
	owner := connect(t, db.OwnerURL)

	enPizza := getSuggestionsEnvelope(t, baseURL, "pizza margherita", "en")
	assertOrderedIDs(t, enPizza, 1, 2, 8, 12, 3)

	enPierogi := getSuggestionsEnvelope(t, baseURL, "pierogi", "en")
	assertOrderedIDs(t, enPierogi, 4, 16, 29, 30, 13)

	plPierogi := getSuggestionsEnvelope(t, baseURL, "pierogi", "pl")
	assertOrderedIDs(t, plPierogi, 4, 16, 10, 29, 36)

	plOws := getSuggestionsEnvelope(t, baseURL, "ows", "pl")
	if plOws.Items[0].FoodObjectId != 28 {
		t.Fatalf("GET suggestions for Polish ows first ID = %d, want Owsianka ID 28 (full order %v)", plOws.Items[0].FoodObjectId, responseIDs(plOws))
	}

	fixtures := []struct {
		id int32
		en string
		pl string
	}{
		{39, "Sernik duplikat", "Sernik duplikat"},
		{40, "Sernik duplikat", "Sernik duplikat"},
		{41, "źle", "Źle"},
		{42, "żaba", "Żaba"},
	}
	for _, f := range fixtures {
		if _, err := owner.Exec(ctx,
			`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, 'solid', 1, 0, 0)`,
			f.id, `{"en": "`+f.en+`", "pl": "`+f.pl+`"}`,
		); err != nil {
			t.Fatalf("owner fixture insert for ID %d: %v", f.id, err)
		}
	}

	dupEn := getSuggestionsEnvelope(t, baseURL, "sernik duplikat", "en")
	assertOrderedIDs(t, dupEn, 39, 40, 34, 12, 37)
	assertSuggestionItem(t, dupEn.Items[0], "Sernik duplikat", "Sernik duplikat", 100, transport.FoodQuantityUnitG)

	dupPl := getSuggestionsEnvelope(t, baseURL, "sernik duplikat", "pl")
	assertOrderedIDs(t, dupPl, 39, 40, 36, 34, 23)

	acEn := getSuggestionsEnvelope(t, baseURL, "ac", "en")
	assertOrderedIDs(t, acEn, 30, 42, 41, 15, 10)
	assertSuggestionItem(t, acEn.Items[1], "żaba", "Żaba", 100, transport.FoodQuantityUnitG)
	assertSuggestionItem(t, acEn.Items[2], "źle", "Źle", 100, transport.FoodQuantityUnitG)

	acPl := getSuggestionsEnvelope(t, baseURL, "ac", "pl")
	assertOrderedIDs(t, acPl, 41, 42, 15, 18, 38)
}

func TestFoodSuggestionAllowedQuantityBoundaryHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name    string
		serving float64
	}{
		{"serving above 100000", 200000},
		{"quotient beyond int32 range", 1e-5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := newSetupDB(t)
			baseURL, _ := startServer(t, db.RuntimeURL)
			owner := connect(t, db.OwnerURL)
			if _, err := owner.Exec(ctx,
				`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, serving) VALUES (39, '{"en": "Boundary serving", "pl": "Graniczna porcja"}'::jsonb, 'solid', 10, 5, 1, $1)`,
				tc.serving,
			); err != nil {
				t.Fatalf("insert %s fixture row: %v", tc.name, err)
			}

			status, body, contentType := getSuggestions(t, baseURL, "pizza", "en")
			assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusInternalServerError, "INTERNAL_ERROR", "")

			status, body, contentType = postSubstitutes(t, baseURL, "application/json", `{"foodObjectId":1,"pageIndex":0}`)
			assertError(t, httpResult{status: status, body: body, contentType: contentType}, http.StatusInternalServerError, "INTERNAL_ERROR", "")
		})
	}
}
