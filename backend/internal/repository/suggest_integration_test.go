package repository

import (
	"context"
	"errors"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/testdb"
)

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

func suggestionIDs(suggestions []Suggestion) []int32 {
	ids := make([]int32, len(suggestions))
	for i, s := range suggestions {
		ids[i] = s.FoodObjectID
	}
	return ids
}

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

func assertSuggestion(t *testing.T, s Suggestion, en, pl string, quantityValue int, quantityUnit Unit) {
	t.Helper()
	if s.Names.En != en || s.Names.Pl != pl {
		t.Fatalf("suggestion ID %d names %+v, want en=%q pl=%q", s.FoodObjectID, s.Names, en, pl)
	}
	if s.DefaultQuantity.Value != quantityValue || s.DefaultQuantity.Unit != quantityUnit {
		t.Fatalf("suggestion ID %d default quantity %+v, want %d %s", s.FoodObjectID, s.DefaultQuantity, quantityValue, quantityUnit)
	}
}

func assertSameSuggestions(t *testing.T, got, want []Suggestion) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d suggestions %v, want %d suggestions %v", len(got), suggestionIDs(got), len(want), suggestionIDs(want))
	}
	for i := range got {
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Fatalf("suggestion %d differs: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

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
	assertIDs(t, enPierogi, 4, 16, 29, 30, 13)

	plPierogi, err := run("pierogi", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(pierogi, Polish): %v", err)
	}
	assertDistinctFive(t, plPierogi)
	assertIDs(t, plPierogi, 4, 16, 10, 29, 36)

	plOws, err := run("ows", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(ows, Polish): %v", err)
	}
	assertDistinctFive(t, plOws)
	if plOws[0].FoodObjectID != 28 {
		t.Fatalf("Run(ows, Polish) first ID = %d, want Owsianka ID 28 (full order %v)", plOws[0].FoodObjectID, suggestionIDs(plOws))
	}

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
	nfdQuery := "pier" + "s\u0301" + " z kurczaka"
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

	acEn, err := run("ac", LanguageEnglish)
	if err != nil {
		t.Fatalf("Run(ac, English): %v", err)
	}
	assertDistinctFive(t, acEn)
	assertIDs(t, acEn, 30, 42, 41, 15, 10)
	assertSuggestion(t, acEn[1], "żaba", "Żaba", 100, UnitGram)
	assertSuggestion(t, acEn[2], "źle", "Źle", 100, UnitGram)

	acPl, err := run("ac", LanguagePolish)
	if err != nil {
		t.Fatalf("Run(ac, Polish): %v", err)
	}
	assertDistinctFive(t, acPl)
	assertIDs(t, acPl, 41, 42, 15, 18, 38)

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

	boundary, err := run(strings.Repeat("a", maxQueryCodePoints), LanguageEnglish)
	if err != nil {
		t.Fatalf("Run with the 128-code-point boundary query: %v", err)
	}
	assertDistinctFive(t, boundary)

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

func allocBytesPerRun(runs int, f func()) float64 {
	f()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	for i := 0; i < runs; i++ {
		f()
	}
	runtime.ReadMemStats(&after)
	return float64(after.TotalAlloc-before.TotalAlloc) / float64(runs)
}

const maxRankingMemoryGrowth = 512 << 10

func TestSuggestionRankingMemoryBound(t *testing.T) {
	_, suggest, _, _, owner := setupSuggestFixture(t)
	ctx := context.Background()

	namesJSON := func(codePoints int) string {
		return `{"en": "` + strings.Repeat("a", codePoints) + `", "pl": "Długi"}`
	}
	if _, err := owner.Exec(ctx,
		`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES (39, $1::jsonb, 'solid', 1, 0, 0)`,
		namesJSON(8192),
	); err != nil {
		t.Fatalf("owner fixture insert: %v", err)
	}

	query := strings.Repeat("a", maxQueryCodePoints)
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

	runOnce()
	allocsShort := allocBytesPerRun(3, runOnce)

	if _, err := owner.Exec(ctx,
		`UPDATE food_objects SET names = $1::jsonb WHERE id = 39`,
		namesJSON(16384),
	); err != nil {
		t.Fatalf("owner fixture name update: %v", err)
	}
	runOnce()
	allocsLong := allocBytesPerRun(3, runOnce)

	if growth := allocsLong - allocsShort; growth > maxRankingMemoryGrowth {
		fullMatrixGrowth := float64((maxQueryCodePoints + 1) * 8192 * 8)
		t.Fatalf("ranking memory grew by %.0f KiB per run when the long database name doubled from 8192 to 16384 code points under a 128-code-point query; want at most %d KiB. Bounded-row ranking allocates only two rows of the shorter input, so the growth is the O(name-length) scan delta; a full distance matrix would grow by about %.0f MiB per run",
			growth/1024, maxRankingMemoryGrowth/1024, fullMatrixGrowth/(1024*1024))
	}
}
