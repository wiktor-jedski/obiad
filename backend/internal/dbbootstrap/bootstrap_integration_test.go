package dbbootstrap_test

import (
	"context"
	"crypto/rand"
	"errors"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"obiad/backend/internal/catalogload"
	"obiad/backend/internal/dbbootstrap"
	"obiad/backend/internal/dbsetup"
	sqlfiles "obiad/backend/internal/repository/sql"
)

func TestDeploymentLifecycle(t *testing.T) {
	raw := os.Getenv("OBIAD_TEST_ADMIN_DATABASE_URL")
	if raw == "" {
		t.Skip("set OBIAD_TEST_ADMIN_DATABASE_URL to run the deployment test")
	}
	admin, err := pgx.ParseConfig(raw)
	if err != nil {
		t.Fatal("invalid test admin configuration")
	}
	ctx := t.Context()
	control := connect(t, admin)
	suffix := strings.ToLower(rand.Text())
	target := dbbootstrap.Target{
		Database: `obiad_"db_` + suffix,
		Owner:    `obiad_"owner_` + suffix,
		Runtime:  `obiad_"runtime_` + suffix,
	}
	ownerPassword := `owner'\;` + rand.Text()
	runtimePassword := `runtime'\;` + rand.Text()
	replacer := strings.NewReplacer(
		`"__DATABASE__"`, pgx.Identifier{target.Database}.Sanitize(),
		`"__OWNER__"`, pgx.Identifier{target.Owner}.Sanitize(),
		`"__RUNTIME__"`, pgx.Identifier{target.Runtime}.Sanitize(),
	)
	fixture := func(name string) string {
		t.Helper()
		body, err := sqlfiles.BootstrapFixtures.ReadFile("testdata/bootstrap/" + name + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		return replacer.Replace(string(body))
	}
	dropDatabase, dropRoles := fixture("drop_database"), fixture("drop_roles")
	t.Cleanup(func() {
		for _, query := range []string{dropDatabase, dropRoles} {
			if _, err := control.Exec(context.Background(), query); err != nil {
				t.Errorf("remove disposable database or roles: %v", err)
			}
		}
	})
	apply := func(phase string) {
		t.Helper()
		if err := target.Apply(ctx, admin, phase, ownerPassword, runtimePassword); err != nil {
			t.Fatal(err)
		}
	}
	apply("roles")
	database := admin.Copy()
	database.Database = target.Database
	dba := connect(t, database)
	ownerConfig := database.Copy()
	ownerConfig.User, ownerConfig.Password = target.Owner, ownerPassword
	owner := connect(t, ownerConfig)
	migrations, err := fs.Sub(sqlfiles.Migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dbsetup.Apply(ctx, owner, migrations); err != nil {
		t.Fatal(err)
	}
	ownerURL, err := url.Parse(raw)
	if err != nil {
		t.Fatal("invalid test admin URL")
	}
	ownerURL.Path, ownerURL.User = "/"+target.Database, url.UserPassword(target.Owner, ownerPassword)
	if err := catalogload.Run(ctx, ownerURL.String(), "../../catalog/dummy.json"); err != nil {
		t.Fatal("could not import the test catalog")
	}
	apply("grants")
	runtimeConfig := database.Copy()
	runtimeConfig.User, runtimeConfig.Password = target.Runtime, runtimePassword
	firstReader := connect(t, runtimeConfig)
	var foodID int32
	if err := firstReader.QueryRow(ctx, sqlfiles.RandomFood).Scan(&foodID); err != nil {
		t.Fatal("runtime could not read the imported catalog")
	}
	if _, err := dba.Exec(ctx, fixture("weaken")); err != nil {
		t.Fatal(err)
	}
	ownerPassword, runtimePassword = `new'\owner`+rand.Text(), `new'\runtime`+rand.Text()
	apply("roles")
	apply("grants")
	ownerConfig.Password = ownerPassword
	owner = connect(t, ownerConfig)
	if _, err := owner.Exec(ctx, fixture("future_table")); err != nil {
		t.Fatal(err)
	}
	runtimeConfig.Password = runtimePassword
	runtime := connect(t, runtimeConfig)
	var restricted bool
	if err := runtime.QueryRow(ctx, fixture("check_access"), target.Owner, target.Runtime).Scan(&restricted); err != nil {
		t.Fatal(err)
	}
	if !restricted {
		t.Fatal("deployment did not restore the required access")
	}
	for operation := range strings.SplitSeq(strings.TrimSpace(fixture("forbidden")), "\n") {
		_, err := runtime.Exec(ctx, operation)
		var denied *pgconn.PgError
		if !errors.As(err, &denied) || denied.Code != "42501" {
			t.Fatalf("runtime operation %q: want insufficient privilege, got %v", operation, err)
		}
	}
	if _, err := dba.Exec(ctx, fixture("runtime_ownership")); err != nil {
		t.Fatal(err)
	}
	state := func() string {
		t.Helper()
		var value string
		if err := dba.QueryRow(ctx, fixture("role_state"), target.Owner, target.Runtime).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := state()
	for _, phase := range []string{"roles", "grants"} {
		err := target.Apply(ctx, admin, phase, ownerPassword, runtimePassword)
		if err == nil || !strings.Contains(err.Error(), "runtime role owns") {
			t.Fatalf("%s did not refuse runtime ownership: %v", phase, err)
		}
		if state() != before {
			t.Fatalf("%s changed a role before the ownership check", phase)
		}
	}
}

func connect(t *testing.T, config *pgx.ConnConfig) *pgx.Conn {
	t.Helper()
	conn, err := pgx.ConnectConfig(t.Context(), config)
	if err != nil {
		t.Fatal("could not connect to the test database")
	}
	t.Cleanup(func() {
		if err := conn.Close(context.Background()); err != nil {
			t.Error("could not close the test connection")
		}
	})
	return conn
}
