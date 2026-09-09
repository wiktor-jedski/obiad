package dbsetup

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"obiad/backend/internal/testdb"
)

func TestExternalCatalogBaselineAndDummyLoad(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	ctx := context.Background()
	for _, table := range []string{"food_objects", "food_families"} {
		if n := countRows(t, owner, "SELECT count(*) FROM "+table); n != 0 {
			t.Fatalf("baseline left %d rows in %s", n, table)
		}
	}
	dummy, err := os.ReadFile(filepath.Join(moduleRoot(t), "catalog", "dummy.json"))
	if err != nil {
		t.Fatal(err)
	}
	testdb.LoadCatalog(t, db.OwnerURL)
	if n := countRows(t, owner, "SELECT count(*) FROM food_objects"); n != 38 {
		t.Fatalf("dummy load produced %d Food Objects, want 38", n)
	}
	var matches bool
	if err := owner.QueryRow(ctx, `SELECT jsonb_build_object(
		'schemaVersion', 1,
		'foodFamilies', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_families f),
		'foodObjects', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
			'id', id, 'names', names, 'nutritionBasis', nutrition_basis,
			'macroProfile', jsonb_build_object(
				'protein', protein, 'availableCarbohydrate', carbohydrate, 'fat', fat),
			'serving', CASE WHEN serving IS NOT NULL THEN
				jsonb_build_object('value', serving, 'unit', serving_unit) END,
			'foodFamilyId', food_family_id, 'imageKey', image_key, 'source', source
		)) ORDER BY id) FROM food_objects)
	) = $1::jsonb`, string(dummy)).Scan(&matches); err != nil {
		t.Fatal(err)
	}
	if !matches {
		t.Fatal("loaded catalog differs from catalog/dummy.json")
	}
	const snapshot = `SELECT jsonb_build_object(
		'objects', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_objects f),
		'families', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_families f),
		'migrations', (SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM schema_migrations m))::text`
	var before, after string
	if err := owner.QueryRow(ctx, snapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	runDBSetupCommand(t, db.OwnerURL)
	if err := owner.QueryRow(ctx, snapshot).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("repeated setup changed ordered rows\nbefore: %s\nafter: %s", before, after)
	}
	testdb.LoadCatalog(t, db.OwnerURL)
	if err := owner.QueryRow(ctx, snapshot).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("repeated dummy load changed ordered rows\nbefore: %s\nafter: %s", before, after)
	}
	t.Log("Task 97: baseline leaves both catalog tables empty; catalogload loads the exact 38-row dummy catalog; repeated setup and load preserve both ordered tables and migration history")
}

func TestExternalCatalogSourceAndFamilyConstraints(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	ctx := context.Background()
	const insert = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat, source)
		VALUES (1, '{"en":"Meal","pl":"Posiłek"}', 'g', 1, 0, 0, $1)`
	for _, source := range []any{
		nil,
		"https://example.org/recipe?q=one%20two#step",
		"http://localhost:8080/recipe",
		"https://[::1]:8080/recipe",
		"https://[2001:db8:0:1:2:3:4:5]/recipe",
		"https://[::ffff:192.0.2.1]/recipe",
		"https://user:password@[2001:db8::1]:65535/recipe",
		"http://example.org:1/recipe",
		"https://example.org:65535/recipe",
		"https://example.org:00065535/recipe",
		"https://example.org:/recipe",
		"urn:example:recipe",
	} {
		if _, err := owner.Exec(ctx, insert, source); err != nil {
			t.Fatalf("valid source %v: %v", source, err)
		}
		var got *string
		if err := owner.QueryRow(ctx, "DELETE FROM food_objects RETURNING source").Scan(&got); err != nil {
			t.Fatal(err)
		}
		if source == nil && got != nil || source != nil && (got == nil || *got != source) {
			t.Fatalf("source round trip: got %v, want %v", got, source)
		}
	}
	for _, source := range []string{"", "relative/path", "//example.org/recipe", "https://", "https:///recipe", "https://:", "https://example.org:bad/recipe", "https://example.org/a b", "https://example.org/%ZZ", "https://example.org/%2", "https://example.org/\nrecipe", "https://example.org/<recipe>"} {
		_, err := owner.Exec(ctx, insert, source)
		wantSQLState(t, err, "23514")
	}
	for _, source := range []string{
		"https://[1]/recipe",
		"https://[:::]/recipe",
		"https://[192.0.2.1]/recipe",
		"https://[1:2:3:4:5:6:7:8:9]/recipe",
		"https://[2001:db8::1::2]/recipe",
		"https://[::ffff:192.0.2.999]/recipe",
		"https://[::1/recipe",
		"https://::1]/recipe",
		"https://example.org:0/recipe",
		"http://example.org:65536/recipe",
		"https://[::1]:65536/recipe",
		"https://user:password@[::1]:0/recipe",
		"https://example.org:999999999999999999999999999999/recipe",
	} {
		t.Run(source, func(t *testing.T) {
			_, err := owner.Exec(ctx, insert, source)
			wantSQLState(t, err, "23514")
		})
		if _, err := owner.Exec(ctx, "DELETE FROM food_objects"); err != nil {
			t.Fatal(err)
		}
	}
	const insertFamily = `INSERT INTO food_families (id, names) VALUES (1, $1::jsonb)`
	for _, names := range []string{`{}`, `{"en":"Meal"}`, `{"en":"","pl":"Posiłek"}`, `{"en":null,"pl":"Posiłek"}`, `{"en":"Meal","pl":42}`, `[]`, `{"en":"Meal","pl":"Posiłek","de":false}`, `{"en":"Meal","pl":"Posiłek","de":""}`} {
		_, err := owner.Exec(ctx, insertFamily, names)
		wantSQLState(t, err, "23514")
	}
	_, err := owner.Exec(ctx, insertFamily, nil)
	wantSQLState(t, err, "23502")
	if _, err := owner.Exec(ctx, insertFamily, `{"en":"Meals","pl":"Posiłki","de":"Gerichte"}`); err != nil {
		t.Fatal(err)
	}
	var names string
	if err := owner.QueryRow(ctx, "SELECT names ->> 'de' FROM food_families WHERE id = 1").Scan(&names); err != nil || names != "Gerichte" {
		t.Fatalf("localized Family name: %q, %v", names, err)
	}
}

func TestServingUnitFollowsNutritionBasis(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	ctx := context.Background()
	const insert = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat, serving)
		VALUES (1, '{"en":"Meal","pl":"Posiłek"}', $1, 1, 0, 0, 333.333333)`
	for _, basis := range []string{"g", "ml"} {
		if _, err := owner.Exec(ctx, insert, basis); err != nil {
			t.Fatal(err)
		}
		var unit string
		var serving float64
		if err := owner.QueryRow(ctx, "SELECT serving, serving_unit FROM food_objects WHERE id = 1").Scan(&serving, &unit); err != nil {
			t.Fatal(err)
		}
		if unit != basis || serving != 333.333333 {
			t.Fatalf("Serving = %v %s, want 333.333333 %s", serving, unit, basis)
		}
		_, err := owner.Exec(ctx, "UPDATE food_objects SET serving_unit = $1 WHERE id = 1", map[string]string{"g": "ml", "ml": "g"}[basis])
		wantSQLState(t, err, "428C9")
		if _, err := owner.Exec(ctx, "UPDATE food_objects SET serving = NULL WHERE id = 1"); err != nil {
			t.Fatal(err)
		}
		if n := countRows(t, owner, "SELECT count(*) FROM food_objects WHERE serving_unit IS NULL"); n != 1 {
			t.Fatal("absent Serving retained a unit")
		}
		if _, err := owner.Exec(ctx, "DELETE FROM food_objects"); err != nil {
			t.Fatal(err)
		}
	}
}
