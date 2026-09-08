package dbsetup

import (
	"context"
	"fmt"
	"io/fs"
	"testing"
	"testing/fstest"

	sqlfiles "obiad/backend/internal/repository/sql"
	"obiad/backend/internal/testdb"
)

func TestExternalCatalogUpgrade(t *testing.T) {
	db := testdb.NewDB(t)
	owner := connect(t, db.OwnerURL)
	ctx := context.Background()
	migrations, err := fs.Sub(sqlfiles.Migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	all, err := Load(migrations)
	if err != nil {
		t.Fatal(err)
	}
	historical := fstest.MapFS{}
	for _, migration := range all {
		if migration.Version < 6 {
			historical[fmt.Sprintf("%04d_%s.sql", migration.Version, migration.Name)] = &fstest.MapFile{Data: []byte(migration.SQL)}
		}
	}
	if _, err := Apply(ctx, owner, historical); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, owner, "SELECT count(*) FROM food_objects"); n != 38 {
		t.Fatalf("historical migrations produced %d Food Objects, want 38", n)
	}
	db.GrantRuntimeCatalogRead(t, owner)
	runDBSetupCommand(t, db.OwnerURL)
	for _, table := range []string{"food_objects", "food_families"} {
		if n := countRows(t, owner, "SELECT count(*) FROM "+table); n != 0 {
			t.Fatalf("upgrade left %d rows in %s", n, table)
		}
	}
	if n := countRows(t, owner, "SELECT count(*) FROM schema_migrations"); n != 6 {
		t.Fatalf("upgrade recorded %d migrations, want 6", n)
	}
	testdb.LoadCatalog(t, owner)
	runDBSetupCommand(t, db.OwnerURL)
	runtime := connect(t, db.RuntimeURL)
	if n := countRows(t, runtime, "SELECT count(*) FROM food_objects WHERE nutrition_basis IN ('g', 'ml')"); n != 38 {
		t.Fatalf("repeat setup changed the loaded catalog: %d rows", n)
	}
	_, err = runtime.Exec(ctx, "UPDATE food_objects SET source = 'https://example.org/recipe' WHERE id = 1")
	wantSQLState(t, err, "42501")
}

func TestExternalCatalogSourceAndFamilyConstraints(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	ctx := context.Background()
	const insert = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat, source)
		VALUES (1, '{"en":"Meal","pl":"Posiłek"}', 'g', 1, 0, 0, $1)`
	for _, source := range []any{nil, "https://example.org/recipe?q=one%20two#step", "http://localhost:8080/recipe", "urn:example:recipe"} {
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
	for _, source := range []string{"", "relative/path", "//example.org/recipe", "https://", "https:///recipe", "https://example.org/a b", "https://example.org/%ZZ", "https://example.org/%2", "https://example.org/\nrecipe", "https://example.org/<recipe>"} {
		_, err := owner.Exec(ctx, insert, source)
		wantSQLState(t, err, "23514")
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
