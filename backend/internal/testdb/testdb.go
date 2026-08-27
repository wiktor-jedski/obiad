// Package testdb creates disposable PostgreSQL fixtures for integration tests.
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

// DB contains one disposable database and its login credentials.
type DB struct {
	// OwnerURL is the schema-owner connection URL.
	OwnerURL string
	// RuntimeURL is the read-only runtime connection URL.
	RuntimeURL string
	// RuntimeRole is the runtime database role name.
	RuntimeRole string
	// AnonURL is the unprivileged connection URL.
	AnonURL string
}

// NewDB creates a disposable database and its login roles.
// It registers cleanup with t.
func NewDB(t testing.TB) *DB {
	t.Helper()
	admin := adminDatabaseURL()
	ctx := context.Background()
	adminConn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Skipf("integration test requires PostgreSQL at %s: %v", redactedURL(admin), err)
	}
	defer func() {
		if err := adminConn.Close(ctx); err != nil {
			t.Errorf("close admin connection: %v", err)
		}
	}()
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
			defer func() {
				if err := dropConn.Close(dropCtx); err != nil {
					t.Errorf("close cleanup connection: %v", err)
				}
			}()
			_, _ = dropConn.Exec(dropCtx, "DROP DATABASE IF EXISTS "+dbName+" WITH (FORCE)")
			for _, role := range []string{ownerRole, runtimeRole, anonRole} {
				_, _ = dropConn.Exec(dropCtx, "DROP ROLE IF EXISTS "+role)
			}
		}
	})
	if _, err := adminConn.Exec(ctx, "CREATE DATABASE "+dbName); err != nil {
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
			t.Fatalf("create role %s: %v", role.name, err)
		}
	}
	if _, err := adminConn.Exec(ctx, "ALTER DATABASE "+dbName+" OWNER TO "+ownerRole); err != nil {
		t.Fatalf("set database owner: %v", err)
	}

	applyPrivilegeSQL(t, connect(t, withDatabase(admin, dbName)),
		"privileges/remove_public_privileges.sql",
		map[string]string{
			"__OBIAD_DATABASE__":     dbName,
			"__OBIAD_OWNER_USER__":   ownerRole,
			"__OBIAD_RUNTIME_USER__": runtimeRole,
		})
	if _, err := adminConn.Exec(ctx, "GRANT CONNECT ON DATABASE "+dbName+" TO "+anonRole); err != nil {
		t.Fatalf("grant anon role connect: %v", err)
	}

	base := withDatabase(admin, dbName)
	return &DB{
		OwnerURL:    withCredentials(base, ownerRole, ownerPassword),
		RuntimeURL:  withCredentials(base, runtimeRole, runtimePassword),
		RuntimeRole: runtimeRole,
		AnonURL:     withCredentials(base, anonRole, anonPassword),
	}
}

// GrantRuntimeCatalogRead grants runtime catalog read access.
func (d *DB) GrantRuntimeCatalogRead(t testing.TB, owner *pgx.Conn) {
	t.Helper()
	applyPrivilegeSQL(t, owner, "privileges/runtime_catalog_read.sql",
		map[string]string{"__OBIAD_RUNTIME_USER__": d.RuntimeRole})
}

func withDatabase(raw string, name string) string {
	u, err := url.Parse(raw)
	if err != nil {
		panic(fmt.Sprintf("invalid database URL %q: %v", raw, err))
	}
	u.Path = "/" + name
	return u.String()
}

func withCredentials(raw string, user string, password string) string {
	u, err := url.Parse(raw)
	if err != nil {
		panic(fmt.Sprintf("invalid database URL %q: %v", raw, err))
	}
	u.User = url.UserPassword(user, password)
	return u.String()
}

func randomPassword(t testing.TB) string {
	t.Helper()
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("generate role password: %v", err)
	}
	return hex.EncodeToString(buf)
}

func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// isSQLIdentifier accepts only generated safe identifiers.
func isSQLIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		lower := r >= 'a' && r <= 'z'
		digit := r >= '0' && r <= '9'
		underscore := r == '_'
		if i == 0 && !lower && !underscore {
			return false
		}
		if !lower && !digit && !underscore {
			return false
		}
	}
	return true
}

// applyPrivilegeSQL executes embedded privilege SQL.
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
	if _, err := conn.Exec(context.Background(), replaced, pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatalf("apply privilege SQL %s: %v", path, err)
	}
}

func redactedURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<invalid database URL>"
	}
	u.User = nil
	return u.String()
}

func connect(t testing.TB, dbURL string) *pgx.Conn {
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
