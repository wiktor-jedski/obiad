package repository

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// maxQueryCodePoints limits normalized queries to 128 code points.
const maxQueryCodePoints = 128

// Language selects the localized name used for ranking.
type Language string

const (
	// LanguageEnglish selects English names.
	LanguageEnglish Language = "en"
	// LanguagePolish selects Polish names.
	LanguagePolish Language = "pl"
)

// LocalizedNames stores English and Polish names.
type LocalizedNames struct {
	// En is the English name.
	En string
	// Pl is the Polish name.
	Pl string
}

// Unit identifies a food quantity unit.
type Unit string

const (
	// UnitServing identifies a serving.
	UnitServing Unit = "serving"
	// UnitGram identifies grams.
	UnitGram Unit = "g"
	// UnitMillilitre identifies millilitres.
	UnitMillilitre Unit = "ml"
)

// Quantity is a default food quantity.
type Quantity struct {
	// Value is the quantity value.
	Value int
	// Unit is the quantity unit.
	Unit Unit
}

// AllowedQuantity defines a unit and its maximum value.
type AllowedQuantity struct {
	// Unit is the allowed unit.
	Unit Unit
	// MaximumValue is the largest allowed value.
	MaximumValue int
}

// Suggestion is one ranked food suggestion.
type Suggestion struct {
	// FoodObjectID identifies the food object.
	FoodObjectID int32
	// Names contains both localized names.
	Names LocalizedNames
	// DefaultQuantity is the suggested quantity.
	DefaultQuantity Quantity
	// AllowedQuantities lists editable quantities.
	AllowedQuantities []AllowedQuantity
}

// Code identifies a stable module failure.
type Code string

const (
	// CodeInvalidSearchQuery identifies an invalid query.
	CodeInvalidSearchQuery Code = "INVALID_SEARCH_QUERY"
	// CodeQueryTooLong identifies an overlong query.
	CodeQueryTooLong Code = "QUERY_TOO_LONG"
	// CodeUnsupportedLanguage identifies an unsupported language.
	CodeUnsupportedLanguage Code = "UNSUPPORTED_LANGUAGE"
	// CodeCatalogUnavailable identifies a storage failure.
	CodeCatalogUnavailable Code = "CATALOG_UNAVAILABLE"
	// CodeInternalError identifies an internal failure.
	CodeInternalError Code = "INTERNAL_ERROR"
)

// Error reports a stable module failure.
type Error struct {
	// Code identifies the failure.
	Code Code
	// Field identifies the invalid request field.
	Field string
	cause error
}

// Error returns the failure description.
func (e *Error) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("%s (field %s): %v", e.Code, e.Field, e.cause)
	}
	return fmt.Sprintf("%s: %v", e.Code, e.cause)
}

// Unwrap returns the underlying failure.
func (e *Error) Unwrap() error { return e.cause }

// Suggest loads and ranks food suggestions.
type Suggest struct {
	loader *loader
}

// NewSuggest creates a suggestion module for conn.
func NewSuggest(conn *pgx.Conn) (*Suggest, error) {
	l, err := newLoader(conn)
	if err != nil {
		return nil, err
	}
	return &Suggest{loader: l}, nil
}

// Run returns ranked suggestions for a query.
func (s *Suggest) Run(ctx context.Context, rawQuery string, lang Language) ([]Suggestion, error) {
	if lang != LanguageEnglish && lang != LanguagePolish {
		return nil, &Error{
			Code:  CodeUnsupportedLanguage,
			Field: "language",
			cause: errors.New("unsupported Interface Language"),
		}
	}
	query, err := normalizeQuery(rawQuery)
	if err != nil {
		return nil, err
	}
	objects, err := s.loader.load(ctx)
	if err != nil {
		var catalogErr *loadError
		if errors.As(err, &catalogErr) && catalogErr.kind == kindStorage {
			return nil, &Error{Code: CodeCatalogUnavailable, cause: err}
		}
		return nil, &Error{Code: CodeInternalError, cause: err}
	}
	return rank(objects, query, lang), nil
}

// normalizeQuery validates and normalizes a search query.
func normalizeQuery(raw string) (string, error) {
	if !utf8.ValidString(raw) {
		return "", &Error{
			Code:  CodeInvalidSearchQuery,
			Field: "query",
			cause: errors.New("search query is not valid UTF-8"),
		}
	}
	normalized := normalize(raw)
	if normalized == "" {
		return "", &Error{
			Code:  CodeInvalidSearchQuery,
			Field: "query",
			cause: errors.New("search query is empty after normalization"),
		}
	}
	if utf8.RuneCountInString(normalized) > maxQueryCodePoints {
		return "", &Error{
			Code:  CodeQueryTooLong,
			Field: "query",
			cause: fmt.Errorf("search query exceeds %d code points after normalization", maxQueryCodePoints),
		}
	}
	return normalized, nil
}

// normalize applies Unicode composition, whitespace folding, and lowercase mapping.
func normalize(s string) string {
	return strings.ToLower(strings.Join(strings.FieldsFunc(norm.NFC.String(s), unicode.IsSpace), " "))
}

// levenshtein computes distance with rows sized to the shorter input.
func levenshtein(a, b []rune) int {
	if len(a) > len(b) {
		a, b = b, a
	}
	prev := make([]int, len(a)+1)
	curr := make([]int, len(a)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(b); i++ {
		curr[0] = i
		for j := 1; j <= len(a); j++ {
			cost := 1
			if a[j-1] == b[i-1] {
				cost = 0
			}
			best := curr[j-1] + 1
			if insertion := prev[j] + 1; insertion < best {
				best = insertion
			}
			if substitution := prev[j-1] + cost; substitution < best {
				best = substitution
			}
			curr[j] = best
		}
		prev, curr = curr, prev
	}
	return prev[len(a)]
}

// matchTier identifies a candidate relevance tier.
type matchTier uint8

const (
	matchExact matchTier = iota
	matchPrefix
	matchSubstring
	matchFallback
)

// ranked stores a candidate before result slicing.
type ranked struct {
	object   foodObject
	tier     matchTier
	distance int
	normName string
}

// rank returns up to five candidates in stable order.
func rank(objects []foodObject, query string, lang Language) []Suggestion {
	collator := collate.New(language.English)
	if lang == LanguagePolish {
		collator = collate.New(language.Polish)
	}
	q := []rune(query)
	rankedList := make([]ranked, 0, len(objects))
	for _, object := range objects {
		name := object.names.En
		if lang == LanguagePolish {
			name = object.names.Pl
		}
		normName := normalize(name)
		rankedList = append(rankedList, ranked{
			object:   object,
			tier:     classifyMatch(normName, query),
			distance: levenshtein(q, []rune(normName)),
			normName: normName,
		})
	}
	sort.Slice(rankedList, func(i, j int) bool {
		a, b := rankedList[i], rankedList[j]
		if a.tier != b.tier {
			return a.tier < b.tier
		}
		if a.distance != b.distance {
			return a.distance < b.distance
		}
		if compared := collator.CompareString(a.normName, b.normName); compared != 0 {
			return compared < 0
		}
		return a.object.id < b.object.id
	})
	count := 5
	if len(rankedList) < count {
		count = len(rankedList)
	}
	suggestions := make([]Suggestion, 0, 5)
	for _, r := range rankedList[:count] {
		suggestions = append(suggestions, Suggestion{
			FoodObjectID:      r.object.id,
			Names:             r.object.names,
			DefaultQuantity:   defaultQuantity(r.object),
			AllowedQuantities: allowedQuantities(r.object),
		})
	}
	return suggestions
}

// classifyMatch returns the first matching relevance tier.
func classifyMatch(name, query string) matchTier {
	switch {
	case name == query:
		return matchExact
	case strings.HasPrefix(name, query):
		return matchPrefix
	case strings.Contains(name, query):
		return matchSubstring
	default:
		return matchFallback
	}
}

// maxBaseQuantity is the largest accepted base-unit quantity.
const maxBaseQuantity = 100000

// defaultQuantity selects the default unit and value.
func defaultQuantity(object foodObject) Quantity {
	if object.serving != nil {
		return Quantity{Value: 1, Unit: UnitServing}
	}
	if object.physicalState == stateLiquid {
		return Quantity{Value: 100, Unit: UnitMillilitre}
	}
	return Quantity{Value: 100, Unit: UnitGram}
}

// servingMaximum returns the largest whole serving count within the limit.
func servingMaximum(serving float64) float64 {
	return math.Floor(maxBaseQuantity / serving)
}

// servingMaximumIsRepresentable validates the generated integer range.
func servingMaximumIsRepresentable(serving float64) bool {
	maximum := servingMaximum(serving)
	return maximum >= 1 && maximum <= math.MaxInt32
}

// allowedQuantities returns editable units with the default first.
func allowedQuantities(object foodObject) []AllowedQuantity {
	baseUnit := UnitGram
	if object.physicalState == stateLiquid {
		baseUnit = UnitMillilitre
	}
	if object.serving == nil {
		return []AllowedQuantity{{Unit: baseUnit, MaximumValue: maxBaseQuantity}}
	}
	return []AllowedQuantity{
		{Unit: UnitServing, MaximumValue: int(servingMaximum(*object.serving))},
		{Unit: baseUnit, MaximumValue: maxBaseQuantity},
	}
}
