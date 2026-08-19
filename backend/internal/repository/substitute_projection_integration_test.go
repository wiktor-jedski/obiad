package repository

// Integration test for Phase 4 (task 17): the final display projection of
// the concrete Find Substitute Page Run operation (ARCH-005, ARCH-013,
// ARCH-018, ARCH-022, REQ-031, REQ-039, REQ-040). It requires a real
// PostgreSQL server: the test creates its isolated disposable database plus
// the schema-owner, SELECT-only runtime, and unprivileged login roles
// through the shared testdb support, runs the real setup command against
// it, grants the runtime catalog read through the same embedded privilege
// SQL the local deployment setup applies, and drives the real Find
// Substitute Page Module through the SELECT-only runtime credential. A
// query tracer on the runtime connection proves that every Run performs
// exactly one fresh embedded SELECT and no mutating statement.
//
// The test proves the P04-G4 projection clauses with artificial boundary
// fixtures kept outside the production seed (ISSUE-002, ARCH-018 quality
// constraints): full-precision ranking and scaling, the solid g and liquid
// ml Matched Quantity units, whole-unit Matched Quantity, one-decimal
// macronutrient, and whole-percentage similarity projection, exact-half-up
// behavior at every target precision, a positive value that displays as
// zero, and an early-rounding adversary that fails if any intermediate
// value is rounded before the final projection (REQ-040). The recorded
// full-precision expectations are verified directly through the private
// production calorie, cosine, and Matched Quantity helpers with
// abs(got - want) <= 1e-12 (ISSUE-005), and the projected display is
// verified on the concrete Run output. Exact-half boundaries that no
// top-ranked fixture can reach through Run (whole-percentage halves and
// arbitrary 0.1 g halves) are asserted directly on the private production
// projection helpers, mirroring the task-16 helper-assertion pattern; the
// schema-valid extreme pair whose projected Matched Quantity exceeds the
// int64 display range is classified as the stable INTERNAL_ERROR through
// Run. No exported seam, fake, or test hook is added. The admin connection
// comes from OBIAD_TEST_ADMIN_DATABASE_URL or from libpq-style environment
// variables; no credential is committed and tests skip when no server is
// reachable.

import (
	"context"
	"errors"
	"testing"
)

// wantProjectionItem records the independently computed full-precision
// values and the final display projection of one fixture candidate: the
// full-precision cosine Nutritional Similarity, Matched Quantity, and
// scaled macronutrients, plus the whole Matched Quantity value and
// candidate base unit, the 0.1 g macronutrients, and the whole similarity
// percentage the Run operation must display.
type wantProjectionItem struct {
	id                  int32
	cosine              float64
	mq                  float64
	protein             float64
	carbohydrate        float64
	fat                 float64
	matchedQuantity     int64
	unit                Unit
	displayProtein      float64
	displayCarbohydrate float64
	displayFat          float64
	similarityPercent   int32
}

// scenarioAProjections covers the solid g scenario (input 100 =
// (0.1, 1, 1) at 350 g): the collinear half fixture 101 whose Matched
// Quantity lands exactly on the whole-unit half (437.5 g → 438 g) and whose
// protein lands exactly on the 0.1 g half (0.35 g → 0.4 g); the
// early-rounding adversary 102 whose full-precision Matched Quantity and
// protein sit just below those halves (437.463… g → 437 g, 0.34997… g →
// 0.3 g); and the zero-display fixture 104 whose positive protein
// (0.01441… g) displays as 0.0 g.
var scenarioAProjections = []wantProjectionItem{
	{
		id: 101, cosine: 1.0, mq: 437.5, protein: 0.35, carbohydrate: 3.5, fat: 3.5,
		matchedQuantity: 438, unit: UnitGram,
		displayProtein: 0.4, displayCarbohydrate: 3.5, displayFat: 3.5, similarityPercent: 100,
	},
	{
		id: 102, cosine: 0.9999999980471663, mq: 437.4632726730032,
		protein: 0.3499706181384025, carbohydrate: 3.499706181384026, fat: 3.5001436446566987,
		matchedQuantity: 437, unit: UnitGram,
		displayProtein: 0.3, displayCarbohydrate: 3.5, displayFat: 3.5, similarityPercent: 100,
	},
	{
		id: 104, cosine: 0.9977048471634474, mq: 180.16287645974185,
		protein: 0.014413030116779349, carbohydrate: 3.603257529194837, fat: 3.603257529194837,
		matchedQuantity: 180, unit: UnitGram,
		displayProtein: 0.0, displayCarbohydrate: 3.6, displayFat: 3.6, similarityPercent: 100,
	},
}

// scenarioBProjections covers the liquid ml scenario (input 110 =
// (3, 4, 9) at 350 g): the half fixture 103 whose Matched Quantity lands
// on the whole-unit half (437.50000000000006 ml → 438 ml) and whose protein
// and fat land on 0.1 g halves (8.750000000000002 g → 8.8 g,
// 29.750000000000004 g → 29.8 g), and two ordinary fixtures 107 and 106
// whose whole Matched Quantities and ordinary 0.1 g macronutrients project
// without boundary effects.
var scenarioBProjections = []wantProjectionItem{
	{
		id: 103, cosine: 0.9856504098890393, mq: 437.50000000000006,
		protein: 8.750000000000002, carbohydrate: 19.687500000000004, fat: 29.750000000000004,
		matchedQuantity: 438, unit: UnitMillilitre,
		displayProtein: 8.8, displayCarbohydrate: 19.7, displayFat: 29.8, similarityPercent: 99,
	},
	{
		id: 107, cosine: 0.9637854731818697, mq: 465.2439024390244,
		protein: 9.304878048780488, carbohydrate: 23.26219512195122, fat: 27.914634146341463,
		matchedQuantity: 465, unit: UnitMillilitre,
		displayProtein: 9.3, displayCarbohydrate: 23.3, displayFat: 27.9, similarityPercent: 96,
	},
	{
		id: 106, cosine: 0.9358786874253313, mq: 443.6046511627907,
		protein: 8.872093023255813, carbohydrate: 26.616279069767444, fat: 26.616279069767444,
		matchedQuantity: 444, unit: UnitMillilitre,
		displayProtein: 8.9, displayCarbohydrate: 26.6, displayFat: 26.6, similarityPercent: 94,
	},
}

// projectedDisplay is one display projection of a Matched Quantity and a
// protein amount, used to compare the full-precision pipeline with naive
// early-rounding pipelines.
type projectedDisplay struct {
	matchedQuantity int64
	protein         float64
}

// displayOf projects one Matched Quantity and the protein scaled to it.
func displayOf(mq, protein float64) projectedDisplay {
	return projectedDisplay{
		matchedQuantity: int64(roundHalfUp(mq)),
		protein:         projectMacronutrient(protein * mq / 100),
	}
}

// TestSubstituteProjectionIntegration exercises the final display
// projection of the concrete Find Substitute Page Run operation against
// real PostgreSQL through the SELECT-only runtime credential (P04-G4):
// artificial boundary fixtures prove full-precision ranking and scaling,
// the solid g and liquid ml Matched Quantity units, whole-unit, one-decimal,
// and whole-percentage projection, exact-half-up behavior at every target
// precision, a positive value that displays as zero, and a fixture that
// fails if any intermediate value is rounded early. Exact-half boundaries
// that no top-ranked fixture can reach are asserted directly on the private
// projection helpers, and the schema-valid extreme pair whose whole Matched
// Quantity exceeds the int64 display range is classified as the stable
// INTERNAL_ERROR after exactly one fresh SELECT and no retry.
func TestSubstituteProjectionIntegration(t *testing.T) {
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

	insert := func(id int32, en, pl string, state physicalState, protein, carbohydrate, fat float64) {
		t.Helper()
		if _, err := owner.Exec(ctx,
			`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, $3, $4, $5, $6)`,
			id, `{"en": "`+en+`", "pl": "`+pl+`"}`, string(state), protein, carbohydrate, fat,
		); err != nil {
			t.Fatalf("owner projection-fixture insert for ID %d: %v", id, err)
		}
	}

	// Exact-half-up projection primitives (REQ-039, ARCH-018): the rounding
	// used at every target precision — whole Matched Quantity, 0.1 g
	// macronutrients, whole percentage — rounds exact nonnegative halves up
	// and permits a positive value to display as zero. Whole-percentage
	// halves and arbitrary 0.1 g halves cannot all reach page 0 through Run
	// (the seeded catalog's similarity spread bounds the visible
	// candidates), so these boundaries are asserted directly on the private
	// production projection helpers, the same pattern the task-16 test uses
	// for the private calculation helpers.
	if got := roundHalfUp(0.5); got != 1 {
		t.Fatalf("roundHalfUp(0.5) = %v, want 1 (exact half rounds up)", got)
	}
	if got := roundHalfUp(1.5); got != 2 {
		t.Fatalf("roundHalfUp(1.5) = %v, want 2 (exact half rounds up)", got)
	}
	if got := roundHalfUp(2.5); got != 3 {
		t.Fatalf("roundHalfUp(2.5) = %v, want 3 (exact half rounds up)", got)
	}
	if got := roundHalfUp(0.49999999999999994); got != 0 {
		t.Fatalf("roundHalfUp(0.49999999999999994) = %v, want 0 (a value just below the half rounds down)", got)
	}
	if got := roundHalfUp(0.4); got != 0 {
		t.Fatalf("roundHalfUp(0.4) = %v, want 0 (a positive value can display as zero)", got)
	}
	if got := roundHalfUp(437.5); got != 438 {
		t.Fatalf("roundHalfUp(437.5) = %v, want 438 (exact half rounds up)", got)
	}
	if got := roundHalfUp(437.49999999999994); got != 437 {
		t.Fatalf("roundHalfUp(437.49999999999994) = %v, want 437 (a value just below the half rounds down)", got)
	}
	if got := projectMacronutrient(8.75); got != 8.8 {
		t.Fatalf("projectMacronutrient(8.75) = %v, want 8.8 (exact half rounds up)", got)
	}
	if got := projectMacronutrient(0.05); got != 0.1 {
		t.Fatalf("projectMacronutrient(0.05) = %v, want 0.1 (exact half rounds up)", got)
	}
	if got := projectMacronutrient(0.04); got != 0.0 {
		t.Fatalf("projectMacronutrient(0.04) = %v, want 0.0 (a positive value can display as zero)", got)
	}
	if got := projectMacronutrient(13.125); got != 13.1 {
		t.Fatalf("projectMacronutrient(13.125) = %v, want 13.1", got)
	}
	if got := projectMacronutrient(31.25); got != 31.3 {
		t.Fatalf("projectMacronutrient(31.25) = %v, want 31.3 (exact half rounds up)", got)
	}
	if got := projectMacronutrient(35.0); got != 35.0 {
		t.Fatalf("projectMacronutrient(35.0) = %v, want 35.0 (an exact 0.1 g value is unchanged)", got)
	}
	if got := projectMacronutrient(0.35); got != 0.4 {
		t.Fatalf("projectMacronutrient(0.35) = %v, want 0.4 (exact half rounds up)", got)
	}
	if got := projectSimilarityPercent(0.505); got != 51 {
		t.Fatalf("projectSimilarityPercent(0.505) = %d, want 51 (exact half rounds up)", got)
	}
	if got := projectSimilarityPercent(0.5); got != 50 {
		t.Fatalf("projectSimilarityPercent(0.5) = %d, want 50 (exact half rounds up)", got)
	}
	if got := projectSimilarityPercent(0.5049999999999999); got != 50 {
		t.Fatalf("projectSimilarityPercent(0.5049999999999999) = %d, want 50 (a value just below the half rounds down)", got)
	}
	if got := projectSimilarityPercent(0.004); got != 0 {
		t.Fatalf("projectSimilarityPercent(0.004) = %d, want 0 (a positive value can display as zero)", got)
	}
	if got := projectSimilarityPercent(1.0); got != 100 {
		t.Fatalf("projectSimilarityPercent(1.0) = %d, want 100", got)
	}
	if got := projectSimilarityPercent(0.9999999999999999); got != 100 {
		t.Fatalf("projectSimilarityPercent(0.9999999999999999) = %d, want 100", got)
	}
	if got, err := projectMatchedQuantity(437.5, stateSolid); err != nil || got != (MatchedQuantity{Value: 438, Unit: UnitGram}) {
		t.Fatalf("projectMatchedQuantity(437.5, solid) = %+v, %v, want {438 g} (exact half rounds up)", got, err)
	}
	if got, err := projectMatchedQuantity(437.49999999999994, stateSolid); err != nil || got != (MatchedQuantity{Value: 437, Unit: UnitGram}) {
		t.Fatalf("projectMatchedQuantity(437.49999999999994, solid) = %+v, %v, want {437 g}", got, err)
	}
	if got, err := projectMatchedQuantity(0.4, stateSolid); err != nil || got != (MatchedQuantity{Value: 0, Unit: UnitGram}) {
		t.Fatalf("projectMatchedQuantity(0.4, solid) = %+v, %v, want {0 g} (a positive value can display as zero)", got, err)
	}
	if got, err := projectMatchedQuantity(62.5, stateLiquid); err != nil || got != (MatchedQuantity{Value: 63, Unit: UnitMillilitre}) {
		t.Fatalf("projectMatchedQuantity(62.5, liquid) = %+v, %v, want {63 ml} (exact half rounds up, ml unit)", got, err)
	}
	if got, err := projectMatchedQuantity(2.5e19, stateSolid); err == nil {
		t.Fatalf("projectMatchedQuantity(2.5e19, solid) = %+v, want the int64 display-range failure", got)
	}

	// Artificial boundary fixtures (ISSUE-002, ARCH-018): all projection
	// evidence uses isolated fixture rows inserted by the schema owner, never
	// the production seed.
	insert(100, "Projection input", "Wprowadzenie projekcji", stateSolid, 0.1, 1, 1)
	insert(101, "Projection half g", "Projekcja polowa g", stateSolid, 0.08, 0.8, 0.8)
	insert(102, "Projection adversary", "Projekcja przeciwnik", stateSolid, 0.08, 0.8, 0.8001)
	insert(104, "Projection zero macro", "Projekcja zerowy makro", stateSolid, 0.008, 2, 2)
	insert(110, "Projection liquid input", "Wprowadzenie projekcji cieklej", stateSolid, 3, 4, 9)
	insert(103, "Projection half ml", "Projekcja polowa ml", stateLiquid, 2, 4.5, 6.8)
	insert(107, "Projection ordinary ml", "Projekcja zwykla ml", stateLiquid, 2, 5, 6)
	insert(106, "Projection third ml", "Projekcja trzecia ml", stateLiquid, 2, 6, 6)
	insert(130, "Projection extreme input", "Ekstremalne wprowadzenie", stateSolid, 2.5e16, 0, 0)
	insert(131, "Projection extreme candidate", "Ekstremalny kandydat", stateSolid, 0.1, 0, 0)

	// One request-local catalog snapshot through the real private Catalog
	// Loader supplies the Macro Profiles for the full-precision helper
	// checks below.
	profiles := loadProfiles(t, module, ctx)

	assertScenario := func(inputID int32, wants []wantProjectionItem) {
		t.Helper()
		page := run(SubstituteInput{FoodObjectID: inputID, Quantity: FoodQuantity{Value: 350, Unit: UnitGram}})
		wantIDs := make([]int32, len(wants))
		for i, want := range wants {
			wantIDs[i] = want.id
		}
		assertPageIDs(t, page, wantIDs...)
		inputProfile := profiles[inputID]
		inputCal := calories(inputProfile) * 350 / 100
		for i, item := range page.Items {
			want := wants[i]
			if item.FoodObjectID != want.id {
				t.Fatalf("page item %d has ID %d, want %d", i, item.FoodObjectID, want.id)
			}
			candidateProfile := profiles[want.id]
			mq := matchedQuantity(inputCal, calories(candidateProfile))
			// Full precision until the final projection (REQ-040): the
			// ranking similarity, the equal-calorie Matched Quantity, and
			// the scaled macronutrients match the recorded full-precision
			// expectations within ISSUE-005's absolute 1e-12 tolerance.
			assertNearEqual(t, "cosineSimilarity", cosineSimilarity(inputProfile, candidateProfile), want.cosine)
			assertNearEqual(t, "matchedQuantity", mq, want.mq)
			assertNearEqual(t, "scaled protein", candidateProfile.protein*mq/100, want.protein)
			assertNearEqual(t, "scaled carbohydrate", candidateProfile.carbohydrate*mq/100, want.carbohydrate)
			assertNearEqual(t, "scaled fat", candidateProfile.fat*mq/100, want.fat)
			// The final display projection (REQ-039): whole Matched Quantity
			// in the candidate base unit, 0.1 g macronutrients, whole
			// similarity percentage, exact halves rounded up, positive
			// values permitted to display as zero.
			if item.MatchedQuantity != (MatchedQuantity{Value: want.matchedQuantity, Unit: want.unit}) {
				t.Fatalf("item %d: Matched Quantity is %+v, want %+v", want.id, item.MatchedQuantity, MatchedQuantity{Value: want.matchedQuantity, Unit: want.unit})
			}
			if item.Protein != want.displayProtein || item.Carbohydrate != want.displayCarbohydrate || item.Fat != want.displayFat {
				t.Fatalf("item %d: macronutrients are (%v, %v, %v), want (%v, %v, %v)",
					want.id, item.Protein, item.Carbohydrate, item.Fat, want.displayProtein, want.displayCarbohydrate, want.displayFat)
			}
			if item.SimilarityPercent != want.similarityPercent {
				t.Fatalf("item %d: similarity percent is %d, want %d", want.id, item.SimilarityPercent, want.similarityPercent)
			}
		}
		// Full-precision ranking (REQ-034): the page-0 order is the strictly
		// decreasing order of the unrounded similarities; rounding similarity
		// for ranking would break this check.
		for i := 1; i < len(page.Items); i++ {
			prev := cosineSimilarity(inputProfile, profiles[page.Items[i-1].FoodObjectID])
			curr := cosineSimilarity(inputProfile, profiles[page.Items[i].FoodObjectID])
			if prev <= curr {
				t.Fatalf("input %d: page-0 full-precision similarity is not strictly decreasing: %.17g then %.17g", inputID, prev, curr)
			}
		}
	}

	// Solid g scenario: whole-unit and 0.1 g exact-half-up projection, the g
	// Matched Quantity unit, a positive protein that displays as zero, and
	// the early-rounding adversary, all through the concrete Run operation.
	assertScenario(100, scenarioAProjections)

	// Liquid ml scenario: the ml Matched Quantity unit, whole-unit and 0.1 g
	// exact-half-up projection, and ordinary whole-unit, one-decimal, and
	// whole-percentage projection, all through the concrete Run operation.
	assertScenario(110, scenarioBProjections)

	// Early-rounding adversary (P04-G4, REQ-040): fixture 102's
	// full-precision display is 437 g and 0.3 g protein. Rounding any
	// intermediate value before the final projection — the input calories
	// (46.9 → 47), the candidate calories (10.7209 → 10.7), or the Matched
	// Quantity (437.463… → 437.5) — projects to 438 g and 0.4 g instead, so
	// the fixture fails any implementation that rounds early. The
	// recomputed naive pipelines below prove each one differs from the
	// full-precision display; the page-0 item itself is asserted through
	// Run in the solid scenario above.
	inputCal := calories(profiles[100]) * 350 / 100
	adversary := profiles[102]
	candCal := calories(adversary)
	mqFull := matchedQuantity(inputCal, candCal)
	fullDisplay := displayOf(mqFull, adversary.protein)
	if fullDisplay != (projectedDisplay{matchedQuantity: 437, protein: 0.3}) {
		t.Fatalf("adversary full-precision display is %+v, want {437 g, 0.3 g}", fullDisplay)
	}
	naivePipelines := map[string]float64{
		"input calories rounded to a whole": matchedQuantity(roundHalfUp(inputCal), candCal),
		"candidate calories rounded to 0.1": matchedQuantity(inputCal, roundHalfUp(candCal*10)/10),
		"Matched Quantity rounded to 0.1":   roundHalfUp(mqFull*10) / 10,
	}
	for name, naiveMQ := range naivePipelines {
		if naiveDisplay := displayOf(naiveMQ, adversary.protein); naiveDisplay == fullDisplay {
			t.Fatalf("adversary fixture is not sensitive to %s: naive display %+v equals the full-precision display %+v",
				name, naiveDisplay, fullDisplay)
		}
	}

	// Schema-valid extreme range (task 17): the whole projected Matched
	// Quantity must fit the int64 display range. Input 130 at 100 g has
	// 1e17 derived calories; the equal-calorie amount of its top-ranked
	// candidate 131 is 2.5e19 g, beyond the int64 range, so Run classifies
	// the pair as the stable INTERNAL_ERROR after exactly one fresh SELECT
	// and no retry instead of returning a wrapped or overflowed display
	// value.
	tracer.reset()
	extremePage, err := module.Run(ctx, SubstituteInput{FoodObjectID: 130, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
	if err == nil {
		t.Fatalf("Run(extreme input 130) returned page %+v, want INTERNAL_ERROR for the out-of-range Matched Quantity", extremePage)
	}
	var moduleErr *Error
	if !errors.As(err, &moduleErr) || moduleErr.Code != CodeInternalError {
		t.Fatalf("Run(extreme input 130) failure %v, want the stable INTERNAL_ERROR classification", err)
	}
	tracer.assertSingleSelect(t, wantSQL)

	// The projection never persists derived values: the catalog still holds
	// exactly the 38 seeded rows plus the 10 artificial boundary fixtures,
	// and the production schema keeps only the ARCH-013 source fields
	// (asserted by TestFindSubstitutePageIntegration).
	if n := countFoodObjects(t, owner); n != 48 {
		t.Fatalf("catalog has %d Food Objects after the Runs, want the 38 seeded rows plus 10 projection fixtures", n)
	}
}
