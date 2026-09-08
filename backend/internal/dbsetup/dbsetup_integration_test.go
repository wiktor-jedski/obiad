package dbsetup

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"obiad/backend/internal/testdb"
)

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("go.mod not found above %s", dir)
		}
		dir = parent
	}
}

func runDBSetupCommand(t *testing.T, dbURL string) string {
	t.Helper()
	cmd := exec.Command("go", "-C", moduleRoot(t), "run", "./cmd/dbsetup")
	cmd.Env = append(os.Environ(), "OBIAD_SCHEMA_OWNER_DATABASE_URL="+dbURL)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go run ./cmd/dbsetup failed: %v\noutput:\n%s", err, out)
	}
	return string(out)
}

func redactedURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<invalid database URL>"
	}
	u.User = nil
	return u.String()
}

func connect(t *testing.T, dbURL string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect to %s: %v", redactedURL(dbURL), err)
	}
	t.Cleanup(func() {
		if err := conn.Close(context.Background()); err != nil {
			t.Errorf("close database connection: %v", err)
		}
	})
	return conn
}

func wantSQLState(t *testing.T, err error, state string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected SQLSTATE %s, got no error", state)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected SQLSTATE %s, got %T: %v", state, err, err)
	}
	if pgErr.Code != state {
		t.Fatalf("expected SQLSTATE %s, got %s: %s", state, pgErr.Code, pgErr.Message)
	}
}

func countRows(t *testing.T, conn *pgx.Conn, query string) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(context.Background(), query).Scan(&n); err != nil {
		t.Fatalf("count query %q: %v", query, err)
	}
	return n
}

func TestDBSetupAppliesVersionedMigrations(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	ctx := context.Background()

	runDBSetupCommand(t, dbURL)

	conn := connect(t, dbURL)
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 6 {
		t.Fatalf("schema_migrations has %d rows, want 6 (one transaction per migration)", n)
	}
	rows, err := conn.Query(ctx, "SELECT version, name FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatalf("read schema_migrations: %v", err)
	}
	defer rows.Close()
	wantVersions := map[int]string{
		1: "create_food_objects",
		2: "add_macro_profile_and_serving",
		3: "add_food_family",
		4: "add_image_key",
		5: "seed_food_catalog",
		6: "external_catalog",
	}
	gotVersions := map[int]string{}
	for rows.Next() {
		var version int
		var name string
		if err := rows.Scan(&version, &name); err != nil {
			t.Fatalf("scan schema_migrations: %v", err)
		}
		gotVersions[version] = name
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate schema_migrations: %v", err)
	}
	for version, wantName := range wantVersions {
		if gotVersions[version] != wantName {
			t.Fatalf("schema_migrations version %d is %q, want %q (full set %v)", version, gotVersions[version], wantName, gotVersions)
		}
	}
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'food_objects')`).Scan(&exists); err != nil {
		t.Fatalf("check food_objects table: %v", err)
	}
	if !exists {
		t.Fatal("food_objects table does not exist after dbsetup")
	}
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("food_objects has %d rows after dbsetup, want 0 before catalog loading", n)
	}
	if err := conn.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'food_families')`).Scan(&exists); err != nil {
		t.Fatalf("check food_families table: %v", err)
	}
	if !exists {
		t.Fatal("food_families table does not exist after dbsetup")
	}
	if n := countRows(t, conn, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("food_families has %d rows after dbsetup, want 0 before catalog loading", n)
	}

	runDBSetupCommand(t, dbURL)
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 6 {
		t.Fatalf("schema_migrations has %d rows after second run, want 6", n)
	}
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("food_objects has %d rows after second run, want 0 before catalog loading", n)
	}
}

func f64p(v float64) *float64 { return &v }
func i32p(v int) *int         { return &v }
func strp(v string) *string   { return &v }

func equalFloatPtr(got, want *float64) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	return *got == *want
}

func equalIntPtr(got, want *int) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	return *got == *want
}

func equalStrPtr(got, want *string) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	return *got == *want
}

func TestDBSetupMigrationTransaction(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	dir := t.TempDir()
	files := map[string]string{
		"0001_ok.sql":  "CREATE TABLE ok_a (id integer PRIMARY KEY);",
		"0002_bad.sql": "CREATE TABLE ok_b (id integer); SELECT 1 / 0;",
	}
	for file, body := range files {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	conn := connect(t, dbURL)
	_, err := Apply(context.Background(), conn, os.DirFS(dir))
	if err == nil {
		t.Fatal("Apply succeeded, want failure from migration 0002")
	}

	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 1 {
		t.Fatalf("schema_migrations has %d rows after failed migration, want 1 (0002 rolled back)", n)
	}
	var version int
	if err := conn.QueryRow(context.Background(), "SELECT version FROM schema_migrations").Scan(&version); err != nil {
		t.Fatalf("read schema_migrations: %v", err)
	}
	if version != 1 {
		t.Fatalf("schema_migrations holds version %d, want 1", version)
	}
	var okA, okB bool
	if err := conn.QueryRow(context.Background(), `SELECT
		EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ok_a'),
		EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ok_b')`).Scan(&okA, &okB); err != nil {
		t.Fatalf("check migration side effects: %v", err)
	}
	if !okA {
		t.Fatal("ok_a from migration 0001 is missing")
	}
	if okB {
		t.Fatal("ok_b from failed migration 0002 was not rolled back")
	}
}

func TestFoodObjectIdentityAndLocalizedNames(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0)`

	if _, err := conn.Exec(ctx, insertFoodObject, 100, `{"en": "Almond milk", "pl": "Napój migdałowy"}`, "ml"); err != nil {
		t.Fatalf("valid Food Object insert failed: %v", err)
	}

	var idEn, idPl int
	if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'en' = $1`, "Almond milk").Scan(&idEn); err != nil {
		t.Fatalf("lookup by English name: %v", err)
	}
	if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'pl' = $1`, "Napój migdałowy").Scan(&idPl); err != nil {
		t.Fatalf("lookup by Polish name: %v", err)
	}
	if idEn != idPl {
		t.Fatalf("English and Polish names resolve to different IDs: en=%d pl=%d", idEn, idPl)
	}
	if idEn != 100 {
		t.Fatalf("both localized names resolve to ID %d, want 100", idEn)
	}

	if _, err := conn.Exec(ctx, insertFoodObject, 101, `{"en": "Bread", "pl": "Chleb"}`, "g"); err != nil {
		t.Fatalf("second valid Food Object insert failed: %v", err)
	}
	var breadID int
	if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'pl' = $1`, "Chleb").Scan(&breadID); err != nil {
		t.Fatalf("lookup by Polish name for Bread: %v", err)
	}
	if breadID != 101 {
		t.Fatalf("Chleb resolves to ID %d, want 101", breadID)
	}

	reject := func(id int, names string) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, id, names, "g")
		wantSQLState(t, err, "23514")
	}
	reject(0, `{"en": "Zero", "pl": "Zero"}`)
	reject(-5, `{"en": "Neg", "pl": "Ujemna"}`)
	reject(102, `{"pl": "Bez EN"}`)
	reject(102, `{"en": "Bez PL"}`)
	reject(102, `{"en": "", "pl": "Puste EN"}`)
	reject(102, `{"en": "Puste PL", "pl": ""}`)
	reject(102, `{"en": "   ", "pl": "Spacje"}`)
	reject(102, `{"en": 42, "pl": "Liczba"}`)
	reject(102, `{"en": "Tablica", "pl": ["Mleko"]}`)
	reject(102, `["Milk", "Mleko"]`)
	reject(102, `"Milk"`)

	_, err := conn.Exec(ctx, insertFoodObject, 100, `{"en": "Milk2", "pl": "Mleko2"}`, "ml")
	wantSQLState(t, err, "23505")

	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 2 {
		t.Fatalf("food_objects has %d rows, want 2 valid test rows", n)
	}
}

func TestFoodObjectNutritionBasis(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0)`

	for id, state := range map[int]string{50: "g", 51: "ml"} {
		if _, err := conn.Exec(ctx, insertFoodObject, id, fmt.Sprintf(`{"en": "S%d", "pl": "P%d"}`, id, id), state); err != nil {
			t.Fatalf("valid state %q insert failed: %v", state, err)
		}
	}

	for _, state := range []string{"solid", "liquid", "kg", "G", "ML", "g ", " ml", ""} {
		_, err := conn.Exec(ctx, insertFoodObject, 52, `{"en": "Bad", "pl": "Zly"}`, state)
		wantSQLState(t, err, "23514")
	}

	_, err := conn.Exec(ctx, insertFoodObject, 52, `{"en": "Bad", "pl": "Zly"}`, nil)
	wantSQLState(t, err, "23502")

	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 2 {
		t.Fatalf("food_objects has %d rows, want 2 valid test rows", n)
	}
}

func TestMacroProfileConstraints(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, $4::float8, $5::float8, $6::float8)`
	valid := []struct {
		id      int
		protein string
		carb    string
		fat     string
	}{
		{101, "0", "0", "0.5"},
		{102, "0.1", "0", "0"},
		{103, "0", "0.2", "0"},
		{104, "1.5", "2.5", "3.5"},
		{105, "1.7976931348623157e308", "0", "0"},
		{106, "5e-324", "0", "0"},
	}
	for _, v := range valid {
		names := fmt.Sprintf(`{"en": "V%d", "pl": "P%d"}`, v.id, v.id)
		if _, err := conn.Exec(ctx, insertFoodObject, v.id, names, "g", v.protein, v.carb, v.fat); err != nil {
			t.Fatalf("valid Macro Profile (%s, %s, %s) insert failed: %v", v.protein, v.carb, v.fat, err)
		}
	}

	reject := func(id int, protein, carb, fat string) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, id, `{"en": "Bad", "pl": "Zly"}`, "g", protein, carb, fat)
		wantSQLState(t, err, "23514")
	}
	reject(7, "0", "0", "0")
	reject(7, "-1", "0", "0")
	reject(7, "0", "-1", "0")
	reject(7, "0", "0", "-1")
	reject(7, "-0.5", "-0.5", "-0.5")
	reject(7, "NaN", "0", "0")
	reject(7, "0", "NaN", "0")
	reject(7, "0", "0", "NaN")
	reject(7, "Infinity", "0", "0")
	reject(7, "0", "Infinity", "0")
	reject(107, "0", "0", "Infinity")
	reject(107, "-Infinity", "0", "0")
	reject(107, "0", "-Infinity", "0")
	reject(107, "0", "0", "-Infinity")

	rejectNull := func(id int, protein, carb, fat any) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, id, `{"en": "Bad", "pl": "Zly"}`, "g", protein, carb, fat)
		wantSQLState(t, err, "23502")
	}
	rejectNull(107, nil, "0", "0")
	rejectNull(107, "0", nil, "0")
	rejectNull(107, "0", "0", nil)

	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != len(valid) {
		t.Fatalf("food_objects has %d rows, want %d (%d valid test rows)", n, len(valid), len(valid))
	}
}

func TestServingConstraints(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat, serving) VALUES ($1, $2::jsonb, $3, 1.0, 0.0, 0.0, $4::float8)`
	valid := []struct {
		id      int
		serving any
	}{
		{101, nil},
		{102, "0.5"},
		{103, "1"},
		{104, "1e300"},
		{105, "5e-324"},
	}
	for _, v := range valid {
		names := fmt.Sprintf(`{"en": "S%d", "pl": "P%d"}`, v.id, v.id)
		if _, err := conn.Exec(ctx, insertFoodObject, v.id, names, "ml", v.serving); err != nil {
			t.Fatalf("valid Serving %v insert failed: %v", v.serving, err)
		}
	}

	reject := func(serving string) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, 106, `{"en": "Bad", "pl": "Zly"}`, "g", serving)
		wantSQLState(t, err, "23514")
	}
	reject("0")
	reject("-1")
	reject("-0.5")
	reject("NaN")
	reject("Infinity")
	reject("-Infinity")

	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != len(valid) {
		t.Fatalf("food_objects has %d rows, want %d (%d valid test rows)", n, len(valid), len(valid))
	}
}

func TestFoodFamilyConstraints(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	if n := countRows(t, conn, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("food_families has %d rows after dbsetup, want 0 before catalog loading", n)
	}

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat, food_family_id) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0, $4)`

	if _, err := conn.Exec(ctx, insertFoodObject, 100, `{"en": "Milk", "pl": "Mleko"}`, "ml", nil); err != nil {
		t.Fatalf("zero-membership Food Object insert failed: %v", err)
	}
	if _, err := conn.Exec(ctx, `INSERT INTO food_families (id, names) VALUES (2, '{"en":"Test","pl":"Test"}')`); err != nil {
		t.Fatalf("valid Food Family insert failed: %v", err)
	}
	if _, err := conn.Exec(ctx, insertFoodObject, 101, `{"en": "Greek yogurt", "pl": "Jogurt grecki"}`, "g", 2); err != nil {
		t.Fatalf("one-membership Food Object insert failed: %v", err)
	}
	var familyID int
	if err := conn.QueryRow(ctx, "SELECT food_family_id FROM food_objects WHERE id = 101").Scan(&familyID); err != nil {
		t.Fatalf("read food_family_id: %v", err)
	}
	if familyID != 2 {
		t.Fatalf("Food Object 101 belongs to family %d, want 2", familyID)
	}

	rejectFamily := func(id int) {
		t.Helper()
		_, err := conn.Exec(ctx, `INSERT INTO food_families (id, names) VALUES ($1, '{"en":"Test","pl":"Test"}')`, id)
		wantSQLState(t, err, "23514")
	}
	rejectFamily(0)
	rejectFamily(-5)

	_, err := conn.Exec(ctx, insertFoodObject, 102, `{"en": "Bad", "pl": "Zly"}`, "g", 99)
	wantSQLState(t, err, "23503")

	if n := countRows(t, conn, `SELECT count(*) FROM pg_constraint
		WHERE contype = 'f' AND conrelid = 'food_objects'::regclass`); n != 1 {
		t.Fatalf("food_objects has %d foreign keys, want exactly 1 (the Food Family membership path)", n)
	}
	var referenced string
	if err := conn.QueryRow(ctx, `SELECT confrelid::regclass::text FROM pg_constraint
		WHERE contype = 'f' AND conrelid = 'food_objects'::regclass`).Scan(&referenced); err != nil {
		t.Fatalf("read food_objects foreign key target: %v", err)
	}
	if referenced != "food_families" {
		t.Fatalf("food_objects foreign key targets %q, want food_families", referenced)
	}
	if n := countRows(t, conn, `SELECT count(*) FROM pg_constraint
		WHERE contype = 'f' AND confrelid = 'food_families'::regclass`); n != 1 {
		t.Fatalf("%d foreign keys reference food_families, want 1 (only the food_objects membership path)", n)
	}
	if n := countRows(t, conn, `SELECT count(*) FROM pg_constraint
		WHERE contype = 'f' AND conrelid = 'food_families'::regclass`); n != 0 {
		t.Fatalf("food_families has %d foreign keys, want 0 (no hierarchy column)", n)
	}

	var isNullable, dataType string
	if err := conn.QueryRow(ctx, `SELECT is_nullable, data_type FROM information_schema.columns
		WHERE table_name = 'food_objects' AND column_name = 'food_family_id'`).Scan(&isNullable, &dataType); err != nil {
		t.Fatalf("read food_family_id column metadata: %v", err)
	}
	if isNullable != "YES" || dataType != "integer" {
		t.Fatalf("food_family_id is nullable=%s data_type=%s, want nullable=YES integer", isNullable, dataType)
	}
	rows, err := conn.Query(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_name = 'food_families' ORDER BY ordinal_position`)
	if err != nil {
		t.Fatalf("list food_families columns: %v", err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan food_families column: %v", err)
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate food_families columns: %v", err)
	}
	if len(columns) != 2 || columns[0] != "id" || columns[1] != "names" {
		t.Fatalf("food_families columns are %v, want exactly [id names] (no hierarchy column)", columns)
	}

	if n := countRows(t, conn, "SELECT count(*) FROM food_families"); n != 1 {
		t.Fatalf("food_families has %d rows, want 1 test Family", n)
	}
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 2 {
		t.Fatalf("food_objects has %d rows, want 2 test rows", n)
	}
}

func TestDatabaseCredentialSeparation(t *testing.T) {
	db := testdb.NewDB(t)
	ctx := context.Background()

	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)

	if n := countRows(t, owner, "SELECT count(*) FROM schema_migrations"); n != 6 {
		t.Fatalf("schema_migrations has %d rows, want 6", n)
	}
	for _, table := range []string{"food_objects", "food_families"} {
		var exists bool
		if err := owner.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1)`, table).Scan(&exists); err != nil {
			t.Fatalf("check %s table: %v", table, err)
		}
		if !exists {
			t.Fatalf("%s table does not exist after dbsetup", table)
		}
	}

	db.GrantRuntimeCatalogRead(t, owner)
	runtime := connect(t, db.RuntimeURL)

	if n := countRows(t, runtime, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("runtime SELECT on food_objects returns %d rows, want 0 before catalog loading", n)
	}
	if n := countRows(t, runtime, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("runtime SELECT on food_families returns %d rows, want 0 before catalog loading", n)
	}

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat) VALUES (100, '{"en": "Milk", "pl": "Mleko"}'::jsonb, 'ml', 10.0, 5.0, 1.0)`
	for _, stmt := range []string{
		insertFoodObject,
		`UPDATE food_objects SET nutrition_basis = 'g' WHERE id = 1`,
		`DELETE FROM food_objects WHERE id = 1`,
	} {
		_, err := runtime.Exec(ctx, stmt)
		wantSQLState(t, err, "42501")
	}

	_, err := runtime.Exec(ctx, "CREATE TABLE runtime_created (id integer)")
	wantSQLState(t, err, "42501")
	_, err = runtime.Exec(ctx, "CREATE TEMP TABLE runtime_temp (id integer)")
	wantSQLState(t, err, "42501")

	anon := connect(t, db.AnonURL)
	_, err = anon.Exec(ctx, "CREATE TABLE anon_created (id integer)")
	wantSQLState(t, err, "42501")
	_, err = anon.Exec(ctx, "CREATE TEMP TABLE anon_temp (id integer)")
	wantSQLState(t, err, "42501")

	if n := countRows(t, owner, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("food_objects has %d rows, want 0 (catalog unchanged)", n)
	}
	if n := countRows(t, owner, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("food_families has %d rows, want 0 (catalog unchanged)", n)
	}
}

func TestFoodObjectImageKey(t *testing.T) {
	dbURL := testdb.NewDB(t).OwnerURL
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 6 {
		t.Fatalf("schema_migrations has %d rows, want 6 (0001-0006)", n)
	}

	const insertFoodObject = `INSERT INTO food_objects (id, names, nutrition_basis, protein, carbohydrate, fat, image_key) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0, $4)`

	if _, err := conn.Exec(ctx, insertFoodObject, 101, `{"en": "Milk", "pl": "Mleko"}`, "ml", nil); err != nil {
		t.Fatalf("NULL image_key insert failed: %v", err)
	}
	var imageKey *string
	if err := conn.QueryRow(ctx, "SELECT image_key FROM food_objects WHERE id = 101").Scan(&imageKey); err != nil {
		t.Fatalf("read NULL image_key: %v", err)
	}
	if imageKey != nil {
		t.Fatalf("image_key without a value is %q, want NULL", *imageKey)
	}
	var isNullable, dataType string
	if err := conn.QueryRow(ctx, `SELECT is_nullable, data_type FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'food_objects' AND column_name = 'image_key'`).Scan(&isNullable, &dataType); err != nil {
		t.Fatalf("read image_key column metadata: %v", err)
	}
	if isNullable != "YES" || dataType != "text" {
		t.Fatalf("image_key is nullable=%s data_type=%s, want nullable=YES text", isNullable, dataType)
	}

	opaqueKeys := []struct {
		id  int
		key string
	}{
		{110, "pizza-margherita"},
		{111, "chicken-breast"},
		{112, "Opaque/Key_v2.0-2026/08/18.зфыва"},
		{113, "  keeps-significant-spaces  "},
	}
	for _, v := range opaqueKeys {
		names := fmt.Sprintf(`{"en": "K%d", "pl": "P%d"}`, v.id, v.id)
		if _, err := conn.Exec(ctx, insertFoodObject, v.id, names, "g", v.key); err != nil {
			t.Fatalf("opaque image key %q insert failed: %v", v.key, err)
		}
		var got string
		if err := conn.QueryRow(ctx, "SELECT image_key FROM food_objects WHERE id = $1", v.id).Scan(&got); err != nil {
			t.Fatalf("read opaque image key %q: %v", v.key, err)
		}
		if got != v.key {
			t.Fatalf("image_key round-tripped to %q, want %q (an opaque key must be preserved exactly)", got, v.key)
		}
	}

	for _, bad := range []string{"", "   "} {
		_, err := conn.Exec(ctx, insertFoodObject, 120, `{"en": "Bad", "pl": "Zly"}`, "g", bad)
		wantSQLState(t, err, "23514")
	}

	wantColumns := []string{"id", "names", "nutrition_basis", "protein", "carbohydrate", "fat", "serving", "food_family_id", "image_key", "serving_unit", "source"}
	rows, err := conn.Query(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'food_objects'
		ORDER BY ordinal_position`)
	if err != nil {
		t.Fatalf("list food_objects columns: %v", err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan food_objects column: %v", err)
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate food_objects columns: %v", err)
	}
	if len(columns) != len(wantColumns) {
		t.Fatalf("food_objects has %d columns %v, want exactly %v (ARCH-013 source fields only)", len(columns), columns, wantColumns)
	}
	for i, want := range wantColumns {
		if columns[i] != want {
			t.Fatalf("food_objects column %d is %q, want %q (full set %v)", i, columns[i], want, columns)
		}
	}

	wantTables := []string{"food_families", "food_objects", "schema_migrations"}
	rows, err = conn.Query(ctx, `SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		ORDER BY table_name`)
	if err != nil {
		t.Fatalf("list public tables: %v", err)
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatalf("scan public table: %v", err)
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate public tables: %v", err)
	}
	if len(tables) != len(wantTables) {
		t.Fatalf("public schema has %d tables %v, want exactly %v (no derived-value tables)", len(tables), tables, wantTables)
	}
	for i, want := range wantTables {
		if tables[i] != want {
			t.Fatalf("public table %d is %q, want %q (full set %v)", i, tables[i], want, tables)
		}
	}
}
