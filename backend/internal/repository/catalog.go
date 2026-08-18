// Package repository implements the private concrete PostgreSQL Catalog
// Loader (ARCH-006): one fresh embedded parameterized SELECT per operation,
// executed through pgx from SQL colocated under
// backend/internal/repository/sql/, mapping rows to private Food Object
// domain values, validating the ARCH-013 catalog invariants, and
// classifying failures as storage or catalog-invariant. The Module exposes
// no repository interface, fake Adapter, runtime cache, SQL ranking,
// automatic retry, or derived-value persistence.
package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	sqlfiles "obiad/backend/internal/repository/sql"
)

// catalogSelectPath is the embedded persistence SELECT the loader executes.
const catalogSelectPath = "catalog/load_food_objects.sql"

// LocalizedNames is the required English and Polish name pair of one Food
// Object (ARCH-013, ADR 0001, REQ-006). Both names are nonempty string
// values on the one stable Food Object ID.
type LocalizedNames struct {
	En string
	Pl string
}

// PhysicalState is the ARCH-013 Physical State of a Food Object: solid or
// liquid. It determines the Nutrition Basis (REQ-007).
type PhysicalState string

const (
	// StateSolid is the Physical State whose Nutrition Basis is 100 g.
	StateSolid PhysicalState = "solid"
	// StateLiquid is the Physical State whose Nutrition Basis is 100 ml.
	StateLiquid PhysicalState = "liquid"
)

// FoodObject is one validated Food Object domain value mapped from one
// seeded catalog row (ARCH-013). The fields are exactly the ARCH-013 source
// fields: stable ID, required localized names, Physical State, finite
// nonnegative Macro Profile, one optional positive Serving, one optional
// Food Family reference, and one optional opaque image key. Derived values
// (calories, Nutritional Similarities, Matched Quantities, page data,
// rounded display values) are never stored and never loaded.
type FoodObject struct {
	ID            int32
	Names         LocalizedNames
	PhysicalState PhysicalState
	Protein       float64
	Carbohydrate  float64
	Fat           float64
	Serving       *float64
	FoodFamilyID  *int32
	ImageKey      *string
}

// Kind classifies a failed catalog load (ARCH-006): storage or
// catalog-invariant.
type Kind string

const (
	// KindStorage reports that the catalog could not be read: PostgreSQL was
	// unreachable, the SELECT failed (for example a missing table or a
	// revoked read grant), or the row stream broke. The catalog data itself
	// was never observed.
	KindStorage Kind = "storage"

	// KindInvariant reports that PostgreSQL returned rows that violate the
	// ARCH-013 catalog invariants: a nonpositive ID, missing or empty
	// localized names, an unknown Physical State, a nonfinite or negative
	// Macro Profile value, an all-zero Macro Profile, a nonpositive or
	// nonfinite Serving, a nonpositive Food Family reference, or an empty
	// image key.
	KindInvariant Kind = "invariant"
)

// String returns the stable classification name.
func (k Kind) String() string { return string(k) }

// Error is a classified catalog load failure (ARCH-006). It distinguishes
// storage failures — PostgreSQL is unreachable or the read fails — from
// catalog-invariant failures — the returned rows do not satisfy the
// ARCH-013 structure contract. Err holds the underlying cause.
type Error struct {
	Kind Kind
	Err  error
}

// Error implements error.
func (e *Error) Error() string {
	return fmt.Sprintf("catalog %s failure: %v", e.Kind, e.Err)
}

// Unwrap returns the underlying cause.
func (e *Error) Unwrap() error { return e.Err }

// Loader is the private concrete PostgreSQL Catalog Loader (ARCH-006). Each
// Load operation executes one fresh embedded parameterized SELECT through
// pgx from SQL colocated under backend/internal/repository/sql/, maps rows
// to private Food Object values, validates the ARCH-013 catalog invariants,
// and classifies failures as storage or catalog-invariant. The Loader holds
// no runtime cache, performs no automatic retry, and never mutates.
type Loader struct {
	conn      *pgx.Conn
	selectSQL string
}

// New returns a Loader that reads the catalog through conn.
func New(conn *pgx.Conn) (*Loader, error) {
	sqlText, err := loadCatalogSelect()
	if err != nil {
		return nil, err
	}
	return &Loader{conn: conn, selectSQL: sqlText}, nil
}

// Load performs one fresh PostgreSQL read: it executes the embedded
// parameterized SELECT exactly once, maps every row to a Food Object value,
// validates the ARCH-013 catalog invariants, and returns the request-local
// snapshot in ascending stable ID order. A failure is classified as storage
// or catalog-invariant (Error.Kind). Load never caches, never retries, and
// never mutates.
func (l *Loader) Load(ctx context.Context) ([]FoodObject, error) {
	rows, err := l.conn.Query(ctx, l.selectSQL)
	if err != nil {
		return nil, &Error{Kind: KindStorage, Err: err}
	}
	defer rows.Close()

	var objects []FoodObject
	for rows.Next() {
		var (
			id           int32
			namesJSON    []byte
			state        string
			protein      float64
			carbohydrate float64
			fat          float64
			serving      *float64
			family       *int32
			imageKey     *string
		)
		if err := rows.Scan(&id, &namesJSON, &state, &protein, &carbohydrate, &fat, &serving, &family, &imageKey); err != nil {
			return nil, &Error{Kind: KindInvariant, Err: fmt.Errorf("scan Food Object row: %w", err)}
		}
		object, err := mapFoodObject(id, namesJSON, state, protein, carbohydrate, fat, serving, family, imageKey)
		if err != nil {
			return nil, &Error{Kind: KindInvariant, Err: err}
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, &Error{Kind: KindStorage, Err: err}
	}
	return objects, nil
}

// loadCatalogSelect reads the embedded persistence SELECT from the catalog
// SQL filesystem.
func loadCatalogSelect() (string, error) {
	b, err := fs.ReadFile(sqlfiles.Catalog, catalogSelectPath)
	if err != nil {
		return "", fmt.Errorf("read embedded catalog SELECT %s: %w", catalogSelectPath, err)
	}
	return string(b), nil
}

// mapFoodObject maps one scanned row to a Food Object value after checking
// every ARCH-013 catalog invariant.
func mapFoodObject(id int32, namesJSON []byte, state string, protein, carbohydrate, fat float64, serving *float64, family *int32, imageKey *string) (FoodObject, error) {
	if id <= 0 {
		return FoodObject{}, fmt.Errorf("Food Object %d: ID must be positive", id)
	}
	names, err := decodeNames(namesJSON)
	if err != nil {
		return FoodObject{}, fmt.Errorf("Food Object %d: %w", id, err)
	}
	var physicalState PhysicalState
	switch PhysicalState(state) {
	case StateSolid:
		physicalState = StateSolid
	case StateLiquid:
		physicalState = StateLiquid
	default:
		return FoodObject{}, fmt.Errorf("Food Object %d: Physical State %q must be %q or %q", id, state, StateSolid, StateLiquid)
	}
	if err := validateMacroProfile(id, protein, carbohydrate, fat); err != nil {
		return FoodObject{}, err
	}
	if serving != nil && !isPositiveFinite(*serving) {
		return FoodObject{}, fmt.Errorf("Food Object %d: Serving must be a positive finite number when present", id)
	}
	if family != nil && *family <= 0 {
		return FoodObject{}, fmt.Errorf("Food Object %d: Food Family ID must be positive when present", id)
	}
	if imageKey != nil && strings.Trim(*imageKey, " ") == "" {
		return FoodObject{}, fmt.Errorf("Food Object %d: image key must be nonempty when present", id)
	}
	return FoodObject{
		ID:            id,
		Names:         names,
		PhysicalState: physicalState,
		Protein:       protein,
		Carbohydrate:  carbohydrate,
		Fat:           fat,
		Serving:       serving,
		FoodFamilyID:  family,
		ImageKey:      imageKey,
	}, nil
}

// decodeNames validates and maps the localized-name JSONB value. The value
// must be a JSON object with nonempty string values for the required "en"
// and "pl" keys, mirroring the migration-0001 btrim semantics (ADR 0001,
// REQ-006). Additional language keys are permitted and ignored.
func decodeNames(rawJSON []byte) (LocalizedNames, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(rawJSON, &m); err != nil {
		return LocalizedNames{}, fmt.Errorf("localized names must be a JSON object: %w", err)
	}
	var names LocalizedNames
	for _, key := range []string{"en", "pl"} {
		raw, ok := m[key]
		if !ok {
			return LocalizedNames{}, fmt.Errorf("localized names are missing the %q name", key)
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return LocalizedNames{}, fmt.Errorf("localized name %q must be a string", key)
		}
		if strings.Trim(value, " ") == "" {
			return LocalizedNames{}, fmt.Errorf("localized name %q must be nonempty", key)
		}
		switch key {
		case "en":
			names.En = value
		case "pl":
			names.Pl = value
		}
	}
	return names, nil
}

// validateMacroProfile checks the finite, nonnegative, not-all-zero Macro
// Profile invariant (REQ-010, ARCH-013).
func validateMacroProfile(id int32, protein, carbohydrate, fat float64) error {
	for _, value := range []struct {
		name  string
		value float64
	}{
		{"protein", protein},
		{"carbohydrate", carbohydrate},
		{"fat", fat},
	} {
		if math.IsNaN(value.value) || math.IsInf(value.value, 0) || value.value < 0 {
			return fmt.Errorf("Food Object %d: %s must be finite and nonnegative", id, value.name)
		}
	}
	if protein == 0 && carbohydrate == 0 && fat == 0 {
		return fmt.Errorf("Food Object %d: at least one Macro Profile value must be positive", id)
	}
	return nil
}

// isPositiveFinite reports whether v is strictly positive and finite.
func isPositiveFinite(v float64) bool {
	return v > 0 && !math.IsInf(v, 0)
}
