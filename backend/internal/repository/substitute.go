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

// MacroProfile stores source macronutrient values.
type MacroProfile struct {
	// Protein is the protein amount in grams.
	Protein float64
	// Carbohydrate is the carbohydrate amount in grams.
	Carbohydrate float64
	// Fat is the fat amount in grams.
	Fat float64
}

// SelectedFood is the calculation basis for the selected food.
type SelectedFood struct {
	// FoodObjectID identifies the food.
	FoodObjectID int32
	// Names contains both localized names.
	Names LocalizedNames
	// MacroProfile stores the canonical profile.
	MacroProfile MacroProfile
	// BaseUnit is the base quantity unit.
	BaseUnit Unit
	// Serving is the optional serving base quantity.
	Serving *float64
}

// SubstituteItem is one candidate substitution.
type SubstituteItem struct {
	// FoodObjectID identifies the substitute.
	FoodObjectID int32
	// Names contains both localized names.
	Names LocalizedNames
	// ImageKey identifies the optional image.
	ImageKey *string
	// MacroProfile stores the canonical profile.
	MacroProfile MacroProfile
	// BaseUnit is the base quantity unit.
	BaseUnit Unit
	// Serving is the optional serving base quantity.
	Serving *float64
	// Similarity is the unrounded cosine similarity.
	Similarity float64
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
	// SelectedFood is the calculation basis of the input food.
	SelectedFood SelectedFood
	// Items contains the page results.
	Items []SubstituteItem
}

// FindSubstitutePage loads and ranks substitution results.
type FindSubstitutePage struct {
	loader *loader
}

// rankedSubstitute stores an eligible candidate before paging.
type rankedSubstitute struct {
	object     foodObject
	profile    macroProfile
	similarity float64
	enName     string
}

// macroProfile stores source macronutrient values.
type macroProfile struct {
	protein      float64
	carbohydrate float64
	fat          float64
}

// pageSize is the number of results per page.
const pageSize = 3

const (
	// CodeInvalidRequest identifies an invalid request.
	CodeInvalidRequest Code = "INVALID_REQUEST"
	// CodeInvalidPageIndex identifies a negative page index.
	CodeInvalidPageIndex Code = "INVALID_PAGE_INDEX"
	// CodeFoodObjectNotFound identifies an absent food object.
	CodeFoodObjectNotFound Code = "FOOD_OBJECT_NOT_FOUND"
	// CodePageOutOfRange identifies an unavailable page.
	CodePageOutOfRange Code = "PAGE_OUT_OF_RANGE"
)

// cosineSimilarity computes full-precision profile similarity.
func cosineSimilarity(a, b macroProfile) float64 {
	dot := a.protein*b.protein + a.carbohydrate*b.carbohydrate + a.fat*b.fat
	normA := math.Sqrt(a.protein*a.protein + a.carbohydrate*a.carbohydrate + a.fat*a.fat)
	normB := math.Sqrt(b.protein*b.protein + b.carbohydrate*b.carbohydrate + b.fat*b.fat)
	return dot / (normA * normB)
}

func projectSimilarityPercent(similarity float64) int32 {
	return int32(math.Round(similarity * 100))
}

// isFiniteDerived rejects nonfinite calculated values.
func isFiniteDerived(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
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
func (f *FindSubstitutePage) Run(ctx context.Context, foodObjectID int32, pageIndex int32) (*Page, error) {
	if foodObjectID <= 0 {
		return nil, &Error{
			Code:  CodeInvalidRequest,
			Field: "foodObjectId",
			cause: fmt.Errorf("food object ID %d must be positive", foodObjectID),
		}
	}
	if pageIndex < 0 {
		return nil, &Error{
			Code:  CodeInvalidPageIndex,
			Field: "pageIndex",
			cause: fmt.Errorf("page index %d must be nonnegative", pageIndex),
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
		if objects[i].id == foodObjectID {
			inputObject = &objects[i]
			break
		}
	}
	if inputObject == nil {
		return nil, &Error{
			Code:  CodeFoodObjectNotFound,
			Field: "foodObjectId",
			cause: fmt.Errorf("food object %d is absent from the catalog", foodObjectID),
		}
	}

	inputProfile := macroProfile{protein: inputObject.protein, carbohydrate: inputObject.carbohydrate, fat: inputObject.fat}
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
		SelectedFood: SelectedFood{
			FoodObjectID: inputObject.id,
			Names:        inputObject.names,
			MacroProfile: MacroProfile{
				Protein:      inputObject.protein,
				Carbohydrate: inputObject.carbohydrate,
				Fat:          inputObject.fat,
			},
			BaseUnit: baseUnit(inputObject.physicalState),
			Serving:  inputObject.serving,
		},
		Items: make([]SubstituteItem, 0, end-start),
	}
	for _, r := range ranked[start:end] {
		page.Items = append(page.Items, SubstituteItem{
			FoodObjectID: r.object.id,
			Names:        r.object.names,
			ImageKey:     r.object.imageKey,
			MacroProfile: MacroProfile{
				Protein:      r.object.protein,
				Carbohydrate: r.object.carbohydrate,
				Fat:          r.object.fat,
			},
			BaseUnit:          baseUnit(r.object.physicalState),
			Serving:           r.object.serving,
			Similarity:        r.similarity,
			SimilarityPercent: projectSimilarityPercent(r.similarity),
		})
	}
	return page, nil
}

// baseUnit returns the base unit for state.
func baseUnit(state physicalState) Unit {
	if state == stateLiquid {
		return UnitMillilitre
	}
	return UnitGram
}
