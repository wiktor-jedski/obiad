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

// pageSize is the number of results per page.
const pageSize = 3

// maxBaseQuantity is the largest accepted base-unit quantity.
const maxBaseQuantity = 100000

const (
	// CodeInvalidRequest identifies an invalid food object ID.
	CodeInvalidRequest Code = "INVALID_REQUEST"
	// CodeInvalidQuantity identifies an invalid quantity.
	CodeInvalidQuantity Code = "INVALID_QUANTITY"
	// CodeQuantityUnitMismatch identifies an incompatible unit.
	CodeQuantityUnitMismatch Code = "QUANTITY_UNIT_MISMATCH"
	// CodeServingUnavailable identifies a missing serving.
	CodeServingUnavailable Code = "SERVING_UNAVAILABLE"
	// CodeQuantityOutOfRange identifies an excessive quantity.
	CodeQuantityOutOfRange Code = "QUANTITY_OUT_OF_RANGE"
	// CodeInvalidPageIndex identifies a negative page index.
	CodeInvalidPageIndex Code = "INVALID_PAGE_INDEX"
	// CodeFoodObjectNotFound identifies an absent food object.
	CodeFoodObjectNotFound Code = "FOOD_OBJECT_NOT_FOUND"
	// CodePageOutOfRange identifies an unavailable page.
	CodePageOutOfRange Code = "PAGE_OUT_OF_RANGE"
)

// FoodQuantity is a food amount in a supported unit.
type FoodQuantity struct {
	// Value is the amount.
	Value float64
	// Unit identifies the amount unit.
	Unit Unit
}

// SubstituteInput identifies the food and quantity to replace.
type SubstituteInput struct {
	// FoodObjectID identifies the input food.
	FoodObjectID int32
	// Quantity is the input amount.
	Quantity FoodQuantity
}

// MatchedQuantity is the projected equal-calorie amount.
type MatchedQuantity struct {
	// Value is the projected amount.
	Value int64
	// Unit identifies the amount unit.
	Unit Unit
}

// SubstituteItem is one display-ready substitution.
type SubstituteItem struct {
	// FoodObjectID identifies the substitute.
	FoodObjectID int32
	// Names contains both localized names.
	Names LocalizedNames
	// ImageKey identifies the optional image.
	ImageKey *string
	// MatchedQuantity is the equal-calorie amount.
	MatchedQuantity MatchedQuantity
	// Protein is the displayed protein amount.
	Protein float64
	// Carbohydrate is the displayed carbohydrate amount.
	Carbohydrate float64
	// Fat is the displayed fat amount.
	Fat float64
	// Calories is the displayed calorie value.
	Calories int64
	// SimilarityPercent is the displayed similarity.
	SimilarityPercent int32
}

// Page contains one substitution result page.
type Page struct {
	// PageIndex is the requested zero-based page.
	PageIndex int32
	// TotalEligibleCount is the number of eligible items.
	TotalEligibleCount int
	// HasMore reports whether another page exists.
	HasMore bool
	// InputMacronutrients are the displayed input macros.
	InputMacronutrients Macronutrients
	// InputCalories is the displayed input calorie value.
	InputCalories int64
	// Items contains the page results.
	Items []SubstituteItem
}

// Macronutrients contains displayed macronutrient values.
type Macronutrients struct {
	// Protein is the displayed protein amount.
	Protein float64
	// Carbohydrate is the displayed carbohydrate amount.
	Carbohydrate float64
	// Fat is the displayed fat amount.
	Fat float64
}

// macroProfile stores source macronutrient values.
type macroProfile struct {
	protein      float64
	carbohydrate float64
	fat          float64
}

// calories derives calories from a macronutrient profile.
func calories(p macroProfile) float64 {
	return 4*p.protein + 4*p.carbohydrate + 9*p.fat
}

// cosineSimilarity computes full-precision profile similarity.
func cosineSimilarity(a, b macroProfile) float64 {
	dot := a.protein*b.protein + a.carbohydrate*b.carbohydrate + a.fat*b.fat
	normA := math.Sqrt(a.protein*a.protein + a.carbohydrate*a.carbohydrate + a.fat*a.fat)
	normB := math.Sqrt(b.protein*b.protein + b.carbohydrate*b.carbohydrate + b.fat*b.fat)
	return dot / (normA * normB)
}

// matchedQuantity computes the equal-calorie base amount.
func matchedQuantity(inputCalories, candidateCaloriesPer100 float64) float64 {
	return inputCalories * 100 / candidateCaloriesPer100
}

// projectMatchedQuantity rounds the final base amount.
func projectMatchedQuantity(mq float64, state physicalState) (MatchedQuantity, error) {
	whole := math.Round(mq)
	if whole >= float64(math.MaxInt64) {
		return MatchedQuantity{}, fmt.Errorf("whole Matched Quantity %v exceeds the int64 display range", mq)
	}
	unit := UnitGram
	if state == stateLiquid {
		unit = UnitMillilitre
	}
	return MatchedQuantity{Value: int64(whole), Unit: unit}, nil
}

// projectCalories rounds a derived calorie value.
func projectCalories(cal float64) (int64, error) {
	whole := math.Round(cal)
	if whole >= float64(math.MaxInt64) {
		return 0, fmt.Errorf("whole calories %v exceeds the int64 display range", cal)
	}
	return int64(whole), nil
}

// projectMacronutrient rounds one displayed macronutrient.
func projectMacronutrient(amount float64) float64 {
	return math.Round(amount*10) / 10
}

// projectSimilarityPercent rounds a similarity percentage.
func projectSimilarityPercent(similarity float64) int32 {
	return int32(math.Round(similarity * 100))
}

// isFiniteDerived rejects nonfinite calculated values.
func isFiniteDerived(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

// validateQuantityValue checks catalog-independent quantity syntax.
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

// isPositiveInteger reports whether v is a positive whole number.
func isPositiveInteger(v float64) bool {
	return isPositiveFinite(v) && v == math.Trunc(v)
}

// baseQuantity validates and converts the input quantity.
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

// rankedSubstitute stores an eligible candidate before paging.
type rankedSubstitute struct {
	object     foodObject
	profile    macroProfile
	similarity float64
	enName     string
}

// rankEligible excludes the input and its food family.
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

// FindSubstitutePage loads and ranks substitution results.
type FindSubstitutePage struct {
	loader *loader
}

// NewFindSubstitutePage creates a substitution module for conn.
func NewFindSubstitutePage(conn *pgx.Conn) (*FindSubstitutePage, error) {
	l, err := newLoader(conn)
	if err != nil {
		return nil, err
	}
	return &FindSubstitutePage{loader: l}, nil
}

// Run returns one requested substitution page.
// It validates input before loading one catalog snapshot.
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
	inputProjectedCalories, err := projectCalories(inputCalories)
	if err != nil {
		return nil, &Error{
			Code:  CodeInternalError,
			cause: fmt.Errorf("input: %w", err),
		}
	}
	inputProtein := inputProfile.protein * baseQty / 100
	inputCarbohydrate := inputProfile.carbohydrate * baseQty / 100
	inputFat := inputProfile.fat * baseQty / 100
	if !isFiniteDerived(inputProtein) || !isFiniteDerived(inputCarbohydrate) || !isFiniteDerived(inputFat) {
		return nil, &Error{
			Code:  CodeInternalError,
			cause: fmt.Errorf("input macronutrients (%v, %v, %v) are not finite for the seeded Macro Profile", inputProtein, inputCarbohydrate, inputFat),
		}
	}
	ranked, err := rankEligible(inputObject.id, inputObject.foodFamilyID, inputProfile, objects)
	if err != nil {
		return nil, &Error{Code: CodeInternalError, cause: err}
	}

	total := len(ranked)
	startIndex := int64(pageIndex) * pageSize
	if pageIndex > 0 && startIndex >= int64(total) {
		return nil, &Error{
			Code:  CodePageOutOfRange,
			Field: "pageIndex",
			cause: fmt.Errorf("page index %d is out of range for %d eligible substitutes", pageIndex, total),
		}
	}
	start := int(startIndex)
	end := min(start+pageSize, total)

	page := &Page{
		PageIndex:          pageIndex,
		TotalEligibleCount: total,
		HasMore:            end < total,
		InputMacronutrients: Macronutrients{
			Protein:      projectMacronutrient(inputProtein),
			Carbohydrate: projectMacronutrient(inputCarbohydrate),
			Fat:          projectMacronutrient(inputFat),
		},
		InputCalories: inputProjectedCalories,
		Items:         make([]SubstituteItem, 0, end-start),
	}
	for _, r := range ranked[start:end] {
		mq := matchedQuantity(inputCalories, calories(r.profile))
		protein := r.profile.protein * mq / 100
		carbohydrate := r.profile.carbohydrate * mq / 100
		fat := r.profile.fat * mq / 100
		itemCalories := calories(r.profile) * mq / 100
		if !isFiniteDerived(mq) || !isFiniteDerived(protein) || !isFiniteDerived(carbohydrate) || !isFiniteDerived(fat) || !isFiniteDerived(itemCalories) {
			return nil, &Error{
				Code: CodeInternalError,
				cause: fmt.Errorf("food object %d: Matched Quantity %v, scaled macronutrients (%v, %v, %v), or scaled calories %v are not finite for the seeded Macro Profile",
					r.object.id, mq, protein, carbohydrate, fat, itemCalories),
			}
		}
		matched, err := projectMatchedQuantity(mq, r.object.physicalState)
		if err != nil {
			return nil, &Error{
				Code:  CodeInternalError,
				cause: fmt.Errorf("food object %d: %w", r.object.id, err),
			}
		}
		itemProjectedCalories, err := projectCalories(itemCalories)
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
			Calories:          itemProjectedCalories,
			SimilarityPercent: projectSimilarityPercent(r.similarity),
		})
	}
	return page, nil
}
