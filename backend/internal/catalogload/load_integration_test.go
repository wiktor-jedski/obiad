package catalogload

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/dbsetup"
	sqlfiles "obiad/backend/internal/repository/sql"
	"obiad/backend/internal/testdb"
)

func TestRunValidatesCompleteCatalogBeforeReplacement(t *testing.T) {
	db := testdb.NewDB(t)
	ctx := context.Background()
	owner, err := pgx.Connect(ctx, db.OwnerURL)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close(ctx) //nolint:errcheck
	migrations, err := fs.Sub(sqlfiles.Migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dbsetup.Apply(ctx, owner, migrations); err != nil {
		t.Fatal(err)
	}
	testdb.LoadCatalog(t, owner)
	var before, after string
	const snapshot = `SELECT jsonb_build_object(
		'objects', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_objects f),
		'families', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_families f))::text`
	if err := owner.QueryRow(ctx, snapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "catalog.json")
	body := `{"schemaVersion":1,"foodFamilies":[],"foodObjects":[
		{"id":100,"names":{"en":"Meal","pl":"Posiłek"},"nutritionBasis":"g","macroProfile":{"protein":1,"availableCarbohydrate":0,"fat":0}},
		{"id":101,"names":{"en":"Invalid Meal","pl":"Niepoprawny posiłek"},"nutritionBasis":"g","macroProfile":{"protein":1,"availableCarbohydrate":0,"fat":0},"foodFamilyId":99}]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Run(ctx, db.OwnerURL, path); err == nil {
		t.Fatal("accepted a dangling Family reference in the last Food Object")
	}
	if err := owner.QueryRow(ctx, snapshot).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatal("invalid catalog changed the previous complete snapshot")
	}
}

func TestRunRejectsNegativeMacrosBeforeConnection(t *testing.T) {
	for _, field := range []string{"protein", "availableCarbohydrate", "fat"} {
		for _, number := range []string{"-1e-400", "-2E-324", "-0." + strings.Repeat("0", 400) + "1"} {
			t.Run(field+"/"+number, func(t *testing.T) {
				body := `{"schemaVersion":1,"foodFamilies":[],"foodObjects":[{"id":1,"names":{"en":"Meal","pl":"Posiłek"},"nutritionBasis":"g","macroProfile":{"protein":1,"availableCarbohydrate":1,"fat":1}}]}`
				body = strings.Replace(body, `"`+field+`":1`, `"`+field+`":`+number, 1)
				path := filepath.Join(t.TempDir(), "catalog.json")
				if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
					t.Fatal(err)
				}
				err := Run(context.Background(), "not-a-database-url", path)
				if err == nil || !strings.HasPrefix(err.Error(), "validate catalog:") {
					t.Fatalf("negative %s reached connection: %v", field, err)
				}
			})
		}
	}
}
