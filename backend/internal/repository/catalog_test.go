package repository

// Integration tests for Phase 3 (task 10): the private concrete PostgreSQL
// Catalog Loader (ARCH-006, ARCH-013, ARCH-016, ARCH-022). They require a
// real PostgreSQL server: each test creates its isolated disposable database
// plus the schema-owner, SELECT-only runtime, and unprivileged login roles
// through the shared testdb support, runs the real setup command against it,
// grants the runtime catalog read through the same embedded privilege SQL the
// local deployment setup applies, and drives the real Loader through the
// SELECT-only runtime credential. A query tracer on the runtime connection
// proves that every load executes exactly one embedded SELECT and no mutating
// statement, and that a failing load is not retried and a changed catalog is
// not cached. The admin connection comes from OBIAD_TEST_ADMIN_DATABASE_URL
// or from libpq-style environment variables; no credential is committed and
// tests skip when no server is reachable.

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/testdb"
)

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

// connectWithTracer opens a database connection closed when the test
// finishes and records every executed statement on tracer.
func connectWithTracer(t *testing.T, dbURL string, tracer *stmtTracer) *pgx.Conn {
	t.Helper()
	cfg, err := pgx.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("parse %s: %v", redactedURL(dbURL), err)
	}
	cfg.Tracer = tracer
	conn, err := pgx.ConnectConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect to %s: %v", redactedURL(dbURL), err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}

// mutationKeywords are the statement-leading words that would indicate a
// mutating statement. The loader must never execute one.
var mutationKeywords = []string{
	"INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "GRANT", "REVOKE",
	"CREATE", "ALTER", "DROP", "CALL", "COPY",
}

// stmtTracer records every statement executed on one connection so a test
// can prove exactly one SELECT and no mutation per load. pgx invokes the
// tracer synchronously on the calling goroutine, so the recorded statements
// are visited in execution order without synchronization.
type stmtTracer struct {
	stmts []pgx.TraceQueryStartData
}

func (t *stmtTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	t.stmts = append(t.stmts, data)
	return ctx
}

func (t *stmtTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryEndData) {}

// reset forgets every recorded statement.
func (t *stmtTracer) reset() { t.stmts = nil }

// assertSingleSelect verifies that exactly one statement was recorded since
// the last reset, that it is the embedded load SELECT, and that it is not a
// mutating statement. One recorded statement per load also proves that a
// failing load is not automatically retried.
func (t *stmtTracer) assertSingleSelect(tb testing.TB, wantSQL string) {
	tb.Helper()
	if len(t.stmts) != 1 {
		var recorded []string
		for _, s := range t.stmts {
			summary := strings.TrimSpace(s.SQL)
			if len(summary) > 80 {
				summary = summary[:80] + "…"
			}
			recorded = append(recorded, summary)
		}
		tb.Fatalf("loader executed %d statements, want exactly one SELECT per load; recorded: %q", len(t.stmts), recorded)
	}
	if t.stmts[0].SQL != wantSQL {
		tb.Fatalf("loader executed unexpected SQL %q, want the embedded SELECT %q", t.stmts[0].SQL, wantSQL)
	}
	for _, kw := range mutationKeywords {
		if strings.Contains(strings.ToUpper(t.stmts[0].SQL), kw) {
			tb.Fatalf("loader executed a mutating statement containing %q: %s", kw, t.stmts[0].SQL)
		}
	}
}

// wantFoodObject is one expected row of the owner-approved ISSUE-002 catalog
// as the loader must map it: fixed ID, localized names, Physical State,
// Macro Profile, optional Serving, optional Food Family membership, and
// optional image key (ARCH-013).
type wantFoodObject struct {
	id           int32
	en           string
	pl           string
	state        PhysicalState
	protein      float64
	carbohydrate float64
	fat          float64
	serving      *float64
	family       *int32
	imageKey     *string
}

func f64p(v float64) *float64 { return &v }
func i32p(v int32) *int32     { return &v }
func strp(v string) *string   { return &v }

// issue002Catalog returns the exact 38-row owner-approved catalog from
// ISSUE-002 in ascending fixed-ID order (the deterministic Phase 2 seed).
func issue002Catalog() []wantFoodObject {
	return []wantFoodObject{
		{1, "Pizza Margherita", "Pizza margherita", StateSolid, 10, 30, 10, f64p(350), i32p(1), strp("pizza-margherita")},
		{2, "Pizza Capricciosa", "Pizza capricciosa", StateSolid, 11, 28, 11, f64p(350), i32p(1), nil},
		{3, "Lasagna", "Lazania", StateSolid, 9, 18, 8, f64p(350), nil, nil},
		{4, "Pierogi", "Pierogi", StateSolid, 6, 32, 5, f64p(250), nil, nil},
		{5, "Chicken breast", "Pierś z kurczaka", StateSolid, 31, 0, 3.6, nil, nil, strp("chicken-breast")},
		{6, "Pork chop", "Kotlet wieprzowy", StateSolid, 27, 0, 14, nil, nil, nil},
		{7, "Beef steak", "Stek wołowy", StateSolid, 26, 0, 15, nil, nil, nil},
		{8, "Mixed berries", "Owoce jagodowe", StateSolid, 1, 12, 0.5, nil, nil, nil},
		{9, "Apple juice", "Sok jabłkowy", StateLiquid, 0.1, 11, 0.1, nil, nil, nil},
		{10, "Milk", "Mleko", StateLiquid, 3.4, 4.8, 2, nil, nil, strp("milk")},
		{11, "Skyr yogurt", "Jogurt skyr", StateSolid, 11, 4, 0.2, f64p(150), nil, nil},
		{12, "Greek yogurt", "Jogurt grecki", StateSolid, 9, 4, 5, f64p(170), nil, nil},
		{13, "Gyoza", "Pierożki gyoza", StateSolid, 8, 24, 8, f64p(200), nil, strp("gyoza")},
		{14, "Oat milk", "Napój owsiany", StateLiquid, 1, 7, 1.5, nil, nil, nil},
		{15, "Kebab", "Kebab", StateSolid, 15, 18, 12, f64p(350), nil, nil},
		{16, "Gyros", "Gyros", StateSolid, 18, 10, 14, f64p(300), nil, nil},
		{17, "Polish chicken soup", "Rosół", StateLiquid, 2, 1, 1, f64p(300), nil, nil},
		{18, "Butter", "Masło", StateSolid, 0.5, 0.5, 82, nil, nil, nil},
		{19, "Olive oil", "Oliwa z oliwek", StateLiquid, 0, 0, 91.3, nil, nil, nil},
		{20, "Protein shake", "Shake białkowy", StateLiquid, 8, 4, 1, f64p(300), nil, nil},
		{21, "Beef cheeseburger", "Cheeseburger wołowy", StateSolid, 13, 24, 13, f64p(220), nil, nil},
		{22, "Fried chicken wings", "Smażone skrzydełka z kurczaka", StateSolid, 22, 8, 20, f64p(180), nil, nil},
		{23, "Turkey breast", "Pierś z indyka", StateSolid, 29, 0, 2, nil, nil, nil},
		{24, "Pickled cucumbers", "Ogórki kiszone", StateSolid, 0.5, 2, 0.2, nil, nil, nil},
		{25, "Tomatoes", "Pomidory", StateSolid, 0.9, 3.9, 0.2, nil, nil, nil},
		{26, "Pancakes", "Naleśniki", StateSolid, 6, 28, 7, f64p(150), nil, nil},
		{27, "Omelette", "Omlet", StateSolid, 11, 1, 12, f64p(180), nil, nil},
		{28, "Oatmeal", "Owsianka", StateSolid, 2.5, 12, 1.5, f64p(250), nil, nil},
		{29, "Paella", "Paella", StateSolid, 8, 20, 5, f64p(350), nil, nil},
		{30, "Pho", "Zupa pho", StateLiquid, 3, 8, 1.5, f64p(400), nil, nil},
		{31, "Beetroot borscht", "Barszcz czerwony", StateLiquid, 1, 7, 0.5, f64p(300), nil, nil},
		{32, "Coleslaw", "Surówka coleslaw", StateSolid, 1, 10, 8, f64p(100), nil, nil},
		{33, "Mondongo", "Zupa mondongo", StateLiquid, 7, 8, 4, f64p(350), nil, nil},
		{34, "Bandeja paisa", "Bandeja paisa", StateSolid, 12, 20, 15, f64p(500), nil, nil},
		{35, "Pastel de nata", "Pastel de nata", StateSolid, 5, 35, 14, f64p(60), nil, nil},
		{36, "Cheesecake", "Sernik", StateSolid, 7, 25, 18, f64p(120), nil, nil},
		{37, "Orange juice", "Sok pomarańczowy", StateLiquid, 0.7, 10, 0.2, nil, nil, nil},
		{38, "Goulash", "Gulasz", StateSolid, 15, 6, 10, f64p(350), nil, nil},
	}
}

func equalFloatPtr(got, want *float64) bool {
	if (got == nil) != (want == nil) {
		return false
	}
	return got == nil || *got == *want
}

func equalInt32Ptr(got, want *int32) bool {
	if (got == nil) != (want == nil) {
		return false
	}
	return got == nil || *got == *want
}

func equalStrPtr(got, want *string) bool {
	if (got == nil) != (want == nil) {
		return false
	}
	return got == nil || *got == *want
}

// assertIssue002Catalog checks that the loader returned exactly the
// owner-approved 38-row ISSUE-002 catalog with exact IDs, localized names,
// Physical States, Macro Profiles, optional Servings, Food Family
// membership, and image keys, in ascending stable ID order.
func assertIssue002Catalog(t *testing.T, objects []FoodObject) {
	t.Helper()
	want := issue002Catalog()
	if len(objects) != len(want) {
		t.Fatalf("loader returned %d Food Objects, want %d", len(objects), len(want))
	}
	for i := range want {
		got, want := objects[i], want[i]
		if got.ID != want.id {
			t.Fatalf("Food Object %d: loader returned ID %d, want %d", i, got.ID, want.id)
		}
		if got.Names.En != want.en || got.Names.Pl != want.pl {
			t.Fatalf("Food Object %d: loader returned names %+v, want en=%q pl=%q", got.ID, got.Names, want.en, want.pl)
		}
		if got.PhysicalState != want.state {
			t.Fatalf("Food Object %d: loader returned Physical State %q, want %q", got.ID, got.PhysicalState, want.state)
		}
		if got.Protein != want.protein || got.Carbohydrate != want.carbohydrate || got.Fat != want.fat {
			t.Fatalf("Food Object %d: loader returned Macro Profile (%g, %g, %g), want (%g, %g, %g)",
				got.ID, got.Protein, got.Carbohydrate, got.Fat, want.protein, want.carbohydrate, want.fat)
		}
		if !equalFloatPtr(got.Serving, want.serving) {
			t.Fatalf("Food Object %d: loader returned Serving %v, want %v", got.ID, got.Serving, want.serving)
		}
		if !equalInt32Ptr(got.FoodFamilyID, want.family) {
			t.Fatalf("Food Object %d: loader returned Food Family ID %v, want %v", got.ID, got.FoodFamilyID, want.family)
		}
		if !equalStrPtr(got.ImageKey, want.imageKey) {
			t.Fatalf("Food Object %d: loader returned image key %v, want %v", got.ID, got.ImageKey, want.imageKey)
		}
	}
}

// TestCatalogLoaderIntegration verifies the ARCH-006 loader against real
// PostgreSQL through the SELECT-only runtime credential (ARCH-016): it loads
// all 38 seeded Food Objects with exact IDs, localized names, Physical
// States, Macro Profiles, optional Servings, Food Family membership, and
// image keys, executes exactly one embedded SELECT and no mutating statement
// per load, and classifies real storage and catalog-invariant failures
// without a cache or automatic retry.
func TestCatalogLoaderIntegration(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	ctx := context.Background()

	tracer := &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	loader, err := New(runtimeConn)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	wantSQL, err := loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}

	// The loader reads the complete seeded catalog through the SELECT-only
	// runtime credential: exactly 38 Food Objects with the exact ISSUE-002
	// values, in ascending stable ID order, from exactly one embedded SELECT
	// and no mutating statement.
	objects, err := loader.Load(ctx)
	if err != nil {
		t.Fatalf("Load seeded catalog through the runtime credential: %v", err)
	}
	tracer.assertSingleSelect(t, wantSQL)
	assertIssue002Catalog(t, objects)

	// Catalog-invariant failure: the schema owner drops the Macro Profile
	// "not all zero" constraint and inserts a row whose Macro Profile is all
	// zero. PostgreSQL accepts the row, but it violates the ARCH-013 catalog
	// invariant, so the loader must fail the load with a catalog-invariant
	// classification — after exactly one SELECT and no mutating statement on
	// the runtime connection (no retry, no cache).
	if _, err := owner.Exec(ctx, "ALTER TABLE food_objects DROP CONSTRAINT food_objects_macro_profile_not_all_zero"); err != nil {
		t.Fatalf("drop macro profile constraint: %v", err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (39, '{"en": "Zero", "pl": "Zero"}'::jsonb, 'solid', 0, 0, 0)`); err != nil {
		t.Fatalf("insert all-zero Macro Profile fixture row: %v", err)
	}
	tracer.reset()
	_, err = loader.Load(ctx)
	var catalogErr *Error
	if !errors.As(err, &catalogErr) {
		t.Fatalf("Load with an all-zero Macro Profile row: want classified *Error, got %v", err)
	}
	if catalogErr.Kind != KindInvariant {
		t.Fatalf("all-zero Macro Profile row classified as %s, want %s (cause: %v)", catalogErr.Kind, KindInvariant, catalogErr.Err)
	}
	tracer.assertSingleSelect(t, wantSQL)

	// Storage failure: the schema owner revokes the runtime role's SELECT
	// grant, so the next fresh read fails inside PostgreSQL with a permission
	// error. The loader must classify it as a storage failure after exactly
	// one SELECT attempt and no mutating statement — the single failed read
	// also proves the loader performs no automatic retry.
	if _, err := owner.Exec(ctx, "REVOKE SELECT ON food_objects FROM "+db.RuntimeRole); err != nil {
		t.Fatalf("revoke runtime catalog read: %v", err)
	}
	tracer.reset()
	_, err = loader.Load(ctx)
	if !errors.As(err, &catalogErr) {
		t.Fatalf("Load after revoking the runtime SELECT grant: want classified *Error, got %v", err)
	}
	if catalogErr.Kind != KindStorage {
		t.Fatalf("permission failure classified as %s, want %s (cause: %v)", catalogErr.Kind, KindStorage, catalogErr.Err)
	}
	tracer.assertSingleSelect(t, wantSQL)
}

// TestCatalogLoaderReadsFreshSnapshot verifies that the loader holds no
// runtime cache (ARCH-006): the same loader instance performs one fresh
// embedded SELECT per load and observes an owner-made valid fixture change
// on the next load.
func TestCatalogLoaderReadsFreshSnapshot(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	ctx := context.Background()

	tracer := &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	loader, err := New(runtimeConn)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	wantSQL, err := loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}

	// First load: the complete seeded catalog, exactly one SELECT.
	first, err := loader.Load(ctx)
	if err != nil {
		t.Fatalf("first Load: %v", err)
	}
	tracer.assertSingleSelect(t, wantSQL)
	assertIssue002Catalog(t, first)
	tracer.reset()

	// The schema owner makes a valid fixture change while the same loader
	// instance stays alive: an updated localized name on Food Object 1 and a
	// new valid Food Object 39. The runtime credential cannot write, so the
	// change is owner-made (ARCH-016).
	if _, err := owner.Exec(ctx, `UPDATE food_objects SET names = '{"en": "Pizza Margherita Fresca", "pl": "Pizza margherita"}'::jsonb WHERE id = 1`); err != nil {
		t.Fatalf("owner fixture name update: %v", err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, serving) VALUES (39, '{"en": "Cucumber", "pl": "Ogórek"}'::jsonb, 'solid', 0.4, 3, 0.1, 100)`); err != nil {
		t.Fatalf("owner fixture row insert: %v", err)
	}

	// Second load through the same loader instance sees both owner-made
	// changes immediately: the updated English name and the new Food Object
	// 39. The loader holds no runtime cache and performs exactly one fresh
	// SELECT and no mutating statement for this load too.
	second, err := loader.Load(ctx)
	if err != nil {
		t.Fatalf("second Load: %v", err)
	}
	tracer.assertSingleSelect(t, wantSQL)
	if len(second) != 39 {
		t.Fatalf("second load returned %d Food Objects, want 39 after the owner fixture change", len(second))
	}
	if second[0].Names.En != "Pizza Margherita Fresca" || second[0].Names.Pl != "Pizza margherita" {
		t.Fatalf("second load did not observe the owner-updated localized names: got %+v", second[0].Names)
	}
	added := second[38]
	if added.ID != 39 || added.Names.En != "Cucumber" || added.Names.Pl != "Ogórek" ||
		added.PhysicalState != StateSolid || added.Protein != 0.4 || added.Carbohydrate != 3 ||
		added.Fat != 0.1 || added.Serving == nil || *added.Serving != 100 ||
		added.FoodFamilyID != nil || added.ImageKey != nil {
		t.Fatalf("second load did not observe the owner-inserted Food Object 39: %+v", added)
	}
}
