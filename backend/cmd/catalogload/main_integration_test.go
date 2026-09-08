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
	for _, tc := range []struct {
		name string
		body string
	}{
		{"phase27", ""},
		{"ml-serving-image-no-families", `{"schemaVersion":1,"foodFamilies":[],"foodObjects":[{"id":2147483647,"names":{"en":"Soup","pl":"Zupa","de":"Suppe"},"macroProfile":{"protein":1.25,"availableCarbohydrate":0,"fat":0.125},"nutritionBasis":"ml","serving":{"value":333.333333,"unit":"ml"},"imageKey":"soup-image"}]}`},
		{"g-serving", `{"schemaVersion":1,"foodFamilies":[{"id":2,"names":{"en":"Meals","pl":"Posiłki","de":"Gerichte"}}],"foodObjects":[{"id":3,"names":{"en":"Meal","pl":"Posiłek"},"macroProfile":{"protein":0,"availableCarbohydrate":2,"fat":0},"nutritionBasis":"g","serving":{"value":250,"unit":"g"},"foodFamilyId":2}]}`},
		{"signed-zero", `{"schemaVersion":1,"foodFamilies":[],"foodObjects":[{"id":4,"names":{"en":"Meal","pl":"Posiłek"},"macroProfile":{"protein":-0,"availableCarbohydrate":1,"fat":-0.000E-400},"nutritionBasis":"g"}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, "catalog.json")
			body := []byte(tc.body)
			if tc.name == "phase27" {
				// P28-G3: opt in with OBIAD_TEST_PHASE27=1 and a pinned data checkout.
				// Normal CI must not read or initialize production data.
				if os.Getenv("OBIAD_TEST_PHASE27") != "1" {
					t.Skip("set OBIAD_TEST_PHASE27=1 to run the generated production artifact gate")
				}
				pin := exec.Command("git", "submodule", "status", "--", "data")
				pin.Dir = "../../.."
				if output, err := pin.CombinedOutput(); err != nil || len(output) == 0 || output[0] != ' ' {
					t.Fatalf("require initialized data at the application Git pin: %v\n%s", err, output)
				}
				export := exec.Command("uv", "run", "--frozen", "obiad-data", "export-catalog",
					"--ingredients-dir", "ingredients", "--meals-dir", "meals",
					"--schema", "../api/catalog.schema.json", "--output", path)
				export.Dir = "../../../data"
				if output, err := export.CombinedOutput(); err != nil {
					t.Fatalf("export Phase 27 catalog: %v\n%s", err, output)
				}
				var err error
				body, err = os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, body, 0o600); err != nil {
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
			if err := json.Unmarshal(body, &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("stored catalog differs from input\ngot: %s\nwant: %s", stored, body)
			}
		})
	}
}
