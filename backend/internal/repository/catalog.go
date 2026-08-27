// Package repository loads and validates food catalog data.
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

const catalogSelectPath = "catalog/load_food_objects.sql"

// physicalState identifies whether quantities use grams or millilitres.
type physicalState string

const (
	stateSolid  physicalState = "solid"
	stateLiquid physicalState = "liquid"
)

// foodObject stores one validated catalog row.
type foodObject struct {
	id            int32
	names         LocalizedNames
	physicalState physicalState
	protein       float64
	carbohydrate  float64
	fat           float64
	serving       *float64
	foodFamilyID  *int32
	imageKey      *string
}

// kind classifies catalog load failures.
type kind string

const (
	kindStorage kind = "storage"

	kindInvariant kind = "invariant"
)

func (k kind) String() string { return string(k) }

// loadError records a catalog load failure.
type loadError struct {
	kind kind
	err  error
}

func (e *loadError) Error() string {
	return fmt.Sprintf("catalog %s failure: %v", e.kind, e.err)
}

func (e *loadError) Unwrap() error { return e.err }

// loader reads a fresh catalog snapshot for each request.
type loader struct {
	conn      *pgx.Conn
	selectSQL string
}

func newLoader(conn *pgx.Conn) (*loader, error) {
	sqlText, err := loadCatalogSelect()
	if err != nil {
		return nil, err
	}
	return &loader{conn: conn, selectSQL: sqlText}, nil
}

// load executes one fresh catalog SELECT.
func (l *loader) load(ctx context.Context) ([]foodObject, error) {
	rows, err := l.conn.Query(ctx, l.selectSQL)
	if err != nil {
		return nil, &loadError{kind: kindStorage, err: err}
	}
	defer rows.Close()

	var objects []foodObject
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
			return nil, &loadError{kind: kindInvariant, err: fmt.Errorf("scan Food Object row: %w", err)}
		}
		object, err := mapFoodObject(id, namesJSON, state, protein, carbohydrate, fat, serving, family, imageKey)
		if err != nil {
			return nil, &loadError{kind: kindInvariant, err: err}
		}
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return nil, &loadError{kind: kindStorage, err: err}
	}
	return objects, nil
}

func loadCatalogSelect() (string, error) {
	b, err := fs.ReadFile(sqlfiles.Catalog, catalogSelectPath)
	if err != nil {
		return "", fmt.Errorf("read embedded catalog SELECT %s: %w", catalogSelectPath, err)
	}
	return string(b), nil
}

// mapFoodObject validates one catalog row.
func mapFoodObject(id int32, namesJSON []byte, state string, protein, carbohydrate, fat float64, serving *float64, family *int32, imageKey *string) (foodObject, error) {
	if id <= 0 {
		return foodObject{}, fmt.Errorf("food object %d: ID must be positive", id)
	}
	names, err := decodeNames(namesJSON)
	if err != nil {
		return foodObject{}, fmt.Errorf("food object %d: %w", id, err)
	}
	stateValue := physicalState(state)
	switch stateValue {
	case stateLiquid, stateSolid:
	default:
		return foodObject{}, fmt.Errorf("food object %d: Physical State %q must be %q or %q", id, state, stateSolid, stateLiquid)
	}
	if err := validateMacroProfile(id, protein, carbohydrate, fat); err != nil {
		return foodObject{}, err
	}
	if serving != nil && !isPositiveFinite(*serving) {
		return foodObject{}, fmt.Errorf("food object %d: Serving must be a positive finite number when present", id)
	}
	if serving != nil && !servingMaximumIsRepresentable(*serving) {
		return foodObject{}, fmt.Errorf("food object %d: Serving %v must make the whole-number maximum of 100000 divided by it a positive value no larger than the int32 display range", id, *serving)
	}
	if family != nil && *family <= 0 {
		return foodObject{}, fmt.Errorf("food object %d: Food Family ID must be positive when present", id)
	}
	if imageKey != nil && strings.Trim(*imageKey, " ") == "" {
		return foodObject{}, fmt.Errorf("food object %d: image key must be nonempty when present", id)
	}
	return foodObject{
		id:            id,
		names:         names,
		physicalState: stateValue,
		protein:       protein,
		carbohydrate:  carbohydrate,
		fat:           fat,
		serving:       serving,
		foodFamilyID:  family,
		imageKey:      imageKey,
	}, nil
}

// decodeNames validates the required localized names.
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

// validateMacroProfile enforces finite, nonnegative macros.
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
			return fmt.Errorf("food object %d: %s must be finite and nonnegative", id, value.name)
		}
	}
	if protein == 0 && carbohydrate == 0 && fat == 0 {
		return fmt.Errorf("food object %d: at least one Macro Profile value must be positive", id)
	}
	return nil
}

// isPositiveFinite reports whether v is positive and finite.
func isPositiveFinite(v float64) bool {
	return v > 0 && !math.IsInf(v, 0)
}
