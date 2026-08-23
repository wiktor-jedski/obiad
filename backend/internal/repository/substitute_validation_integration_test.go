package repository

// Integration test for Phase 4 (task 18) and Phase 11 (task 36): the Find
// Substitute Page input validation and stable Module failures (ARCH-005,
// ARCH-006, ARCH-008, ARCH-018, ARCH-022, P04-G4, P11-G1). It requires a
// real PostgreSQL server: it reuses the shared task-16 fixture
// setupSubstituteFixture, which creates an isolated disposable database plus
// the schema-owner, SELECT-only runtime, and unprivileged login roles through
// the shared testdb support, runs the real setup command against it, grants
// the runtime catalog read through the same embedded privilege SQL the local
// deployment setup applies, connects the SELECT-only runtime credential with
// a statement tracer, and builds a Find Substitute Page Module over that
// connection.
//
// The test proves the accepted inputs — positive integer direct g and ml
// values, dot-decimal Serving counts, both 100,000 g / 100,000 ml
// converted-value boundaries (including a Serving conversion that lands
// exactly on the limit and a tiny positive converted value), and page 0
// for zero eligible Substitutes — and the exact ISSUE-005 stable failures
// for nonpositive, fractional, or nonfinite base values, unsupported units,
// invalid Serving values, Physical State unit mismatch, missing Serving,
// over-limit converted values, a converted value that underflows to zero,
// nonpositive or absent Food Object IDs, negative pages, and out-of-range
// nonzero pages (including the first page after the last page and
// math.MaxInt32). A per-request statement tracer proves no retry and at most
// one fresh SELECT: catalog-independent request failures (negative page
// index, Food Object ID, quantity value or unit) are rejected before any
// catalog read and record zero statements; object-dependent failures (absent
// ID, unit mismatch, unavailable Serving, converted-value range, page out of
// range) record exactly one fresh embedded SELECT and no second read; and
// every accepted request records exactly one fresh embedded SELECT. No fake
// Adapter, exported seam, or test hook is added: the test sits in the same
// package. The admin connection comes from OBIAD_TEST_ADMIN_DATABASE_URL or
// from libpq-style environment variables; no credential is committed and
// tests skip when no server is reachable.
import (
	"context"
	"errors"
	"math"
	"testing"
)

// assertStableFailure checks that Run returned exactly the expected stable
// Module failure: the ISSUE-005 code and the exact field path, with no page
// result and no other failure type.
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

// TestFindSubstitutePageValidationIntegration exercises the concrete Find
// Substitute Page validation and stable failures against real PostgreSQL
// through the SELECT-only runtime credential (P04-G4). Designated seeded
// inputs: Pizza Margherita (ID 1, solid, Serving 350 g, 36 eligible),
// Chicken breast (ID 5, solid, no Serving, 37 eligible), Milk (ID 10,
// liquid, no Serving, 37 eligible), Polish chicken soup (ID 17, liquid,
// Serving 300 ml, 37 eligible), and Coleslaw (ID 32, solid, Serving 100 g,
// 37 eligible).
func TestFindSubstitutePageValidationIntegration(t *testing.T) {
	_, module, tracer, wantSQL, owner := setupSubstituteFixture(t)
	ctx := context.Background()

	// Accepted inputs: positive integer direct g and ml values, dot-decimal
	// Serving counts, and both converted-value boundaries (ARCH-018,
	// REQ-025). Each accepted request performs exactly one fresh embedded
	// SELECT and no retry. The boundary cases prove 100,000 g and
	// 100,000 ml are accepted, and the Coleslaw case proves a Serving
	// conversion landing exactly on the 100,000 g limit (1000 × 100 g) is
	// accepted.
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

	// Converted-value lower bound (ARCH-018: the converted base quantity
	// must be strictly positive and finite). The schema owner inserts an
	// isolated artificial fixture — a schema-valid tiny stored Serving of
	// 1e-4 on Food Object 39 — that the production seed never contains
	// (ISSUE-002, ARCH-018 quality constraints). The value is small enough
	// that a smallest-subnormal Serving count times it underflows to exactly
	// zero, yet large enough to satisfy the ISSUE-010 Serving invariant
	// (the whole-number maximum floor(100000 / 1e-4) = 1000000000 fits the
	// int32 display range), so the row passes the Catalog Loader and reaches
	// the converted-value guard. The underflowed zero product must be
	// classified as the ISSUE-005 stable INVALID_QUANTITY with field
	// quantity.value (a nonpositive base quantity) after exactly one fresh
	// SELECT instead of returning a false successful zero-quantity page. A
	// Serving count of 1 against the same fixture converts to 1e-4
	// (strictly positive), proving the guard rejects only the underflowed
	// zero product, not every tiny converted value.
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

	// Catalog-independent failures: rejected before the single catalog read,
	// recording zero statements (no read at all, no retry). These cover the
	// nonpositive Food Object ID, negative page, every nonzero page, and
	// the value/unit rules that need no catalog data: nonpositive,
	// fractional, or nonfinite (NaN, +Inf, -Inf) direct base values,
	// unsupported units, and invalid (nonpositive or nonfinite) Serving
	// values.
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

	// Object-dependent failures: rejected after the single fresh catalog
	// read, recording exactly one embedded SELECT and no second read, no
	// retry. These cover the absent positive Food Object ID, the
	// unit-to-Physical-State mismatch, the unavailable Serving, and the
	// over-limit converted values (direct, Serving-converted, and
	// dot-decimal Serving-converted, for both solids and liquids).
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

	// Zero-result contract: page 0 remains valid when zero eligible Substitutes
	// exist, while nonzero pages return PAGE_OUT_OF_RANGE with pageIndex.
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
