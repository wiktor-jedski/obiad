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

// Code values specific to the concrete Find Substitute Page Module
// (ARCH-005). The stable codes map to the ISSUE-005-resolved HTTP error
// responses; the Fiber Adapter never exposes an internal cause. The
// suggestion-specific codes (CodeInvalidSearchQuery, CodeQueryTooLong,
// CodeUnsupportedLanguage) live beside the Suggest Module, and the shared
// catalog codes (CodeCatalogUnavailable, CodeInternalError) serve both
// operations.
const (
	// CodeFoodObjectNotFound reports an input Food Object ID that is absent
	// from the catalog (ISSUE-005: 404 FOOD_OBJECT_NOT_FOUND with field
	// foodObjectId).
	CodeFoodObjectNotFound Code = "FOOD_OBJECT_NOT_FOUND"
	// CodePageOutOfRange reports a page index outside the supported page-0
	// range. Every nonzero page is out of range until Phase 11 adds valid
	// later-page behavior (ISSUE-005: 422 PAGE_OUT_OF_RANGE with field
	// pageIndex); Phase 4 task 18 completes the page classification by
	// distinguishing negative pages as INVALID_PAGE_INDEX.
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

// SubstituteItem is one ranked eligible Substitute (ARCH-005, ARCH-018): the
// stable Food Object ID, both localized names, the optional image key, the
// unrounded Matched Quantity in the candidate base unit, the unrounded
// protein, carbohydrate, and fat scaled to that Matched Quantity, and the
// unrounded Nutritional Similarity as a fraction of one. Every calculation
// stays in float64 until Phase 4 task 17 completes the display projection
// (rounding Matched Quantity, macronutrients, and similarity) without
// changing candidate eligibility or order.
type SubstituteItem struct {
	FoodObjectID    int32
	Names           LocalizedNames
	ImageKey        *string
	MatchedQuantity float64
	Protein         float64
	Carbohydrate    float64
	Fat             float64
	Similarity      float64
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
// Quantity; Phase 4 task 17 rounds it for display.
func matchedQuantity(inputCalories, candidateCaloriesPer100 float64) float64 {
	return inputCalories * 100 / candidateCaloriesPer100
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

// baseQuantity converts one Substitution Input Food Quantity to its base
// unit (ARCH-018): a direct gram or millilitre value is used as-is, and a
// Serving count multiplies the Food Object's Serving base quantity. The
// request is assumed valid; Phase 4 task 18 completes the validation gates
// (positive direct integers, unit-to-Physical-State match, available
// Serving, and the 100,000 g / 100,000 ml converted-value limit). The
// conversion is defensive and reports an error instead of panicking when
// the catalog lacks the Serving a Serving count requires.
func baseQuantity(object foodObject, q FoodQuantity) (float64, error) {
	switch q.Unit {
	case UnitServing:
		if object.serving == nil {
			return 0, fmt.Errorf("food object %d has no Serving for a serving-count quantity", object.id)
		}
		return q.Value * *object.serving, nil
	case UnitGram, UnitMillilitre:
		return q.Value, nil
	default:
		return 0, fmt.Errorf("food quantity unit %q is not g, ml, or serving", q.Unit)
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

// Run implements the Find Substitute Page operation (ARCH-005, ARCH-018)
// for a valid page-0 request: it converts the Substitution Input Food
// Quantity to its base unit, derives the input calories as 4p + 4c + 9f,
// performs one fresh catalog read through the Catalog Loader, excludes the
// input and its Food Family, orders the eligible Substitutes by decreasing
// unrounded Nutritional Similarity, the pinned English collation of the
// stored English names, and stable Food Object ID, and returns the total
// eligible count, hasMore, and the first zero to three unique items. Every
// calculation stays in float64 until Phase 4 task 17 completes the display
// projection. A schema-valid finite Macro Profile whose derived calories,
// similarity, Matched Quantity, or scaled macronutrients are not finite is
// classified as an internal failure at the Module boundary instead of
// reaching a page or the ranking order. Failures are stable Error values
// with a Code and an optional Field.
func (f *FindSubstitutePage) Run(ctx context.Context, input SubstituteInput, pageIndex int32) (*Page, error) {
	if pageIndex != 0 {
		return nil, &Error{
			Code:  CodePageOutOfRange,
			Field: "pageIndex",
			cause: fmt.Errorf("page index %d is out of range: only page 0 exists until Phase 11", pageIndex),
		}
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
		return nil, &Error{Code: CodeInternalError, cause: err}
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
		page.Items = append(page.Items, SubstituteItem{
			FoodObjectID:    r.object.id,
			Names:           r.object.names,
			ImageKey:        r.object.imageKey,
			MatchedQuantity: mq,
			Protein:         protein,
			Carbohydrate:    carbohydrate,
			Fat:             fat,
			Similarity:      r.similarity,
		})
	}
	return page, nil
}
