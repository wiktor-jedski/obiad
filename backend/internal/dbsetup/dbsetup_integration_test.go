package dbsetup

// Integration tests for task 1 (Phase 1): they require a real PostgreSQL
// server (ARCH-022). Each test creates a disposable database, runs the real
// setup command (go run ./cmd/dbsetup) against it, and drops the database
// afterwards. The admin connection comes from OBIAD_TEST_ADMIN_DATABASE_URL and
// defaults to a local PostgreSQL; tests skip when no server is reachable.

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	testAdminDatabaseURLEnv = "OBIAD_TEST_ADMIN_DATABASE_URL"
	defaultAdminDatabaseURL = "postgres://postgres:obiad@localhost:5432/postgres"
)

// newDisposableDB creates a uniquely named empty database and returns its
// connection URL. The database is dropped when the test finishes.
func newDisposableDB(t *testing.T) string {
	t.Helper()
	admin := os.Getenv(testAdminDatabaseURLEnv)
	if admin == "" {
		admin = defaultAdminDatabaseURL
	}
	ctx := context.Background()
	adminConn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Skipf("integration test requires PostgreSQL at %s: %v", admin, err)
	}
	name := fmt.Sprintf("obiad_test_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		dropCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if dropConn, err := pgx.Connect(dropCtx, admin); err == nil {
			defer dropConn.Close(dropCtx)
			_, _ = dropConn.Exec(dropCtx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		}
	})
	if _, err := adminConn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		adminConn.Close(ctx)
		t.Fatalf("create disposable database: %v", err)
	}
	if err := adminConn.Close(ctx); err != nil {
		t.Fatalf("close admin connection: %v", err)
	}
	return withDatabase(admin, name)
}

// withDatabase returns url with its database path replaced by name.
func withDatabase(raw string, name string) string {
	u, err := url.Parse(raw)
	if err != nil {
		panic(fmt.Sprintf("invalid database URL %q: %v", raw, err))
	}
	u.Path = "/" + name
	return u.String()
}

// moduleRoot walks up from the test working directory to the module root.
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

// runDBSetupCommand executes the real setup command against dbURL and returns
// its combined output.
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

// connect opens a database connection closed when the test finishes.
func connect(t *testing.T, dbURL string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect to %s: %v", dbURL, err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}

// wantSQLState asserts that err is a PostgreSQL error with the given SQLSTATE.
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

// TestDBSetupAppliesVersionedMigrations verifies P01-G1: the setup command
// applies the versioned migrations to an empty disposable database in one
// migration transaction, records the applied version, and is idempotent.
func TestDBSetupAppliesVersionedMigrations(t *testing.T) {
	dbURL := newDisposableDB(t)
	ctx := context.Background()

	// First run applies exactly one pending migration.
	out := runDBSetupCommand(t, dbURL)
	if !strings.Contains(out, "applied 1 pending migration(s)") {
		t.Fatalf("first run output %q does not report one applied migration", out)
	}

	conn := connect(t, dbURL)
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 1 {
		t.Fatalf("schema_migrations has %d rows, want 1 (one migration transaction)", n)
	}
	var version int
	var name string
	if err := conn.QueryRow(ctx, "SELECT version, name FROM schema_migrations").Scan(&version, &name); err != nil {
		t.Fatalf("read schema_migrations: %v", err)
	}
	if version != 1 || name != "create_food_objects" {
		t.Fatalf("schema_migrations row is version=%d name=%q, want version=1 name=create_food_objects", version, name)
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
	// No seed rows (Phase 1 creates the schema only).
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("food_objects has %d rows after dbsetup, want 0 (no seed rows)", n)
	}

	// A second run is a versioned no-op.
	out = runDBSetupCommand(t, dbURL)
	if !strings.Contains(out, "applied 0 pending migration(s)") {
		t.Fatalf("second run output %q does not report zero applied migrations", out)
	}
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 1 {
		t.Fatalf("schema_migrations has %d rows after second run, want 1", n)
	}
}

// TestDBSetupMigrationTransaction verifies that one migration applies
// atomically: a failing migration records no version and leaves no partial
// schema, while earlier migrations stay applied.
func TestDBSetupMigrationTransaction(t *testing.T) {
	dbURL := newDisposableDB(t)
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

// TestFoodObjectIdentityAndLocalizedNames verifies P01-G3, P01-G4, and P01-G5:
// a valid Food Object row with positive ID and nonempty string "en" and "pl"
// names succeeds, both localized names share one ID, and missing, empty,
// wrong-type, or nonpositive values are rejected.
func TestFoodObjectIdentityAndLocalizedNames(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state) VALUES ($1, $2::jsonb, $3)`

	// P01-G3: a valid row with a positive ID and both names succeeds.
	if _, err := conn.Exec(ctx, insertFoodObject, 1, `{"en": "Milk", "pl": "Mleko"}`, "liquid"); err != nil {
		t.Fatalf("valid Food Object insert failed: %v", err)
	}

	// P01-G5: one ID serves both localized names.
	var idEn, idPl int
	if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'en' = $1`, "Milk").Scan(&idEn); err != nil {
		t.Fatalf("lookup by English name: %v", err)
	}
	if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'pl' = $1`, "Mleko").Scan(&idPl); err != nil {
		t.Fatalf("lookup by Polish name: %v", err)
	}
	if idEn != idPl {
		t.Fatalf("English and Polish names resolve to different IDs: en=%d pl=%d", idEn, idPl)
	}
	if idEn != 1 {
		t.Fatalf("both localized names resolve to ID %d, want 1", idEn)
	}

	// A second record keeps its own distinct, stable ID.
	if _, err := conn.Exec(ctx, insertFoodObject, 2, `{"en": "Bread", "pl": "Chleb"}`, "solid"); err != nil {
		t.Fatalf("second valid Food Object insert failed: %v", err)
	}
	var breadID int
	if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'pl' = $1`, "Chleb").Scan(&breadID); err != nil {
		t.Fatalf("lookup by Polish name for Bread: %v", err)
	}
	if breadID != 2 {
		t.Fatalf("Chleb resolves to ID %d, want 2", breadID)
	}

	// P01-G4: each specified invalid row is rejected.
	reject := func(id int, names string) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, id, names, "solid")
		wantSQLState(t, err, "23514") // check_violation
	}
	reject(0, `{"en": "Zero", "pl": "Zero"}`)       // nonpositive ID
	reject(-5, `{"en": "Neg", "pl": "Ujemna"}`)     // nonpositive ID
	reject(3, `{"pl": "Bez EN"}`)                   // missing en
	reject(3, `{"en": "Bez PL"}`)                   // missing pl
	reject(3, `{"en": "", "pl": "Puste EN"}`)       // empty en
	reject(3, `{"en": "Puste PL", "pl": ""}`)       // empty pl
	reject(3, `{"en": "   ", "pl": "Spacje"}`)      // whitespace-only en
	reject(3, `{"en": 42, "pl": "Liczba"}`)         // wrong-type en
	reject(3, `{"en": "Tablica", "pl": ["Mleko"]}`) // wrong-type pl
	reject(3, `["Milk", "Mleko"]`)                  // names not an object
	reject(3, `"Milk"`)                             // names not an object

	// A duplicate positive ID is rejected by the primary key.
	_, err := conn.Exec(ctx, insertFoodObject, 1, `{"en": "Milk2", "pl": "Mleko2"}`, "liquid")
	wantSQLState(t, err, "23505") // unique_violation

	// Every rejected row left the table unchanged: exactly the two valid rows.
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 2 {
		t.Fatalf("food_objects has %d rows, want 2 after all rejections", n)
	}
}

// TestFoodObjectPhysicalState verifies P01-G3 and P01-G4 for the Physical
// State: "solid" and "liquid" are accepted and every other value is rejected.
func TestFoodObjectPhysicalState(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state) VALUES ($1, $2::jsonb, $3)`

	for id, state := range map[int]string{10: "solid", 11: "liquid"} {
		if _, err := conn.Exec(ctx, insertFoodObject, id, fmt.Sprintf(`{"en": "S%d", "pl": "P%d"}`, id, id), state); err != nil {
			t.Fatalf("valid state %q insert failed: %v", state, err)
		}
	}

	for _, state := range []string{"gas", "Solid", "SOLID", "solid ", " liquid", ""} {
		_, err := conn.Exec(ctx, insertFoodObject, 20, `{"en": "Bad", "pl": "Zly"}`, state)
		wantSQLState(t, err, "23514") // check_violation
	}

	// NULL violates NOT NULL, not the CHECK constraint.
	_, err := conn.Exec(ctx, insertFoodObject, 20, `{"en": "Bad", "pl": "Zly"}`, nil)
	wantSQLState(t, err, "23502") // not_null_violation

	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 2 {
		t.Fatalf("food_objects has %d rows, want 2 after state rejections", n)
	}
}
