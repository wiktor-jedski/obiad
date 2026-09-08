package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/testdb"
)

func TestCommandLoadsCatalogs(t *testing.T) {
	db := testdb.NewDB(t)
	ctx := context.Background()
	owner, err := pgx.Connect(ctx, db.OwnerURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close(ctx) //nolint:errcheck
	dir := t.TempDir()
	binary := filepath.Join(dir, "catalogload")
	build := exec.Command("go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build catalogload: %v\n%s", err, output)
	}
	setup := exec.Command("go", "run", "../dbsetup")
	setup.Env = append(os.Environ(), "OBIAD_SCHEMA_OWNER_DATABASE_URL="+db.OwnerURL)
	if output, err := setup.CombinedOutput(); err != nil {
		t.Fatalf("dbsetup: %v\n%s", err, output)
	}
	// This source-agnostic fixture preserves the Phase 27 one-Meal export values.
	production := `{"foodFamilies":[{"id":1,"names":{"en":"Dumplings","pl":"Pierogi"}}],"foodObjects":[{"foodFamilyId":1,"id":1,"macroProfile":{"availableCarbohydrate":24.302264,"fat":2.070593,"protein":7.227230},"names":{"en":"Pierogi ruskie","pl":"Pierogi ruskie"},"nutritionBasis":"g","source":"https://kuchnia-domowa.pl/dania-glowne/481-pierogi-ruskie"}],"schemaVersion":1}`
	for _, tc := range []struct {
		name string
		body string
	}{
		{"phase27", production},
		{"ml-serving-image-no-families", `{"schemaVersion":1,"foodFamilies":[],"foodObjects":[{"id":2147483647,"names":{"en":"Soup","pl":"Zupa","de":"Suppe"},"macroProfile":{"protein":1.25,"availableCarbohydrate":0,"fat":0.125},"nutritionBasis":"ml","serving":{"value":333.333333,"unit":"ml"},"imageKey":"soup-image"}]}`},
		{"g-serving", `{"schemaVersion":1,"foodFamilies":[{"id":2,"names":{"en":"Meals","pl":"Posiłki","de":"Gerichte"}}],"foodObjects":[{"id":3,"names":{"en":"Meal","pl":"Posiłek"},"macroProfile":{"protein":0,"availableCarbohydrate":2,"fat":0},"nutritionBasis":"g","serving":{"value":250,"unit":"g"},"foodFamilyId":2}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, "catalog.json")
			if err := os.WriteFile(path, []byte(tc.body), 0o600); err != nil {
				t.Fatal(err)
			}
			command := exec.Command(binary, path)
			command.Env = append(os.Environ(), "OBIAD_SCHEMA_OWNER_DATABASE_URL="+db.OwnerURL,
				"OBIAD_RUNTIME_DATABASE_URL="+db.AnonURL)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("catalogload: %v\n%s", err, output)
			}
			var stored []byte
			err := owner.QueryRow(ctx, `SELECT jsonb_build_object(
				'schemaVersion', 1,
				'foodFamilies', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'names', names) ORDER BY id) FROM food_families), '[]'::jsonb),
				'foodObjects', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
					'id', id, 'names', names, 'nutritionBasis', nutrition_basis,
					'macroProfile', jsonb_build_object('protein', protein, 'availableCarbohydrate', carbohydrate, 'fat', fat),
					'serving', CASE WHEN serving IS NOT NULL THEN jsonb_build_object('value', serving, 'unit', serving_unit) END,
					'source', source, 'imageKey', image_key, 'foodFamilyId', food_family_id
				)) ORDER BY id) FROM food_objects))`).Scan(&stored)
			if err != nil {
				t.Fatal(err)
			}
			var got, want any
			if err := json.Unmarshal(stored, &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.body), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("stored catalog differs from input\ngot: %s\nwant: %s", stored, tc.body)
			}
		})
	}
}
