package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"obiad/backend/internal/testdb"
)

type commandFixture struct {
	ctx    context.Context
	db     *testdb.DB
	owner  *pgx.Conn
	binary string
}

const failureCatalog = `{"schemaVersion":1,"foodFamilies":[{"id":10,"names":{"en":"Family","pl":"Rodzina"}}],"foodObjects":[{"id":101,"names":{"en":"First","pl":"Pierwszy"},"macroProfile":{"protein":1,"availableCarbohydrate":2,"fat":3},"nutritionBasis":"g","serving":{"value":200,"unit":"g"},"source":"https://example.org/meal","imageKey":"meal","foodFamilyId":10},{"id":102,"names":{"en":"Last","pl":"Ostatni"},"macroProfile":{"protein":4,"availableCarbohydrate":5,"fat":6},"nutritionBasis":"ml"}]}`

func newCommandFixture(t *testing.T) *commandFixture {
	t.Helper()
	db := testdb.NewDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	owner, err := pgx.Connect(ctx, db.OwnerURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close(context.Background()) })
	binary := filepath.Join(t.TempDir(), "catalogload")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build catalogload: %v\n%s", err, output)
	}
	setup := exec.CommandContext(ctx, "go", "run", "../dbsetup")
	setup.Env = append(os.Environ(), "OBIAD_SCHEMA_OWNER_DATABASE_URL="+db.OwnerURL)
	if output, err := setup.CombinedOutput(); err != nil {
		t.Fatalf("dbsetup: %v\n%s", err, output)
	}
	f := &commandFixture{ctx: ctx, db: db, owner: owner, binary: binary}
	if output, err := f.command(t, db.OwnerURL, failureCatalog, "seed").CombinedOutput(); err != nil {
		t.Fatalf("seed through catalogload: %v\n%s", err, output)
	}
	return f
}

func (f *commandFixture) command(t *testing.T, databaseURL, body, name string) *exec.Cmd {
	t.Helper()
	path := filepath.Join(t.TempDir(), "catalog.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(f.ctx, f.binary, path)
	cmd.Env = append(os.Environ(), "OBIAD_SCHEMA_OWNER_DATABASE_URL="+databaseURL,
		"OBIAD_RUNTIME_DATABASE_URL="+f.db.RuntimeURL, "PGAPPNAME="+name)
	return cmd
}

func (f *commandFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.owner.Exec(f.ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (f *commandFixture) snapshot(t *testing.T, conn *pgx.Conn) string {
	t.Helper()
	var snapshot string
	if err := conn.QueryRow(f.ctx, `SELECT jsonb_build_object(
		'objects', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_objects f),
		'families', (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM food_families f))::text`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func (f *commandFixture) requireSnapshot(t *testing.T, want string) {
	t.Helper()
	if got := f.snapshot(t, f.owner); got != want {
		t.Fatalf("catalog snapshot changed\ngot: %s\nwant: %s", got, want)
	}
}

func requireCommandFailure(t *testing.T, command *exec.Cmd, diagnostic string) {
	t.Helper()
	output, err := command.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() == 0 || !bytes.Contains(output, []byte(diagnostic)) {
		t.Fatalf("expected nonzero command exit with %q, got %v\n%s", diagnostic, err, output)
	}
}

func TestCommandRejectsInvalidCatalogBeforeMutation(t *testing.T) {
	f := newCommandFixture(t)
	before := f.snapshot(t, f.owner)
	// Sequence advances survive rollback, so this detects even attempted deletion.
	f.exec(t, `CREATE SEQUENCE mutation_attempt;
		CREATE FUNCTION record_delete() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN PERFORM nextval('mutation_attempt'); RETURN OLD; END $$;
		CREATE TRIGGER record_delete BEFORE DELETE ON food_objects FOR EACH ROW EXECUTE FUNCTION record_delete();
		CREATE TRIGGER record_delete BEFORE DELETE ON food_families FOR EACH ROW EXECUTE FUNCTION record_delete()`)
	for _, tc := range []struct {
		name string
		old  string
		new  string
	}{
		{"malformed", `"schemaVersion":1`, `"schemaVersion":`},
		{"truncated", `"nutritionBasis":"ml"}]}`, `"nutritionBasis":"ml"}`},
		{"trailing-document", `"nutritionBasis":"ml"}]}`, `"nutritionBasis":"ml"}]} {}`},
		{"unsupported-schema", `"schemaVersion":1`, `"schemaVersion":2`},
		{"missing-schema", `"schemaVersion":1,`, ``},
		{"duplicate-key", `"schemaVersion":1`, `"schemaVersion":2,"schemaVersion":1`},
		{"duplicate-nested-key", `"en":"Last"`, `"en":"Other","en":"Last"`},
		{"duplicate-object-id", `"id":102`, `"id":101`},
		{"duplicate-family-id", `"pl":"Rodzina"}}]`, `"pl":"Rodzina"}},{"id":10,"names":{"en":"Other","pl":"Inna"}}]`},
		{"unknown-top-level", `"schemaVersion":1`, `"schemaVersion":1,"dataCommit":"ignored"`},
		{"unknown-object-field", `"id":102`, `"id":102,"ingredientId":1`},
		{"unknown-family-field", `"id":10`, `"id":10,"parentId":2`},
		{"unknown-macro-field", `"protein":4`, `"protein":4,"fiber":1`},
		{"unknown-serving-field", `"value":200`, `"value":200,"count":2`},
		{"case-folded-key", `"schemaVersion":1`, `"SchemaVersion":1`},
		{"nonpositive-object-id", `"id":102`, `"id":0`},
		{"negative-family-id", `"id":10`, `"id":-10`},
		{"out-of-range-id", `"id":102`, `"id":2147483648`},
		{"fractional-id", `"id":102`, `"id":102.5`},
		{"missing-object-id", `"id":102,`, ``},
		{"missing-english", `"en":"Last",`, ``},
		{"empty-polish", `"pl":"Ostatni"`, `"pl":""`},
		{"blank-family-name", `"pl":"Rodzina"`, `"pl":" \t"`},
		{"nul-name", `"en":"Last"`, `"en":"\u0000"`},
		{"invalid-unicode", `"en":"Last"`, `"en":"\ud800"`},
		{"invalid-utf8", `"en":"Last"`, "\"en\":\"\xff\""},
		{"missing-basis", `,"nutritionBasis":"ml"`, ``},
		{"invalid-basis", `"nutritionBasis":"ml"`, `"nutritionBasis":"kg"`},
		{"missing-macro", `"protein":4,`, ``},
		{"negative-macro", `"fat":6`, `"fat":-1`},
		{"negative-underflow", `"fat":6`, `"fat":-1e-400`},
		{"zero-profile", `"protein":4,"availableCarbohydrate":5,"fat":6`, `"protein":0,"availableCarbohydrate":0,"fat":0`},
		{"nonfinite-overflow", `"fat":6`, `"fat":1e400`},
		{"nan", `"fat":6`, `"fat":NaN`},
		{"infinity", `"fat":6`, `"fat":Infinity`},
		{"string-macro", `"fat":6`, `"fat":"6"`},
		{"zero-serving", `"value":200`, `"value":0`},
		{"negative-serving", `"value":200`, `"value":-1`},
		{"nonfinite-serving", `"value":200`, `"value":1e400`},
		{"missing-serving-value", `"value":200,`, ``},
		{"mismatched-serving-unit", `"unit":"g"`, `"unit":"ml"`},
		{"second-serving", `"value":200,"unit":"g"`, `"value":200,"unit":"g","value":300`},
		{"dangling-family-last-object", `"nutritionBasis":"ml"`, `"nutritionBasis":"ml","foodFamilyId":99`},
		{"multiple-families", `"foodFamilyId":10`, `"foodFamilyId":[10,11]`},
		{"relative-source", `https://example.org/meal`, `/meal`},
		{"invalid-source-port", `https://example.org/meal`, `https://example.org:99999/meal`},
		{"empty-image", `"imageKey":"meal"`, `"imageKey":" "`},
		{"null-optional", `"imageKey":"meal"`, `"imageKey":null`},
		{"missing-families", `"foodFamilies":[{"id":10,"names":{"en":"Family","pl":"Rodzina"}}],`, ``},
		{"empty-objects", `"foodObjects":[` + strings.Split(failureCatalog, `"foodObjects":[`)[1], `"foodObjects":[]}`},
		{"missing-objects", `,"foodObjects":[` + strings.Split(failureCatalog, `"foodObjects":[`)[1], `}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := strings.Replace(failureCatalog, tc.old, tc.new, 1)
			if body == failureCatalog {
				t.Fatal("invalid case did not change the catalog")
			}
			requireCommandFailure(t, f.command(t, f.db.OwnerURL, body, tc.name), "validate catalog:")
			f.requireSnapshot(t, before)
			var attempted bool
			if err := f.owner.QueryRow(f.ctx, `SELECT is_called FROM mutation_attempt`).Scan(&attempted); err != nil {
				t.Fatal(err)
			}
			if attempted {
				t.Fatal("invalid catalog attempted mutation before rejection")
			}
		})
	}
}

func TestCommandRollsBackDatabaseFailure(t *testing.T) {
	f := newCommandFixture(t)
	before := f.snapshot(t, f.owner)
	f.exec(t, `ALTER TABLE food_objects ADD CONSTRAINT reject_last CHECK (id <> 102) NOT VALID;
		CREATE SEQUENCE inserted_objects;
		CREATE FUNCTION record_insert() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN PERFORM nextval('inserted_objects'); RETURN NEW; END $$;
		CREATE TRIGGER record_insert AFTER INSERT ON food_objects FOR EACH ROW EXECUTE FUNCTION record_insert()`)
	replacement := strings.ReplaceAll(failureCatalog, `"en":`, `"de":"Neu","en":`)
	requireCommandFailure(t, f.command(t, f.db.OwnerURL, replacement, "constraint-failure"), "SQLSTATE 23514")
	var inserted bool
	if err := f.owner.QueryRow(f.ctx, `SELECT is_called FROM inserted_objects`).Scan(&inserted); err != nil {
		t.Fatal(err)
	}
	if !inserted {
		t.Fatal("database failure did not follow a successful Food Object insert")
	}
	f.requireSnapshot(t, before)
	f.exec(t, `ALTER TABLE food_objects DROP CONSTRAINT reject_last`)
	if output, err := f.command(t, f.db.OwnerURL, replacement, "after-rollback").CombinedOutput(); err != nil {
		t.Fatalf("load after rollback: %v\n%s", err, output)
	}
	if f.snapshot(t, f.owner) == before {
		t.Fatal("successful retry did not replace the catalog")
	}
}

func TestCommandRuntimeRoleCannotMutateCatalog(t *testing.T) {
	f := newCommandFixture(t)
	f.db.GrantRuntimeCatalogRead(t, f.owner)
	runtime, err := pgx.Connect(f.ctx, f.db.RuntimeURL)
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close(context.Background()) //nolint:errcheck
	before := f.snapshot(t, f.owner)
	if got := f.snapshot(t, runtime); got != before {
		t.Fatal("runtime SELECT does not expose the complete catalog")
	}
	for _, table := range []string{"food_families", "food_objects"} {
		for _, statement := range []string{
			"INSERT INTO " + table + " (id, names) SELECT id, names FROM " + table,
			"UPDATE " + table + " SET names = '{}'::jsonb",
			"DELETE FROM " + table,
			"TRUNCATE " + table + " CASCADE",
		} {
			t.Run(statement, func(t *testing.T) {
				_, err := runtime.Exec(f.ctx, statement)
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
					t.Fatalf("expected insufficient_privilege, got %v", err)
				}
				f.requireSnapshot(t, before)
			})
		}
	}
	requireCommandFailure(t, f.command(t, f.db.RuntimeURL, failureCatalog, "runtime-load"), "SQLSTATE 42501")
	f.requireSnapshot(t, before)
}

func (f *commandFixture) waitForLock(t *testing.T, name string, key int64) {
	t.Helper()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		var waiting bool
		if err := f.owner.QueryRow(f.ctx, `SELECT EXISTS (
			SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid)
			WHERE a.datname = current_database() AND a.application_name = $1
			AND l.locktype = 'advisory' AND NOT l.granted
			AND l.classid::bigint = ($2::bigint >> 32)
			AND l.objid::bigint = ($2::bigint & 4294967295) AND l.objsubid = 1)`, name, key).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-deadline.C:
			t.Fatalf("%s did not wait for advisory lock %d", name, key)
		case <-tick.C:
		}
	}
}

func TestConcurrentCommandsCommitCompleteSnapshots(t *testing.T) {
	f := newCommandFixture(t)
	before := f.snapshot(t, f.owner)
	first := strings.ReplaceAll(failureCatalog, `"id":101`, `"id":201`)
	second := strings.ReplaceAll(failureCatalog, `"id":101`, `"id":301`)
	second = strings.ReplaceAll(second, `"id":10,`, `"id":20,`)
	second = strings.ReplaceAll(second, `"foodFamilyId":10`, `"foodFamilyId":20`)
	// Capture complete expected rows through the same real command before contention.
	var snapshots []string
	for i, body := range []string{first, second, failureCatalog} {
		if output, err := f.command(t, f.db.OwnerURL, body, fmt.Sprintf("expected-%d", i)).CombinedOutput(); err != nil {
			t.Fatalf("load expected snapshot: %v\n%s", err, output)
		}
		snapshots = append(snapshots, f.snapshot(t, f.owner))
	}
	f.requireSnapshot(t, before)
	f.exec(t, `CREATE FUNCTION pause_insert() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN PERFORM pg_advisory_xact_lock(NEW.id::bigint); RETURN NEW; END $$;
		CREATE TRIGGER pause_insert BEFORE INSERT ON food_objects FOR EACH ROW EXECUTE FUNCTION pause_insert();
		SELECT pg_advisory_lock(201); SELECT pg_advisory_lock(301)`)
	start := func(body, name string) func() {
		cmd := f.command(t, f.db.OwnerURL, body, name)
		var output bytes.Buffer
		cmd.Stdout, cmd.Stderr = &output, &output
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		t.Cleanup(func() { _ = cmd.Process.Kill() })
		return func() {
			t.Helper()
			select {
			case err := <-done:
				if err != nil {
					t.Fatalf("%s: %v\n%s", name, err, output.String())
				}
			case <-f.ctx.Done():
				t.Fatalf("%s did not finish: %v", name, f.ctx.Err())
			}
		}
	}
	finishFirst := start(first, "first-loader")
	f.waitForLock(t, "first-loader", 201)
	f.requireSnapshot(t, before)
	finishSecond := start(second, "second-loader")
	f.waitForLock(t, "second-loader", 0x0B1AD0001)
	f.requireSnapshot(t, before)
	f.exec(t, `SELECT pg_advisory_unlock(201)`)
	finishFirst()
	f.waitForLock(t, "second-loader", 301)
	f.requireSnapshot(t, snapshots[0])
	f.exec(t, `SELECT pg_advisory_unlock(301)`)
	finishSecond()
	f.requireSnapshot(t, snapshots[1])
}
