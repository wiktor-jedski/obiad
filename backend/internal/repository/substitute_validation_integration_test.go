package repository

import (
	"context"
	"errors"
	"math"
	"testing"
)

func assertStableFailure(t *testing.T, err error, wantCode Code, wantField string) {
	t.Helper()
	if err == nil {
		t.Fatalf("Run succeeded, want the stable failure %s with field %q", wantCode, wantField)
	}
	var moduleErr *Error
	if !errors.As(err, &moduleErr) {
		t.Fatalf("failure %v is not a stable Module Error", err)
	}
	if moduleErr.Code != wantCode {
		t.Fatalf("failure Code %s, want %s (failure %v)", moduleErr.Code, wantCode, err)
	}
	if moduleErr.Field != wantField {
		t.Fatalf("failure Field %q, want %q (failure %v)", moduleErr.Field, wantField, err)
	}
}

func TestFindSubstitutePageValidationIntegration(t *testing.T) {
	_, module, tracer, wantSQL, owner := setupSubstituteFixture(t)
	ctx := context.Background()

	accepted := []struct {
		name      string
		input     SubstituteInput
		wantCount int
	}{
		{"solid direct integer grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 250, Unit: UnitGram}}, 37},
		{"liquid direct integer millilitres", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 250, Unit: UnitMillilitre}}, 37},
		{"solid dot-decimal Serving count", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 1.5, Unit: UnitServing}}, 36},
		{"liquid dot-decimal Serving count", SubstituteInput{FoodObjectID: 17, Quantity: FoodQuantity{Value: 0.5, Unit: UnitServing}}, 37},
		{"solid converted boundary at 100000 g", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100000, Unit: UnitGram}}, 37},
		{"liquid converted boundary at 100000 ml", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100000, Unit: UnitMillilitre}}, 37},
		{"Serving converted boundary at 100000 g", SubstituteInput{FoodObjectID: 32, Quantity: FoodQuantity{Value: 1000, Unit: UnitServing}}, 37},
	}
	for _, tc := range accepted {
		t.Run("accept "+tc.name, func(t *testing.T) {
			tracer.reset()
			page, err := module.Run(ctx, tc.input, 0)
			if err != nil {
				t.Fatalf("Run(%+v): %v", tc.input, err)
			}
			if page.TotalEligibleCount != tc.wantCount {
				t.Fatalf("input %d: total eligible count %d, want %d", tc.input.FoodObjectID, page.TotalEligibleCount, tc.wantCount)
			}
			tracer.assertSingleSelect(t, wantSQL)
		})
	}

	if _, err := owner.Exec(ctx,
		`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, serving)
		 VALUES ($1, $2::jsonb, 'solid', 1, 1, 1, $3)`,
		39, `{"en": "Tiny Serving fixture", "pl": "Drobna porcja"}`, 1e-4,
	); err != nil {
		t.Fatalf("owner tiny-Serving fixture insert: %v", err)
	}
	t.Run("accept tiny positive converted Serving", func(t *testing.T) {
		tracer.reset()
		page, err := module.Run(ctx, SubstituteInput{FoodObjectID: 39, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, 0)
		if err != nil {
			t.Fatalf("Run(tiny-Serving fixture, 1 serving): %v", err)
		}
		if page.TotalEligibleCount != 38 {
			t.Fatalf("tiny-Serving fixture: total eligible count %d, want 38 (39 rows minus the input)", page.TotalEligibleCount)
		}
		tracer.assertSingleSelect(t, wantSQL)
	})
	t.Run("reject Serving converted underflow to zero", func(t *testing.T) {
		tracer.reset()
		page, err := module.Run(ctx, SubstituteInput{FoodObjectID: 39, Quantity: FoodQuantity{Value: math.SmallestNonzeroFloat64, Unit: UnitServing}}, 0)
		if page != nil {
			t.Fatalf("Run(tiny-Serving fixture, subnormal serving) returned a page, want the stable failure INVALID_QUANTITY with field quantity.value")
		}
		assertStableFailure(t, err, CodeInvalidQuantity, "quantity.value")
		tracer.assertSingleSelect(t, wantSQL)
	})
	if _, err := owner.Exec(ctx, "DELETE FROM food_objects WHERE id = 39"); err != nil {
		t.Fatalf("delete tiny-Serving fixture: %v", err)
	}

	preLoad := []struct {
		name      string
		input     SubstituteInput
		pageIndex int32
		wantCode  Code
		wantField string
	}{
		{"nonpositive Food Object ID", SubstituteInput{FoodObjectID: 0, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0, CodeInvalidRequest, "foodObjectId"},
		{"negative Food Object ID", SubstituteInput{FoodObjectID: -7, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0, CodeInvalidRequest, "foodObjectId"},
		{"zero direct grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 0, Unit: UnitGram}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"negative direct grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: -100, Unit: UnitGram}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"fractional direct grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100.5, Unit: UnitGram}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"fractional direct millilitres", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100.5, Unit: UnitMillilitre}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"unsupported unit", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: "kg"}}, 0, CodeInvalidQuantity, "quantity.unit"},
		{"zero Serving count", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 0, Unit: UnitServing}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"negative Serving count", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: -1.5, Unit: UnitServing}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"NaN direct grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: math.NaN(), Unit: UnitGram}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"positive infinity direct grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: math.Inf(1), Unit: UnitGram}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"negative infinity direct grams", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: math.Inf(-1), Unit: UnitGram}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"NaN direct millilitres", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: math.NaN(), Unit: UnitMillilitre}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"positive infinity direct millilitres", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: math.Inf(1), Unit: UnitMillilitre}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"NaN Serving count", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: math.NaN(), Unit: UnitServing}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"positive infinity Serving count", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: math.Inf(1), Unit: UnitServing}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"negative infinity Serving count", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: math.Inf(-1), Unit: UnitServing}}, 0, CodeInvalidQuantity, "quantity.value"},
		{"negative page index", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, -1, CodeInvalidPageIndex, "pageIndex"},
	}
	for _, tc := range preLoad {
		t.Run("reject "+tc.name, func(t *testing.T) {
			tracer.reset()
			page, err := module.Run(ctx, tc.input, tc.pageIndex)
			if page != nil {
				t.Fatalf("Run(%+v, page %d) returned a page, want the stable failure %s with field %q",
					tc.input, tc.pageIndex, tc.wantCode, tc.wantField)
			}
			assertStableFailure(t, err, tc.wantCode, tc.wantField)
			if len(tracer.stmts) != 0 {
				t.Fatalf("catalog-independent rejection executed %d statements, want zero before the catalog read", len(tracer.stmts))
			}
		})
	}

	postLoad := []struct {
		name      string
		input     SubstituteInput
		pageIndex int32
		wantCode  Code
		wantField string
	}{
		{"absent positive Food Object ID", SubstituteInput{FoodObjectID: 999999, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0, CodeFoodObjectNotFound, "foodObjectId"},
		{"absent positive Food Object ID with Serving", SubstituteInput{FoodObjectID: 999999, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, 0, CodeFoodObjectNotFound, "foodObjectId"},
		{"solid with millilitre unit mismatch", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: UnitMillilitre}}, 0, CodeQuantityUnitMismatch, "quantity.unit"},
		{"liquid with gram unit mismatch", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0, CodeQuantityUnitMismatch, "quantity.unit"},
		{"missing Serving on solid", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, 0, CodeServingUnavailable, "quantity.unit"},
		{"missing Serving on liquid", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, 0, CodeServingUnavailable, "quantity.unit"},
		{"direct grams over limit", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100001, Unit: UnitGram}}, 0, CodeQuantityOutOfRange, "quantity.value"},
		{"direct millilitres over limit", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100001, Unit: UnitMillilitre}}, 0, CodeQuantityOutOfRange, "quantity.value"},
		{"Serving converted over limit", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 286, Unit: UnitServing}}, 0, CodeQuantityOutOfRange, "quantity.value"},
		{"dot-decimal Serving converted over limit", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 285.72, Unit: UnitServing}}, 0, CodeQuantityOutOfRange, "quantity.value"},
		{"Serving converted over limit on liquid", SubstituteInput{FoodObjectID: 17, Quantity: FoodQuantity{Value: 334, Unit: UnitServing}}, 0, CodeQuantityOutOfRange, "quantity.value"},
		{"first page after last page for Pizza Margherita (36 candidates)", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, 12, CodePageOutOfRange, "pageIndex"},
		{"math.MaxInt32 page for Pizza Margherita", SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, math.MaxInt32, CodePageOutOfRange, "pageIndex"},
		{"first page after last page for Chicken breast (37 candidates)", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 13, CodePageOutOfRange, "pageIndex"},
		{"math.MaxInt32 page for Chicken breast", SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, math.MaxInt32, CodePageOutOfRange, "pageIndex"},
		{"first page after last page for Milk (37 candidates)", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100, Unit: UnitMillilitre}}, 13, CodePageOutOfRange, "pageIndex"},
		{"math.MaxInt32 page for Milk", SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100, Unit: UnitMillilitre}}, math.MaxInt32, CodePageOutOfRange, "pageIndex"},
	}
	for _, tc := range postLoad {
		t.Run("reject "+tc.name, func(t *testing.T) {
			tracer.reset()
			page, err := module.Run(ctx, tc.input, tc.pageIndex)
			if page != nil {
				t.Fatalf("Run(%+v, page %d) returned a page, want the stable failure %s with field %q", tc.input, tc.pageIndex, tc.wantCode, tc.wantField)
			}
			assertStableFailure(t, err, tc.wantCode, tc.wantField)
			tracer.assertSingleSelect(t, wantSQL)
		})
	}

	if _, err := owner.Exec(ctx, "INSERT INTO food_families (id) VALUES (99)"); err != nil {
		t.Fatalf("owner insert food_families 99: %v", err)
	}
	if _, err := owner.Exec(ctx, "UPDATE food_objects SET food_family_id = 99"); err != nil {
		t.Fatalf("owner update food_objects to food_family_id 99: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat, food_family_id) VALUES ($1, $2::jsonb, 'solid', $3, $4, $5, 99)`,
		95, `{"en": "Zero input", "pl": "Wprowadzenie zero"}`, 10.0, 20.0, 5.0,
	); err != nil {
		t.Fatalf("insert zero input: %v", err)
	}
	tracer.reset()
	zeroPage, err := module.Run(ctx, SubstituteInput{FoodObjectID: 95, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
	if err != nil {
		t.Fatalf("Run(zero input, page 0) failed: %v", err)
	}
	if zeroPage.PageIndex != 0 || zeroPage.TotalEligibleCount != 0 || zeroPage.HasMore || len(zeroPage.Items) != 0 {
		t.Fatalf("zeroPage %+v, want PageIndex: 0, TotalEligibleCount: 0, HasMore: false, Items: empty", zeroPage)
	}
	tracer.assertSingleSelect(t, wantSQL)

	tracer.reset()
	zeroPage1, err := module.Run(ctx, SubstituteInput{FoodObjectID: 95, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 1)
	if zeroPage1 != nil {
		t.Fatalf("Run(zero input, page 1) returned page %+v, want CodePageOutOfRange", zeroPage1)
	}
	assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
	tracer.assertSingleSelect(t, wantSQL)
}
