package repository

// Integration tests for Phase 3 (task 11): the concrete Suggest Food Objects
// Run operation over the private Catalog Loader (ARCH-004, ARCH-006,
// ARCH-017, ARCH-022). They require a real PostgreSQL server: each test
// creates its isolated disposable database plus the schema-owner, SELECT-only
// runtime, and unprivileged login roles through the shared testdb support,
// runs the real setup command against it, grants the runtime catalog read
// through the same embedded privilege SQL the local deployment setup applies,
// and drives the real Suggest Module through the SELECT-only runtime
// credential. A query tracer on the runtime connection proves that every Run
// performs exactly one fresh embedded SELECT and that validation failures
// never touch PostgreSQL. The admin connection comes from
// OBIAD_TEST_ADMIN_DATABASE_URL or from libpq-style environment variables; no
// credential is committed and tests skip when no server is reachable.

import (
	"context"
	"errors"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/testdb"
)

// setupSuggestFixture creates the disposable database, runs the real setup
// command against it, grants the runtime role catalog SELECT exactly as the
// local deployment setup does, connects the SELECT-only runtime credential
// with a statement tracer, and builds a Suggest Module over that connection.
// It returns the Module, the tracer, the embedded SELECT text, and the
// schema-owner connection (for owner-made fixture changes, ARCH-016).
func setupSuggestFixture(t *testing.T) (db *testdb.DB, suggest *Suggest, tracer *stmtTracer, wantSQL string, owner *pgx.Conn) {
	t.Helper()
	db = testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner = connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	tracer = &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	var err error
	suggest, err = NewSuggest(runtimeConn)
	if err != nil {
		t.Fatalf("NewSuggest: %v", err)
	}
	wantSQL, err = loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}
	return db, suggest, tracer, wantSQL, owner
}

// assertIDs checks the exact ordered suggestion ID sequence.
func assertIDs(t *testing.T, suggestions []Suggestion, want ...int32) {
	t.Helper()
	if len(suggestions) != len(want) {
		t.Fatalf("got %d suggestions with IDs %v, want %d IDs %v", len(suggestions), suggestionIDs(suggestions), len(want), want)
	}
	for i, id := range want {
		if suggestions[i].FoodObjectID != id {
			t.Fatalf("suggestion %d has ID %d, want %d (full order %v)", i, suggestions[i].FoodObjectID, id, suggestionIDs(suggestions))
		}
	}
}

// suggestionIDs returns the ordered Food Object IDs of the suggestions.
func suggestionIDs(suggestions []Suggestion) []int32 {
	ids := make([]int32, len(suggestions))
	for i, s := range suggestions {
		ids[i] = s.FoodObjectID
	}
	return ids
}

// assertDistinctFive checks that the operation returned exactly five
// distinct suggestions, each carrying both required localized names.
func assertDistinctFive(t *testing.T, suggestions []Suggestion) {
	t.Helper()
	if len(suggestions) != 5 {
		t.Fatalf("got %d suggestions, want exactly five", len(suggestions))
	}
	seen := make(map[int32]bool, len(suggestions))
	for _, s := range suggestions {
		if seen[s.FoodObjectID] {
			t.Fatalf("suggestion ID %d is not distinct", s.FoodObjectID)
		}
		seen[s.FoodObjectID] = true
		if s.Names.En == "" || s.Names.Pl == "" {
			t.Fatalf("suggestion ID %d carries empty localized names %+v", s.FoodObjectID, s.Names)
		}
	}
}

// assertSuggestion checks the exact localized names and default Food Quantity
// of one suggestion.
func assertSuggestion(t *testing.T, s Suggestion, en, pl string, quantityValue int, quantityUnit Unit) {
	t.Helper()
	if s.Names.En != en || s.Names.Pl != pl {
		t.Fatalf("suggestion ID %d names %+v, want en=%q pl=%q", s.FoodObjectID, s.Names, en, pl)
	}
	if s.DefaultQuantity.Value != quantityValue || s.DefaultQuantity.Unit != quantityUnit {
		t.Fatalf("suggestion ID %d default quantity %+v, want %d %s", s.FoodObjectID, s.DefaultQuantity, quantityValue, quantityUnit)
	}
}

// assertSameSuggestions checks that two result slices are identical item for
// item (IDs, names, and quantities), proving that two query variants are
// normalized to the same comparison.
func assertSameSuggestions(t *testing.T, got, want []Suggestion) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d suggestions %v, want %d suggestions %v", len(got), suggestionIDs(got), len(want), suggestionIDs(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("suggestion %d differs: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

// assertStableError checks the exact stable failure code and field of the
// operation error.
func assertStableError(t *testing.T, err error, wantCode Code, wantField string) {
	t.Helper()
	var suggestErr *Error
	if !errors.As(err, &suggestErr) {
		t.Fatalf("error %v is not a *Error", err)
	}
	if suggestErr.Code != wantCode {
		t.Fatalf("failure code %q, want %q (error: %v)", suggestErr.Code, wantCode, err)
	}
	if suggestErr.Field != wantField {
		t.Fatalf("failure field %q, want %q (error: %v)", suggestErr.Field, wantField, err)
	}
}

// TestSuggestFoodObjectsIntegration exercises the concrete Suggest Run
// operation and the fresh Catalog Loader against real PostgreSQL through the
// SELECT-only runtime credential: exactly five distinct suggestions for
// normal and no-close-match queries in both languages; all three default Food
// Quantities; normalization of case, Unicode whitespace, and canonically
// equivalent (NFC/NFD) text; Polish-diacritic distance; raw-distance order;
// active-language and ID tie order; the stable validation failures; the fresh
// loader; and the storage-failure classification. Every successful Run
// executes exactly one fresh embedded SELECT and no mutating statement.
func TestSuggestFoodObjectsIntegration(t *testing.T) {
	db, suggest, tracer, wantSQL, owner := setupSuggestFixture(t)
	ctx := context.Background()
	run := func(query string, lang Language) ([]Suggestion, error) {
		t.Helper()
		tracer.reset()
		suggestions, err := suggest.Run(ctx, query, lang)
		if err != nil {
			if len(tracer.stmts) != 0 {
				t.Fatalf("Run(%q, %s) failed after %d statements; validation failures must not read PostgreSQL", query, lang, len(tracer.stmts))
			}
			return nil, err
		}
		tracer.assertSingleSelect(t, wantSQL)
		return suggestions, nil
	}

	// Normal query, both languages: the same query text is compared against
	// the English names in English mode and the Polish names in Polish mode
	// (REQ-013). Each language yields exactly five distinct suggestions whose
	// order is derived from raw code-point Levenshtein distance (REQ-016).
	enPizza, err := run("pizza margherita", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(pizza margherita, English): %v", err)
	}
	assertDistinctFive(t, enPizza)
	assertIDs(t, enPizza, 1, 2, 8, 12, 3)
	assertSuggestion(t, enPizza[0], "Pizza Margherita", "Pizza margherita", 1, UnitServing)

	plPizza, err := run("pizza margherita", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(pizza margherita, Polish): %v", err)
	}
	assertDistinctFive(t, plPizza)
	assertIDs(t, plPizza, 1, 2, 3, 29, 35)

	enPierogi, err := run("pierogi", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(pierogi, English): %v", err)
	}
	assertDistinctFive(t, enPierogi)
	// Distance-5 tie broken by English collation: gyros < paella < pho.
	assertIDs(t, enPierogi, 4, 16, 29, 30, 13)

	plPierogi, err := run("pierogi", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(pierogi, Polish): %v", err)
	}
	assertDistinctFive(t, plPierogi)
	// Distance-5 tie broken by Polish collation: gyros < mleko < paella <
	// sernik.
	assertIDs(t, plPierogi, 4, 16, 10, 29, 36)

	// No-close-match query, both languages: "zzzzzz" matches nothing, yet a
	// valid catalog returns exactly five distinct suggestions (REQ-012). The
	// English and Polish result sets differ because each language compares
	// its own names (REQ-013).
	enNone, err := run("zzzzzz", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(zzzzzz, English): %v", err)
	}
	assertDistinctFive(t, enNone)
	assertIDs(t, enNone, 13, 18, 16, 15, 10)

	plNone, err := run("zzzzzz", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(zzzzzz, Polish): %v", err)
	}
	assertDistinctFive(t, plNone)
	assertIDs(t, plNone, 38, 16, 15, 3, 18)

	// Default Food Quantities: 1 serving for a Food Object with a Serving
	// (REQ-023), otherwise the 100 g Nutrition Basis of a solid and the
	// 100 ml Nutrition Basis of a liquid (REQ-007, REQ-024). Both localized
	// names are always returned.
	chicken, err := run("chicken breast", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(chicken breast, English): %v", err)
	}
	assertDistinctFive(t, chicken)
	assertIDs(t, chicken, 5, 23, 7, 36, 15)
	assertSuggestion(t, chicken[0], "Chicken breast", "Pierś z kurczaka", 100, UnitGram)

	milk, err := run("milk", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(milk, English): %v", err)
	}
	assertDistinctFive(t, milk)
	assertIDs(t, milk, 10, 14, 30, 13, 16)
	assertSuggestion(t, milk[0], "Milk", "Mleko", 100, UnitMillilitre)

	// Normalization (REQ-014, ARCH-017): letter-case and whitespace variants
	// and canonically equivalent (NFC/NFD) text produce identical ordered
	// suggestions. Unicode whitespace (here non-breaking spaces U+00A0) is
	// trimmed and collapsed to ASCII spaces.
	caseVariant, err := run("  PiZzA  MARGHERITA ", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(case and space variant, English): %v", err)
	}
	assertSameSuggestions(t, caseVariant, enPizza)

	nbVariant, err := run("pizza\u00a0\u00a0margherita", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(Unicode whitespace variant, English): %v", err)
	}
	assertSameSuggestions(t, nbVariant, enPizza)

	nfcQuery := "pierś z kurczaka"
	nfdQuery := "pier" + "s\u0301" + " z kurczaka" // decomposed ś: s + combining acute
	nfc, err := run(nfcQuery, LanguagePolish)
	if err != nil {
		t.Fatalf("Run(NFC query, Polish): %v", err)
	}
	assertDistinctFive(t, nfc)
	assertIDs(t, nfc, 5, 23, 13, 24, 19)
	nfd, err := run(nfdQuery, LanguagePolish)
	if err != nil {
		t.Fatalf("Run(NFD query, Polish): %v", err)
	}
	assertSameSuggestions(t, nfd, nfc)
	assertSuggestion(t, nfc[0], "Chicken breast", "Pierś z kurczaka", 100, UnitGram)

	// Polish diacritics (REQ-015): "z" and "ż" are distinct code points one
	// edit apart. Replacing ż with z in the query costs exactly one
	// substitution: "Pierożki gyoza" stays the top suggestion at distance 1,
	// but the distances of the remaining names shift (23 versus 4 trade
	// ranks), so the two queries rank differently.
	zForm, err := run("pierozki gyoza", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(pierozki gyoza, Polish): %v", err)
	}
	assertDistinctFive(t, zForm)
	assertIDs(t, zForm, 13, 23, 4, 5, 25)

	accentedForm, err := run("pierożki gyoza", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(pierożki gyoza, Polish): %v", err)
	}
	assertDistinctFive(t, accentedForm)
	assertIDs(t, accentedForm, 13, 4, 23, 5, 25)
	if suggestionIDs(zForm)[1] == suggestionIDs(accentedForm)[1] {
		t.Fatalf("the z-form and ż-form queries must rank differently: both put %v at rank 2", suggestionIDs(zForm)[1])
	}

	// Tie order (REQ-017, ISSUE-004): the schema owner inserts four fixture
	// Food Objects: two with identical localized names (IDs 39 and 40) and
	// two whose names "źle" and "żaba" tie at the same distance but order
	// differently under the pinned English and Polish collations.
	fixtureNames := []struct {
		id int32
		en string
		pl string
	}{
		{39, "Sernik duplikat", "Sernik duplikat"},
		{40, "Sernik duplikat", "Sernik duplikat"},
		{41, "źle", "Źle"},
		{42, "żaba", "Żaba"},
	}
	for _, f := range fixtureNames {
		if _, err := owner.Exec(ctx,
			`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, 'solid', 1, 0, 0)`,
			f.id, `{"en": "`+f.en+`", "pl": "`+f.pl+`"}`,
		); err != nil {
			t.Fatalf("owner fixture insert for ID %d: %v", f.id, err)
		}
	}

	// Equal distance and equal collation (identical names) fall back to the
	// stable Food Object ID: 39 before 40 in both languages.
	dupEn, err := run("sernik duplikat", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(sernik duplikat, English): %v", err)
	}
	assertDistinctFive(t, dupEn)
	assertIDs(t, dupEn, 39, 40, 34, 12, 37)
	assertSuggestion(t, dupEn[0], "Sernik duplikat", "Sernik duplikat", 100, UnitGram)

	dupPl, err := run("sernik duplikat", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(sernik duplikat, Polish): %v", err)
	}
	assertDistinctFive(t, dupPl)
	assertIDs(t, dupPl, 39, 40, 36, 34, 23)

	// Equal distance with different names breaks by the pinned active-language
	// collation of the normalized names. For the query "a", "źle" and "żaba"
	// tie at distance 3: the English collator orders "żaba" before "źle"
	// (ID 42 before 41), while the Polish collator orders "źle" before
	// "żaba" (ID 41 before 42) — the same pair ranks differently per
	// language, proving the pinned collation follows the Interface Language.
	aEn, err := run("a", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(a, English): %v", err)
	}
	assertDistinctFive(t, aEn)
	assertIDs(t, aEn, 30, 42, 41, 13, 15)
	assertSuggestion(t, aEn[1], "żaba", "Żaba", 100, UnitGram)
	assertSuggestion(t, aEn[2], "źle", "Źle", 100, UnitGram)

	aPl, err := run("a", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(a, Polish): %v", err)
	}
	assertDistinctFive(t, aPl)
	assertIDs(t, aPl, 41, 42, 15, 18, 38)

	// Stable validation failures: invalid UTF-8, normalized-empty queries
	// (ASCII and Unicode whitespace), and an over-128-code-point query are
	// rejected with the stable code and field, before any catalog read.
	if _, err := run("pizza\xff\xfe", LanguageEnglish); err == nil {
		t.Fatal("Run with invalid UTF-8 succeeded, want INVALID_SEARCH_QUERY")
	} else {
		assertStableError(t, err, CodeInvalidSearchQuery, "query")
	}
	if _, err := run("   ", LanguageEnglish); err == nil {
		t.Fatal("Run with a whitespace-only query succeeded, want INVALID_SEARCH_QUERY")
	} else {
		assertStableError(t, err, CodeInvalidSearchQuery, "query")
	}
	if _, err := run("\u00a0\u00a0\u3000", LanguageEnglish); err == nil {
		t.Fatal("Run with a Unicode-whitespace-only query succeeded, want INVALID_SEARCH_QUERY")
	} else {
		assertStableError(t, err, CodeInvalidSearchQuery, "query")
	}
	if _, err := run(strings.Repeat("a", maxQueryCodePoints+1), LanguageEnglish); err == nil {
		t.Fatal("Run with a 129-code-point query succeeded, want QUERY_TOO_LONG")
	} else {
		assertStableError(t, err, CodeQueryTooLong, "query")
	}
	if _, err := run("anything", Language("fr")); err == nil {
		t.Fatal("Run with an unsupported language succeeded, want UNSUPPORTED_LANGUAGE")
	} else {
		assertStableError(t, err, CodeUnsupportedLanguage, "language")
	}

	// The 128-code-point boundary: a query of exactly 128 code points is the
	// longest accepted query and still returns exactly five distinct
	// suggestions.
	boundary, err := run(strings.Repeat("a", maxQueryCodePoints), LanguageEnglish)
	if err != nil {
		t.Fatalf("Run with the 128-code-point boundary query: %v", err)
	}
	assertDistinctFive(t, boundary)

	// Fresh loader: the schema owner updates Food Object 1's English name
	// while the same Suggest Module instance stays alive. The next Run
	// observes the change immediately — one fresh embedded SELECT per
	// operation, no runtime cache (ARCH-006).
	if _, err := owner.Exec(ctx, `UPDATE food_objects SET names = '{"en": "Pizza Margherita Fresca", "pl": "Pizza margherita"}'::jsonb WHERE id = 1`); err != nil {
		t.Fatalf("owner fixture name update: %v", err)
	}
	fresh, err := run("pizza margherita", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run after owner name update: %v", err)
	}
	assertDistinctFive(t, fresh)
	assertIDs(t, fresh, 1, 2, 8, 12, 3)
	if fresh[0].Names.En != "Pizza Margherita Fresca" {
		t.Fatalf("fresh Run did not observe the owner-updated name: got %+v", fresh[0].Names)
	}

	// Storage failure: the schema owner revokes the runtime role's SELECT
	// grant, so the next fresh read fails inside PostgreSQL. The Module must
	// classify it as the stable CATALOG_UNAVAILABLE failure with no field,
	// after exactly one SELECT attempt and no retry.
	if _, err := owner.Exec(ctx, "REVOKE SELECT ON food_objects FROM "+db.RuntimeRole); err != nil {
		t.Fatalf("revoke runtime catalog read: %v", err)
	}
	tracer.reset()
	if _, err := suggest.Run(ctx, "pizza", LanguageEnglish); err == nil {
		t.Fatal("Run after revoking the runtime SELECT grant succeeded, want CATALOG_UNAVAILABLE")
	} else {
		assertStableError(t, err, CodeCatalogUnavailable, "")
	}
	tracer.assertSingleSelect(t, wantSQL)
}

// allocBytesPerRun returns the average number of bytes allocated per run of f
// (runtime.MemStats.TotalAlloc is monotonic, so garbage collection does not
// affect the measurement). f is executed once as a warm-up before measuring.
func allocBytesPerRun(runs int, f func()) float64 {
	f() // warm-up
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	for i := 0; i < runs; i++ {
		f()
	}
	runtime.ReadMemStats(&after)
	return float64(after.TotalAlloc-before.TotalAlloc) / float64(runs)
}

// maxRankingMemoryGrowth is the largest accepted per-run allocation growth
// when the long database name doubles from 8192 to 16384 code points under a
// 128-code-point query. Bounded-row ranking allocates only two distance rows
// sized to the 128-code-point shorter input, so the growth is just the
// O(name-length) scan and normalization delta (~100 KiB); a full distance
// matrix would grow by 129 × 8192 × 8 bytes ≈ 8.1 MiB per run, far above
// this bound.
const maxRankingMemoryGrowth = 512 << 10

// TestSuggestionRankingMemoryBound verifies the ARCH-017 quality constraint
// against real PostgreSQL: the concrete Run operation computes raw
// code-point Levenshtein distance with working memory bounded by the shorter
// input. With a 128-code-point query (the accepted boundary) against a
// database name of 8192 then 16384 code points, the per-run allocation
// growth must stay within the bounded-row delta; a full-matrix distance
// implementation would grow by roughly 8 MiB per run and fail. The owner-made
// name change between the two measurements also exercises the fresh loader.
func TestSuggestionRankingMemoryBound(t *testing.T) {
	_, suggest, _, _, owner := setupSuggestFixture(t)
	ctx := context.Background()

	// The schema owner inserts a Food Object whose English name is a long run
	// of code points, far longer than the 128-code-point query, so the query
	// is always the shorter input of the distance computation.
	namesJSON := func(codePoints int) string {
		return `{"en": "` + strings.Repeat("a", codePoints) + `", "pl": "Długi"}`
	}
	if _, err := owner.Exec(ctx,
		`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (39, $1::jsonb, 'solid', 1, 0, 0)`,
		namesJSON(8192),
	); err != nil {
		t.Fatalf("owner fixture insert: %v", err)
	}

	query := strings.Repeat("a", maxQueryCodePoints) // exactly 128 code points
	runOnce := func() {
		suggestions, err := suggest.Run(ctx, query, LanguageEnglish)
		if err != nil {
			t.Fatalf("Run with the 128-code-point query and long name: %v", err)
		}
		if len(suggestions) != 5 {
			t.Fatalf("Run returned %d suggestions, want exactly five", len(suggestions))
		}
		seen := make(map[int32]bool, len(suggestions))
		for _, s := range suggestions {
			if seen[s.FoodObjectID] {
				t.Fatalf("Run returned duplicate suggestion ID %d", s.FoodObjectID)
			}
			seen[s.FoodObjectID] = true
		}
	}

	runOnce() // warm-up (statement description cache and steady state)
	allocsShort := allocBytesPerRun(3, runOnce)

	// The same Suggest Module instance must observe the fresh snapshot on the
	// next Run (no runtime cache): the long name doubles to 16384 code points.
	if _, err := owner.Exec(ctx,
		`UPDATE food_objects SET names = $1::jsonb WHERE id = 39`,
		namesJSON(16384),
	); err != nil {
		t.Fatalf("owner fixture name update: %v", err)
	}
	runOnce() // warm-up on the fresh snapshot
	allocsLong := allocBytesPerRun(3, runOnce)

	if growth := allocsLong - allocsShort; growth > maxRankingMemoryGrowth {
		fullMatrixGrowth := float64((maxQueryCodePoints + 1) * 8192 * 8) // 129 rows × 8192 extra code points × 8 bytes
		t.Fatalf("ranking memory grew by %.0f KiB per run when the long database name doubled from 8192 to 16384 code points under a 128-code-point query; want at most %d KiB. Bounded-row ranking allocates only two rows of the shorter input, so the growth is the O(name-length) scan delta; a full distance matrix would grow by about %.0f MiB per run",
			growth/1024, maxRankingMemoryGrowth/1024, fullMatrixGrowth/(1024*1024))
	}
}
