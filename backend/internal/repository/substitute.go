package repository

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// pageSize is the number of unique Substitute items one page returns
// (ARCH-005, ARCH-018): pages slice the eligible list in groups of three.
const pageSize = 3

// maxBaseQuantity is the largest accepted converted base-unit quantity of a
// Substitution Input (ARCH-018): at most 100,000 g or 100,000 ml.
const maxBaseQuantity = 100000

// Code values specific to the concrete Find Substitute Page Module
// (ARCH-005). The stable codes map to the ISSUE-005-resolved HTTP error
// responses; the Fiber Adapter never exposes an internal cause. The
// suggestion-specific codes (CodeInvalidSearchQuery, CodeQueryTooLong,
// CodeUnsupportedLanguage) live beside the Suggest Module, and the shared
// catalog codes (CodeCatalogUnavailable, CodeInternalError) serve both
// operations.
const (
	// CodeInvalidRequest reports a nonpositive input Food Object ID
	// (ISSUE-005: 400 INVALID_REQUEST with field foodObjectId).
	CodeInvalidRequest Code = "INVALID_REQUEST"
	// CodeInvalidQuantity reports a nonpositive or nonintegral direct gram
	// or millilitre value or a nonpositive Serving count (field
	// quantity.value) or an unsupported unit (field quantity.unit)
	// (ISSUE-005: 422 INVALID_QUANTITY).
	CodeInvalidQuantity Code = "INVALID_QUANTITY"
	// CodeQuantityUnitMismatch reports a direct gram or millilitre unit
	// that does not match the input Food Object Physical State (ISSUE-005:
	// 422 QUANTITY_UNIT_MISMATCH with field quantity.unit).
	CodeQuantityUnitMismatch Code = "QUANTITY_UNIT_MISMATCH"
	// CodeServingUnavailable reports a Serving count for a Food Object that
	// has no stored Serving (ISSUE-005: 422 SERVING_UNAVAILABLE with field
	// quantity.unit).
	CodeServingUnavailable Code = "SERVING_UNAVAILABLE"
	// CodeQuantityOutOfRange reports a converted base quantity over
	// 100,000 g or 100,000 ml (ISSUE-005: 422 QUANTITY_OUT_OF_RANGE with
	// field quantity.value).
	CodeQuantityOutOfRange Code = "QUANTITY_OUT_OF_RANGE"
	// CodeInvalidPageIndex reports a negative page index (ISSUE-005: 422
	// INVALID_PAGE_INDEX with field pageIndex).
	CodeInvalidPageIndex Code = "INVALID_PAGE_INDEX"
	// CodeFoodObjectNotFound reports an input Food Object ID that is absent
	// from the catalog (ISSUE-005: 404 FOOD_OBJECT_NOT_FOUND with field
	// foodObjectId).
	CodeFoodObjectNotFound Code = "FOOD_OBJECT_NOT_FOUND"
	// CodePageOutOfRange reports a nonzero page index. Every nonzero page
	// is out of range until Phase 11 adds valid later-page behavior
	// (ISSUE-005: 422 PAGE_OUT_OF_RANGE with field pageIndex); a negative
	// page is the separate CodeInvalidPageIndex failure.
	CodePageOutOfRange Code = "PAGE_OUT_OF_RANGE"
)

// FoodQuantity is an amount of a Food Object expressed in grams,
// millilitres, or servings (CONTEXT.md nutrition glossary). A direct gram or
// millilitre value is a positive integer; a Serving count can be fractional
// and multiplies the Food Object Serving base quantity (ARCH-018). The
// generated transport values never enter the Module: the Fiber Adapter maps
// them to this domain value at the HTTP boundary.
type FoodQuantity struct {
	Value float64
	Unit  Unit
}

// SubstituteInput is a Substitution Input (CONTEXT.md glossary): one Food
// Object and one Food Quantity supplied to a Substitution Search. The
// input's Macro Profile, Physical State, Serving, and Food Family come from
// the catalog snapshot the Catalog Loader reads for the operation.
type SubstituteInput struct {
	FoodObjectID int32
	Quantity     FoodQuantity
}

// MatchedQuantity is one Substitute's display-projected equal-calorie
// amount (REQ-031, REQ-038): a whole value in the candidate base unit —
// grams for a solid candidate, millilitres for a liquid candidate
// (ARCH-013, ARCH-018). The value and unit are the final projection of the
// full-precision Matched Quantity; candidate eligibility and order never
// depend on them (REQ-040).
type MatchedQuantity struct {
	Value int64
	Unit  Unit
}

// SubstituteItem is one ranked eligible Substitute after the final display
// projection (ARCH-005, ARCH-018, REQ-039): the stable Food Object ID, both
// localized names, the optional image key, the whole Matched Quantity in
// the candidate base unit, the protein, carbohydrate, and fat scaled to the
// unrounded Matched Quantity and rounded to 0.1 g, and the whole similarity
// percentage. Every ranking and calculation stays in float64 until this
// projection; candidate eligibility and order never depend on the rounded
// values (REQ-040).
type SubstituteItem struct {
	FoodObjectID      int32
	Names             LocalizedNames
	ImageKey          *string
	MatchedQuantity   MatchedQuantity
	Protein           float64
	Carbohydrate      float64
	Fat               float64
	SimilarityPercent int32
}

// Page is one deterministic page of display-ready Substitutes (ARCH-005):
// the requested zero-based page index, the total eligible count, whether
// more eligible Substitutes follow, and at most pageSize unique items.
type Page struct {
	PageIndex          int32
	TotalEligibleCount int
	HasMore            bool
	Items              []SubstituteItem
}

// macroProfile is one Food Object's protein, carbohydrate, and fat
// composition (CONTEXT.md nutrition glossary). Calories are derived from
// this profile but are not part of it (ARCH-013, REQ-029).
type macroProfile struct {
	protein      float64
	carbohydrate float64
	fat          float64
}

// calories derives the ARCH-018 calorie value 4p + 4c + 9f of one Macro
// Profile, expressed per Nutrition Basis (REQ-029): 100 g for a solid and
// 100 ml for a liquid.
func calories(p macroProfile) float64 {
	return 4*p.protein + 4*p.carbohydrate + 9*p.fat
}

// cosineSimilarity computes the Nutritional Similarity of two Macro
// Profiles as the cosine of the angle between their protein, carbohydrate,
// and fat vectors (ARCH-018, REQ-030): dot(a, b) / (|a| |b|). The result is
// the full-precision float64 value; ranking compares unrounded values and
// never applies a tolerance (ISSUE-005: the absolute 1e-12 tolerance is a
// test comparison only).
func cosineSimilarity(a, b macroProfile) float64 {
	dot := a.protein*b.protein + a.carbohydrate*b.carbohydrate + a.fat*b.fat
	normA := math.Sqrt(a.protein*a.protein + a.carbohydrate*a.carbohydrate + a.fat*a.fat)
	normB := math.Sqrt(b.protein*b.protein + b.carbohydrate*b.carbohydrate + b.fat*b.fat)
	return dot / (normA * normB)
}

// matchedQuantity computes the candidate base-unit amount whose derived
// calories equal the Substitution Input's total derived calories (ARCH-018,
// REQ-031): mq = inputCalories × 100 / candidateCaloriesPer100, where
// inputCalories is the input's total calorie value at its converted base
// quantity and candidateCaloriesPer100 is the candidate's calories per
// Nutrition Basis. The result stays the full-precision float64 Matched
// Quantity; the final display projection rounds it.
func matchedQuantity(inputCalories, candidateCaloriesPer100 float64) float64 {
	return inputCalories * 100 / candidateCaloriesPer100
}

// roundHalfUp returns the nearest whole number to v, rounding exact
// nonnegative halves up (REQ-039, ARCH-018): 0.5 becomes 1, 1.5 becomes 2,
// and 0.49999999999999994 becomes 0. Every value it receives is
// nonnegative — Matched Quantities, scaled macronutrients, and similarities
// never go below zero — so math.Round's half-away-from-zero rule is exactly
// half-up here. It is the single rounding primitive of the final display
// projection.
func roundHalfUp(v float64) float64 {
	return math.Round(v)
}

// projectMatchedQuantity rounds the full-precision Matched Quantity to a
// whole candidate base unit and attaches that unit — g for a solid
// candidate, ml for a liquid candidate (ARCH-013 Nutrition Basis, REQ-038,
// REQ-039): 437.5 g becomes 438 g and 437.49999999999994 g becomes 437 g.
// A positive value can display as zero. The whole value must fit the int64
// display range; a schema-valid extreme input whose equal-calorie amount
// exceeds it is a Module failure, never a wrapped or overflowed display
// value.
func projectMatchedQuantity(mq float64, state physicalState) (MatchedQuantity, error) {
	whole := roundHalfUp(mq)
	if whole >= float64(math.MaxInt64) {
		return MatchedQuantity{}, fmt.Errorf("whole Matched Quantity %v exceeds the int64 display range", mq)
	}
	unit := UnitGram
	if state == stateLiquid {
		unit = UnitMillilitre
	}
	return MatchedQuantity{Value: int64(whole), Unit: unit}, nil
}

// projectMacronutrient rounds one macronutrient amount, already scaled to
// the unrounded Matched Quantity, to 0.1 g (REQ-039, ARCH-018): 8.75 g
// becomes 8.8 g and 0.04 g becomes 0.0 g, so a positive amount can display
// as zero. The rounding happens once, in this final projection, never
// before the scaling.
func projectMacronutrient(amount float64) float64 {
	return roundHalfUp(amount*10) / 10
}

// projectSimilarityPercent rounds 100 × the full-precision Nutritional
// Similarity to a whole percentage (REQ-039, ARCH-018): 0.505 becomes 51
// and 0.5049999999999999 becomes 50. The similarity itself stays unrounded
// until this projection.
func projectSimilarityPercent(similarity float64) int32 {
	return int32(roundHalfUp(similarity * 100))
}

// isFiniteDerived reports whether one derived calculation result is a finite
// float64. The ARCH-013 source schema accepts the largest finite double and
// the smallest positive subnormal as Macro Profile values, and the derived
// arithmetic over or under those values (for example 4×DBL_MAX becomes
// +Inf, and a subnormal norm underflows to a zero denominator), so Run
// classifies every nonfinite derived value as an internal failure at the
// Module boundary instead of returning it in a page or ordering by it.
func isFiniteDerived(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

// validateQuantityValue enforces the catalog-independent Food Quantity
// syntax rules of the Find Substitute Page Module (ARCH-018, REQ-025): the
// unit must be g, ml, or serving; a direct gram or millilitre value must be
// a positive integer; and a Serving count must be positive and may be
// fractional. Failures are the ISSUE-005 stable INVALID_QUANTITY code with
// field quantity.value for a nonpositive or nonintegral direct value or a
// nonpositive Serving count, and field quantity.unit for an unsupported
// unit. The unit-to-Physical-State match, the stored-Serving requirement,
// and the converted-value limit depend on the catalog Food Object and are
// enforced by baseQuantity after the single catalog read.
func validateQuantityValue(q FoodQuantity) error {
	switch q.Unit {
	case UnitGram, UnitMillilitre:
		if !isPositiveInteger(q.Value) {
			return &Error{
				Code:  CodeInvalidQuantity,
				Field: "quantity.value",
				cause: fmt.Errorf("direct %s quantity %v must be a positive integer", q.Unit, q.Value),
			}
		}
	case UnitServing:
		if !isPositiveFinite(q.Value) {
			return &Error{
				Code:  CodeInvalidQuantity,
				Field: "quantity.value",
				cause: fmt.Errorf("serving count %v must be positive", q.Value),
			}
		}
	default:
		return &Error{
			Code:  CodeInvalidQuantity,
			Field: "quantity.unit",
			cause: fmt.Errorf("food quantity unit %q is not g, ml, or serving", q.Unit),
		}
	}
	return nil
}

// isPositiveInteger reports whether v is a positive finite whole number: a
// direct gram or millilitre value must satisfy it (ARCH-018, REQ-025). NaN
// and infinities are rejected because they are neither positive nor whole.
func isPositiveInteger(v float64) bool {
	return isPositiveFinite(v) && v == math.Trunc(v)
}

// baseQuantity validates one Substitution Input Food Quantity against the
// input Food Object and converts it to its base unit (ARCH-018): a direct
// gram or millilitre unit must match the Food Object Physical State (g for
// a solid, ml for a liquid), a Serving count requires a stored Serving and
// multiplies its base quantity, and the converted base quantity must be
// strictly positive and finite and at most 100,000 g or 100,000 ml.
// Failures are the ISSUE-005 stable errors: QUANTITY_UNIT_MISMATCH with
// field quantity.unit for a direct unit that does not match the Physical
// State, SERVING_UNAVAILABLE with field quantity.unit for a Serving count
// without a stored Serving, INVALID_QUANTITY with field quantity.value for
// a converted base quantity that is not a positive finite number (a
// subnormal Serving count times a subnormal stored Serving can underflow to
// exactly zero), and QUANTITY_OUT_OF_RANGE with field quantity.value for a
// converted base quantity over the 100,000 limit. Run validates the page
// index, the Food Object ID, and the catalog-independent quantity syntax
// before the single catalog read, so the default branch below is
// unreachable for a request that passed validateQuantityValue; it still
// returns a stable error instead of panicking.
func baseQuantity(object foodObject, q FoodQuantity) (float64, error) {
	switch q.Unit {
	case UnitServing:
		if object.serving == nil {
			return 0, &Error{
				Code:  CodeServingUnavailable,
				Field: "quantity.unit",
				cause: fmt.Errorf("food object %d has no stored Serving for a Serving-count quantity", object.id),
			}
		}
		converted := q.Value * *object.serving
		if converted <= 0 || math.IsNaN(converted) {
			// ARCH-018 requires the converted base quantity to be strictly
			// greater than zero. Both factors are positive finite by the
			// pre-load and catalog invariants, so a nonpositive product can
			// only be the exact zero of a subnormal Serving count times a
			// subnormal stored Serving; it must not reach the page as a
			// false successful zero-quantity result. ISSUE-005 classifies a
			// nonpositive base quantity as INVALID_QUANTITY with field
			// quantity.value.
			return 0, &Error{
				Code:  CodeInvalidQuantity,
				Field: "quantity.value",
				cause: fmt.Errorf("converted base quantity %v is not a positive finite number", converted),
			}
		}
		if converted > maxBaseQuantity {
			return 0, &Error{
				Code:  CodeQuantityOutOfRange,
				Field: "quantity.value",
				cause: fmt.Errorf("converted base quantity %v exceeds the %d base-unit limit", converted, maxBaseQuantity),
			}
		}
		return converted, nil
	case UnitGram:
		if object.physicalState != stateSolid {
			return 0, &Error{
				Code:  CodeQuantityUnitMismatch,
				Field: "quantity.unit",
				cause: fmt.Errorf("gram quantity for food object %d whose Physical State is %q", object.id, object.physicalState),
			}
		}
		if q.Value > maxBaseQuantity {
			return 0, &Error{
				Code:  CodeQuantityOutOfRange,
				Field: "quantity.value",
				cause: fmt.Errorf("direct %s quantity %v exceeds the %d g limit", q.Unit, q.Value, maxBaseQuantity),
			}
		}
		return q.Value, nil
	case UnitMillilitre:
		if object.physicalState != stateLiquid {
			return 0, &Error{
				Code:  CodeQuantityUnitMismatch,
				Field: "quantity.unit",
				cause: fmt.Errorf("millilitre quantity for food object %d whose Physical State is %q", object.id, object.physicalState),
			}
		}
		if q.Value > maxBaseQuantity {
			return 0, &Error{
				Code:  CodeQuantityOutOfRange,
				Field: "quantity.value",
				cause: fmt.Errorf("direct %s quantity %v exceeds the %d ml limit", q.Unit, q.Value, maxBaseQuantity),
			}
		}
		return q.Value, nil
	default:
		return 0, &Error{
			Code:  CodeInvalidQuantity,
			Field: "quantity.unit",
			cause: fmt.Errorf("food quantity unit %q is not g, ml, or serving", q.Unit),
		}
	}
}

// rankedSubstitute is one eligible candidate before slicing: the Food
// Object, its Macro Profile, its unrounded Nutritional Similarity to the
// Substitution Input, and its stored English name (the pinned collation
// key).
type rankedSubstitute struct {
	object     foodObject
	profile    macroProfile
	similarity float64
	enName     string
}

// rankEligible returns every eligible Substitution candidate ordered by
// decreasing unrounded Nutritional Similarity, the ISSUE-004-pinned English
// collation of the stored English names (collate.New(language.English), no
// options), and stable Food Object ID (ARCH-018, REQ-034, REQ-035). The
// collator distinguishes case and whitespace in the stored names — the
// substitute tie rule does not normalize them; only the Suggest operation
// applies its query normalizer (ISSUE-004). The Substitution Input itself
// (REQ-032) and every other member of its Food Family (REQ-033) are
// excluded. Similarities are the full-precision float64 values; no tolerance
// is used as a tie or ranking threshold (ISSUE-005). A schema-valid extreme
// Macro Profile whose cosine or derived calories are not finite is reported
// as an error so a NaN or infinite similarity can never enter the strict
// ordering and an infinite candidate calorie value can never reach the
// Matched Quantity calculation.
func rankEligible(inputID int32, inputFamily *int32, inputProfile macroProfile, objects []foodObject) ([]rankedSubstitute, error) {
	collator := collate.New(language.English)
	rankedList := make([]rankedSubstitute, 0, len(objects))
	for _, object := range objects {
		if object.id == inputID {
			continue
		}
		if inputFamily != nil && object.foodFamilyID != nil && *object.foodFamilyID == *inputFamily {
			continue
		}
		profile := macroProfile{protein: object.protein, carbohydrate: object.carbohydrate, fat: object.fat}
		similarity := cosineSimilarity(inputProfile, profile)
		if !isFiniteDerived(similarity) {
			return nil, fmt.Errorf("food object %d: Nutritional Similarity %v is not finite for the seeded Macro Profile", object.id, similarity)
		}
		if candidateCalories := calories(profile); !isFiniteDerived(candidateCalories) {
			return nil, fmt.Errorf("food object %d: derived calories %v are not finite for the seeded Macro Profile", object.id, candidateCalories)
		}
		rankedList = append(rankedList, rankedSubstitute{
			object:     object,
			profile:    profile,
			similarity: similarity,
			enName:     object.names.En,
		})
	}
	sort.Slice(rankedList, func(i, j int) bool {
		a, b := rankedList[i], rankedList[j]
		if a.similarity != b.similarity {
			return a.similarity > b.similarity
		}
		if compared := collator.CompareString(a.enName, b.enName); compared != 0 {
			return compared < 0
		}
		return a.object.id < b.object.id
	})
	return rankedList, nil
}

// FindSubstitutePage is the concrete Find Substitute Page Module (ARCH-005).
// Its one Run operation accepts a Substitution Input and a zero-based page
// index and returns the requested page of display-ready Substitutes or one
// stable failure. The Module ranks the request-local catalog snapshot loaded
// through the private Catalog Loader (ARCH-006): one fresh embedded SELECT
// per operation, no runtime cache, no retry. The Module exposes no Go
// interface, repository port, ranking policy, or test Adapter, and no
// generated transport value enters the Module.
type FindSubstitutePage struct {
	loader *loader
}

// NewFindSubstitutePage returns a Find Substitute Page Module that loads
// every request-local catalog snapshot through conn.
func NewFindSubstitutePage(conn *pgx.Conn) (*FindSubstitutePage, error) {
	l, err := newLoader(conn)
	if err != nil {
		return nil, err
	}
	return &FindSubstitutePage{loader: l}, nil
}

// Run implements the Find Substitute Page operation (ARCH-005, ARCH-018):
// it validates the Food Object ID, the page index, and the catalog-
// independent Food Quantity syntax, performs one fresh catalog read through
// the Catalog Loader, resolves the Substitution Input Food Object, enforces
// the unit-to-Physical-State match, the stored-Serving requirement, and the
// 100,000 g / 100,000 ml converted-value limit, converts the Food Quantity
// to its base unit, derives the input calories as 4p + 4c + 9f, excludes
// the input and its Food Family, orders the eligible Substitutes by
// decreasing unrounded Nutritional Similarity, the pinned English collation
// of the stored English names, and stable Food Object ID, and returns the
// total eligible count, hasMore, and the first zero to three unique items.
// Every ranking and calculation stays in float64 until the final display
// projection (REQ-040), which rounds the Matched Quantity to a whole
// candidate base unit, the scaled macronutrients to 0.1 g, and 100 ×
// similarity to a whole percentage (REQ-039). A schema-valid finite Macro
// Profile whose derived calories, similarity, Matched Quantity, or scaled
// macronutrients are not finite, or whose projected Matched Quantity does
// not fit the int64 display range, is classified as an internal failure at
// the Module boundary instead of reaching a page or the ranking order.
// Failures are stable Error values with a Code and an optional Field.
// Catalog-independent request failures (page index, Food Object ID,
// quantity value or unit) are rejected before the single catalog read, and
// object-dependent failures (absent ID, unit mismatch, unavailable Serving,
// converted-value limit) after it, so Run never reads the catalog twice and
// never retries.
func (f *FindSubstitutePage) Run(ctx context.Context, input SubstituteInput, pageIndex int32) (*Page, error) {
	if input.FoodObjectID <= 0 {
		return nil, &Error{
			Code:  CodeInvalidRequest,
			Field: "foodObjectId",
			cause: fmt.Errorf("food object ID %d must be positive", input.FoodObjectID),
		}
	}
	if pageIndex < 0 {
		return nil, &Error{
			Code:  CodeInvalidPageIndex,
			Field: "pageIndex",
			cause: fmt.Errorf("page index %d must be nonnegative", pageIndex),
		}
	}
	if pageIndex != 0 {
		return nil, &Error{
			Code:  CodePageOutOfRange,
			Field: "pageIndex",
			cause: fmt.Errorf("page index %d is out of range: only page 0 exists until Phase 11", pageIndex),
		}
	}
	if err := validateQuantityValue(input.Quantity); err != nil {
		return nil, err
	}
	objects, err := f.loader.load(ctx)
	if err != nil {
		var catalogErr *loadError
		if errors.As(err, &catalogErr) && catalogErr.kind == kindStorage {
			return nil, &Error{Code: CodeCatalogUnavailable, cause: err}
		}
		return nil, &Error{Code: CodeInternalError, cause: err}
	}

	var inputObject *foodObject
	for i := range objects {
		if objects[i].id == input.FoodObjectID {
			inputObject = &objects[i]
			break
		}
	}
	if inputObject == nil {
		return nil, &Error{
			Code:  CodeFoodObjectNotFound,
			Field: "foodObjectId",
			cause: fmt.Errorf("food object %d is absent from the catalog", input.FoodObjectID),
		}
	}
	baseQty, err := baseQuantity(*inputObject, input.Quantity)
	if err != nil {
		return nil, err
	}

	inputProfile := macroProfile{protein: inputObject.protein, carbohydrate: inputObject.carbohydrate, fat: inputObject.fat}
	inputCalories := calories(inputProfile) * baseQty / 100
	if !isFiniteDerived(inputCalories) {
		return nil, &Error{
			Code:  CodeInternalError,
			cause: fmt.Errorf("input calories %v are not finite for the seeded Macro Profile", inputCalories),
		}
	}
	ranked, err := rankEligible(inputObject.id, inputObject.foodFamilyID, inputProfile, objects)
	if err != nil {
		return nil, &Error{Code: CodeInternalError, cause: err}
	}

	total := len(ranked)
	page := &Page{
		PageIndex:          pageIndex,
		TotalEligibleCount: total,
		HasMore:            total > pageSize,
		Items:              make([]SubstituteItem, 0, pageSize),
	}
	for _, r := range ranked[:min(pageSize, total)] {
		mq := matchedQuantity(inputCalories, calories(r.profile))
		protein := r.profile.protein * mq / 100
		carbohydrate := r.profile.carbohydrate * mq / 100
		fat := r.profile.fat * mq / 100
		if !isFiniteDerived(mq) || !isFiniteDerived(protein) || !isFiniteDerived(carbohydrate) || !isFiniteDerived(fat) {
			return nil, &Error{
				Code: CodeInternalError,
				cause: fmt.Errorf("food object %d: Matched Quantity %v or scaled macronutrients (%v, %v, %v) are not finite for the seeded Macro Profile",
					r.object.id, mq, protein, carbohydrate, fat),
			}
		}
		matched, err := projectMatchedQuantity(mq, r.object.physicalState)
		if err != nil {
			return nil, &Error{
				Code:  CodeInternalError,
				cause: fmt.Errorf("food object %d: %w", r.object.id, err),
			}
		}
		page.Items = append(page.Items, SubstituteItem{
			FoodObjectID:      r.object.id,
			Names:             r.object.names,
			ImageKey:          r.object.imageKey,
			MatchedQuantity:   matched,
			Protein:           projectMacronutrient(protein),
			Carbohydrate:      projectMacronutrient(carbohydrate),
			Fat:               projectMacronutrient(fat),
			SimilarityPercent: projectSimilarityPercent(r.similarity),
		})
	}
	return page, nil
}
