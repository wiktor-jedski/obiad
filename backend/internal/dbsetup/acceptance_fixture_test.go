package dbsetup

// Phase 2, task 7: reusable PostgreSQL integration-fixture manifest for the
// plausible seeded rows approved in ISSUE-002 (ARCH-017, ARCH-018, REQ-033,
// REQ-071, REQ-072).
//
// This file is implementation-test data. It designates the three acceptance
// inputs (Pizza Margherita at one Serving, Chicken breast at 100 g, Milk at
// 100 ml) and keeps their derived expectations — expected ordered fixed IDs,
// full-precision Nutritional Similarities, unrounded Matched Quantities,
// numeric tolerances, and page order — here, never in the product-decision
// issue (ISSUE-002) and never in production SQL (ARCH-013). The expectations
// are derived with the ARCH-018 float64 formulas from the deterministic
// seeded catalog, which is identical after every dbsetup run (P02-G2), so
// they reproduce exactly from a fresh setup; nothing derived is stored in a
// production table (P02-G4: the runtime credential reads only the source
// catalog).
//
// Artificial similarity ties, numeric precision boundaries, unknown images,
// and other failure data stay in isolated fixtures owned by the later
// behavior phases (Phase 3/4), not in this manifest.

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// PageSize is the fixed Substitute page size: "Count all eligible
// Substitutes, then slice pages of three" (ARCH-018).
const PageSize = 3

// SimilarityTolerance is the absolute tolerance for comparing a
// full-precision Nutritional Similarity with the expected manifest value.
// 1e-12 is orders of magnitude tighter than the whole-percent display
// rounding (ARCH-018) and comfortably above float64 rounding noise for the
// catalog magnitudes.
const SimilarityTolerance = 1e-12

// MatchedQuantityTolerance is the absolute tolerance, in base units (g or
// ml), for comparing an unrounded Matched Quantity with the expected manifest
// value. The largest expected Matched Quantity is about 1.5e3 base units
// (float64 ulp about 2.3e-13), so 1e-9 is about four thousand times machine
// rounding while still far tighter than the whole-base-unit display rounding
// (ARCH-018).
const MatchedQuantityTolerance = 1e-9

// AcceptanceInput is one ISSUE-002 designated acceptance input: the Food
// Object it names plus the Food Quantity it is submitted with (REQ-071).
// Quantity is the designated Food Quantity converted to base units; Unit
// follows the glossary Nutrition Basis ("g" for solid, "ml" for liquid).
type AcceptanceInput struct {
	ID            int
	EnglishName   string
	PolishName    string
	PhysicalState string
	Serving       *float64 // one-Serving base quantity; nil when the row has no Serving
	ImageKey      *string  // known opaque frontend key; nil = absent image (REQ-011)
	Protein       float64  // grams per Nutrition Basis (100 g solids, 100 ml liquids)
	Carbohydrate  float64
	Fat           float64
	Designation   string  // "one Serving", "100 g", or "100 ml"
	Quantity      float64 // designated Food Quantity in base units
	Unit          string  // "g" (solid) or "ml" (liquid)
}

// ExpectedResult is one derived expectation for an eligible Substitutes row:
// the full-precision Nutritional Similarity and the unrounded Matched
// Quantity (ARCH-018), plus the seeded row identity fields so later behavior
// phases can resolve and display the Substitute without re-deriving the
// fixture. Similarity is cosine similarity of the input and candidate Macro
// Profiles; MatchedQuantity is the amount of the Substitute with the same
// derived calorie value as the input, in the Substitute's base units.
type ExpectedResult struct {
	ID              int
	EnglishName     string
	PolishName      string
	PhysicalState   string
	Serving         *float64
	ImageKey        *string
	Similarity      float64 // full precision, unrounded (ARCH-018)
	MatchedQuantity float64 // unrounded, base units (ARCH-018)
}

// AcceptanceFixture is the complete derived expectation for one designated
// acceptance input: the input itself, its eligible Substitutes in ARCH-018
// order (decreasing unrounded similarity, pinned English-name collation,
// stable Food Object ID), the full-precision similarities and unrounded
// Matched Quantities for every eligible ID, and the page order (pages of
// PageSize, in order).
type AcceptanceFixture struct {
	Input         AcceptanceInput
	EligibleCount int
	OrderedIDs    []int
	Results       map[int]ExpectedResult
	Pages         [][]int
}

// englishCollation is the pinned English collator used for the ARCH-018
// result tie-break. For the ASCII English names in the catalog the collation
// order equals their letter order; the tie-break is exercised only when two
// candidates have bit-identical full-precision similarities, which the
// approved distinct Macro Profiles never produce.
var englishCollation = collate.New(language.English)

// macroCalories derives the calorie value of a Macro Profile per Nutrition
// Basis with float64 (ARCH-018: 4p + 4c + 9f).
func macroCalories(protein, carbohydrate, fat float64) float64 {
	return 4*protein + 4*carbohydrate + 9*fat
}

// nutritionalSimilarity computes the Nutritional Similarity of two Macro
// Profiles as cosine similarity with float64 (ARCH-018).
func nutritionalSimilarity(pA, cA, fA, pB, cB, fB float64) float64 {
	dot := pA*pB + cA*cB + fA*fB
	normA := math.Sqrt(pA*pA + cA*cA + fA*fA)
	normB := math.Sqrt(pB*pB + cB*cB + fB*fB)
	return dot / (normA * normB)
}

// matchedQuantity computes the unrounded amount of a candidate with the same
// derived calorie value as the input: the input's total derived calories
// divided by the candidate's calories per Nutrition Basis (ARCH-018). inputQuantity
// is the converted input Food Quantity in base units.
func matchedQuantity(inputCalories, inputQuantity, candidateCalories float64) float64 {
	return inputCalories * inputQuantity / candidateCalories
}

// AcceptanceFixtures returns the reusable acceptance fixture manifest: one
// AcceptanceFixture per designated acceptance input (ISSUE-002) in
// designated-input order (Pizza Margherita, Chicken breast, Milk). Every
// derived expectation is computed here from the deterministic seeded catalog
// (issue002Catalog) with the ARCH-018 float64 formulas and kept as
// implementation-test data: expected ordered fixed IDs, full-precision
// Nutritional Similarities, unrounded Matched Quantities, numeric
// tolerances, and page order. Later behavior phases consume these fixtures.
func AcceptanceFixtures() []AcceptanceFixture {
	catalog := issue002Catalog()
	byID := make(map[int]seedFoodObject, len(catalog))
	for _, row := range catalog {
		byID[row.id] = row
	}
	// Designated acceptance inputs (ISSUE-002): Pizza Margherita at one
	// Serving (its 350 g Serving base quantity), Chicken breast at 100 g,
	// and Milk at 100 ml (the no-Serving defaults are the Nutrition Basis
	// quantities of the glossary).
	designated := []struct {
		id          int
		designation string
		quantity    float64
		unit        string
	}{
		{1, "one Serving", 350, "g"},
		{5, "100 g", 100, "g"},
		{10, "100 ml", 100, "ml"},
	}
	fixtures := make([]AcceptanceFixture, 0, len(designated))
	for _, d := range designated {
		row := byID[d.id]
		excluded := map[int]bool{d.id: true}
		if row.familyID != nil {
			// REQ-033: exclude every other member of the input's Food Family.
			for _, other := range catalog {
				if other.familyID != nil && *other.familyID == *row.familyID {
					excluded[other.id] = true
				}
			}
		}
		eligible := make([]int, 0, len(catalog)-len(excluded))
		for _, other := range catalog {
			if !excluded[other.id] {
				eligible = append(eligible, other.id)
			}
		}
		inputCalories := macroCalories(row.protein, row.carbohydrate, row.fat)
		sims := make(map[int]float64, len(eligible))
		mqs := make(map[int]float64, len(eligible))
		for _, id := range eligible {
			c := byID[id]
			sims[id] = nutritionalSimilarity(row.protein, row.carbohydrate, row.fat, c.protein, c.carbohydrate, c.fat)
			mqs[id] = matchedQuantity(inputCalories, d.quantity, macroCalories(c.protein, c.carbohydrate, c.fat))
		}
		// ARCH-018 result order: decreasing unrounded similarity, pinned
		// English-name collation, stable Food Object ID.
		sort.Slice(eligible, func(i, j int) bool {
			a, b := eligible[i], eligible[j]
			if sims[a] != sims[b] {
				return sims[a] > sims[b]
			}
			if c := englishCollation.CompareString(byID[a].en, byID[b].en); c != 0 {
				return c < 0
			}
			return a < b
		})
		pages := make([][]int, 0, (len(eligible)+PageSize-1)/PageSize)
		for start := 0; start < len(eligible); start += PageSize {
			end := start + PageSize
			if end > len(eligible) {
				end = len(eligible)
			}
			pages = append(pages, eligible[start:end])
		}
		results := make(map[int]ExpectedResult, len(eligible))
		for _, id := range eligible {
			c := byID[id]
			results[id] = ExpectedResult{
				ID:              c.id,
				EnglishName:     c.en,
				PolishName:      c.pl,
				PhysicalState:   c.state,
				Serving:         c.serving,
				ImageKey:        c.imageKey,
				Similarity:      sims[id],
				MatchedQuantity: mqs[id],
			}
		}
		fixtures = append(fixtures, AcceptanceFixture{
			Input: AcceptanceInput{
				ID:            row.id,
				EnglishName:   row.en,
				PolishName:    row.pl,
				PhysicalState: row.state,
				Serving:       row.serving,
				ImageKey:      row.imageKey,
				Protein:       row.protein,
				Carbohydrate:  row.carbohydrate,
				Fat:           row.fat,
				Designation:   d.designation,
				Quantity:      d.quantity,
				Unit:          d.unit,
			},
			EligibleCount: len(eligible),
			OrderedIDs:    eligible,
			Results:       results,
			Pages:         pages,
		})
	}
	return fixtures
}

// liveFoodObject is one seeded Food Object row read back from PostgreSQL for
// cross-checking the manifest against a fresh setup.
type liveFoodObject struct {
	id           int
	en           string
	pl           string
	state        string
	protein      float64
	carbohydrate float64
	fat          float64
	serving      *float64
	familyID     *int
	imageKey     *string
}

// readLiveCatalog loads the complete seeded Food Object catalog from conn.
func readLiveCatalog(t *testing.T, conn *pgx.Conn) map[int]liveFoodObject {
	t.Helper()
	rows, err := conn.Query(context.Background(), `SELECT id, names ->> 'en', names ->> 'pl', physical_state,
		protein, carbohydrate, fat, serving, food_family_id, image_key
		FROM food_objects`)
	if err != nil {
		t.Fatalf("read seeded catalog: %v", err)
	}
	defer rows.Close()
	live := make(map[int]liveFoodObject)
	for rows.Next() {
		var row liveFoodObject
		if err := rows.Scan(&row.id, &row.en, &row.pl, &row.state, &row.protein, &row.carbohydrate,
			&row.fat, &row.serving, &row.familyID, &row.imageKey); err != nil {
			t.Fatalf("scan seeded row: %v", err)
		}
		live[row.id] = row
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate seeded catalog: %v", err)
	}
	return live
}

// dbEligibleIDs returns the IDs eligible as Substitutes for the Food Object
// with the given ID, computed from the seeded catalog using only the input
// and Food Family exclusion (REQ-033): every Food Object except the input
// itself and, when the input has a Food Family, the other members of that
// Family. No other filtering is applied (ARCH-018).
func dbEligibleIDs(t *testing.T, conn *pgx.Conn, inputID int) []int {
	t.Helper()
	rows, err := conn.Query(context.Background(), `WITH input_family AS (
			SELECT food_family_id FROM food_objects WHERE id = $1
		)
		SELECT fo.id FROM food_objects fo, input_family f
		WHERE fo.id <> $1
		  AND (f.food_family_id IS NULL OR fo.food_family_id IS DISTINCT FROM f.food_family_id)
		ORDER BY fo.id`, inputID)
	if err != nil {
		t.Fatalf("compute eligible IDs for input %d: %v", inputID, err)
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan eligible ID for input %d: %v", inputID, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate eligible IDs for input %d: %v", inputID, err)
	}
	return ids
}

func sortedInts(v []int) []int {
	out := append([]int(nil), v...)
	sort.Ints(out)
	return out
}

// TestAcceptanceCatalogCoverage verifies task 7 (P02-G2, P02-G4): the
// reusable integration-fixture manifest resolves against a fresh setup. Every
// designated input and expected-result ID resolves exactly once; the eligible
// Substitutes counts are 36, 37, and 37 using only the input and Food Family
// exclusion (REQ-033, REQ-071); the full and partial page cardinalities hold
// (ARCH-018 pages of three); Pizza Capricciosa is excluded only for the Pizza
// input; and no expected derived value is stored in a production table
// (ARCH-013).
func TestAcceptanceCatalogCoverage(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	fixtures := AcceptanceFixtures()
	// ISSUE-002 eligible-candidate counts for the designated inputs.
	wantEligible := map[int]int{1: 36, 5: 37, 10: 37}
	if len(fixtures) != len(wantEligible) {
		t.Fatalf("AcceptanceFixtures returned %d fixtures, want %d designated inputs", len(fixtures), len(wantEligible))
	}

	// P02-G2: the deterministic seeded catalog is the derivation source, so
	// the manifest expectations reproduce exactly from a fresh setup. Read
	// the complete catalog back once and cross-check every fixture against
	// these live rows.
	live := readLiveCatalog(t, conn)

	for _, fx := range fixtures {
		in := fx.Input

		// Every designated input resolves exactly once: the fixed ID and both
		// localized names each match exactly one seeded row, and the English
		// and Polish names resolve to the same designated ID (REQ-005,
		// REQ-006).
		var idByEN, idByPL int
		if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'en' = $1`, in.EnglishName).Scan(&idByEN); err != nil {
			t.Fatalf("resolve English name %q for input %d: %v", in.EnglishName, in.ID, err)
		}
		if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'pl' = $1`, in.PolishName).Scan(&idByPL); err != nil {
			t.Fatalf("resolve Polish name %q for input %d: %v", in.PolishName, in.ID, err)
		}
		if idByEN != in.ID || idByPL != in.ID || idByEN != idByPL {
			t.Fatalf("designated input %d resolves by English to %d and by Polish to %d, want %d for both", in.ID, idByEN, idByPL, in.ID)
		}
		for _, name := range []string{in.EnglishName, in.PolishName} {
			var n int
			if err := conn.QueryRow(ctx, `SELECT count(*) FROM food_objects WHERE names ->> 'en' = $1 OR names ->> 'pl' = $1`, name).Scan(&n); err != nil {
				t.Fatalf("count rows for name %q: %v", name, err)
			}
			if n != 1 {
				t.Fatalf("name %q matches %d rows, want exactly 1", name, n)
			}
		}
		if n := countRows(t, conn, fmt.Sprintf("SELECT count(*) FROM food_objects WHERE id = %d", in.ID)); n != 1 {
			t.Fatalf("designated input ID %d resolves to %d rows, want exactly 1", in.ID, n)
		}
		// The fixture input mirrors the seeded row (names, state, Serving,
		// image key, Macro Profile).
		row := live[in.ID]
		if row.en != in.EnglishName || row.pl != in.PolishName || row.state != in.PhysicalState ||
			!equalFloatPtr(row.serving, in.Serving) || !equalStrPtr(row.imageKey, in.ImageKey) ||
			row.protein != in.Protein || row.carbohydrate != in.Carbohydrate || row.fat != in.Fat {
			t.Fatalf("fixture input %d does not mirror the seeded row (got %+v, want %+v)", in.ID, row, in)
		}

		// Every expected-result ID resolves exactly once, and the fixture
		// holds one ExpectedResult per eligible ID.
		seen := make(map[int]bool, fx.EligibleCount)
		for _, id := range fx.OrderedIDs {
			if seen[id] {
				t.Fatalf("fixture for input %d lists result ID %d more than once", in.ID, id)
			}
			seen[id] = true
			if n := countRows(t, conn, fmt.Sprintf("SELECT count(*) FROM food_objects WHERE id = %d", id)); n != 1 {
				t.Fatalf("expected-result ID %d for input %d resolves to %d rows, want exactly 1", id, in.ID, n)
			}
			if _, ok := fx.Results[id]; !ok {
				t.Fatalf("fixture for input %d has no ExpectedResult for ID %d", in.ID, id)
			}
		}
		if len(seen) != fx.EligibleCount {
			t.Fatalf("fixture for input %d lists %d unique expected-result IDs, want %d", in.ID, len(seen), fx.EligibleCount)
		}

		// Eligible counts: 36, 37, and 37, computed from the seeded catalog
		// using only the input and Food Family exclusion (REQ-033, REQ-071).
		dbEligible := dbEligibleIDs(t, conn, in.ID)
		if len(dbEligible) != fx.EligibleCount {
			t.Fatalf("input %d has %d eligible Substitutes, want %d", in.ID, len(dbEligible), fx.EligibleCount)
		}
		if fx.EligibleCount != wantEligible[in.ID] {
			t.Fatalf("fixture eligible count for input %d is %d, want %d (ISSUE-002)", in.ID, fx.EligibleCount, wantEligible[in.ID])
		}
		// The fixture's expected-result ID set is exactly the eligible set:
		// no other filtering is applied.
		if !slices.Equal(sortedInts(dbEligible), sortedInts(fx.OrderedIDs)) {
			t.Fatalf("input %d fixture expected-result IDs do not match the eligible set (db %v, fixture %v)",
				in.ID, sortedInts(dbEligible), sortedInts(fx.OrderedIDs))
		}

		// Page cardinalities (ARCH-018): pages of three; only the last page
		// may be partial; the pages concatenate to the ordered result IDs
		// (the Pizza page order).
		n := fx.EligibleCount
		wantPages := (n + PageSize - 1) / PageSize
		if len(fx.Pages) != wantPages {
			t.Fatalf("input %d has %d pages, want %d for %d eligible Substitutes", in.ID, len(fx.Pages), wantPages, n)
		}
		lastSize := n % PageSize
		var flat []int
		for i, page := range fx.Pages {
			if len(page) > PageSize {
				t.Fatalf("input %d page %d has %d items, want at most %d", in.ID, i, len(page), PageSize)
			}
			if i < len(fx.Pages)-1 && len(page) != PageSize {
				t.Fatalf("input %d non-last page %d has %d items, want %d (full page)", in.ID, i, len(page), PageSize)
			}
			if i == len(fx.Pages)-1 {
				wantLast := lastSize
				if wantLast == 0 {
					wantLast = PageSize
				}
				if len(page) != wantLast {
					t.Fatalf("input %d last page has %d items, want %d", in.ID, len(page), wantLast)
				}
			}
			flat = append(flat, page...)
		}
		if !slices.Equal(flat, fx.OrderedIDs) {
			t.Fatalf("input %d pages do not concatenate to the ordered result IDs", in.ID)
		}
		// Full and partial last pages: 36 eligible Substitutes give 12 full
		// pages and no partial page; 37 give 12 full pages plus a partial
		// last page of one.
		if in.ID == 1 {
			if n%PageSize != 0 || len(fx.Pages) != n/PageSize {
				t.Fatalf("Pizza fixture has %d eligible Substitutes, want a multiple of %d (full pages only)", n, PageSize)
			}
			for i, page := range fx.Pages {
				if len(page) != PageSize {
					t.Fatalf("Pizza page %d has %d items, want %d (full page)", i, len(page), PageSize)
				}
			}
		} else {
			if n%PageSize != 1 || len(fx.Pages) != n/PageSize+1 {
				t.Fatalf("input %d has %d eligible Substitutes, want 12 full pages plus a partial last page of one", in.ID, n)
			}
			for i := 0; i < n/PageSize; i++ {
				if len(fx.Pages[i]) != PageSize {
					t.Fatalf("input %d full page %d has %d items, want %d", in.ID, i, len(fx.Pages[i]), PageSize)
				}
			}
			if len(fx.Pages[len(fx.Pages)-1]) != 1 {
				t.Fatalf("input %d partial last page has %d items, want 1", in.ID, len(fx.Pages[len(fx.Pages)-1]))
			}
		}

		// The manifest order is strictly decreasing full-precision
		// Nutritional Similarity (ARCH-018); the approved distinct Macro
		// Profiles never produce artificial ties.
		for i := 1; i < len(fx.OrderedIDs); i++ {
			prev, cur := fx.Results[fx.OrderedIDs[i-1]], fx.Results[fx.OrderedIDs[i]]
			if prev.Similarity <= cur.Similarity {
				t.Fatalf("input %d order is not strictly decreasing at rank %d (%.17g then %.17g)", in.ID, i, prev.Similarity, cur.Similarity)
			}
		}

		// P02-G2: every derived expectation (full-precision similarity and
		// unrounded Matched Quantity) reproduces from the live seeded rows
		// within the numeric tolerances, and the fixture identity data
		// mirrors the seeded rows.
		inputCalories := macroCalories(in.Protein, in.Carbohydrate, in.Fat)
		for _, id := range fx.OrderedIDs {
			want := fx.Results[id]
			liveRow := live[id]
			gotSim := nutritionalSimilarity(in.Protein, in.Carbohydrate, in.Fat, liveRow.protein, liveRow.carbohydrate, liveRow.fat)
			if math.Abs(gotSim-want.Similarity) > SimilarityTolerance {
				t.Fatalf("input %d result %d similarity is %.17g, fixture expects %.17g (tolerance %g)", in.ID, id, gotSim, want.Similarity, SimilarityTolerance)
			}
			gotMQ := matchedQuantity(inputCalories, in.Quantity, macroCalories(liveRow.protein, liveRow.carbohydrate, liveRow.fat))
			if math.Abs(gotMQ-want.MatchedQuantity) > MatchedQuantityTolerance {
				t.Fatalf("input %d result %d Matched Quantity is %.17g %s, fixture expects %.17g (tolerance %g)", in.ID, id, gotMQ, wantUnit(want.PhysicalState), want.MatchedQuantity, MatchedQuantityTolerance)
			}
			if want.EnglishName != liveRow.en || want.PolishName != liveRow.pl || want.PhysicalState != liveRow.state ||
				!equalFloatPtr(want.Serving, liveRow.serving) || !equalStrPtr(want.ImageKey, liveRow.imageKey) {
				t.Fatalf("input %d result %d identity data does not mirror the seeded row", in.ID, id)
			}
		}

		// Gram and millilitre results: eligibility ignores Physical State, so
		// every fixture covers solid results (g) and liquid results (ml).
		hasSolid, hasLiquid := false, false
		for _, r := range fx.Results {
			hasSolid = hasSolid || r.PhysicalState == "solid"
			hasLiquid = hasLiquid || r.PhysicalState == "liquid"
		}
		if !hasSolid || !hasLiquid {
			t.Fatalf("input %d fixture must cover gram (solid) and millilitre (liquid) Matched Quantities, got solid=%t liquid=%t", in.ID, hasSolid, hasLiquid)
		}

		// Serving and no-Serving defaults: Pizza Margherita is designated at
		// one Serving (its 350 g base quantity); Chicken breast and Milk have
		// no Serving and are designated at the 100 g / 100 ml Nutrition Basis
		// defaults. The Unit always follows the glossary Nutrition Basis.
		if in.ID == 1 {
			if in.Serving == nil || *in.Serving != 350 || in.Quantity != 350 || in.Unit != "g" {
				t.Fatalf("Pizza input must designate one Serving (350 g), got serving=%v quantity=%v unit=%q", in.Serving, in.Quantity, in.Unit)
			}
		} else {
			if in.Serving != nil || in.Quantity != 100 {
				t.Fatalf("input %d must use the no-Serving default 100 %s, got serving=%v quantity=%v", in.ID, in.Unit, in.Serving, in.Quantity)
			}
		}
		if (in.PhysicalState == "solid") != (in.Unit == "g") || (in.PhysicalState == "liquid") != (in.Unit == "ml") {
			t.Fatalf("input %d unit %q does not follow the %s Nutrition Basis", in.ID, in.Unit, in.PhysicalState)
		}

		// Absent images: the designated inputs carry the known image keys
		// (ISSUE-002), and absent images (NULL, the single placeholder state
		// of REQ-011/ARCH-015) are covered by the expected results: every
		// eligible NULL-image seeded row appears with a nil ImageKey.
		if in.ID == 1 && (in.ImageKey == nil || *in.ImageKey != "pizza-margherita") {
			t.Fatalf("Pizza input image key is %v, want %q", in.ImageKey, "pizza-margherita")
		}
		if in.ID == 5 && (in.ImageKey == nil || *in.ImageKey != "chicken-breast") {
			t.Fatalf("Chicken breast input image key is %v, want %q", in.ImageKey, "chicken-breast")
		}
		if in.ID == 10 && (in.ImageKey == nil || *in.ImageKey != "milk") {
			t.Fatalf("Milk input image key is %v, want %q", in.ImageKey, "milk")
		}
		hasAbsent := false
		for _, id := range fx.OrderedIDs {
			r := fx.Results[id]
			if (r.ImageKey == nil) != (live[id].imageKey == nil) {
				t.Fatalf("input %d result %d image state does not mirror the seeded row", in.ID, id)
			}
			hasAbsent = hasAbsent || r.ImageKey == nil
		}
		if !hasAbsent {
			t.Fatalf("input %d fixture covers no absent-image (NULL) expected result", in.ID)
		}
	}

	// Pizza Capricciosa (ID 2) is excluded only for the Pizza input: it is
	// the sole other member of Food Family 1 (REQ-033). It must be absent
	// from the Pizza fixture and present for every other designated input.
	byInputID := make(map[int]AcceptanceFixture, len(fixtures))
	for _, fx := range fixtures {
		byInputID[fx.Input.ID] = fx
	}
	if slices.Contains(byInputID[1].OrderedIDs, 2) {
		t.Fatal("Pizza Capricciosa must be excluded from Pizza Margherita results (Food Family exclusion, REQ-033)")
	}
	if !slices.Contains(byInputID[5].OrderedIDs, 2) {
		t.Fatal("Pizza Capricciosa must be eligible for the Chicken breast input")
	}
	if !slices.Contains(byInputID[10].OrderedIDs, 2) {
		t.Fatal("Pizza Capricciosa must be eligible for the Milk input")
	}
	// Pizza Margherita (ID 1) is excluded only for its own input: it must be
	// eligible for every other designated input.
	if !slices.Contains(byInputID[5].OrderedIDs, 1) || !slices.Contains(byInputID[10].OrderedIDs, 1) {
		t.Fatal("Pizza Margherita must be eligible for the Chicken breast and Milk inputs")
	}

	// P02-G4: no expected derived value is stored in a production table
	// (ARCH-013). food_objects carries exactly the source fields — no derived
	// calories, Nutritional Similarity, Matched Quantity, page, or rounded
	// display values — and the public schema holds no derived-value tables or
	// columns.
	wantColumns := []string{"id", "names", "physical_state", "protein", "carbohydrate", "fat", "serving", "food_family_id", "image_key"}
	rows, err := conn.Query(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'food_objects'
		ORDER BY ordinal_position`)
	if err != nil {
		t.Fatalf("list food_objects columns: %v", err)
	}
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan food_objects column: %v", err)
		}
		columns = append(columns, column)
	}
	rows.Close()
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
	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatalf("scan public table: %v", err)
		}
		tables = append(tables, table)
	}
	rows.Close()
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
	// No public column name suggests a derived value: the manifest's expected
	// similarities, Matched Quantities, page orders, calories, and rounded
	// display values exist only as implementation-test data.
	derivedColumn := regexp.MustCompile(`(?i)calor|similar|matched|page|round|display`)
	rows, err = conn.Query(ctx, `SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = 'public' ORDER BY table_name, column_name`)
	if err != nil {
		t.Fatalf("list public columns: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			t.Fatalf("scan public column: %v", err)
		}
		if derivedColumn.MatchString(column) {
			t.Fatalf("production column %s.%s suggests a derived value; derived expectations must stay in implementation-test data", table, column)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate public columns: %v", err)
	}
}

// wantUnit returns the Matched Quantity base unit for a Physical State.
func wantUnit(state string) string {
	if state == "liquid" {
		return "ml"
	}
	return "g"
}
