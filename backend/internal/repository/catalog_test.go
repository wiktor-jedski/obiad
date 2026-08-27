package repository

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
	t.Cleanup(func() {
		if err := conn.Close(context.Background()); err != nil {
			t.Errorf("close traced database connection: %v", err)
		}
	})
	return conn
}

var mutationKeywords = []string{
	"INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "GRANT", "REVOKE",
	"CREATE", "ALTER", "DROP", "CALL", "COPY",
}

type stmtTracer struct {
	stmts []pgx.TraceQueryStartData
}

func (t *stmtTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	t.stmts = append(t.stmts, data)
	return ctx
}

func (t *stmtTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryEndData) {}

func (t *stmtTracer) reset() { t.stmts = nil }

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

type wantFoodObject struct {
	id           int32
	en           string
	pl           string
	state        physicalState
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

func issue002Catalog() []wantFoodObject {
	return []wantFoodObject{
		{1, "Pizza Margherita", "Pizza margherita", stateSolid, 10, 30, 10, f64p(350), i32p(1), strp("pizza-margherita")},
		{2, "Pizza Capricciosa", "Pizza capricciosa", stateSolid, 11, 28, 11, f64p(350), i32p(1), nil},
		{3, "Lasagna", "Lazania", stateSolid, 9, 18, 8, f64p(350), nil, nil},
		{4, "Pierogi", "Pierogi", stateSolid, 6, 32, 5, f64p(250), nil, nil},
		{5, "Chicken breast", "Pierś z kurczaka", stateSolid, 31, 0, 3.6, nil, nil, strp("chicken-breast")},
		{6, "Pork chop", "Kotlet wieprzowy", stateSolid, 27, 0, 14, nil, nil, nil},
		{7, "Beef steak", "Stek wołowy", stateSolid, 26, 0, 15, nil, nil, nil},
		{8, "Mixed berries", "Owoce jagodowe", stateSolid, 1, 12, 0.5, nil, nil, nil},
		{9, "Apple juice", "Sok jabłkowy", stateLiquid, 0.1, 11, 0.1, nil, nil, nil},
		{10, "Milk", "Mleko", stateLiquid, 3.4, 4.8, 2, nil, nil, strp("milk")},
		{11, "Skyr yogurt", "Jogurt skyr", stateSolid, 11, 4, 0.2, f64p(150), nil, nil},
		{12, "Greek yogurt", "Jogurt grecki", stateSolid, 9, 4, 5, f64p(170), nil, nil},
		{13, "Gyoza", "Pierożki gyoza", stateSolid, 8, 24, 8, f64p(200), nil, strp("gyoza")},
		{14, "Oat milk", "Napój owsiany", stateLiquid, 1, 7, 1.5, nil, nil, nil},
		{15, "Kebab", "Kebab", stateSolid, 15, 18, 12, f64p(350), nil, nil},
		{16, "Gyros", "Gyros", stateSolid, 18, 10, 14, f64p(300), nil, nil},
		{17, "Polish chicken soup", "Rosół", stateLiquid, 2, 1, 1, f64p(300), nil, nil},
		{18, "Butter", "Masło", stateSolid, 0.5, 0.5, 82, nil, nil, nil},
		{19, "Olive oil", "Oliwa z oliwek", stateLiquid, 0, 0, 91.3, nil, nil, nil},
		{20, "Protein shake", "Shake białkowy", stateLiquid, 8, 4, 1, f64p(300), nil, nil},
		{21, "Beef cheeseburger", "Cheeseburger wołowy", stateSolid, 13, 24, 13, f64p(220), nil, nil},
		{22, "Fried chicken wings", "Smażone skrzydełka z kurczaka", stateSolid, 22, 8, 20, f64p(180), nil, nil},
		{23, "Turkey breast", "Pierś z indyka", stateSolid, 29, 0, 2, nil, nil, nil},
		{24, "Pickled cucumbers", "Ogórki kiszone", stateSolid, 0.5, 2, 0.2, nil, nil, nil},
		{25, "Tomatoes", "Pomidory", stateSolid, 0.9, 3.9, 0.2, nil, nil, nil},
		{26, "Pancakes", "Naleśniki", stateSolid, 6, 28, 7, f64p(150), nil, nil},
		{27, "Omelette", "Omlet", stateSolid, 11, 1, 12, f64p(180), nil, nil},
		{28, "Oatmeal", "Owsianka", stateSolid, 2.5, 12, 1.5, f64p(250), nil, nil},
		{29, "Paella", "Paella", stateSolid, 8, 20, 5, f64p(350), nil, nil},
		{30, "Pho", "Zupa pho", stateLiquid, 3, 8, 1.5, f64p(400), nil, nil},
		{31, "Beetroot borscht", "Barszcz czerwony", stateLiquid, 1, 7, 0.5, f64p(300), nil, nil},
		{32, "Coleslaw", "Surówka coleslaw", stateSolid, 1, 10, 8, f64p(100), nil, nil},
		{33, "Mondongo", "Zupa mondongo", stateLiquid, 7, 8, 4, f64p(350), nil, nil},
		{34, "Bandeja paisa", "Bandeja paisa", stateSolid, 12, 20, 15, f64p(500), nil, nil},
		{35, "Pastel de nata", "Pastel de nata", stateSolid, 5, 35, 14, f64p(60), nil, nil},
		{36, "Cheesecake", "Sernik", stateSolid, 7, 25, 18, f64p(120), nil, nil},
		{37, "Orange juice", "Sok pomarańczowy", stateLiquid, 0.7, 10, 0.2, nil, nil, nil},
		{38, "Goulash", "Gulasz", stateSolid, 15, 6, 10, f64p(350), nil, nil},
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

func assertIssue002Catalog(t *testing.T, objects []foodObject) {
	t.Helper()
	want := issue002Catalog()
	if len(objects) != len(want) {
		t.Fatalf("loader returned %d Food Objects, want %d", len(objects), len(want))
	}
	for i := range want {
		got, want := objects[i], want[i]
		if got.id != want.id {
			t.Fatalf("Food Object %d: loader returned ID %d, want %d", i, got.id, want.id)
		}
		if got.names.En != want.en || got.names.Pl != want.pl {
			t.Fatalf("Food Object %d: loader returned names %+v, want en=%q pl=%q", got.id, got.names, want.en, want.pl)
		}
		if got.physicalState != want.state {
			t.Fatalf("Food Object %d: loader returned Physical State %q, want %q", got.id, got.physicalState, want.state)
		}
		if got.protein != want.protein || got.carbohydrate != want.carbohydrate || got.fat != want.fat {
			t.Fatalf("Food Object %d: loader returned Macro Profile (%g, %g, %g), want (%g, %g, %g)",
				got.id, got.protein, got.carbohydrate, got.fat, want.protein, want.carbohydrate, want.fat)
		}
		if !equalFloatPtr(got.serving, want.serving) {
			t.Fatalf("Food Object %d: loader returned Serving %v, want %v", got.id, got.serving, want.serving)
		}
		if !equalInt32Ptr(got.foodFamilyID, want.family) {
			t.Fatalf("Food Object %d: loader returned Food Family ID %v, want %v", got.id, got.foodFamilyID, want.family)
		}
		if !equalStrPtr(got.imageKey, want.imageKey) {
			t.Fatalf("Food Object %d: loader returned image key %v, want %v", got.id, got.imageKey, want.imageKey)
		}
	}
}

func TestCatalogLoaderIntegration(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	ctx := context.Background()

	tracer := &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	loader, err := newLoader(runtimeConn)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	wantSQL, err := loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}

	objects, err := loader.load(ctx)
	if err != nil {
		t.Fatalf("Load seeded catalog through the runtime credential: %v", err)
	}
	tracer.assertSingleSelect(t, wantSQL)
	assertIssue002Catalog(t, objects)

	servingBoundaryCases := []struct {
		name    string
		id      int32
		serving float64
	}{
		{"Serving above 100000", 40, 200000},
		{"Serving with quotient beyond int32 range", 41, 1e-5},
	}
	var catalogErr *loadError
	for _, tc := range servingBoundaryCases {
		if _, err := owner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, serving) VALUES ($1, '{"en": "Boundary serving", "pl": "Graniczna porcja"}'::jsonb, 'solid', 1, 0, 0, $2)`, tc.id, tc.serving); err != nil {
			t.Fatalf("insert %s fixture row: %v", tc.name, err)
		}
		tracer.reset()
		_, err = loader.load(ctx)
		if !errors.As(err, &catalogErr) {
			t.Fatalf("Load with %s row: want classified *loadError, got %v", tc.name, err)
		}
		if catalogErr.kind != kindInvariant {
			t.Fatalf("%s row classified as %s, want %s (cause: %v)", tc.name, catalogErr.kind, kindInvariant, catalogErr.err)
		}
		if !strings.Contains(catalogErr.err.Error(), "100000") {
			t.Fatalf("%s row did not reach the serving-maximum invariant validation: %v", tc.name, catalogErr.err)
		}
		tracer.assertSingleSelect(t, wantSQL)
		if _, err := owner.Exec(ctx, "DELETE FROM food_objects WHERE id = $1", tc.id); err != nil {
			t.Fatalf("delete %s fixture row: %v", tc.name, err)
		}
	}

	if _, err := owner.Exec(ctx, "ALTER TABLE food_objects DROP CONSTRAINT food_objects_macro_profile_not_all_zero"); err != nil {
		t.Fatalf("drop macro profile constraint: %v", err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (39, '{"en": "Zero", "pl": "Zero"}'::jsonb, 'solid', 0, 0, 0)`); err != nil {
		t.Fatalf("insert all-zero Macro Profile fixture row: %v", err)
	}
	tracer.reset()
	_, err = loader.load(ctx)
	if !errors.As(err, &catalogErr) {
		t.Fatalf("Load with an all-zero Macro Profile row: want classified *loadError, got %v", err)
	}
	if catalogErr.kind != kindInvariant {
		t.Fatalf("all-zero Macro Profile row classified as %s, want %s (cause: %v)", catalogErr.kind, kindInvariant, catalogErr.err)
	}
	tracer.assertSingleSelect(t, wantSQL)

	if _, err := owner.Exec(ctx, "ALTER TABLE food_objects DROP CONSTRAINT food_objects_id_check"); err != nil {
		t.Fatalf("drop positive-ID constraint: %v", err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (0, '{"en": "Zero id", "pl": "Zero id"}'::jsonb, 'solid', 1, 0, 0)`); err != nil {
		t.Fatalf("insert nonpositive-ID fixture row: %v", err)
	}
	tracer.reset()
	_, err = loader.load(ctx)
	if !errors.As(err, &catalogErr) {
		t.Fatalf("Load with a nonpositive-ID row: want classified *loadError, got %v", err)
	}
	if catalogErr.kind != kindInvariant {
		t.Fatalf("nonpositive-ID row classified as %s, want %s (cause: %v)", catalogErr.kind, kindInvariant, catalogErr.err)
	}
	if !strings.Contains(catalogErr.err.Error(), "ID must be positive") {
		t.Fatalf("nonpositive-ID row did not reach invariant validation (was it filtered by the predicate?): %v", catalogErr.err)
	}
	tracer.assertSingleSelect(t, wantSQL)

	if _, err := owner.Exec(ctx, "REVOKE SELECT ON food_objects FROM "+db.RuntimeRole); err != nil {
		t.Fatalf("revoke runtime catalog read: %v", err)
	}
	tracer.reset()
	_, err = loader.load(ctx)
	if !errors.As(err, &catalogErr) {
		t.Fatalf("Load after revoking the runtime SELECT grant: want classified *loadError, got %v", err)
	}
	if catalogErr.kind != kindStorage {
		t.Fatalf("permission failure classified as %s, want %s (cause: %v)", catalogErr.kind, kindStorage, catalogErr.err)
	}
	tracer.assertSingleSelect(t, wantSQL)
}

func TestCatalogLoaderReadsFreshSnapshot(t *testing.T) {
	db := testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner := connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	ctx := context.Background()

	tracer := &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	loader, err := newLoader(runtimeConn)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	wantSQL, err := loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}

	first, err := loader.load(ctx)
	if err != nil {
		t.Fatalf("first Load: %v", err)
	}
	tracer.assertSingleSelect(t, wantSQL)
	assertIssue002Catalog(t, first)
	tracer.reset()

	if _, err := owner.Exec(ctx, `UPDATE food_objects SET names = '{"en": "Pizza Margherita Fresca", "pl": "Pizza margherita"}'::jsonb WHERE id = 1`); err != nil {
		t.Fatalf("owner fixture name update: %v", err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, serving) VALUES (39, '{"en": "Cucumber", "pl": "Ogórek"}'::jsonb, 'solid', 0.4, 3, 0.1, 100)`); err != nil {
		t.Fatalf("owner fixture row insert: %v", err)
	}

	second, err := loader.load(ctx)
	if err != nil {
		t.Fatalf("second Load: %v", err)
	}
	tracer.assertSingleSelect(t, wantSQL)
	if len(second) != 39 {
		t.Fatalf("second load returned %d Food Objects, want 39 after the owner fixture change", len(second))
	}
	if second[0].names.En != "Pizza Margherita Fresca" || second[0].names.Pl != "Pizza margherita" {
		t.Fatalf("second load did not observe the owner-updated localized names: got %+v", second[0].names)
	}
	added := second[38]
	if added.id != 39 || added.names.En != "Cucumber" || added.names.Pl != "Ogórek" ||
		added.physicalState != stateSolid || added.protein != 0.4 || added.carbohydrate != 3 ||
		added.fat != 0.1 || added.serving == nil || *added.serving != 100 ||
		added.foodFamilyID != nil || added.imageKey != nil {
		t.Fatalf("second load did not observe the owner-inserted Food Object 39: %+v", added)
	}
}
