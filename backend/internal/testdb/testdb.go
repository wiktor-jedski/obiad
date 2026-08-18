// Package testdb provides reusable backend integration-test support for the
// disposable PostgreSQL fixtures the architecture verification mechanism
// (ARCH-022) requires: creating and cleaning up isolated databases plus the
// schema-owner, SELECT-only runtime, and unprivileged login roles the local
// deployment setup creates before dbsetup runs (ARCH-016, ISSUE-001).
//
// Each fixture database is uniquely named and gets its own role set with
// per-run random passwords. The support applies the same embedded privilege
// SQL the local deployment setup applies, so the tested privilege boundary is
// exactly the deployed one. The database and all roles are dropped when the
// test finishes, on success or failure. The admin connection comes from
// OBIAD_TEST_ADMIN_DATABASE_URL or from libpq-style environment variables
// (PGHOST, PGPORT, PGUSER, PGDATABASE) with the password supplied by
// PGPASSWORD or ~/.pgpass; no credential is committed and tests skip when no
// server is reachable.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	sqlmigrations "obiad/backend/internal/repository/sql"
)

const adminDatabaseURLEnv = "OBIAD_TEST_ADMIN_DATABASE_URL"

// adminDatabaseURL returns the admin connection URL for the fixtures. The
// credential is never committed: OBIAD_TEST_ADMIN_DATABASE_URL wins when set;
// otherwise libpq-style environment variables (PGHOST, PGPORT, PGUSER,
// PGDATABASE) shape a password-free URL and the password comes from PGPASSWORD
// or the ~/.pgpass file.
func adminDatabaseURL() string {
	if u := os.Getenv(adminDatabaseURLEnv); u != "" {
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

// DB is one disposable isolated database with the three login roles the local
// deployment setup creates before dbsetup runs (ARCH-016, ISSUE-001): a
// schema-owner role, a SELECT-only runtime role, and an unprivileged
// CONNECT-only role. The database and all three roles are dropped when the
// test finishes. The exported fields are the owner and runtime controls the
// later fresh-snapshot, ranking-fixture, database-outage, and deadline
// scenarios need: the owner URL (dbsetup and fixture writes), the runtime URL
// (the later Fiber process), the runtime role name (catalog SELECT grants),
// and the unprivileged role URL (the PUBLIC-revocation proof).
type DB struct {
	// OwnerURL is the schema-owner connection URL: the real setup command
	// (go run ./cmd/dbsetup) runs against it (ARCH-007).
	OwnerURL string
	// RuntimeURL is the SELECT-only runtime connection URL: the later Fiber
	// process reads the catalog through it (ARCH-016).
	RuntimeURL string
	// RuntimeRole is the runtime role name; the schema owner grants catalog
	// SELECT to it after dbsetup runs (GrantRuntimeCatalogRead).
	RuntimeRole string
	// AnonURL is the unprivileged CONNECT-only role URL that proves PUBLIC
	// object-creation and temporary-table privileges are removed (ARCH-016).
	AnonURL string
}

// NewDB creates a uniquely named empty database plus the three login roles
// the local deployment setup creates before dbsetup runs: a schema-owner
// role, a SELECT-only runtime role, and an unprivileged CONNECT-only role
// that proves the PUBLIC revocations (ARCH-016, ISSUE-001). The owner owns
// the database; PUBLIC object-creation and temporary-table privileges are
// removed before dbsetup runs. The database and all roles are dropped when
// the test finishes, on success or failure.
func NewDB(t testing.TB) *DB {
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
	return &DB{
		OwnerURL:    withCredentials(base, ownerRole, ownerPassword),
		RuntimeURL:  withCredentials(base, runtimeRole, runtimePassword),
		RuntimeRole: runtimeRole,
		AnonURL:     withCredentials(base, anonRole, anonPassword),
	}
}

// GrantRuntimeCatalogRead applies the embedded runtime_catalog_read.sql
// grants as the schema owner, exactly as the local deployment setup does
// after dbsetup runs (ARCH-016). owner must be connected with the
// schema-owner credential.
func (d *DB) GrantRuntimeCatalogRead(t testing.TB, owner *pgx.Conn) {
	t.Helper()
	applyPrivilegeSQL(t, owner, "privileges/runtime_catalog_read.sql",
		map[string]string{"__OBIAD_RUNTIME_USER__": d.RuntimeRole})
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
func randomPassword(t testing.TB) string {
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
func applyPrivilegeSQL(t testing.TB, conn *pgx.Conn, path string, replacements map[string]string) {
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
func connect(t testing.TB, dbURL string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect to %s: %v", redactedURL(dbURL), err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}
