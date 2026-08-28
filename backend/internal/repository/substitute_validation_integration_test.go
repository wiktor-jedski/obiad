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
		id        int32
		wantCount int
	}{
		{"Pizza Margherita", 1, 36},
		{"Chicken breast", 5, 37},
		{"Milk", 10, 37},
	}
	for _, tc := range accepted {
		t.Run("accept "+tc.name, func(t *testing.T) {
			tracer.reset()
			page, err := module.Run(ctx, tc.id, 0)
			if err != nil {
				t.Fatalf("Run(%d, page 0): %v", tc.id, err)
			}
			if page.TotalEligibleCount != tc.wantCount {
				t.Fatalf("input %d: total eligible count %d, want %d", tc.id, page.TotalEligibleCount, tc.wantCount)
			}
			tracer.assertSingleSelect(t, wantSQL)
		})
	}

	preLoad := []struct {
		name      string
		id        int32
		pageIndex int32
		wantCode  Code
		wantField string
	}{
		{"nonpositive Food Object ID", 0, 0, CodeInvalidRequest, "foodObjectId"},
		{"negative Food Object ID", -7, 0, CodeInvalidRequest, "foodObjectId"},
		{"negative page index", 5, -1, CodeInvalidPageIndex, "pageIndex"},
	}
	for _, tc := range preLoad {
		t.Run("reject "+tc.name, func(t *testing.T) {
			tracer.reset()
			page, err := module.Run(ctx, tc.id, tc.pageIndex)
			if page != nil {
				t.Fatalf("Run(%d, page %d) returned a page, want the stable failure %s with field %q",
					tc.id, tc.pageIndex, tc.wantCode, tc.wantField)
			}
			assertStableFailure(t, err, tc.wantCode, tc.wantField)
			if len(tracer.stmts) != 0 {
				t.Fatalf("catalog-independent rejection executed %d statements, want zero before the catalog read", len(tracer.stmts))
			}
		})
	}

	postLoad := []struct {
		name      string
		id        int32
		pageIndex int32
		wantCode  Code
		wantField string
	}{
		{"absent positive Food Object ID", 999999, 0, CodeFoodObjectNotFound, "foodObjectId"},
		{"first page after last page for Pizza Margherita (36 candidates)", 1, 12, CodePageOutOfRange, "pageIndex"},
		{"math.MaxInt32 page for Pizza Margherita", 1, math.MaxInt32, CodePageOutOfRange, "pageIndex"},
		{"first page after last page for Chicken breast (37 candidates)", 5, 13, CodePageOutOfRange, "pageIndex"},
		{"math.MaxInt32 page for Chicken breast", 5, math.MaxInt32, CodePageOutOfRange, "pageIndex"},
		{"first page after last page for Milk (37 candidates)", 10, 13, CodePageOutOfRange, "pageIndex"},
		{"math.MaxInt32 page for Milk", 10, math.MaxInt32, CodePageOutOfRange, "pageIndex"},
	}
	for _, tc := range postLoad {
		t.Run("reject "+tc.name, func(t *testing.T) {
			tracer.reset()
			page, err := module.Run(ctx, tc.id, tc.pageIndex)
			if page != nil {
				t.Fatalf("Run(%d, page %d) returned a page, want the stable failure %s with field %q", tc.id, tc.pageIndex, tc.wantCode, tc.wantField)
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
	zeroPage, err := module.Run(ctx, 95, 0)
	if err != nil {
		t.Fatalf("Run(zero input, page 0) failed: %v", err)
	}
	if zeroPage.PageIndex != 0 || zeroPage.TotalEligibleCount != 0 || zeroPage.HasMore || len(zeroPage.Items) != 0 {
		t.Fatalf("zeroPage %+v, want PageIndex: 0, TotalEligibleCount: 0, HasMore: false, Items: empty", zeroPage)
	}
	tracer.assertSingleSelect(t, wantSQL)

	tracer.reset()
	zeroPage1, err := module.Run(ctx, 95, 1)
	if zeroPage1 != nil {
		t.Fatalf("Run(zero input, page 1) returned page %+v, want CodePageOutOfRange", zeroPage1)
	}
	assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
	tracer.assertSingleSelect(t, wantSQL)
}
