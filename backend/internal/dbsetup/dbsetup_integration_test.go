package dbsetup

// Integration tests for Phases 1-2 (tasks 1-5): they require a real PostgreSQL
// server (ARCH-022). Each test creates a disposable database — plus the
// schema-owner and SELECT-only runtime login roles the local deployment setup
// creates before dbsetup runs (ARCH-016, ISSUE-001) — runs the real setup
// command (go run ./cmd/dbsetup) against it, and drops the database and roles
// afterwards. The admin connection comes from OBIAD_TEST_ADMIN_DATABASE_URL or
// from libpq-style environment variables (PGHOST, PGPORT, PGUSER, PGDATABASE)
// with the password supplied by PGPASSWORD or ~/.pgpass; no credential is
// committed and tests skip when no server is reachable.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	sqlmigrations "obiad/backend/internal/repository/sql"
)

const testAdminDatabaseURLEnv = "OBIAD_TEST_ADMIN_DATABASE_URL"

// adminDatabaseURL returns the admin connection URL for the fixtures. The
// credential is never committed: OBIAD_TEST_ADMIN_DATABASE_URL wins when set;
// otherwise libpq-style environment variables (PGHOST, PGPORT, PGUSER,
// PGDATABASE) shape a password-free URL and the password comes from PGPASSWORD
// or the ~/.pgpass file.
func adminDatabaseURL() string {
	if u := os.Getenv(testAdminDatabaseURLEnv); u != "" {
		return u
	}
	host := os.Getenv("PGHOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("PGPORT")
	if port == "" {
		port = "5432"
	}
	user := os.Getenv("PGUSER")
	if user == "" {
		user = "postgres"
	}
	db := os.Getenv("PGDATABASE")
	if db == "" {
		db = "postgres"
	}
	u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(host, port), Path: "/" + db}
	u.User = url.User(user)
	return u.String()
}

// separatedDatabase holds the connections the credential-separation fixture
// creates: the schema-owner URL (dbsetup), the SELECT-only runtime URL (the
// later Fiber process), the runtime role name (needed to grant SELECT), and
// the CONNECT-only role URL that proves PUBLIC object-creation and
// temporary-table privileges are removed.
type separatedDatabase struct {
	ownerURL    string
	runtimeURL  string
	runtimeRole string
	anonURL     string
}

// newDisposableDB creates a uniquely named empty database with the two login
// roles the local deployment setup creates before dbsetup runs and returns
// the schema-owner connection URL. The database and roles are dropped when
// the test finishes.
func newDisposableDB(t *testing.T) string {
	t.Helper()
	return newSeparatedDatabase(t).ownerURL
}

// newSeparatedDatabase creates a uniquely named empty database plus three
// login roles: a schema-owner role, a SELECT-only runtime role, and an
// unprivileged CONNECT-only role that proves the PUBLIC revocations (ARCH-016,
// ISSUE-001). The owner owns the database; PUBLIC object-creation and
// temporary-table privileges are removed before dbsetup runs. It returns the
// owner and runtime connection URLs, the runtime role name, and the
// CONNECT-only role URL. The database and all roles are dropped when the test
// finishes.
func newSeparatedDatabase(t *testing.T) separatedDatabase {
	t.Helper()
	admin := adminDatabaseURL()
	ctx := context.Background()
	adminConn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Skipf("integration test requires PostgreSQL at %s: %v", redactedURL(admin), err)
	}
	suffix := time.Now().UnixNano()
	dbName := fmt.Sprintf("obiad_test_%d", suffix)
	ownerRole := fmt.Sprintf("obiad_owner_%d", suffix)
	runtimeRole := fmt.Sprintf("obiad_runtime_%d", suffix)
	anonRole := fmt.Sprintf("obiad_anon_%d", suffix)
	ownerPassword := randomPassword(t)
	runtimePassword := randomPassword(t)
	anonPassword := randomPassword(t)
	t.Cleanup(func() {
		dropCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if dropConn, err := pgx.Connect(dropCtx, admin); err == nil {
			defer dropConn.Close(dropCtx)
			_, _ = dropConn.Exec(dropCtx, "DROP DATABASE IF EXISTS "+dbName+" WITH (FORCE)")
			for _, role := range []string{ownerRole, runtimeRole, anonRole} {
				_, _ = dropConn.Exec(dropCtx, "DROP ROLE IF EXISTS "+role)
			}
		}
	})
	if _, err := adminConn.Exec(ctx, "CREATE DATABASE "+dbName); err != nil {
		adminConn.Close(ctx)
		t.Fatalf("create disposable database: %v", err)
	}
	for _, role := range []struct {
		name     string
		password string
	}{
		{ownerRole, ownerPassword},
		{runtimeRole, runtimePassword},
		{anonRole, anonPassword},
	} {
		if _, err := adminConn.Exec(ctx, "CREATE ROLE "+role.name+" LOGIN PASSWORD "+quoteLiteral(role.password)); err != nil {
			adminConn.Close(ctx)
			t.Fatalf("create role %s: %v", role.name, err)
		}
	}
	if _, err := adminConn.Exec(ctx, "ALTER DATABASE "+dbName+" OWNER TO "+ownerRole); err != nil {
		adminConn.Close(ctx)
		t.Fatalf("set database owner: %v", err)
	}

	// Remove PUBLIC object-creation and temporary-table privileges and grant
	// the runtime role connection rights before dbsetup runs. The admin
	// applies the same embedded SQL the local deployment setup applies.
	applyPrivilegeSQL(t, connect(t, withDatabase(admin, dbName)),
		"privileges/remove_public_privileges.sql",
		map[string]string{
			"__OBIAD_DATABASE__":     dbName,
			"__OBIAD_OWNER_USER__":   ownerRole,
			"__OBIAD_RUNTIME_USER__": runtimeRole,
		})
	// The CONNECT-only role proves the PUBLIC revocations; the local
	// deployment setup has no such role, so the fixture grants its CONNECT.
	if _, err := adminConn.Exec(ctx, "GRANT CONNECT ON DATABASE "+dbName+" TO "+anonRole); err != nil {
		adminConn.Close(ctx)
		t.Fatalf("grant anon role connect: %v", err)
	}
	if err := adminConn.Close(ctx); err != nil {
		t.Fatalf("close admin connection: %v", err)
	}

	base := withDatabase(admin, dbName)
	return separatedDatabase{
		ownerURL:    withCredentials(base, ownerRole, ownerPassword),
		runtimeURL:  withCredentials(base, runtimeRole, runtimePassword),
		runtimeRole: runtimeRole,
		anonURL:     withCredentials(base, anonRole, anonPassword),
	}
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

// withCredentials returns url with its userinfo replaced by user and password.
func withCredentials(raw string, user string, password string) string {
	u, err := url.Parse(raw)
	if err != nil {
		panic(fmt.Sprintf("invalid database URL %q: %v", raw, err))
	}
	u.User = url.UserPassword(user, password)
	return u.String()
}

// randomPassword returns a fresh 32-hex-character password from crypto/rand
// for a disposable role. Passwords are generated per run, are never committed
// or logged, and are useless after the disposable database is dropped.
func randomPassword(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("generate role password: %v", err)
	}
	return hex.EncodeToString(buf)
}

// quoteLiteral quotes s as a PostgreSQL string literal.
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// isSQLIdentifier reports whether s is a safe PostgreSQL identifier
// ([a-z_][a-z0-9_]*). The fixture generates every role and database name, so
// the check is defense in depth: a placeholder can never inject SQL.
func isSQLIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		lower := r >= 'a' && r <= 'z'
		digit := r >= '0' && r <= '9'
		underscore := r == '_'
		if i == 0 && !(lower || underscore) {
			return false
		}
		if !(lower || digit || underscore) {
			return false
		}
	}
	return true
}

// applyPrivilegeSQL reads one embedded privilege SQL file, substitutes its
// identifier placeholders, and executes it on conn. The same files are
// applied by the local deployment setup script, so the tested SQL is exactly
// the deployed SQL.
func applyPrivilegeSQL(t *testing.T, conn *pgx.Conn, path string, replacements map[string]string) {
	t.Helper()
	body, err := sqlmigrations.Privileges.ReadFile(path)
	if err != nil {
		t.Fatalf("read privilege SQL %s: %v", path, err)
	}
	replaced := string(body)
	for placeholder, value := range replacements {
		if !isSQLIdentifier(value) {
			t.Fatalf("refusing to substitute %s with non-identifier %q", placeholder, value)
		}
		replaced = strings.ReplaceAll(replaced, placeholder, value)
	}
	// Simple protocol so the multi-statement privilege file executes as one
	// batch, like the migration runner does.
	if _, err := conn.Exec(context.Background(), replaced, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatalf("apply privilege SQL %s: %v", path, err)
	}
}

// grantRuntimeCatalogRead applies the embedded runtime_catalog_read.sql grants
// as the schema owner, exactly as the local deployment setup does after
// dbsetup runs.
func grantRuntimeCatalogRead(t *testing.T, owner *pgx.Conn, runtimeRole string) {
	t.Helper()
	applyPrivilegeSQL(t, owner, "privileges/runtime_catalog_read.sql",
		map[string]string{"__OBIAD_RUNTIME_USER__": runtimeRole})
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

// redactedURL returns raw with any userinfo removed so failure and skip
// messages never disclose credentials.
func redactedURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<invalid database URL>"
	}
	u.User = nil
	return u.String()
}

// connect opens a database connection closed when the test finishes.
func connect(t *testing.T, dbURL string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect to %s: %v", redactedURL(dbURL), err)
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

	// First run applies exactly four pending migrations.
	out := runDBSetupCommand(t, dbURL)
	if !strings.Contains(out, "applied 4 pending migration(s)") {
		t.Fatalf("first run output %q does not report four applied migrations", out)
	}

	conn := connect(t, dbURL)
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 4 {
		t.Fatalf("schema_migrations has %d rows, want 4 (one transaction per migration)", n)
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
	// No seed rows (Phase 1 creates the schema only).
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("food_objects has %d rows after dbsetup, want 0 (no seed rows)", n)
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
		t.Fatalf("food_families has %d rows after dbsetup, want 0 (no seed rows)", n)
	}

	// A second run is a versioned no-op.
	out = runDBSetupCommand(t, dbURL)
	if !strings.Contains(out, "applied 0 pending migration(s)") {
		t.Fatalf("second run output %q does not report zero applied migrations", out)
	}
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 4 {
		t.Fatalf("schema_migrations has %d rows after second run, want 4", n)
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

	// Migration 0002 requires a Macro Profile; a fixed valid profile keeps these
	// identity, name, and state assertions focused on their own constraints.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0)`

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

	// Migration 0002 requires a Macro Profile; a fixed valid profile keeps these
	// identity, name, and state assertions focused on their own constraints.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0)`

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

// TestMacroProfileConstraints verifies P01-G3 and P01-G4 for REQ-010: every
// valid Macro Profile boundary is accepted, and null values, all-zero
// profiles, negative values, NaN, and positive or negative infinity are
// rejected. The catalog retains zero seed rows.
func TestMacroProfileConstraints(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	// Valid boundaries: one positive value in each position, all three
	// positive, a zero-and-positive mix, and the largest and smallest finite
	// positive double values.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, $4::float8, $5::float8, $6::float8)`
	valid := []struct {
		id      int
		protein string
		carb    string
		fat     string
	}{
		{1, "0", "0", "0.5"},                    // only fat positive
		{2, "0.1", "0", "0"},                    // only protein positive
		{3, "0", "0.2", "0"},                    // only carbohydrate positive
		{4, "1.5", "2.5", "3.5"},                // all three positive
		{5, "1.7976931348623157e308", "0", "0"}, // largest finite double
		{6, "5e-324", "0", "0"},                 // smallest positive subnormal
	}
	for _, v := range valid {
		names := fmt.Sprintf(`{"en": "V%d", "pl": "P%d"}`, v.id, v.id)
		if _, err := conn.Exec(ctx, insertFoodObject, v.id, names, "solid", v.protein, v.carb, v.fat); err != nil {
			t.Fatalf("valid Macro Profile (%s, %s, %s) insert failed: %v", v.protein, v.carb, v.fat, err)
		}
	}

	// Every invalid profile is rejected.
	reject := func(id int, protein, carb, fat string) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, id, `{"en": "Bad", "pl": "Zly"}`, "solid", protein, carb, fat)
		wantSQLState(t, err, "23514") // check_violation
	}
	reject(7, "0", "0", "0")          // all-zero profile
	reject(7, "-1", "0", "0")         // negative protein
	reject(7, "0", "-1", "0")         // negative carbohydrate
	reject(7, "0", "0", "-1")         // negative fat
	reject(7, "-0.5", "-0.5", "-0.5") // all negative
	reject(7, "NaN", "0", "0")        // NaN protein
	reject(7, "0", "NaN", "0")        // NaN carbohydrate
	reject(7, "0", "0", "NaN")        // NaN fat
	reject(7, "Infinity", "0", "0")   // +Infinity protein
	reject(7, "0", "Infinity", "0")   // +Infinity carbohydrate
	reject(7, "0", "0", "Infinity")   // +Infinity fat
	reject(7, "-Infinity", "0", "0")  // -Infinity protein
	reject(7, "0", "-Infinity", "0")  // -Infinity carbohydrate
	reject(7, "0", "0", "-Infinity")  // -Infinity fat

	// NULL macro values violate NOT NULL, not a CHECK constraint.
	rejectNull := func(id int, protein, carb, fat any) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, id, `{"en": "Bad", "pl": "Zly"}`, "solid", protein, carb, fat)
		wantSQLState(t, err, "23502") // not_null_violation
	}
	rejectNull(7, nil, "0", "0") // NULL protein
	rejectNull(7, "0", nil, "0") // NULL carbohydrate
	rejectNull(7, "0", "0", nil) // NULL fat

	// No seed rows: the table holds exactly the valid rows inserted here.
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != len(valid) {
		t.Fatalf("food_objects has %d rows, want %d (only test rows, no seed rows)", n, len(valid))
	}
}

// TestServingConstraints verifies P01-G3 and P01-G4 for REQ-008: zero or one
// Serving is accepted, and nonpositive or nonfinite Serving base quantities
// are rejected. The catalog retains zero seed rows.
func TestServingConstraints(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	// A fixed valid Macro Profile keeps this test focused on the Serving
	// column. Valid boundaries: no Serving (NULL) and positive finite values
	// from the smallest subnormal to the largest finite double.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, serving) VALUES ($1, $2::jsonb, $3, 1.0, 0.0, 0.0, $4::float8)`
	valid := []struct {
		id      int
		serving any
	}{
		{1, nil},      // zero Servings: the NULL state
		{2, "0.5"},    // fractional positive Serving
		{3, "1"},      // one whole Serving
		{4, "1e300"},  // large finite Serving
		{5, "5e-324"}, // smallest positive subnormal Serving
	}
	for _, v := range valid {
		names := fmt.Sprintf(`{"en": "S%d", "pl": "P%d"}`, v.id, v.id)
		if _, err := conn.Exec(ctx, insertFoodObject, v.id, names, "liquid", v.serving); err != nil {
			t.Fatalf("valid Serving %v insert failed: %v", v.serving, err)
		}
	}

	// Nonpositive and nonfinite Servings are rejected.
	reject := func(serving string) {
		t.Helper()
		_, err := conn.Exec(ctx, insertFoodObject, 6, `{"en": "Bad", "pl": "Zly"}`, "solid", serving)
		wantSQLState(t, err, "23514") // check_violation
	}
	reject("0")         // zero Serving
	reject("-1")        // negative Serving
	reject("-0.5")      // negative fractional Serving
	reject("NaN")       // NaN Serving
	reject("Infinity")  // +Infinity Serving
	reject("-Infinity") // -Infinity Serving

	// No seed rows: the table holds exactly the valid rows inserted here.
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != len(valid) {
		t.Fatalf("food_objects has %d rows, want %d (only test rows, no seed rows)", n, len(valid))
	}
}

// TestFoodFamilyConstraints verifies P01-G3 and P01-G4 for REQ-009 and the
// glossary Food Family contract: a Food Object belongs to zero or one flat
// Food Family, nonpositive Food Family IDs and references to missing Families
// are rejected, the single nullable foreign key is the only membership path,
// the Food Family table has no hierarchy column, and the catalog retains zero
// seed rows.
func TestFoodFamilyConstraints(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	// No seed rows: dbsetup leaves both Food Catalog tables empty.
	if n := countRows(t, conn, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("food_families has %d rows after dbsetup, want 0 (no seed rows)", n)
	}

	// A fixed valid Macro Profile keeps this test focused on the Food Family
	// membership column.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, food_family_id) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0, $4)`

	// P01-G3: zero membership (NULL) and one valid membership both succeed.
	if _, err := conn.Exec(ctx, insertFoodObject, 1, `{"en": "Milk", "pl": "Mleko"}`, "liquid", nil); err != nil {
		t.Fatalf("zero-membership Food Object insert failed: %v", err)
	}
	if _, err := conn.Exec(ctx, "INSERT INTO food_families (id) VALUES (1)"); err != nil {
		t.Fatalf("valid Food Family insert failed: %v", err)
	}
	if _, err := conn.Exec(ctx, insertFoodObject, 2, `{"en": "Greek yogurt", "pl": "Jogurt grecki"}`, "solid", 1); err != nil {
		t.Fatalf("one-membership Food Object insert failed: %v", err)
	}
	var familyID int
	if err := conn.QueryRow(ctx, "SELECT food_family_id FROM food_objects WHERE id = 2").Scan(&familyID); err != nil {
		t.Fatalf("read food_family_id: %v", err)
	}
	if familyID != 1 {
		t.Fatalf("Food Object 2 belongs to family %d, want 1", familyID)
	}

	// P01-G4: nonpositive Food Family IDs are rejected by the ID CHECK.
	rejectFamily := func(id int) {
		t.Helper()
		_, err := conn.Exec(ctx, "INSERT INTO food_families (id) VALUES ($1)", id)
		wantSQLState(t, err, "23514") // check_violation
	}
	rejectFamily(0)  // zero Food Family ID
	rejectFamily(-5) // negative Food Family ID

	// P01-G4: a Food Object cannot reference a missing Food Family.
	_, err := conn.Exec(ctx, insertFoodObject, 3, `{"en": "Bad", "pl": "Zly"}`, "solid", 99)
	wantSQLState(t, err, "23503") // foreign_key_violation

	// The single nullable foreign key is the only membership path: food_objects
	// has exactly one foreign key, it targets food_families, it is the only
	// foreign key in the whole schema that references food_families (no
	// junction-table membership representation), and food_families itself has
	// no foreign keys (no hierarchy: no self-referencing parent, level, or
	// path column and no reverse membership column).
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

	// The membership column is nullable and of integer type, and the Food
	// Family table owns only its positive integer ID (no hierarchy column).
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
	if len(columns) != 1 || columns[0] != "id" {
		t.Fatalf("food_families columns are %v, want exactly [id] (no hierarchy column)", columns)
	}

	// No seed rows: each table holds exactly the test rows inserted here.
	if n := countRows(t, conn, "SELECT count(*) FROM food_families"); n != 1 {
		t.Fatalf("food_families has %d rows, want 1 (only the test family, no seed rows)", n)
	}
	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 2 {
		t.Fatalf("food_objects has %d rows, want 2 (only test rows, no seed rows)", n)
	}
}

// TestDatabaseCredentialSeparation verifies P01-G1 and P01-G2 for ARCH-007,
// ARCH-013, and ARCH-016: the schema-owner credential applies the complete
// schema to the empty owner database; the SELECT-only runtime credential can
// read both Food Catalog tables but cannot INSERT, UPDATE, DELETE, create
// tables, or create temporary tables; PUBLIC object-creation and
// temporary-table privileges are removed; and every catalog table remains
// empty.
func TestDatabaseCredentialSeparation(t *testing.T) {
	db := newSeparatedDatabase(t)
	ctx := context.Background()

	// P01-G1: the exact setup command applies the complete schema on the empty
	// owner database.
	out := runDBSetupCommand(t, db.ownerURL)
	if !strings.Contains(out, "applied 4 pending migration(s)") {
		t.Fatalf("setup output %q does not report four applied migrations", out)
	}
	owner := connect(t, db.ownerURL)

	// The schema is complete: four migration versions recorded and both Food
	// Catalog tables present.
	if n := countRows(t, owner, "SELECT count(*) FROM schema_migrations"); n != 4 {
		t.Fatalf("schema_migrations has %d rows, want 4", n)
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

	// The runtime role reads the catalog through the same grants the local
	// deployment setup applies after dbsetup runs.
	grantRuntimeCatalogRead(t, owner, db.runtimeRole)
	runtime := connect(t, db.runtimeURL)

	// The runtime credential can SELECT both catalog tables, and the catalog
	// is empty.
	if n := countRows(t, runtime, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("runtime SELECT on food_objects returns %d rows, want 0 (empty catalog)", n)
	}
	if n := countRows(t, runtime, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("runtime SELECT on food_families returns %d rows, want 0 (empty catalog)", n)
	}

	// The runtime credential cannot INSERT, UPDATE, or DELETE.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (1, '{"en": "Milk", "pl": "Mleko"}'::jsonb, 'liquid', 10.0, 5.0, 1.0)`
	for _, stmt := range []string{
		insertFoodObject,
		`UPDATE food_objects SET physical_state = 'solid' WHERE id = 1`,
		`DELETE FROM food_objects WHERE id = 1`,
	} {
		_, err := runtime.Exec(ctx, stmt)
		wantSQLState(t, err, "42501") // insufficient_privilege
	}

	// The runtime credential cannot create tables or temporary tables.
	_, err := runtime.Exec(ctx, "CREATE TABLE runtime_created (id integer)")
	wantSQLState(t, err, "42501")
	_, err = runtime.Exec(ctx, "CREATE TEMP TABLE runtime_temp (id integer)")
	wantSQLState(t, err, "42501")

	// PUBLIC object-creation and temporary-table privileges are removed: a
	// role that holds only CONNECT (no CREATE on the public schema, no
	// TEMPORARY on the database) can connect, yet it cannot create tables or
	// temporary tables either.
	anon := connect(t, db.anonURL)
	_, err = anon.Exec(ctx, "CREATE TABLE anon_created (id integer)")
	wantSQLState(t, err, "42501")
	_, err = anon.Exec(ctx, "CREATE TEMP TABLE anon_temp (id integer)")
	wantSQLState(t, err, "42501")

	// The failed writes left every catalog table empty.
	if n := countRows(t, owner, "SELECT count(*) FROM food_objects"); n != 0 {
		t.Fatalf("food_objects has %d rows, want 0 (empty catalog)", n)
	}
	if n := countRows(t, owner, "SELECT count(*) FROM food_families"); n != 0 {
		t.Fatalf("food_families has %d rows, want 0 (empty catalog)", n)
	}
}

// TestFoodObjectImageKey verifies Phase 2 (task 5; ARCH-013, ARCH-015,
// REQ-011): migration 0004 adds one optional opaque frontend image key per
// Food Object. image_key is nullable, so NULL is the single "no usable image"
// state that shows the bundled placeholder; a present key is opaque and is
// preserved exactly (no trimming, normalization, truncation, or length
// limit); empty and spaces-only keys are rejected (btrim semantics); and the production
// schema stays limited to the ARCH-013 source fields — no derived calories,
// Nutritional Similarities, Matched Quantities, page data, or rounded display
// values in production tables, and no derived-value tables.
func TestFoodObjectImageKey(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	// Migration 0004 is applied and recorded.
	if n := countRows(t, conn, "SELECT count(*) FROM schema_migrations"); n != 4 {
		t.Fatalf("schema_migrations has %d rows, want 4 (0001-0004)", n)
	}

	// A fixed valid Macro Profile keeps this test focused on the image key
	// column.
	const insertFoodObject = `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, image_key) VALUES ($1, $2::jsonb, $3, 10.0, 5.0, 1.0, $4)`

	// image_key is nullable: NULL is the "no usable image" state (REQ-011,
	// ARCH-015) and is accepted.
	if _, err := conn.Exec(ctx, insertFoodObject, 1, `{"en": "Milk", "pl": "Mleko"}`, "liquid", nil); err != nil {
		t.Fatalf("NULL image_key insert failed: %v", err)
	}
	var imageKey *string
	if err := conn.QueryRow(ctx, "SELECT image_key FROM food_objects WHERE id = 1").Scan(&imageKey); err != nil {
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

	// A present key is opaque and is preserved exactly: the stored value
	// round-trips byte-for-byte with no trimming, case folding, normalization,
	// or truncation. Keys carry realistic frontend values plus opaque
	// characters (slashes, dots, dashes, uppercase, and non-ASCII) and
	// significant surrounding whitespace.
	opaqueKeys := []struct {
		id  int
		key string
	}{
		{10, "pizza-margherita"},
		{11, "chicken-breast"},
		{12, "Opaque/Key_v2.0-2026/08/18.зфыва"},
		{13, "  keeps-significant-spaces  "},
	}
	for _, v := range opaqueKeys {
		names := fmt.Sprintf(`{"en": "K%d", "pl": "P%d"}`, v.id, v.id)
		if _, err := conn.Exec(ctx, insertFoodObject, v.id, names, "solid", v.key); err != nil {
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

	// Empty and spaces-only keys are rejected (btrim trims spaces, matching
	// the localized-name constraint), so NULL stays the single "absent image"
	// representation.
	for _, bad := range []string{"", "   "} {
		_, err := conn.Exec(ctx, insertFoodObject, 20, `{"en": "Bad", "pl": "Zly"}`, "solid", bad)
		wantSQLState(t, err, "23514") // check_violation
	}

	// The production schema stays limited to the ARCH-013 source fields:
	// food_objects carries exactly the source columns — no derived calories,
	// Nutritional Similarity, Matched Quantity, page, or rounded display
	// values — and the public schema holds no derived-value tables.
	wantColumns := []string{"id", "names", "physical_state", "protein", "carbohydrate", "fat", "serving", "food_family_id", "image_key"}
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
