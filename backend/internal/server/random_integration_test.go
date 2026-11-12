package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"obiad/backend/internal/transport"
)

func getRandomFood(t *testing.T, baseURL string) httpResult {
	t.Helper()
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(baseURL + "/api/v1/food-objects/random")
	if err != nil {
		t.Fatalf("GET random food: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close random food response: %v", err)
		}
	}()
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control %q, want no-store", got)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read random food response: %v", err)
	}
	return httpResult{status: resp.StatusCode, body: string(raw), contentType: resp.Header.Get("Content-Type")}
}

func randomFoodID(t *testing.T, result httpResult) int32 {
	t.Helper()
	if result.status != http.StatusOK || !strings.HasPrefix(result.contentType, "application/json") {
		t.Fatalf("random food response: %+v", result)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(result.body), &fields); err != nil {
		t.Fatal(err)
	}
	assertExactFieldSet(t, fields, "random food response", "foodObjectId")
	var response transport.RandomFoodResponse
	if err := json.Unmarshal([]byte(result.body), &response); err != nil {
		t.Fatal(err)
	}
	if response.FoodObjectId <= 0 {
		t.Fatalf("nonpositive random ID: %d", response.FoodObjectId)
	}
	return response.FoodObjectId
}

func TestRandomFoodHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	db := newSetupDB(t)
	owner := connect(t, db.OwnerURL)
	baseURL, _ := startServer(t, db.RuntimeURL)
	// Sparse, non-keyword foods must remain eligible; no distribution assumptions.
	if _, err := owner.Exec(ctx, "DELETE FROM food_objects WHERE id NOT IN (19, 35)"); err != nil {
		t.Fatal(err)
	}
	for range 8 {
		id := randomFoodID(t, getRandomFood(t, baseURL))
		if id != 19 && id != 35 {
			t.Fatalf("random ID %d is outside the current sparse catalog", id)
		}
	}
	if _, err := owner.Exec(ctx, "DELETE FROM food_objects WHERE id = 35"); err != nil {
		t.Fatal(err)
	}
	for _, onlyID := range []int32{19, 35} {
		if _, err := owner.Exec(ctx, "UPDATE food_objects SET id = $1", onlyID); err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if got := randomFoodID(t, getRandomFood(t, baseURL)); got != onlyID {
				t.Fatalf("single-row catalog returned %d, want %d", got, onlyID)
			}
		}
	}
	if _, err := owner.Exec(ctx, "DELETE FROM food_objects"); err != nil {
		t.Fatal(err)
	}
	assertError(t, getRandomFood(t, baseURL), http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
}

func TestRandomFoodFailuresHTTPIntegration(t *testing.T) {
	ctx := context.Background()
	db := newSetupDB(t)
	owner := connect(t, db.OwnerURL)
	baseURL, pool := startServer(t, db.RuntimeURL)
	if _, err := owner.Exec(ctx, "BEGIN; LOCK TABLE food_objects IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = owner.Exec(ctx, "ROLLBACK") })
	start := time.Now()
	assertError(t, getRandomFood(t, baseURL), http.StatusGatewayTimeout, "SEARCH_TIMEOUT", "")
	if elapsed := time.Since(start); elapsed < 350*time.Millisecond || elapsed > 900*time.Millisecond {
		t.Fatalf("locked random request took %v, want about 450 ms", elapsed)
	}
	admin := connect(t, adminDatabaseURL())
	if !waitForNoBlockedQuery(t, admin, db.RuntimeRole, 2*time.Second) {
		t.Fatal("random catalog query remained blocked after deadline")
	}
	if _, err := owner.Exec(ctx, "ROLLBACK; DROP TABLE food_objects"); err != nil {
		t.Fatal(err)
	}
	assertError(t, getRandomFood(t, baseURL), http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
	pool.Close()
	assertError(t, getRandomFood(t, baseURL), http.StatusServiceUnavailable, "CATALOG_UNAVAILABLE", "")
}

func TestSelectedFoodImageHTTPIntegration(t *testing.T) {
	db := newSetupDB(t)
	baseURL, _ := startServer(t, db.RuntimeURL)
	status, body, contentType := postSubstitutes(t, baseURL, "application/json", `{"foodObjectId":1,"pageIndex":0}`)
	response := assertSubstituteSuccessEnvelope(t, status, body, contentType)
	if response.SelectedFood.ImageKey == nil || *response.SelectedFood.ImageKey != "pizza-margherita" {
		t.Fatalf("selected image %v, want pizza-margherita", response.SelectedFood.ImageKey)
	}
	status, body, contentType = postSubstitutes(t, baseURL, "application/json", `{"foodObjectId":2,"pageIndex":0}`)
	response = assertSubstituteSuccessEnvelope(t, status, body, contentType)
	if response.SelectedFood.ImageKey != nil {
		t.Fatalf("selected image %q, want omitted", *response.SelectedFood.ImageKey)
	}
	var envelope struct {
		SelectedFood map[string]json.RawMessage `json:"selectedFood"`
	}
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		t.Fatal(err)
	}
	if _, present := envelope.SelectedFood["imageKey"]; present {
		t.Fatal("absent selected image must be omitted, not null")
	}
}
