package repository

import (
	"context"
	"errors"
	"math"
	"testing"
)

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
	displayCalories     int64
	similarityPercent   int32
}

var scenarioAProjections = []wantProjectionItem{
	{
		id: 101, cosine: 1.0, mq: 437.5, protein: 0.35, carbohydrate: 3.5, fat: 3.5,
		matchedQuantity: 438, unit: UnitGram,
		displayProtein: 0.4, displayCarbohydrate: 3.5, displayFat: 3.5, displayCalories: 47, similarityPercent: 100,
	},
	{
		id: 102, cosine: 0.9999999980471663, mq: 437.4632726730032,
		protein: 0.3499706181384025, carbohydrate: 3.499706181384026, fat: 3.5001436446566987,
		matchedQuantity: 437, unit: UnitGram,
		displayProtein: 0.3, displayCarbohydrate: 3.5, displayFat: 3.5, displayCalories: 47, similarityPercent: 100,
	},
	{
		id: 104, cosine: 0.9977048471634474, mq: 180.16287645974185,
		protein: 0.014413030116779349, carbohydrate: 3.603257529194837, fat: 3.603257529194837,
		matchedQuantity: 180, unit: UnitGram,
		displayProtein: 0.0, displayCarbohydrate: 3.6, displayFat: 3.6, displayCalories: 47, similarityPercent: 100,
	},
}

var scenarioBProjections = []wantProjectionItem{
	{
		id: 103, cosine: 0.9856504098890393, mq: 437.50000000000006,
		protein: 8.750000000000002, carbohydrate: 19.687500000000004, fat: 29.750000000000004,
		matchedQuantity: 438, unit: UnitMillilitre,
		displayProtein: 8.8, displayCarbohydrate: 19.7, displayFat: 29.8, displayCalories: 382, similarityPercent: 99,
	},
	{
		id: 107, cosine: 0.9637854731818697, mq: 465.2439024390244,
		protein: 9.304878048780488, carbohydrate: 23.26219512195122, fat: 27.914634146341463,
		matchedQuantity: 465, unit: UnitMillilitre,
		displayProtein: 9.3, displayCarbohydrate: 23.3, displayFat: 27.9, displayCalories: 382, similarityPercent: 96,
	},
	{
		id: 108, cosine: 0.94500000000000006, mq: 341.07965651199112,
		protein: 19.955564097289411, carbohydrate: 6.3508054590323875, fat: 30.697169086079203,
		matchedQuantity: 341, unit: UnitMillilitre,
		displayProtein: 20.0, displayCarbohydrate: 6.4, displayFat: 30.7, displayCalories: 382, similarityPercent: 95,
	},
}

type projectedDisplay struct {
	matchedQuantity int64
	protein         float64
}

func displayOf(mq, protein float64) projectedDisplay {
	return projectedDisplay{
		matchedQuantity: int64(math.Round(mq)),
		protein:         projectMacronutrient(protein * mq / 100),
	}
}

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

	insert(100, "Projection input", "Wprowadzenie projekcji", stateSolid, 0.1, 1, 1)
	insert(101, "Projection half g", "Projekcja polowa g", stateSolid, 0.08, 0.8, 0.8)
	insert(102, "Projection adversary", "Projekcja przeciwnik", stateSolid, 0.08, 0.8, 0.8001)
	insert(104, "Projection zero macro", "Projekcja zerowy makro", stateSolid, 0.008, 2, 2)
	insert(110, "Projection liquid input", "Wprowadzenie projekcji cieklej", stateSolid, 3, 4, 9)
	insert(103, "Projection half ml", "Projekcja polowa ml", stateLiquid, 2, 4.5, 6.8)
	insert(107, "Projection ordinary ml", "Projekcja zwykla ml", stateLiquid, 2, 5, 6)
	insert(108, "Projection half percent", "Projekcja polowa procent", stateLiquid, 5.850704876791104, 1.8619713424066724, 9)
	insert(130, "Projection extreme input", "Ekstremalne wprowadzenie", stateSolid, 2.5e16, 0, 0)
	insert(131, "Projection extreme candidate", "Ekstremalny kandydat", stateSolid, 0.1, 0, 0)

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
			assertNearEqual(t, "cosineSimilarity", cosineSimilarity(inputProfile, candidateProfile), want.cosine)
			assertNearEqual(t, "matchedQuantity", mq, want.mq)
			assertNearEqual(t, "scaled protein", candidateProfile.protein*mq/100, want.protein)
			assertNearEqual(t, "scaled carbohydrate", candidateProfile.carbohydrate*mq/100, want.carbohydrate)
			assertNearEqual(t, "scaled fat", candidateProfile.fat*mq/100, want.fat)
			if item.MatchedQuantity != (MatchedQuantity{Value: want.matchedQuantity, Unit: want.unit}) {
				t.Fatalf("item %d: Matched Quantity is %+v, want %+v", want.id, item.MatchedQuantity, MatchedQuantity{Value: want.matchedQuantity, Unit: want.unit})
			}
			if item.Protein != want.displayProtein || item.Carbohydrate != want.displayCarbohydrate || item.Fat != want.displayFat {
				t.Fatalf("item %d: macronutrients are (%v, %v, %v), want (%v, %v, %v)",
					want.id, item.Protein, item.Carbohydrate, item.Fat, want.displayProtein, want.displayCarbohydrate, want.displayFat)
			}
			if item.Calories != want.displayCalories {
				t.Fatalf("item %d: calories is %d, want %d", want.id, item.Calories, want.displayCalories)
			}
			if item.SimilarityPercent != want.similarityPercent {
				t.Fatalf("item %d: similarity percent is %d, want %d", want.id, item.SimilarityPercent, want.similarityPercent)
			}
		}
		for i := 1; i < len(page.Items); i++ {
			prev := cosineSimilarity(inputProfile, profiles[page.Items[i-1].FoodObjectID])
			curr := cosineSimilarity(inputProfile, profiles[page.Items[i].FoodObjectID])
			if prev <= curr {
				t.Fatalf("input %d: page-0 full-precision similarity is not strictly decreasing: %.17g then %.17g", inputID, prev, curr)
			}
		}
	}

	assertScenario(100, scenarioAProjections)

	assertScenario(110, scenarioBProjections)

	if cal, err := projectCalories(46.5); err != nil || cal != 47 {
		t.Fatalf("projectCalories(46.5) = %d, %v, want 47, nil", cal, err)
	}
	if cal, err := projectCalories(46.49999999999999); err != nil || cal != 46 {
		t.Fatalf("projectCalories(46.49999999999999) = %d, %v, want 46, nil", cal, err)
	}
	if cal, err := projectCalories(0.04); err != nil || cal != 0 {
		t.Fatalf("projectCalories(0.04) = %d, %v, want 0, nil", cal, err)
	}

	if half := cosineSimilarity(profiles[110], profiles[108]) * 100; half != 94.5 {
		t.Fatalf("fixture 108 cosine × 100 = %.17g, want the exact half 94.5", half)
	}

	inputCal := calories(profiles[100]) * 350 / 100
	adversary := profiles[102]
	candCal := calories(adversary)
	mqFull := matchedQuantity(inputCal, candCal)
	fullDisplay := displayOf(mqFull, adversary.protein)
	if fullDisplay != (projectedDisplay{matchedQuantity: 437, protein: 0.3}) {
		t.Fatalf("adversary full-precision display is %+v, want {437 g, 0.3 g}", fullDisplay)
	}
	naivePipelines := map[string]float64{
		"input calories rounded to a whole": matchedQuantity(math.Round(inputCal), candCal),
		"candidate calories rounded to 0.1": matchedQuantity(inputCal, math.Round(candCal*10)/10),
		"Matched Quantity rounded to 0.1":   math.Round(mqFull*10) / 10,
	}
	for name, naiveMQ := range naivePipelines {
		if naiveDisplay := displayOf(naiveMQ, adversary.protein); naiveDisplay == fullDisplay {
			t.Fatalf("adversary fixture is not sensitive to %s: naive display %+v equals the full-precision display %+v",
				name, naiveDisplay, fullDisplay)
		}
	}

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

	if n := countFoodObjects(t, owner); n != 48 {
		t.Fatalf("catalog has %d Food Objects after the Runs, want the 38 seeded rows plus 10 projection fixtures", n)
	}
}
