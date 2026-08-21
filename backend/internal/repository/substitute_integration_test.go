package repository

// Integration test for Phase 4 (task 16): the concrete Find Substitute Page
// Run operation over the private Catalog Loader (ARCH-005, ARCH-006,
// ARCH-013, ARCH-018, ARCH-022). It requires a real PostgreSQL server: the
// test creates its isolated disposable database plus the schema-owner,
// SELECT-only runtime, and unprivileged login roles through the shared
// testdb support, runs the real setup command against it, grants the runtime
// catalog read through the same embedded privilege SQL the local deployment
// setup applies, and drives the real Find Substitute Page Module through the
// SELECT-only runtime credential. A query tracer on the runtime connection
// proves that every Run performs exactly one fresh embedded SELECT and no
// mutating statement.
//
// The test verifies the designated seeded calories, Matched Quantities,
// eligible counts, page-0 IDs, hasMore, input and Food Family exclusions,
// decreasing full-precision order, English-name and stable-ID ties, the raw
// stored-name collation tie rule (case and whitespace remain significant),
// three unique results, one fresh SELECT, no mutation or derived-value
// persistence, the Serving conversion branch, the final display projection
// of the three scaled macro fields and the whole Matched Quantity and
// similarity percentage (task 17), and the finite-boundary classification
// of schema-valid extreme Macro Profiles. In the same test, Macro Profiles
// loaded by the real private Catalog Loader are passed directly to the
// private production calorie, cosine, and Matched Quantity helpers and
// compared with independently recorded full-precision expectations using
// abs(got - want) <= 1e-12 (ISSUE-005: the absolute 1e-12 tolerance is a
// test comparison only, never a production tie or ranking threshold). No
// exported seam, fake, or test hook is added: the helpers stay private and
// the test sits in the same package. The admin connection comes from
// OBIAD_TEST_ADMIN_DATABASE_URL or from libpq-style environment variables;
// no credential is committed and tests skip when no server is reachable.

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/testdb"
)

// nearEqual is ISSUE-005's absolute comparison tolerance for full-precision
// calculation expectations: abs(got - want) <= 1e-12. It is used only by
// tests; production ranking and calculations never apply a tolerance.
const nearEqual = 1e-12

// wantCalories records the independently derived seeded calories per
// Nutrition Basis (4p + 4c + 9f, REQ-029) for every ISSUE-002 Food Object,
// as full-precision float64 expectations.
var wantCalories = map[int32]float64{
	1:  250.0,
	2:  255.0,
	3:  180.0,
	4:  197.0,
	5:  156.4,
	6:  234.0,
	7:  239.0,
	8:  56.5,
	9:  45.3,
	10: 50.8,
	11: 61.8,
	12: 97.0,
	13: 200.0,
	14: 45.5,
	15: 240.0,
	16: 238.0,
	17: 21.0,
	18: 742.0,
	19: 821.6999999999999,
	20: 57.0,
	21: 265.0,
	22: 300.0,
	23: 134.0,
	24: 11.8,
	25: 21.0,
	26: 199.0,
	27: 156.0,
	28: 71.5,
	29: 157.0,
	30: 57.5,
	31: 36.5,
	32: 116.0,
	33: 96.0,
	34: 263.0,
	35: 286.0,
	36: 290.0,
	37: 44.599999999999994,
	38: 174.0,
}

// wantCandidate is one independently recorded full-precision expectation for
// one eligible Substitute of a designated input: its seeded calories per
// Nutrition Basis, its cosine Nutritional Similarity to the input, its
// equal-calorie Matched Quantity in the candidate base unit, the three
// unrounded macronutrients scaled to that Matched Quantity, and the
// candidate base unit of that Matched Quantity (g for a solid, ml for a
// liquid, ARCH-013).
type wantCandidate struct {
	id              int32
	calories        float64
	cosine          float64
	matchedQuantity float64
	protein         float64
	carbohydrate    float64
	fat             float64
	unit            Unit
}

// wantSubstitutePage is one independently recorded page-0 expectation for a
// designated acceptance input (ISSUE-002): the input's Food Quantity, its
// converted base-unit quantity, its total derived calories, the exact page-0
// ID order, and the full-precision expectations of the first three eligible
// candidates in that order. The designated eligible-candidate counts are 36
// for Pizza Margherita and 37 for Chicken breast and Milk (ISSUE-002).
type wantSubstitutePage struct {
	inputID       int32
	quantity      FoodQuantity
	baseQuantity  float64
	totalCalories float64
	pageIDs       []int32
	candidates    []wantCandidate
}

// wantSubstitutePages records the independently computed page-0 expectations
// for the three ISSUE-002 designated acceptance inputs.
var wantSubstitutePages = []wantSubstitutePage{
	{
		inputID:       1, // Pizza Margherita, one Serving = 350 g
		quantity:      FoodQuantity{Value: 1, Unit: UnitServing},
		baseQuantity:  350,
		totalCalories: 875.0,
		pageIDs:       []int32{13, 29, 26},
		candidates: []wantCandidate{
			{id: 13, calories: 200.0, cosine: 0.9999999999999999, matchedQuantity: 437.5, protein: 35.0, carbohydrate: 105.0, fat: 35.0, unit: UnitGram},
			{id: 29, calories: 157.0, cosine: 0.9953414448979734, matchedQuantity: 557.3248407643312, protein: 44.58598726114649, carbohydrate: 111.46496815286623, fat: 27.86624203821656, unit: UnitGram},
			{id: 26, calories: 199.0, cosine: 0.992122967180221, matchedQuantity: 439.69849246231155, protein: 26.38190954773869, carbohydrate: 123.11557788944724, fat: 30.77889447236181, unit: UnitGram},
		},
	},
	{
		inputID:       5, // Chicken breast, 100 g Nutrition Basis
		quantity:      FoodQuantity{Value: 100, Unit: UnitGram},
		baseQuantity:  100,
		totalCalories: 156.4,
		pageIDs:       []int32{23, 11, 6},
		candidates: []wantCandidate{
			{id: 23, calories: 134.0, cosine: 0.998907198578582, matchedQuantity: 116.71641791044776, protein: 33.84776119402985, carbohydrate: 0.0, fat: 2.334328358208955, unit: UnitGram},
			{id: 11, calories: 61.8, cosine: 0.9353543324988515, matchedQuantity: 253.07443365695795, protein: 27.838187702265373, carbohydrate: 10.122977346278319, fat: 0.506148867313916, unit: UnitGram},
			{id: 6, calories: 234.0, cosine: 0.9349276360101546, matchedQuantity: 66.83760683760684, protein: 18.046153846153846, carbohydrate: 0.0, fat: 9.357264957264958, unit: UnitGram},
		},
	},
	{
		inputID:       10, // Milk, 100 ml Nutrition Basis
		quantity:      FoodQuantity{Value: 100, Unit: UnitMillilitre},
		baseQuantity:  100,
		totalCalories: 50.8,
		pageIDs:       []int32{33, 3, 21},
		candidates: []wantCandidate{
			{id: 33, calories: 96.0, cosine: 0.9948293845065213, matchedQuantity: 52.916666666666664, protein: 3.704166666666666, carbohydrate: 4.233333333333333, fat: 2.1166666666666667, unit: UnitMillilitre},
			{id: 3, calories: 180.0, cosine: 0.9884883774184667, matchedQuantity: 28.22222222222222, protein: 2.54, carbohydrate: 5.08, fat: 2.2577777777777777, unit: UnitGram},
			{id: 21, calories: 265.0, cosine: 0.9870586973699207, matchedQuantity: 19.169811320754718, protein: 2.4920754716981133, carbohydrate: 4.6007547169811325, fat: 2.4920754716981133, unit: UnitGram},
		},
	},
}

// setupSubstituteFixture creates the disposable database, runs the real
// setup command against it, grants the runtime role catalog SELECT exactly
// as the local deployment setup does, connects the SELECT-only runtime
// credential with a statement tracer, and builds a Find Substitute Page
// Module over that connection. It returns the Module, the tracer, the
// embedded SELECT text, and the schema-owner connection (for owner-made
// fixture changes, ARCH-016).
func setupSubstituteFixture(t *testing.T) (db *testdb.DB, module *FindSubstitutePage, tracer *stmtTracer, wantSQL string, owner *pgx.Conn) {
	t.Helper()
	db = testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner = connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	tracer = &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	var err error
	module, err = NewFindSubstitutePage(runtimeConn)
	if err != nil {
		t.Fatalf("NewFindSubstitutePage: %v", err)
	}
	wantSQL, err = loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}
	return db, module, tracer, wantSQL, owner
}

// pageIDs returns the ordered Food Object IDs of the page items.
func pageIDs(page *Page) []int32 {
	ids := make([]int32, len(page.Items))
	for i, item := range page.Items {
		ids[i] = item.FoodObjectID
	}
	return ids
}

// assertPageIDs checks the exact ordered page-0 ID sequence.
func assertPageIDs(t *testing.T, page *Page, want ...int32) {
	t.Helper()
	if len(page.Items) != len(want) {
		t.Fatalf("page 0 has %d items with IDs %v, want %d IDs %v", len(page.Items), pageIDs(page), len(want), want)
	}
	for i, id := range want {
		if page.Items[i].FoodObjectID != id {
			t.Fatalf("page 0 item %d has ID %d, want %d (full order %v)", i, page.Items[i].FoodObjectID, id, pageIDs(page))
		}
	}
}

// assertUniqueThree checks that the page carries exactly three items with
// distinct stable Food Object IDs (ARCH-005, REQ-042).
func assertUniqueThree(t *testing.T, page *Page) {
	t.Helper()
	if len(page.Items) != pageSize {
		t.Fatalf("page 0 has %d items, want exactly %d", len(page.Items), pageSize)
	}
	seen := make(map[int32]bool, len(page.Items))
	for _, item := range page.Items {
		if seen[item.FoodObjectID] {
			t.Fatalf("page 0 item ID %d is not unique", item.FoodObjectID)
		}
		seen[item.FoodObjectID] = true
	}
}

// assertNearEqual checks one full-precision expectation with ISSUE-005's
// absolute 1e-12 tolerance, abs(got - want) <= 1e-12.
func assertNearEqual(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > nearEqual {
		t.Fatalf("%s = %.17g, want %.17g (abs difference %.3g exceeds 1e-12)", name, got, want, math.Abs(got-want))
	}
}

// assertProjectedItem checks that one page item carries the final display
// projection of the independently recorded full-precision candidate
// expectation (task 17, REQ-039): the whole Matched Quantity in the
// candidate base unit, the protein, carbohydrate, and fat scaled to the
// unrounded Matched Quantity and rounded to 0.1 g, and the whole similarity
// percentage. The full-precision expectation is projected through the
// private production helpers, which are themselves pinned to exact boundary
// literals by TestSubstituteProjectionIntegration.
func assertProjectedItem(t *testing.T, item SubstituteItem, want wantCandidate) {
	t.Helper()
	wantMQ := int64(math.Round(want.matchedQuantity))
	if item.MatchedQuantity.Value != wantMQ || item.MatchedQuantity.Unit != want.unit {
		t.Fatalf("item %d: Matched Quantity is %+v, want value %d in unit %q (full precision %.17g)",
			item.FoodObjectID, item.MatchedQuantity, wantMQ, want.unit, want.matchedQuantity)
	}
	assertMacro := func(name string, got, full float64) {
		t.Helper()
		if want := projectMacronutrient(full); got != want {
			t.Fatalf("item %d: %s is %.17g, want the projected %.17g of the full-precision %.17g",
				item.FoodObjectID, name, got, want, full)
		}
	}
	assertMacro("protein", item.Protein, want.protein)
	assertMacro("carbohydrate", item.Carbohydrate, want.carbohydrate)
	assertMacro("fat", item.Fat, want.fat)
	if wantPercent := projectSimilarityPercent(want.cosine); item.SimilarityPercent != wantPercent {
		t.Fatalf("item %d: similarity percent is %d, want the projected %d of the full-precision %.17g",
			item.FoodObjectID, item.SimilarityPercent, wantPercent, want.cosine)
	}
}

// assertInputMacronutrients checks the ISSUE-010 input macronutrients of one
// page: the protein, carbohydrate, and fat of the Substitution Input scaled
// to its committed base quantity (per-Nutrition-Basis values times
// baseQuantity / 100) and projected to 0.1 g by the same half-up display
// rule as the result cards.
func assertInputMacronutrients(t *testing.T, page *Page, protein, carbohydrate, fat float64) {
	t.Helper()
	got := page.InputMacronutrients
	if got.Protein != protein || got.Carbohydrate != carbohydrate || got.Fat != fat {
		t.Fatalf("input macronutrients (%v, %v, %v), want (%v, %v, %v)", got.Protein, got.Carbohydrate, got.Fat, protein, carbohydrate, fat)
	}
}

// assertBitIdenticalTie verifies, through the private production cosine
// helper, that two tie candidates have bit-identical full-precision
// similarity to the tie input (REQ-035). The item projection no longer
// exposes the unrounded similarity, so the test re-derives it from a fresh
// request-local catalog snapshot that includes the isolated tie fixtures
// inserted by the caller.
func assertBitIdenticalTie(t *testing.T, module *FindSubstitutePage, ctx context.Context, inputID, aID, bID int32) {
	t.Helper()
	profiles := loadProfiles(t, module, ctx)
	inputProfile, ok := profiles[inputID]
	if !ok {
		t.Fatalf("loaded catalog has no tie input %d", inputID)
	}
	simA := cosineSimilarity(inputProfile, profiles[aID])
	simB := cosineSimilarity(inputProfile, profiles[bID])
	if simA != simB {
		t.Fatalf("identical-profile candidates %d and %d must have bit-identical similarity: %.17g vs %.17g", aID, bID, simA, simB)
	}
}

// loadProfiles performs one fresh catalog read through the real private
// Catalog Loader on the runtime connection and returns every Food Object's
// Macro Profile keyed by stable ID.
func loadProfiles(t *testing.T, module *FindSubstitutePage, ctx context.Context) map[int32]macroProfile {
	t.Helper()
	objects, err := module.loader.load(ctx)
	if err != nil {
		t.Fatalf("load catalog through the private Loader: %v", err)
	}
	profiles := make(map[int32]macroProfile, len(objects))
	for _, object := range objects {
		profiles[object.id] = macroProfile{protein: object.protein, carbohydrate: object.carbohydrate, fat: object.fat}
	}
	return profiles
}

// TestFindSubstitutePageIntegration exercises the concrete Find Substitute
// Page Run operation and the fresh Catalog Loader against real PostgreSQL
// through the SELECT-only runtime credential (P04-G3): the three designated
// seeded inputs (Pizza Margherita at one Serving, Chicken breast at 100 g,
// Milk at 100 ml) return their exact eligible counts, hasMore, page-0 IDs,
// and three unique items; the input and its Food Family are excluded;
// ordering follows decreasing full-precision similarity; identical-similarity
// ties follow the pinned English collation and stable ID; every Run executes
// exactly one fresh embedded SELECT and no mutating statement; and no
// derived value is persisted. Macro Profiles loaded by the real private
// Catalog Loader are passed directly to the private production calorie,
// cosine, and Matched Quantity helpers and compared with independently
// recorded full-precision expectations within the absolute 1e-12 tolerance.
// The ISSUE-010 input macronutrients of the committed Substitution Input
// quantity are asserted for 1 serving, 100 g, 100 ml, and changed accepted
// quantities — including an exact-half 0.75 g case that projects half-up to
// 0.8 g — with the ranked result IDs and order unchanged (task 33,
// REQ-028).
func TestFindSubstitutePageIntegration(t *testing.T) {
	_, module, tracer, wantSQL, owner := setupSubstituteFixture(t)
	ctx := context.Background()

	run := func(input SubstituteInput) *Page {
		t.Helper()
		tracer.reset()
		page, err := module.Run(ctx, input, 0)
		if err != nil {
			t.Fatalf("Run(input %d, %v): %v", input.FoodObjectID, input.Quantity, err)
		}
		tracer.assertSingleSelect(t, wantSQL)
		return page
	}

	// Designated seeded inputs: exact eligible counts (ISSUE-002: 36 for
	// Pizza Margherita, 37 for Chicken breast and Milk), hasMore true, the
	// recorded page-0 ID order, three unique items, and decreasing
	// full-precision similarity across the returned items. One request-local
	// catalog snapshot is loaded through the real private Catalog Loader up
	// front so the ordering and projection assertions below can re-derive
	// the full-precision values with the private production helpers.
	profiles := loadProfiles(t, module, ctx)
	wantCounts := map[int32]int{1: 36, 5: 37, 10: 37}
	for _, want := range wantSubstitutePages {
		page := run(SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity})
		if page.PageIndex != 0 {
			t.Fatalf("input %d: page index %d, want 0", want.inputID, page.PageIndex)
		}
		if page.TotalEligibleCount != wantCounts[want.inputID] {
			t.Fatalf("input %d: total eligible count %d, want %d after input and Food Family exclusion",
				want.inputID, page.TotalEligibleCount, wantCounts[want.inputID])
		}
		if !page.HasMore {
			t.Fatalf("input %d: hasMore false, want true (more than %d eligible Substitutes)", want.inputID, pageSize)
		}
		assertPageIDs(t, page, want.pageIDs...)
		assertUniqueThree(t, page)
		// The item projection no longer exposes the unrounded similarity, so
		// the strictly decreasing page-0 order is verified on the
		// full-precision values re-derived through the private production
		// helper (REQ-034): an implementation that rounded similarity for
		// ranking would break this check.
		inputProfile := profiles[want.inputID]
		for i := 1; i < len(page.Items); i++ {
			prev := cosineSimilarity(inputProfile, profiles[page.Items[i-1].FoodObjectID])
			curr := cosineSimilarity(inputProfile, profiles[page.Items[i].FoodObjectID])
			if prev <= curr {
				t.Fatalf("input %d: page-0 full-precision similarity is not strictly decreasing: %.17g then %.17g", want.inputID, prev, curr)
			}
		}
	}

	// Input and Food Family exclusion (REQ-032, REQ-033): Pizza Margherita
	// (ID 1) excludes itself and its Food Family member Pizza Capricciosa
	// (ID 2); Chicken breast (ID 5) and Milk (ID 10) exclude only
	// themselves. The page-0 items never contain an excluded ID, and the
	// eligible counts (36, 37, 37) prove both the input and the Food Family
	// row are gone for Pizza Margherita while no member of the Pizza family
	// is excluded for the other two inputs.
	excludedByInput := map[int32][]int32{1: {1, 2}, 5: {5}, 10: {10}}
	for _, want := range wantSubstitutePages {
		page := run(SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity})
		for _, id := range excludedByInput[want.inputID] {
			for _, item := range page.Items {
				if item.FoodObjectID == id {
					t.Fatalf("input %d: excluded Food Object %d appears on page 0", want.inputID, id)
				}
			}
		}
	}

	// Full-precision helpers (REQ-029, REQ-030, REQ-031, REQ-040): Macro
	// Profiles loaded by the real private Catalog Loader are passed directly
	// to the private production calorie, cosine, and Matched Quantity
	// helpers and compared with the independently recorded expectations
	// within ISSUE-005's absolute 1e-12 tolerance. The recorded top-three
	// cosines strictly decrease, so the recorded page-0 ID order is the
	// decreasing full-precision similarity order.
	for id, want := range wantCalories {
		profile, ok := profiles[id]
		if !ok {
			t.Fatalf("loaded catalog has no Food Object %d", id)
		}
		assertNearEqual(t, "calories(profile 1)", calories(profile), want)
	}
	for _, want := range wantSubstitutePages {
		inputProfile := profiles[want.inputID]
		inputCalories := calories(inputProfile) * want.baseQuantity / 100
		assertNearEqual(t, "input total calories", inputCalories, want.totalCalories)
		page := run(SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity})
		for i, candidate := range want.candidates {
			candidateProfile := profiles[candidate.id]
			gotCosine := cosineSimilarity(inputProfile, candidateProfile)
			gotCalories := calories(candidateProfile)
			gotMatched := matchedQuantity(inputCalories, gotCalories)
			assertNearEqual(t, "cosineSimilarity(input, candidate)", gotCosine, candidate.cosine)
			assertNearEqual(t, "calories(candidate)", gotCalories, candidate.calories)
			assertNearEqual(t, "matchedQuantity", gotMatched, candidate.matchedQuantity)
			// The page-0 items returned by Run carry the final display
			// projection of the recorded full-precision values (task 17,
			// REQ-039): the whole Matched Quantity in the candidate base
			// unit, the macronutrients rounded to 0.1 g, and the whole
			// similarity percentage. The full-precision values themselves
			// are asserted above through the private helpers, so the two
			// halves of the evidence pin the scaling and the projection.
			assertProjectedItem(t, page.Items[i], candidate)
			if i > 0 && want.candidates[i-1].cosine <= candidate.cosine {
				t.Fatalf("recorded top-3 cosines for input %d are not strictly decreasing", want.inputID)
			}
		}
	}

	// ISSUE-010 input macronutrients (task 33): every successful page
	// carries the Substitution Input macronutrients scaled to the committed
	// base quantity — per-Nutrition-Basis protein, carbohydrate, and fat
	// times baseQuantity / 100 — and projected to 0.1 g by the same half-up
	// display rule as the result cards (REQ-039). The three designated
	// quantities and changed accepted quantities of the same inputs produce
	// the expected projected values without changing the ranked result IDs
	// or order (REQ-028, ISSUE-010).
	for _, want := range wantSubstitutePages {
		page := run(SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity})
		profile := profiles[want.inputID]
		wantInput := Macronutrients{
			Protein:      projectMacronutrient(profile.protein * want.baseQuantity / 100),
			Carbohydrate: projectMacronutrient(profile.carbohydrate * want.baseQuantity / 100),
			Fat:          projectMacronutrient(profile.fat * want.baseQuantity / 100),
		}
		if page.InputMacronutrients != wantInput {
			t.Fatalf("input %d at %v: input macronutrients %+v, want the projected %+v of the committed base quantity %v",
				want.inputID, want.quantity, page.InputMacronutrients, wantInput, want.baseQuantity)
		}
	}

	// Designated quantities, exact projected values: Pizza Margherita at
	// 1 serving (350 g) = 35.0 / 105.0 / 35.0, Chicken breast at 100 g =
	// 31.0 / 0.0 / 3.6, and Milk at 100 ml = 3.4 / 4.8 / 2.0.
	oneServing := run(SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}})
	assertInputMacronutrients(t, oneServing, 35.0, 105.0, 35.0)
	hundredGrams := run(SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
	assertInputMacronutrients(t, hundredGrams, 31.0, 0.0, 3.6)
	hundredMillilitres := run(SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100, Unit: UnitMillilitre}})
	assertInputMacronutrients(t, hundredMillilitres, 3.4, 4.8, 2.0)

	// Changed accepted quantities of the same inputs: Pizza Margherita at
	// 100 g = 10.0 / 30.0 / 10.0 and at 2 servings (700 g) = 70.0 / 210.0 /
	// 70.0, Chicken breast at 200 g = 62.0 / 0.0 / 7.2, and Milk at 250 ml
	// = 8.5 / 12.0 / 5.0. The ranked result IDs and order stay exactly the
	// designated ones (REQ-028).
	changed := []struct {
		input   SubstituteInput
		protein float64
		carb    float64
		fat     float64
		wantIDs []int32
	}{
		{SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 10.0, 30.0, 10.0, []int32{13, 29, 26}},
		{SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 2, Unit: UnitServing}}, 70.0, 210.0, 70.0, []int32{13, 29, 26}},
		{SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 200, Unit: UnitGram}}, 62.0, 0.0, 7.2, []int32{23, 11, 6}},
		{SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 250, Unit: UnitMillilitre}}, 8.5, 12.0, 5.0, []int32{33, 3, 21}},
	}
	for _, tc := range changed {
		page := run(tc.input)
		assertInputMacronutrients(t, page, tc.protein, tc.carb, tc.fat)
		assertPageIDs(t, page, tc.wantIDs...)
	}

	// Exact-half projection evidence: Butter (ID 18) at 150 g scales protein
	// 0.5 × 1.5 = 0.75 and carbohydrate 0.5 × 1.5 = 0.75, whose 0.05 digit
	// is an exact half that rounds up to 0.8 by the half-up display rule,
	// and fat 82 × 1.5 = 123.0. The changed quantity leaves the ranked IDs
	// and order unchanged.
	butter := run(SubstituteInput{FoodObjectID: 18, Quantity: FoodQuantity{Value: 150, Unit: UnitGram}})
	assertInputMacronutrients(t, butter, 0.8, 0.8, 123.0)

	// No mutation or derived-value persistence: the fresh Loader reads the
	// unchanged seeded catalog (exactly 38 Food Objects), and the production
	// schema stays limited to the ARCH-013 source fields — no derived
	// calories, Nutritional Similarity, Matched Quantity, page, or rounded
	// display columns. The per-Run tracer already proves exactly one fresh
	// embedded SELECT and no mutating statement on the SELECT-only runtime
	// connection.
	if n := countFoodObjects(t, owner); n != 38 {
		t.Fatalf("catalog has %d Food Objects after the Runs, want the unchanged 38 seeded rows", n)
	}
	wantColumns := []string{"id", "names", "physical_state", "protein", "carbohydrate", "fat", "serving", "food_family_id", "image_key"}
	assertFoodObjectColumns(t, owner, wantColumns)

	// Tie order (REQ-035): the schema owner inserts isolated tie fixtures —
	// artificial equal-similarity rows kept outside the production seed
	// (ISSUE-002, ARCH-018 quality constraints).
	insertTieObject := func(id int32, en, pl string, protein, carbohydrate, fat float64) {
		t.Helper()
		if _, err := owner.Exec(ctx,
			`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, 'solid', $3, $4, $5)`,
			id, `{"en": "`+en+`", "pl": "`+pl+`"}`, protein, carbohydrate, fat,
		); err != nil {
			t.Fatalf("owner tie-fixture insert for ID %d: %v", id, err)
		}
	}

	// Stable-ID tie: two candidates with identical Macro Profiles and
	// identical localized names have bit-identical similarity, so the pinned
	// English collation cannot separate them and the stable Food Object ID
	// decides: 44 before 45.
	insertTieObject(43, "Tie input", "Wprowadzenie wiazania", 10, 20, 5)
	insertTieObject(44, "Tie duplicate", "Duplikat wiazania", 10, 20, 5)
	insertTieObject(45, "Tie duplicate", "Duplikat wiazania", 10, 20, 5)
	idTie := run(SubstituteInput{FoodObjectID: 43, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
	if idTie.TotalEligibleCount != 40 {
		t.Fatalf("tie input 43: total eligible count %d, want 40 (38 seeded + 3 fixtures minus the input)", idTie.TotalEligibleCount)
	}
	if !idTie.HasMore {
		t.Fatalf("tie input 43: hasMore false, want true")
	}
	assertPageIDs(t, idTie, 44, 45, 29)
	assertUniqueThree(t, idTie)
	assertBitIdenticalTie(t, module, ctx, 43, 44, 45)
	if idTie.Items[0].Names.En != "Tie duplicate" || idTie.Items[1].Names.En != "Tie duplicate" {
		t.Fatalf("stable-ID tie fixtures carry names %q and %q, want both \"Tie duplicate\"", idTie.Items[0].Names.En, idTie.Items[1].Names.En)
	}
	if idTie.Items[0].FoodObjectID != 44 || idTie.Items[1].FoodObjectID != 45 {
		t.Fatalf("identical-name tie ordered as %v, want [44 45] by stable Food Object ID", pageIDs(idTie)[:2])
	}

	// English-name tie: two candidates with identical Macro Profiles but
	// different English names break by the pinned English collation. The
	// names deliberately oppose ascending ID order ("Tie alpha" is ID 55 and
	// "Tie zulu" is ID 54), so 55 before 54 can only come from the collation,
	// proving the English-name tie overrides the stable-ID order (REQ-035).
	insertTieObject(53, "Tie zulu input", "Wprowadzenie zulu", 4, 6, 8)
	insertTieObject(54, "Tie zulu", "Zulu wiazania", 4, 6, 8)
	insertTieObject(55, "Tie alpha", "Alfa wiazania", 4, 6, 8)
	nameTie := run(SubstituteInput{FoodObjectID: 53, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
	if nameTie.TotalEligibleCount != 43 {
		t.Fatalf("tie input 53: total eligible count %d, want 43 (38 seeded + 6 fixtures minus the input)", nameTie.TotalEligibleCount)
	}
	if !nameTie.HasMore {
		t.Fatalf("tie input 53: hasMore false, want true")
	}
	assertPageIDs(t, nameTie, 55, 54, 34)
	assertUniqueThree(t, nameTie)
	assertBitIdenticalTie(t, module, ctx, 53, 55, 54)
	if nameTie.Items[0].Names.En != "Tie alpha" || nameTie.Items[1].Names.En != "Tie zulu" {
		t.Fatalf("English-name tie ordered as %q then %q, want \"Tie alpha\" then \"Tie zulu\"", nameTie.Items[0].Names.En, nameTie.Items[1].Names.En)
	}
	if nameTie.Items[0].FoodObjectID != 55 || nameTie.Items[1].FoodObjectID != 54 {
		t.Fatalf("English-name tie ordered as %v, want [55 54]: the pinned English collation must override the ascending stable-ID order",
			pageIDs(nameTie)[:2])
	}

	// Raw stored-name collation (REQ-035, ARCH-018): the substitute tie rule
	// collates the stored English names with collate.New(language.English)
	// and never applies the Suggest operation's query normalizer, so case
	// and whitespace distinctions in the stored names stay significant and
	// decide the tie before the stable-ID fallback. Both fixtures make the
	// raw-name order oppose the ascending-ID order, so the observed page
	// order can only come from the raw collation.
	insertTieObject(66, "Tie case input", "Wprowadzenie wielkosci liter", 2, 2, 2)
	insertTieObject(67, "Tie case", "Wielkosc liter", 2, 2, 2)
	insertTieObject(68, "tie case", "wielkosc liter", 2, 2, 2)
	caseTie := run(SubstituteInput{FoodObjectID: 66, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
	if caseTie.TotalEligibleCount != 46 {
		t.Fatalf("tie input 66: total eligible count %d, want 46 (38 seeded + 9 fixtures minus the input)", caseTie.TotalEligibleCount)
	}
	if !caseTie.HasMore {
		t.Fatalf("tie input 66: hasMore false, want true")
	}
	assertPageIDs(t, caseTie, 68, 67, 15)
	assertUniqueThree(t, caseTie)
	assertBitIdenticalTie(t, module, ctx, 66, 68, 67)
	if caseTie.Items[0].Names.En != "tie case" || caseTie.Items[1].Names.En != "Tie case" {
		t.Fatalf("case tie ordered as %q then %q, want \"tie case\" then \"Tie case\" by the raw English collation", caseTie.Items[0].Names.En, caseTie.Items[1].Names.En)
	}
	if caseTie.Items[0].FoodObjectID != 68 || caseTie.Items[1].FoodObjectID != 67 {
		t.Fatalf("case tie ordered as %v, want [68 67]: the raw stored-name collation must order lowercase before title case; the Suggest normalizer would fold the names and fall back to IDs [67 68]",
			pageIDs(caseTie)[:2])
	}

	insertTieObject(76, "Tie whitespace input", "Wprowadzenie spacji", 5, 3, 1)
	insertTieObject(77, "Tie space", "Spacja", 5, 3, 1)
	insertTieObject(78, "Tie  space", "Podwojna spacja", 5, 3, 1)
	spaceTie := run(SubstituteInput{FoodObjectID: 76, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
	if spaceTie.TotalEligibleCount != 49 {
		t.Fatalf("tie input 76: total eligible count %d, want 49 (38 seeded + 12 fixtures minus the input)", spaceTie.TotalEligibleCount)
	}
	if !spaceTie.HasMore {
		t.Fatalf("tie input 76: hasMore false, want true")
	}
	assertPageIDs(t, spaceTie, 78, 77, 20)
	assertUniqueThree(t, spaceTie)
	assertBitIdenticalTie(t, module, ctx, 76, 78, 77)
	if spaceTie.Items[0].Names.En != "Tie  space" || spaceTie.Items[1].Names.En != "Tie space" {
		t.Fatalf("whitespace tie ordered as %q then %q, want \"Tie  space\" then \"Tie space\" by the raw English collation", spaceTie.Items[0].Names.En, spaceTie.Items[1].Names.En)
	}
	if spaceTie.Items[0].FoodObjectID != 78 || spaceTie.Items[1].FoodObjectID != 77 {
		t.Fatalf("whitespace tie ordered as %v, want [78 77]: the raw stored-name collation must order the double-space name before the single-space name; collapsing the whitespace would fall back to IDs [77 78]",
			pageIDs(spaceTie)[:2])
	}

	// Candidate-calorie overflow classification (ARCH-018, ISSUE-005): a
	// schema-valid largest-finite candidate with protein = DBL_MAX has
	// derived calories 4p + 4c + 9f = +Inf, yet against a small normal input
	// its dot product and cosine stay finite (the candidate norm overflows to
	// +Inf, so the cosine is a finite zero). Without the candidate-calorie
	// check the Matched Quantity would divide finite input calories by +Inf
	// and return a false successful zero quantity with zero scaled macros.
	// Run must classify the pair as the stable INTERNAL_ERROR before ranking
	// or page construction, after exactly one fresh SELECT and no retry.
	runExpectInternalError := func(input SubstituteInput) {
		t.Helper()
		tracer.reset()
		page, err := module.Run(ctx, input, 0)
		if err == nil {
			t.Fatalf("Run(input %d, %v) returned page %+v, want INTERNAL_ERROR for the nonfinite derived arithmetic", input.FoodObjectID, input.Quantity, page)
		}
		var moduleErr *Error
		if !errors.As(err, &moduleErr) || moduleErr.Code != CodeInternalError {
			t.Fatalf("Run(input %d, %v) failure %v, want the stable INTERNAL_ERROR classification", input.FoodObjectID, input.Quantity, err)
		}
		tracer.assertSingleSelect(t, wantSQL)
	}
	insertTieObject(90, "Small normal input", "Maly normalny produkt", 0.1, 0, 0)
	insertTieObject(91, "Largest calories candidate", "Kandydat o najwiekszej kalorycznosci", math.MaxFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 90, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	// Finite-boundary classification (ARCH-018, ISSUE-005): the ARCH-013
	// schema accepts the largest finite double and the smallest positive
	// subnormal as Macro Profile values, but the derived arithmetic over or
	// under them — 4×DBL_MAX overflows to +Inf calories and an Inf/Inf cosine,
	// and a subnormal vector norm underflows to a zero denominator and a
	// nonfinite cosine. Run must classify every such schema-valid profile as
	// the stable internal failure at the Module boundary instead of returning
	// nonfinite page fields or ordering by NaN, after exactly one fresh
	// SELECT and no retry. The fixtures are artificial boundary data owned by
	// this isolated integration test, never the production seed (ISSUE-002,
	// ARCH-018 quality constraints).

	// Smallest positive subnormal candidate: its squared norm underflows to a
	// zero denominator, so its cosine against any normal input is not finite.
	insertTieObject(88, "Subnormal candidate", "Subnormalny kandydat", math.SmallestNonzeroFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 43, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	// Smallest positive subnormal input: the input vector norm underflows to
	// zero, so every candidate cosine is not finite.
	insertTieObject(89, "Subnormal input", "Subnormalne wprowadzenie", math.SmallestNonzeroFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 89, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	// Largest finite double candidate: its squared norm overflows to +Inf and
	// its cosine against any normal input is Inf/Inf, that is NaN.
	insertTieObject(87, "Largest candidate", "Najwiekszy kandydat", math.MaxFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 43, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	// Largest finite double input: 4 × DBL_MAX overflows to +Inf input
	// calories, classified before any ranking.
	insertTieObject(86, "Largest input", "Najwieksze wprowadzenie", math.MaxFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 86, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
}

// countFoodObjects returns the number of Food Object rows on the owner
// connection.
func countFoodObjects(t *testing.T, owner *pgx.Conn) int {
	t.Helper()
	var n int
	if err := owner.QueryRow(context.Background(), "SELECT count(*) FROM food_objects").Scan(&n); err != nil {
		t.Fatalf("count Food Objects: %v", err)
	}
	return n
}

// assertFoodObjectColumns checks that food_objects carries exactly the
// ARCH-013 source columns in ordinal order — no derived calories,
// Nutritional Similarity, Matched Quantity, page, or rounded display
// columns (ARCH-013, task 16).
func assertFoodObjectColumns(t *testing.T, owner *pgx.Conn, want []string) {
	t.Helper()
	rows, err := owner.Query(context.Background(), `SELECT column_name FROM information_schema.columns
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
	if len(columns) != len(want) {
		t.Fatalf("food_objects has %d columns %v, want exactly %v (ARCH-013 source fields only)", len(columns), columns, want)
	}
	for i, column := range want {
		if columns[i] != column {
			t.Fatalf("food_objects column %d is %q, want %q (full set %v)", i, columns[i], column, columns)
		}
	}
}
