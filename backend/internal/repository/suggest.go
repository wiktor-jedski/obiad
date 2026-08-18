package repository

import (
	"context"
	"errors"
	"fmt"
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

// LocalizedNames is the English and Polish name pair of one suggested Food
// Object (ARCH-004). Both required names are always present.
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

// Suggestion is one ranked Food Object suggestion (ARCH-004): the stable
// Food Object ID, both localized names, and the backend-derived default Food
// Quantity. Suggestions are Module domain values; generated transport values
// never enter the Module.
type Suggestion struct {
	FoodObjectID    int32
	Names           LocalizedNames
	DefaultQuantity Quantity
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

// Error is one stable Suggest failure (ARCH-004). Code is always present;
// Field names the offending request parameter ("query" or "language") for
// client-parameter failures and is empty for server failures. cause is the
// internal cause and never appears in a response.
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
// Catalog Loader (ARCH-006): one fresh embedded parameterized SELECT per
// operation, no runtime cache, no retry. The Module exposes no Go interface,
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
// the Catalog Loader, ranks the snapshot by raw code-point Levenshtein
// distance, the pinned active-language collation, and stable Food Object ID,
// and returns exactly five distinct suggestions. Every suggestion carries
// the stable Food Object ID, both localized names, and the backend-derived
// default Food Quantity. Failures are stable Error values with a Code and an
// optional Field.
func (s *Suggest) Run(ctx context.Context, rawQuery string, lang Language) ([]Suggestion, error) {
	if lang != LanguageEnglish && lang != LanguagePolish {
		return nil, &Error{
			Code:  CodeUnsupportedLanguage,
			Field: "language",
			cause: fmt.Errorf("unsupported Interface Language %q", lang),
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
			cause: errors.New("Search Query is not valid UTF-8"),
		}
	}
	normalized := normalize(raw)
	if normalized == "" {
		return "", &Error{
			Code:  CodeInvalidSearchQuery,
			Field: "query",
			cause: errors.New("Search Query is empty after normalization"),
		}
	}
	if utf8.RuneCountInString(normalized) > maxQueryCodePoints {
		return "", &Error{
			Code:  CodeQueryTooLong,
			Field: "query",
			cause: fmt.Errorf("Search Query exceeds %d code points after normalization", maxQueryCodePoints),
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
// b (ARCH-017, REQ-016): the minimum number of single code-point insertions,
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

// ranked is one candidate suggestion before slicing: the Food Object, its
// raw code-point Levenshtein distance, and its normalized active-language
// name.
type ranked struct {
	object   foodObject
	distance int
	normName string
}

// rank orders the catalog snapshot by increasing raw code-point Levenshtein
// distance, the ISSUE-004-pinned active-language collation of the normalized
// names (collate.New(language.English) or collate.New(language.Polish) with
// no options), and stable Food Object ID (ARCH-017, REQ-016, REQ-017), then
// returns the five best suggestions with their backend-derived default Food
// Quantities. No match threshold is applied, so a valid seeded catalog
// returns five suggestions for any accepted nonempty query.
func rank(objects []foodObject, query string, lang Language) []Suggestion {
	collator := collate.New(language.English)
	if lang == LanguagePolish {
		collator = collate.New(language.Polish)
	}
	q := []rune(query)
	rankedList := make([]ranked, 0, len(objects))
	for _, object := range objects {
		name := object.names.en
		if lang == LanguagePolish {
			name = object.names.pl
		}
		normName := normalize(name)
		rankedList = append(rankedList, ranked{
			object:   object,
			distance: levenshtein(q, []rune(normName)),
			normName: normName,
		})
	}
	sort.Slice(rankedList, func(i, j int) bool {
		a, b := rankedList[i], rankedList[j]
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
			FoodObjectID: r.object.id,
			Names: LocalizedNames{
				En: r.object.names.en,
				Pl: r.object.names.pl,
			},
			DefaultQuantity: defaultQuantity(r.object),
		})
	}
	return suggestions
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
