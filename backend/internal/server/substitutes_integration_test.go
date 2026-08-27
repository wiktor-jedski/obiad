package server

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
	assertExactFieldSet(t, envelope, "response envelope", "pageIndex", "totalEligibleCount", "hasMore", "inputMacronutrients", "inputCalories", "items")
	var inputMacros map[string]json.RawMessage
	if err := json.Unmarshal(envelope["inputMacronutrients"], &inputMacros); err != nil {
		t.Fatalf("inputMacronutrients %q is not a JSON object: %v", envelope["inputMacronutrients"], err)
	}
	assertExactFieldSet(t, inputMacros, "inputMacronutrients", "protein", "carbohydrate", "fat")
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["items"], &items); err != nil {
		t.Fatalf("items %q is not a JSON array: %v", envelope["items"], err)
	}
	for i, item := range items {
		wantFields := []string{"foodObjectId", "names", "matchedQuantity", "macronutrients", "calories", "similarityPercent"}
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

func assertInputMacronutrients(t *testing.T, response transport.SubstituteSearchResponse, protein, carbohydrate, fat float64) {
	t.Helper()
	got := response.InputMacronutrients
	if got.Protein != protein || got.Carbohydrate != carbohydrate || got.Fat != fat {
		t.Fatalf("inputMacronutrients (%v, %v, %v), want (%v, %v, %v)", got.Protein, got.Carbohydrate, got.Fat, protein, carbohydrate, fat)
	}
}

func assertInputCalories(t *testing.T, response transport.SubstituteSearchResponse, calories int64) {
	t.Helper()
	if response.InputCalories != calories {
		t.Fatalf("inputCalories %d, want %d", response.InputCalories, calories)
	}
}

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
	calories          int64
	similarityPercent int32
}

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
	if item.Calories != want.calories {
		t.Fatalf("item %d calories %d, want %d", item.FoodObjectId, item.Calories, want.calories)
	}
	if item.SimilarityPercent != want.similarityPercent {
		t.Fatalf("item %d similarityPercent %d, want %d", item.FoodObjectId, item.SimilarityPercent, want.similarityPercent)
	}
}

func assertSubstitutePage(t *testing.T, response transport.SubstituteSearchResponse, pageIndex, totalEligibleCount int32, hasMore bool, wants ...wantSubstituteItem) {
	t.Helper()
	if response.PageIndex != pageIndex {
		t.Fatalf("pageIndex %d, want %d", response.PageIndex, pageIndex)
	}
	if response.TotalEligibleCount != totalEligibleCount {
		t.Fatalf("totalEligibleCount %d, want %d", response.TotalEligibleCount, totalEligibleCount)
	}
	if response.HasMore != hasMore {
		t.Fatalf("hasMore %v, want %v", response.HasMore, hasMore)
	}
	if len(response.Items) != len(wants) {
		t.Fatalf("page %d has %d items, want %d", pageIndex, len(response.Items), len(wants))
	}
	seen := make(map[int32]bool, len(response.Items))
	for i, want := range wants {
		if seen[response.Items[i].FoodObjectId] {
			t.Fatalf("page %d item ID %d is not unique", pageIndex, response.Items[i].FoodObjectId)
		}
		seen[response.Items[i].FoodObjectId] = true
		assertSubstituteItem(t, response.Items[i], want)
	}
}

func strPtr(s string) *string { return &s }

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

func TestSubstituteSearchHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	status, body, contentType := postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`)
	pizza := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, pizza, 35.0, 105.0, 35.0)
	assertInputCalories(t, pizza, 875)
	assertSubstitutePage(t, pizza, 0, 36, true,
		wantSubstituteItem{id: 13, en: "Gyoza", pl: "Pierożki gyoza", imageKey: strPtr("gyoza"), matchedValue: 438, matchedUnit: transport.MatchedQuantityUnitG, protein: 35, carbohydrate: 105, fat: 35, calories: 875, similarityPercent: 100},
		wantSubstituteItem{id: 29, en: "Paella", pl: "Paella", matchedValue: 557, matchedUnit: transport.MatchedQuantityUnitG, protein: 44.6, carbohydrate: 111.5, fat: 27.9, calories: 875, similarityPercent: 100},
		wantSubstituteItem{id: 26, en: "Pancakes", pl: "Naleśniki", matchedValue: 440, matchedUnit: transport.MatchedQuantityUnitG, protein: 26.4, carbohydrate: 123.1, fat: 30.8, calories: 875, similarityPercent: 99},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":1}`)
	pizzaPage1 := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, pizzaPage1, 35.0, 105.0, 35.0)
	assertInputCalories(t, pizzaPage1, 875)
	assertSubstitutePage(t, pizzaPage1, 1, 36, true,
		wantSubstituteItem{id: 30, en: "Pho", pl: "Zupa pho", matchedValue: 1522, matchedUnit: transport.MatchedQuantityUnitMl, protein: 45.7, carbohydrate: 121.7, fat: 22.8, calories: 875, similarityPercent: 99},
		wantSubstituteItem{id: 3, en: "Lasagna", pl: "Lazania", matchedValue: 486, matchedUnit: transport.MatchedQuantityUnitG, protein: 43.8, carbohydrate: 87.5, fat: 38.9, calories: 875, similarityPercent: 99},
		wantSubstituteItem{id: 35, en: "Pastel de nata", pl: "Pastel de nata", matchedValue: 306, matchedUnit: transport.MatchedQuantityUnitG, protein: 15.3, carbohydrate: 107.1, fat: 42.8, calories: 875, similarityPercent: 98},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":11}`)
	pizzaLast := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, pizzaLast, 35.0, 105.0, 35.0)
	assertInputCalories(t, pizzaLast, 875)
	assertSubstitutePage(t, pizzaLast, 11, 36, false,
		wantSubstituteItem{id: 23, en: "Turkey breast", pl: "Pierś z indyka", matchedValue: 653, matchedUnit: transport.MatchedQuantityUnitG, protein: 189.4, carbohydrate: 0, fat: 13.1, calories: 875, similarityPercent: 32},
		wantSubstituteItem{id: 18, en: "Butter", pl: "Masło", matchedValue: 118, matchedUnit: transport.MatchedQuantityUnitG, protein: 0.6, carbohydrate: 0.6, fat: 96.7, calories: 875, similarityPercent: 31},
		wantSubstituteItem{id: 19, en: "Olive oil", pl: "Oliwa z oliwek", matchedValue: 106, matchedUnit: transport.MatchedQuantityUnitMl, protein: 0, carbohydrate: 0, fat: 97.2, calories: 875, similarityPercent: 30},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"quantity":{"value":100,"unit":"g"},"pageIndex":0}`)
	pizzaAt100g := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, pizzaAt100g, 10.0, 30.0, 10.0)
	assertInputCalories(t, pizzaAt100g, 250)
	if len(pizzaAt100g.Items) != len(pizza.Items) {
		t.Fatalf("Pizza at 100 g returned %d items, want the same %d as one Serving", len(pizzaAt100g.Items), len(pizza.Items))
	}
	for i := range pizza.Items {
		if pizzaAt100g.Items[i].FoodObjectId != pizza.Items[i].FoodObjectId {
			t.Fatalf("Pizza at 100 g item %d has ID %d, want the unchanged ID %d of one Serving", i, pizzaAt100g.Items[i].FoodObjectId, pizza.Items[i].FoodObjectId)
		}
	}

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":5,"quantity":{"value":100,"unit":"g"},"pageIndex":0}`)
	chicken := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, chicken, 31.0, 0.0, 3.6)
	assertInputCalories(t, chicken, 156)
	assertSubstitutePage(t, chicken, 0, 37, true,
		wantSubstituteItem{id: 23, en: "Turkey breast", pl: "Pierś z indyka", matchedValue: 117, matchedUnit: transport.MatchedQuantityUnitG, protein: 33.8, carbohydrate: 0, fat: 2.3, calories: 156, similarityPercent: 100},
		wantSubstituteItem{id: 11, en: "Skyr yogurt", pl: "Jogurt skyr", matchedValue: 253, matchedUnit: transport.MatchedQuantityUnitG, protein: 27.8, carbohydrate: 10.1, fat: 0.5, calories: 156, similarityPercent: 94},
		wantSubstituteItem{id: 6, en: "Pork chop", pl: "Kotlet wieprzowy", matchedValue: 67, matchedUnit: transport.MatchedQuantityUnitG, protein: 18, carbohydrate: 0, fat: 9.4, calories: 156, similarityPercent: 93},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":5,"quantity":{"value":100,"unit":"g"},"pageIndex":12}`)
	chickenLast := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, chickenLast, 31.0, 0.0, 3.6)
	assertInputCalories(t, chickenLast, 156)
	assertSubstitutePage(t, chickenLast, 12, 37, false,
		wantSubstituteItem{id: 9, en: "Apple juice", pl: "Sok jabłkowy", matchedValue: 345, matchedUnit: transport.MatchedQuantityUnitMl, protein: 0.3, carbohydrate: 38, fat: 0.3, calories: 156, similarityPercent: 1},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":10,"quantity":{"value":100,"unit":"ml"},"pageIndex":0}`)
	milk := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, milk, 3.4, 4.8, 2.0)
	assertInputCalories(t, milk, 51)
	assertSubstitutePage(t, milk, 0, 37, true,
		wantSubstituteItem{id: 33, en: "Mondongo", pl: "Zupa mondongo", matchedValue: 53, matchedUnit: transport.MatchedQuantityUnitMl, protein: 3.7, carbohydrate: 4.2, fat: 2.1, calories: 51, similarityPercent: 99},
		wantSubstituteItem{id: 3, en: "Lasagna", pl: "Lazania", matchedValue: 28, matchedUnit: transport.MatchedQuantityUnitG, protein: 2.5, carbohydrate: 5.1, fat: 2.3, calories: 51, similarityPercent: 99},
		wantSubstituteItem{id: 21, en: "Beef cheeseburger", pl: "Cheeseburger wołowy", matchedValue: 19, matchedUnit: transport.MatchedQuantityUnitG, protein: 2.5, carbohydrate: 4.6, fat: 2.5, calories: 51, similarityPercent: 99},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":10,"quantity":{"value":100,"unit":"ml"},"pageIndex":12}`)
	milkLast := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, milkLast, 3.4, 4.8, 2.0)
	assertInputCalories(t, milkLast, 51)
	assertSubstitutePage(t, milkLast, 12, 37, false,
		wantSubstituteItem{id: 19, en: "Olive oil", pl: "Oliwa z oliwek", matchedValue: 6, matchedUnit: transport.MatchedQuantityUnitMl, protein: 0, carbohydrate: 0, fat: 5.6, calories: 51, similarityPercent: 32},
	)
}

func TestSubstituteSearchContractHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	valid := `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, valid)
	canonical := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, canonical, 35.0, 105.0, 35.0)
	assertInputCalories(t, canonical, 875)
	status, body, contentType = postSubstitutes(t, baseURL, jsonType+"; charset=utf-8", valid)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, valid+"\n")
	assertSubstituteSuccessEnvelope(t, status, body, contentType)
	reordered := "{\n  \"pageIndex\": 0,\n  \"quantity\": { \"unit\": \"serving\", \"value\": 1 },\n  \"foodObjectId\": 1\n}"
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, reordered)
	reorderedEnvelope := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertInputMacronutrients(t, reorderedEnvelope, 35.0, 105.0, 35.0)

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
		{"array foodObjectId", `{"foodObjectId":[],"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`, transport.FoodObjectId},
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

	precedenceCases := []struct {
		name string
		body string
	}{
		{"truncated after wrong-type scalar", `{"foodObjectId":true`},
		{"truncated after wrong-type string", `{"foodObjectId":"x"`},
		{"truncated after null", `{"pageIndex":null`},
		{"truncated after fractional number", `{"foodObjectId":1.5`},
		{"truncated after scalar quantity", `{"quantity":5`},
		{"truncated after wrong-type composite", `{"foodObjectId":[]`},
		{"truncated after array quantity", `{"quantity":[]`},
		{"truncated after nested wrong-type", `{"quantity":{"value":[1],"unit":"g"},"pageIndex":0`},
		{"truncated after nested null", `{"quantity":{"value":null,"unit":"serving"},"pageIndex":0`},
		{"truncated after complete object", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0`},
		{"malformed delimiter after wrong-type", `{"foodObjectId":]}`},
		{"malformed delimiter after null", `{"quantity":{"value":null]}}`},
		{"trailing comma after wrong-type", `{"foodObjectId":true,}`},
		{"trailing comma after null", `{"foodObjectId":null,"quantity":{"value":1,"unit":"serving"},"pageIndex":0,}`},
	}
	for _, tc := range precedenceCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, "")
		})
	}
}
