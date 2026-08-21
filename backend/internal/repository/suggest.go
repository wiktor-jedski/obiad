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

// maxQueryCodePoints is the largest accepted normalized Search Query, in
// Unicode code points (ARCH-017). A normalized query over 128 code points is
// rejected with the stable QUERY_TOO_LONG failure.
const maxQueryCodePoints = 128

// Language is the Interface Language used to compare Food Object names
// (REQ-013). Only English and Polish are supported; the ranking compares the
// active-language name and ties are broken with the ISSUE-004-pinned
// collation for that language.
type Language string

const (
	// LanguageEnglish compares the English localized name with
	// collate.New(language.English).
	LanguageEnglish Language = "en"
	// LanguagePolish compares the Polish localized name with
	// collate.New(language.Polish).
	LanguagePolish Language = "pl"
)

// LocalizedNames is the required English and Polish name pair of one Food
// Object (ARCH-004, ARCH-013).
type LocalizedNames struct {
	En string
	Pl string
}

// Unit is the Food Quantity unit of a backend-derived default Food Quantity
// (ARCH-004).
type Unit string

const (
	// UnitServing is one standard Serving.
	UnitServing Unit = "serving"
	// UnitGram is a gram of a solid Food Object.
	UnitGram Unit = "g"
	// UnitMillilitre is a millilitre of a liquid Food Object.
	UnitMillilitre Unit = "ml"
)

// Quantity is a backend-derived default Food Quantity (ARCH-004, REQ-023,
// REQ-024): 1 serving for a Food Object with a Serving, otherwise the 100 g
// Nutrition Basis of a solid or the 100 ml Nutrition Basis of a liquid. The
// Module emits only these three values.
type Quantity struct {
	Value int
	Unit  Unit
}

// AllowedQuantity is one allowed quantity-editor unit of a suggested Food
// Object with its positive whole maximum value (ISSUE-010): the unit and the
// largest accepted value of that unit. A Food Object without a Serving
// exposes only its g or ml base unit with maximum 100000. A Food Object with
// a Serving exposes serving first with the maximum equal to the whole-number
// floor of 100000 divided by its stored Serving base quantity, then its g or
// ml base unit with maximum 100000. The default unit is first, and the
// Physical State and the stored Serving quantity are never exposed.
type AllowedQuantity struct {
	Unit         Unit
	MaximumValue int
}

// Suggestion is one ranked Food Object suggestion (ARCH-004): the stable
// Food Object ID, both localized names, the backend-derived default Food
// Quantity, and the allowed quantity-editor units. Suggestions are Module
// domain values; generated transport values never enter the Module.
type Suggestion struct {
	FoodObjectID      int32
	Names             LocalizedNames
	DefaultQuantity   Quantity
	AllowedQuantities []AllowedQuantity
}

// Code is a stable Suggest failure code (ARCH-004, ARCH-008). Codes are
// stable across releases and map to the stable HTTP error responses; the
// Fiber Adapter never exposes an internal cause.
type Code string

const (
	// CodeInvalidSearchQuery reports a normalized-empty or invalid-UTF-8
	// Search Query.
	CodeInvalidSearchQuery Code = "INVALID_SEARCH_QUERY"
	// CodeQueryTooLong reports a normalized Search Query over 128 Unicode
	// code points.
	CodeQueryTooLong Code = "QUERY_TOO_LONG"
	// CodeUnsupportedLanguage reports an Interface Language other than
	// English or Polish.
	CodeUnsupportedLanguage Code = "UNSUPPORTED_LANGUAGE"
	// CodeCatalogUnavailable reports a catalog storage failure: PostgreSQL
	// could not serve the fresh read.
	CodeCatalogUnavailable Code = "CATALOG_UNAVAILABLE"
	// CodeInternalError reports a catalog-invariant or unexpected failure.
	CodeInternalError Code = "INTERNAL_ERROR"
)

// Error is one stable Module failure (ARCH-004, ARCH-005). Code is always
// present; Field names the offending request field path ("query",
// "language", "foodObjectId", "quantity.value", "quantity.unit", or
// "pageIndex") for client failures and is empty for server failures. cause
// is the internal cause and never appears in a response.
type Error struct {
	Code  Code
	Field string
	cause error
}

// Error implements error.
func (e *Error) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("%s (field %s): %v", e.Code, e.Field, e.cause)
	}
	return fmt.Sprintf("%s: %v", e.Code, e.cause)
}

// Unwrap returns the internal cause.
func (e *Error) Unwrap() error { return e.cause }

// Suggest is the concrete Suggest Food Objects Module (ARCH-004). Its one
// Run operation accepts a raw Search Query and an Interface Language and
// returns exactly five distinct suggestions or one stable failure. The
// Module ranks the request-local catalog snapshot loaded through the private
// Catalog Loader (ARCH-006): one fresh embedded SELECT per operation, no
// runtime cache, no retry. The Module exposes no Go interface,
// repository port, ranking policy, or test Adapter, and no generated
// transport value enters the Module.
type Suggest struct {
	loader *loader
}

// NewSuggest returns a Suggest Module that loads every request-local catalog
// snapshot through conn.
func NewSuggest(conn *pgx.Conn) (*Suggest, error) {
	l, err := newLoader(conn)
	if err != nil {
		return nil, err
	}
	return &Suggest{loader: l}, nil
}

// Run implements the Suggest Food Objects operation (ARCH-004, ARCH-017):
// it validates the raw Search Query UTF-8 encoding and the Interface
// Language, normalizes the query, performs one fresh catalog read through
// the Catalog Loader, assigns exact, prefix, substring, and fallback match
// tiers, then ranks within each tier by raw code-point Levenshtein distance,
// the pinned active-language collation, and stable Food Object ID. It returns
// exactly five distinct suggestions carrying the stable Food Object ID, both
// localized names, and the backend-derived default Food Quantity. Failures
// are stable Error values with a Code and an optional Field.
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

// normalizeQuery validates the raw Search Query UTF-8 encoding and applies
// the ARCH-017 normalization pipeline, then rejects a normalized empty query
// with INVALID_SEARCH_QUERY and a normalized query over 128 code points with
// QUERY_TOO_LONG. Failure causes never echo the query text.
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

// normalize applies the ARCH-017 normalization pipeline to one string: NFC
// canonical composition, Unicode whitespace trimming and collapsing to ASCII
// spaces, and Unicode lowercase mapping. Canonically equivalent text
// therefore normalizes to one identical value, and letter-case and
// whitespace variants compare equally (REQ-014).
func normalize(s string) string {
	return strings.ToLower(strings.Join(strings.FieldsFunc(norm.NFC.String(s), unicode.IsSpace), " "))
}

// levenshtein returns the raw code-point Levenshtein distance between a and
// b (ARCH-017, REQ-076): the minimum number of single code-point insertions,
// deletions, or substitutions. Polish diacritics remain distinct from their
// base letters, so "z" and "ż" are one edit apart (REQ-015). Working memory
// is bounded by the shorter input: only two distance rows are kept, each
// sized to the shorter input plus one, so a full distance matrix is never
// allocated (ARCH-017 quality constraint).
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

// matchTier is the autocomplete relevance class of one normalized candidate.
// Lower values rank first (ARCH-017, REQ-076).
type matchTier uint8

const (
	matchExact matchTier = iota
	matchPrefix
	matchSubstring
	matchFallback
)

// ranked is one candidate suggestion before slicing: the Food Object, its
// first applicable autocomplete match tier, raw code-point Levenshtein
// distance, and normalized active-language name.
type ranked struct {
	object   foodObject
	tier     matchTier
	distance int
	normName string
}

// rank orders the catalog snapshot by exact match, full-name prefix,
// substring, and fallback tier. Within each tier it sorts by increasing raw
// code-point Levenshtein distance, the ISSUE-004-pinned active-language
// collation (collate.New(language.English) or collate.New(language.Polish)
// with no options), and stable Food Object ID (ARCH-017, REQ-017, REQ-076).
// It returns the five best suggestions with their backend-derived default
// Food Quantities. No match threshold is applied, so a valid seeded catalog
// returns five suggestions for any accepted nonempty query.
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

// classifyMatch assigns one normalized name to its first applicable
// autocomplete tier (ARCH-017, REQ-076).
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

// defaultQuantity derives the backend default Food Quantity (ARCH-004,
// REQ-023, REQ-024): 1 serving for a Food Object with a Serving, otherwise
// the 100 g Nutrition Basis of a solid or the 100 ml Nutrition Basis of a
// liquid.
func defaultQuantity(object foodObject) Quantity {
	if object.serving != nil {
		return Quantity{Value: 1, Unit: UnitServing}
	}
	if object.physicalState == stateLiquid {
		return Quantity{Value: 100, Unit: UnitMillilitre}
	}
	return Quantity{Value: 100, Unit: UnitGram}
}

// servingMaximum returns the whole-number floor of maxBaseQuantity divided
// by a stored Serving base quantity: the ISSUE-010 allowed maximum of the
// serving unit. The exact positive floor is the largest whole Serving count
// whose converted base quantity stays at most 100,000 g or 100,000 ml.
func servingMaximum(serving float64) float64 {
	return math.Floor(maxBaseQuantity / serving)
}

// servingMaximumIsRepresentable reports whether the ISSUE-010 serving
// maximum of a stored Serving base quantity is a positive whole value that
// fits the generated int32 display range. The catalog Serving invariant
// (ARCH-013, task-33 repair) requires it, so a validated catalog row can
// never produce a zero maximum or a maximum that wraps in the HTTP Adapter's
// int32 mapping.
func servingMaximumIsRepresentable(serving float64) bool {
	maximum := servingMaximum(serving)
	return maximum >= 1 && maximum <= math.MaxInt32
}

// allowedQuantities derives the allowed quantity-editor units of one Food
// Object, default first (ISSUE-010): a Food Object without a Serving exposes
// only its g or ml base unit with maximum 100000; a Food Object with a
// Serving exposes serving first with the maximum equal to the whole-number
// floor of 100000 divided by its stored Serving base quantity, then its g or
// ml base unit with maximum 100000. The Physical State and the stored Serving
// quantity are never exposed. The Catalog Loader validated the ARCH-013
// Serving invariant before this function runs, so servingMaximum is always
// a positive whole value within the int32 display range and the values never
// need a second guard here.
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
