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
	assertExactFieldSet(t, envelope, "response envelope", "pageIndex", "totalEligibleCount", "hasMore", "selectedFood", "items")
	var selected map[string]json.RawMessage
	if err := json.Unmarshal(envelope["selectedFood"], &selected); err != nil {
		t.Fatalf("selectedFood %q is not a JSON object: %v", envelope["selectedFood"], err)
	}
	wantSelectedFields := []string{"foodObjectId", "names", "macroProfile", "baseUnit"}
	if _, ok := selected["serving"]; ok {
		wantSelectedFields = append(wantSelectedFields, "serving")
	}
	assertExactFieldSet(t, selected, "selectedFood", wantSelectedFields...)
	var selectedNames map[string]json.RawMessage
	if err := json.Unmarshal(selected["names"], &selectedNames); err != nil {
		t.Fatalf("selectedFood names %q is not a JSON object: %v", selected["names"], err)
	}
	assertExactFieldSet(t, selectedNames, "selectedFood names", "en", "pl")
	var selectedMacros map[string]json.RawMessage
	if err := json.Unmarshal(selected["macroProfile"], &selectedMacros); err != nil {
		t.Fatalf("selectedFood macroProfile %q is not a JSON object: %v", selected["macroProfile"], err)
	}
	assertExactFieldSet(t, selectedMacros, "selectedFood macroProfile", "protein", "carbohydrate", "fat")

	var items []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["items"], &items); err != nil {
		t.Fatalf("items %q is not a JSON array: %v", envelope["items"], err)
	}
	for i, item := range items {
		wantFields := []string{"foodObjectId", "names", "macroProfile", "baseUnit", "similarityPercent"}
		if _, ok := item["imageKey"]; ok {
			wantFields = append(wantFields, "imageKey")
		}
		if _, ok := item["serving"]; ok {
			wantFields = append(wantFields, "serving")
		}
		assertExactFieldSet(t, item, "item", wantFields...)
		var names map[string]json.RawMessage
		if err := json.Unmarshal(item["names"], &names); err != nil {
			t.Fatalf("item %d names %q is not a JSON object: %v", i, item["names"], err)
		}
		assertExactFieldSet(t, names, "names", "en", "pl")
		var macros map[string]json.RawMessage
		if err := json.Unmarshal(item["macroProfile"], &macros); err != nil {
			t.Fatalf("item %d macroProfile %q is not a JSON object: %v", i, item["macroProfile"], err)
		}
		assertExactFieldSet(t, macros, "macroProfile", "protein", "carbohydrate", "fat")
	}
	var response transport.SubstituteSearchResponse
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		t.Fatalf("body %q does not match the generated SubstituteSearchResponse: %v", body, err)
	}
	return response
}

type wantSelectedFood struct {
	id           int32
	en           string
	pl           string
	macroProfile transport.MacroProfile
	baseUnit     transport.SelectedFoodBaseUnit
	serving      *float64
}

func assertSelectedFood(t *testing.T, got transport.SelectedFood, want wantSelectedFood) {
	t.Helper()
	if got.FoodObjectId != want.id {
		t.Fatalf("selectedFood.FoodObjectId %d, want %d", got.FoodObjectId, want.id)
	}
	if got.Names.En != want.en || got.Names.Pl != want.pl {
		t.Fatalf("selectedFood.Names (%q, %q), want (%q, %q)", got.Names.En, got.Names.Pl, want.en, want.pl)
	}
	if got.MacroProfile != want.macroProfile {
		t.Fatalf("selectedFood.MacroProfile %+v, want %+v", got.MacroProfile, want.macroProfile)
	}
	if got.BaseUnit != want.baseUnit {
		t.Fatalf("selectedFood.BaseUnit %q, want %q", got.BaseUnit, want.baseUnit)
	}
	if want.serving == nil {
		if got.Serving != nil {
			t.Fatalf("selectedFood.Serving %v, want nil", *got.Serving)
		}
	} else {
		if got.Serving == nil || *got.Serving != *want.serving {
			t.Fatalf("selectedFood.Serving %v, want %v", got.Serving, *want.serving)
		}
	}
}

type wantSubstituteItem struct {
	id                int32
	en                string
	pl                string
	imageKey          *string
	macroProfile      transport.MacroProfile
	baseUnit          transport.SubstituteItemBaseUnit
	serving           *float64
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
	if item.MacroProfile != want.macroProfile {
		t.Fatalf("item %d macroProfile (%v, %v, %v), want (%v, %v, %v)", item.FoodObjectId, item.MacroProfile.Protein, item.MacroProfile.Carbohydrate, item.MacroProfile.Fat, want.macroProfile.Protein, want.macroProfile.Carbohydrate, want.macroProfile.Fat)
	}
	if item.BaseUnit != want.baseUnit {
		t.Fatalf("item %d baseUnit %q, want %q", item.FoodObjectId, item.BaseUnit, want.baseUnit)
	}
	if want.serving == nil {
		if item.Serving != nil {
			t.Fatalf("item %d serving %v, want nil", item.FoodObjectId, *item.Serving)
		}
	} else if item.Serving == nil || *item.Serving != *want.serving {
		t.Fatalf("item %d serving %v, want %v", item.FoodObjectId, item.Serving, *want.serving)
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

func strPtr(s string) *string       { return &s }
func float64Ptr(v float64) *float64 { return &v }

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
		`{"foodObjectId":1,"pageIndex":0}`)
	pizza := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, pizza.SelectedFood, wantSelectedFood{
		id: 1, en: "Pizza Margherita", pl: "Pizza margherita",
		macroProfile: transport.MacroProfile{Protein: 10, Carbohydrate: 30, Fat: 10},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      float64Ptr(350),
	})
	assertSubstitutePage(t, pizza, 0, 36, true,
		wantSubstituteItem{id: 13, en: "Gyoza", pl: "Pierożki gyoza", imageKey: strPtr("gyoza"), macroProfile: transport.MacroProfile{Protein: 8, Carbohydrate: 24, Fat: 8}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(200), similarityPercent: 100},
		wantSubstituteItem{id: 29, en: "Paella", pl: "Paella", macroProfile: transport.MacroProfile{Protein: 8, Carbohydrate: 20, Fat: 5}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(350), similarityPercent: 100},
		wantSubstituteItem{id: 26, en: "Pancakes", pl: "Naleśniki", macroProfile: transport.MacroProfile{Protein: 6, Carbohydrate: 28, Fat: 7}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(150), similarityPercent: 99},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"pageIndex":1}`)
	pizzaPage1 := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, pizzaPage1.SelectedFood, wantSelectedFood{
		id: 1, en: "Pizza Margherita", pl: "Pizza margherita",
		macroProfile: transport.MacroProfile{Protein: 10, Carbohydrate: 30, Fat: 10},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      float64Ptr(350),
	})
	assertSubstitutePage(t, pizzaPage1, 1, 36, true,
		wantSubstituteItem{id: 30, en: "Pho", pl: "Zupa pho", macroProfile: transport.MacroProfile{Protein: 3, Carbohydrate: 8, Fat: 1.5}, baseUnit: transport.SubstituteItemBaseUnitMl, serving: float64Ptr(400), similarityPercent: 99},
		wantSubstituteItem{id: 3, en: "Lasagna", pl: "Lazania", macroProfile: transport.MacroProfile{Protein: 9, Carbohydrate: 18, Fat: 8}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(350), similarityPercent: 99},
		wantSubstituteItem{id: 35, en: "Pastel de nata", pl: "Pastel de nata", macroProfile: transport.MacroProfile{Protein: 5, Carbohydrate: 35, Fat: 14}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(60), similarityPercent: 98},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":1,"pageIndex":11}`)
	pizzaLast := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, pizzaLast.SelectedFood, wantSelectedFood{
		id: 1, en: "Pizza Margherita", pl: "Pizza margherita",
		macroProfile: transport.MacroProfile{Protein: 10, Carbohydrate: 30, Fat: 10},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      float64Ptr(350),
	})
	assertSubstitutePage(t, pizzaLast, 11, 36, false,
		wantSubstituteItem{id: 23, en: "Turkey breast", pl: "Pierś z indyka", macroProfile: transport.MacroProfile{Protein: 29, Carbohydrate: 0, Fat: 2}, baseUnit: transport.SubstituteItemBaseUnitG, serving: nil, similarityPercent: 32},
		wantSubstituteItem{id: 18, en: "Butter", pl: "Masło", macroProfile: transport.MacroProfile{Protein: 0.5, Carbohydrate: 0.5, Fat: 82}, baseUnit: transport.SubstituteItemBaseUnitG, serving: nil, similarityPercent: 31},
		wantSubstituteItem{id: 19, en: "Olive oil", pl: "Oliwa z oliwek", macroProfile: transport.MacroProfile{Protein: 0, Carbohydrate: 0, Fat: 91.3}, baseUnit: transport.SubstituteItemBaseUnitMl, serving: nil, similarityPercent: 30},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":5,"pageIndex":0}`)
	chicken := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, chicken.SelectedFood, wantSelectedFood{
		id: 5, en: "Chicken breast", pl: "Pierś z kurczaka",
		macroProfile: transport.MacroProfile{Protein: 31, Carbohydrate: 0, Fat: 3.6},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      nil,
	})
	assertSubstitutePage(t, chicken, 0, 37, true,
		wantSubstituteItem{id: 23, en: "Turkey breast", pl: "Pierś z indyka", macroProfile: transport.MacroProfile{Protein: 29, Carbohydrate: 0, Fat: 2}, baseUnit: transport.SubstituteItemBaseUnitG, serving: nil, similarityPercent: 100},
		wantSubstituteItem{id: 11, en: "Skyr yogurt", pl: "Jogurt skyr", macroProfile: transport.MacroProfile{Protein: 11, Carbohydrate: 4, Fat: 0.2}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(150), similarityPercent: 94},
		wantSubstituteItem{id: 6, en: "Pork chop", pl: "Kotlet wieprzowy", macroProfile: transport.MacroProfile{Protein: 27, Carbohydrate: 0, Fat: 14}, baseUnit: transport.SubstituteItemBaseUnitG, serving: nil, similarityPercent: 93},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":5,"pageIndex":12}`)
	chickenLast := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, chickenLast.SelectedFood, wantSelectedFood{
		id: 5, en: "Chicken breast", pl: "Pierś z kurczaka",
		macroProfile: transport.MacroProfile{Protein: 31, Carbohydrate: 0, Fat: 3.6},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      nil,
	})
	assertSubstitutePage(t, chickenLast, 12, 37, false,
		wantSubstituteItem{id: 9, en: "Apple juice", pl: "Sok jabłkowy", macroProfile: transport.MacroProfile{Protein: 0.1, Carbohydrate: 11, Fat: 0.1}, baseUnit: transport.SubstituteItemBaseUnitMl, serving: nil, similarityPercent: 1},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":10,"pageIndex":0}`)
	milk := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, milk.SelectedFood, wantSelectedFood{
		id: 10, en: "Milk", pl: "Mleko",
		macroProfile: transport.MacroProfile{Protein: 3.4, Carbohydrate: 4.8, Fat: 2},
		baseUnit:     transport.SelectedFoodBaseUnitMl,
		serving:      nil,
	})
	assertSubstitutePage(t, milk, 0, 37, true,
		wantSubstituteItem{id: 33, en: "Mondongo", pl: "Zupa mondongo", macroProfile: transport.MacroProfile{Protein: 7, Carbohydrate: 8, Fat: 4}, baseUnit: transport.SubstituteItemBaseUnitMl, serving: float64Ptr(350), similarityPercent: 99},
		wantSubstituteItem{id: 3, en: "Lasagna", pl: "Lazania", macroProfile: transport.MacroProfile{Protein: 9, Carbohydrate: 18, Fat: 8}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(350), similarityPercent: 99},
		wantSubstituteItem{id: 21, en: "Beef cheeseburger", pl: "Cheeseburger wołowy", macroProfile: transport.MacroProfile{Protein: 13, Carbohydrate: 24, Fat: 13}, baseUnit: transport.SubstituteItemBaseUnitG, serving: float64Ptr(220), similarityPercent: 99},
	)

	status, body, contentType = postSubstitutes(t, baseURL, jsonType,
		`{"foodObjectId":10,"pageIndex":12}`)
	milkLast := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, milkLast.SelectedFood, wantSelectedFood{
		id: 10, en: "Milk", pl: "Mleko",
		macroProfile: transport.MacroProfile{Protein: 3.4, Carbohydrate: 4.8, Fat: 2},
		baseUnit:     transport.SelectedFoodBaseUnitMl,
		serving:      nil,
	})
	assertSubstitutePage(t, milkLast, 12, 37, false,
		wantSubstituteItem{id: 19, en: "Olive oil", pl: "Oliwa z oliwek", macroProfile: transport.MacroProfile{Protein: 0, Carbohydrate: 0, Fat: 91.3}, baseUnit: transport.SubstituteItemBaseUnitMl, serving: nil, similarityPercent: 32},
	)
}

func TestSubstituteSearchContractHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	const jsonType = "application/json"

	valid := `{"foodObjectId":1,"pageIndex":0}`
	status, body, contentType := postSubstitutes(t, baseURL, jsonType, valid)
	canonical := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, canonical.SelectedFood, wantSelectedFood{
		id: 1, en: "Pizza Margherita", pl: "Pizza margherita",
		macroProfile: transport.MacroProfile{Protein: 10, Carbohydrate: 30, Fat: 10},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      float64Ptr(350),
	})
	status, body, contentType = postSubstitutes(t, baseURL, jsonType+"; charset=utf-8", valid)
	assertSubstituteSuccessEnvelope(t, status, body, contentType)
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, valid+"\n")
	assertSubstituteSuccessEnvelope(t, status, body, contentType)
	reordered := "{\n  \"pageIndex\": 0,\n  \"foodObjectId\": 1\n}"
	status, body, contentType = postSubstitutes(t, baseURL, jsonType, reordered)
	reorderedEnvelope := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	assertSelectedFood(t, reorderedEnvelope.SelectedFood, wantSelectedFood{
		id: 1, en: "Pizza Margherita", pl: "Pizza margherita",
		macroProfile: transport.MacroProfile{Protein: 10, Carbohydrate: 30, Fat: 10},
		baseUnit:     transport.SelectedFoodBaseUnitG,
		serving:      float64Ptr(350),
	})

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
		{"unknown root key", `{"foodObjectId":1,"pageIndex":0,"extra":1}`},
		{"quantity field rejected as unknown", `{"foodObjectId":1,"quantity":{"value":1,"unit":"serving"},"pageIndex":0}`},
		{"scalar quantity field rejected as unknown", `{"foodObjectId":1,"quantity":100,"pageIndex":0}`},
		{"duplicate unknown key", `{"foodObjectId":1,"pageIndex":0,"extra":1,"extra":2}`},
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
		{"duplicate foodObjectId", `{"foodObjectId":1,"foodObjectId":2,"pageIndex":0}`, transport.FoodObjectId},
		{"duplicate pageIndex", `{"foodObjectId":1,"pageIndex":0,"pageIndex":1}`, transport.PageIndex},
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
		{"missing foodObjectId", `{"pageIndex":0}`, transport.FoodObjectId},
		{"missing pageIndex", `{"foodObjectId":1}`, transport.PageIndex},
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
		{"null foodObjectId", `{"foodObjectId":null,"pageIndex":0}`, transport.FoodObjectId},
		{"null pageIndex", `{"foodObjectId":1,"pageIndex":null}`, transport.PageIndex},
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
		{"string foodObjectId", `{"foodObjectId":"1","pageIndex":0}`, transport.FoodObjectId},
		{"boolean pageIndex", `{"foodObjectId":1,"pageIndex":true}`, transport.PageIndex},
		{"array foodObjectId", `{"foodObjectId":[],"pageIndex":0}`, transport.FoodObjectId},
		{"fractional foodObjectId", `{"foodObjectId":1.5,"pageIndex":0}`, transport.FoodObjectId},
		{"out-of-int32 foodObjectId", `{"foodObjectId":2147483648,"pageIndex":0}`, transport.FoodObjectId},
		{"out-of-int32 pageIndex", `{"foodObjectId":1,"pageIndex":2147483648}`, transport.PageIndex},
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
		{"truncated after wrong-type composite", `{"foodObjectId":[]`},
		{"truncated after complete object", `{"foodObjectId":1,"pageIndex":0`},
		{"malformed delimiter after wrong-type", `{"foodObjectId":]}`},
		{"trailing comma after wrong-type", `{"foodObjectId":true,}`},
		{"trailing comma after null", `{"foodObjectId":null,"pageIndex":0,}`},
	}
	for _, tc := range precedenceCases {
		t.Run("reject "+tc.name, func(t *testing.T) {
			status, body, contentType := postSubstitutes(t, baseURL, jsonType, tc.body)
			assertInvalidRequest(t, status, body, contentType, "")
		})
	}
}
