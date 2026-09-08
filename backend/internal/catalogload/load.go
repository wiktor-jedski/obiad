// Package catalogload validates and replaces an offline application catalog.
package catalogload

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	sqlfiles "obiad/backend/internal/repository/sql"
)

type catalog struct {
	SchemaVersion int          `json:"schemaVersion"`
	FoodFamilies  []family     `json:"foodFamilies"`
	FoodObjects   []foodObject `json:"foodObjects"`
}

type family struct {
	ID    int64             `json:"id"`
	Names map[string]string `json:"names"`
}

type foodObject struct {
	ID             int64             `json:"id"`
	Names          map[string]string `json:"names"`
	MacroProfile   macros            `json:"macroProfile"`
	NutritionBasis string            `json:"nutritionBasis"`
	Serving        *serving          `json:"serving"`
	Source         *string           `json:"source"`
	ImageKey       *string           `json:"imageKey"`
	FoodFamilyID   *int64            `json:"foodFamilyId"`
}

type macros struct {
	Protein               *float64 `json:"protein"`
	AvailableCarbohydrate *float64 `json:"availableCarbohydrate"`
	Fat                   *float64 `json:"fat"`
}

type serving struct {
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
}

const advisoryLockKey int64 = 0x0B1AD0001

var sourceCharacters = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:([A-Za-z0-9._~!$&'()*+,;=:@/?#-]|%[0-9A-Fa-f]{2}|\[[0-9A-Fa-f:.]+\])+$`)

// Run validates the complete file before connecting and atomically replaces the catalog.
func Run(ctx context.Context, databaseURL, path string) (runErr error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read catalog: %w", err)
	}
	c, err := decode(body)
	if err != nil {
		return fmt.Errorf("validate catalog: %w", err)
	}
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() {
		runErr = errors.Join(runErr, conn.Close(context.Background()))
	}()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin replacement: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if _, err := tx.Exec(ctx, sqlfiles.LockCatalog, advisoryLockKey); err != nil {
		return fmt.Errorf("lock catalog: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlfiles.ClearCatalog); err != nil {
		return fmt.Errorf("clear catalog: %w", err)
	}
	for _, f := range c.FoodFamilies {
		if _, err := tx.Exec(ctx, sqlfiles.InsertFamily, f.ID, f.Names); err != nil {
			return fmt.Errorf("insert Food Family %d: %w", f.ID, err)
		}
	}
	for _, f := range c.FoodObjects {
		var quantity *float64
		if f.Serving != nil {
			quantity = &f.Serving.Value
		}
		if _, err := tx.Exec(ctx, sqlfiles.InsertFoodObject, f.ID, f.Names, f.NutritionBasis,
			*f.MacroProfile.Protein, *f.MacroProfile.AvailableCarbohydrate, *f.MacroProfile.Fat,
			quantity, f.Source, f.ImageKey, f.FoodFamilyID); err != nil {
			return fmt.Errorf("insert Food Object %d: %w", f.ID, err)
		}
	}
	return tx.Commit(ctx)
}

func decode(body []byte) (catalog, error) {
	var c catalog
	if !utf8.Valid(body) || !validEscapes(body) {
		return c, errors.New("invalid Unicode")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	if err := checkJSON(d, "catalog"); err != nil {
		return c, err
	}
	if _, err := d.Token(); err != io.EOF {
		return c, errors.New("expected one complete JSON document")
	}
	if err := json.Unmarshal(body, &c); err != nil {
		return c, err
	}
	if c.SchemaVersion != 1 || c.FoodFamilies == nil || len(c.FoodObjects) == 0 {
		return c, errors.New("require schemaVersion 1, foodFamilies array and nonempty foodObjects array")
	}
	families := make(map[int64]bool, len(c.FoodFamilies))
	for _, f := range c.FoodFamilies {
		if f.ID <= 0 || f.ID > math.MaxInt32 || families[f.ID] || !validNames(f.Names) {
			return c, fmt.Errorf("invalid or duplicate Food Family %d", f.ID)
		}
		families[f.ID] = true
	}
	objects := make(map[int64]bool, len(c.FoodObjects))
	for _, f := range c.FoodObjects {
		if f.ID <= 0 || f.ID > math.MaxInt32 || objects[f.ID] || !validNames(f.Names) {
			return c, fmt.Errorf("invalid or duplicate Food Object %d", f.ID)
		}
		objects[f.ID] = true
		m := f.MacroProfile
		if !nonnegative(m.Protein) || !nonnegative(m.AvailableCarbohydrate) || !nonnegative(m.Fat) ||
			(*m.Protein == 0 && *m.AvailableCarbohydrate == 0 && *m.Fat == 0) {
			return c, fmt.Errorf("food object %d: invalid Macro Profile", f.ID)
		}
		if f.NutritionBasis != "g" && f.NutritionBasis != "ml" {
			return c, fmt.Errorf("food object %d: invalid Nutrition Basis", f.ID)
		}
		if s := f.Serving; s != nil && (!nonnegative(&s.Value) || s.Value == 0 || s.Unit != f.NutritionBasis) {
			return c, fmt.Errorf("food object %d: invalid Serving", f.ID)
		}
		if f.FoodFamilyID != nil && !families[*f.FoodFamilyID] {
			return c, fmt.Errorf("food object %d: unknown Food Family", f.ID)
		}
		if f.ImageKey != nil && strings.Trim(*f.ImageKey, " ") == "" {
			return c, fmt.Errorf("food object %d: empty image key", f.ID)
		}
		if f.Source != nil && !validSource(*f.Source) {
			return c, fmt.Errorf("food object %d: invalid source URL", f.ID)
		}
	}
	return c, nil
}

func nonnegative(n *float64) bool {
	return n != nil && *n >= 0 && !math.IsInf(*n, 0) && !math.IsNaN(*n)
}

func validNames(names map[string]string) bool {
	if strings.TrimSpace(names["en"]) == "" || strings.TrimSpace(names["pl"]) == "" {
		return false
	}
	for _, name := range names {
		if name == "" || strings.ContainsRune(name, 0) {
			return false
		}
	}
	return true
}

func validSource(source string) bool {
	if !sourceCharacters.MatchString(source) || strings.Count(source, "#") > 1 {
		return false
	}
	u, err := url.Parse(source)
	if err != nil || !u.IsAbs() {
		return false
	}
	if strings.EqualFold(u.Scheme, "http") || strings.EqualFold(u.Scheme, "https") {
		if u.Hostname() == "" {
			return false
		}
		bracketed := strings.HasPrefix(u.Host, "[")
		ipv6 := strings.Contains(u.Hostname(), ":")
		if bracketed != ipv6 || (bracketed && net.ParseIP(u.Hostname()) == nil) {
			return false
		}
		if port := u.Port(); port != "" {
			n, err := strconv.ParseUint(strings.TrimLeft(port, "0"), 10, 16)
			if err != nil || n == 0 {
				return false
			}
		}
	}
	return true
}

// checkJSON rejects duplicate and noncanonical keys and null before typed decoding.
func checkJSON(d *json.Decoder, kind string) error {
	token, err := d.Token()
	if err != nil {
		return err
	}
	if token == nil {
		return errors.New("null is not catalog content")
	}
	if text, ok := token.(string); ok && strings.ContainsRune(text, 0) {
		return errors.New("NUL is not supported in catalog strings")
	}
	if number, ok := token.(json.Number); ok && (kind == "protein" || kind == "availableCarbohydrate" || kind == "fat") {
		// Check the exact mantissa before float64 conversion can underflow to negative zero.
		mantissa := number.String()
		if exponent := strings.IndexAny(mantissa, "eE"); exponent >= 0 {
			mantissa = mantissa[:exponent]
		}
		if strings.HasPrefix(mantissa, "-") && strings.Trim(mantissa, "-0.") != "" {
			return fmt.Errorf("%s: negative Macro Profile value", kind)
		}
	}
	switch token {
	case json.Delim('{'):
		seen := map[string]bool{}
		for d.More() {
			keyToken, err := d.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok || strings.ContainsRune(key, 0) || seen[key] || !allowedKey(kind, key) {
				return fmt.Errorf("%s: duplicate or unrecognized field %q", kind, key)
			}
			seen[key] = true
			if err := checkJSON(d, key); err != nil {
				return err
			}
		}
		_, err = d.Token()
	case json.Delim('['):
		for d.More() {
			if err := checkJSON(d, kind); err != nil {
				return err
			}
		}
		_, err = d.Token()
	}
	return err
}

func allowedKey(kind, key string) bool {
	var allowed string
	switch kind {
	case "catalog":
		allowed = " schemaVersion foodFamilies foodObjects "
	case "foodFamilies":
		allowed = " id names "
	case "foodObjects":
		allowed = " id names macroProfile nutritionBasis serving source imageKey foodFamilyId "
	case "macroProfile":
		allowed = " protein availableCarbohydrate fat "
	case "serving":
		allowed = " value unit "
	case "names":
		return true
	default:
		return false
	}
	for _, field := range strings.Fields(allowed) {
		if key == field {
			return true
		}
	}
	return false
}

// validEscapes prevents encoding/json from replacing unpaired UTF-16 surrogates.
func validEscapes(body []byte) bool {
	for i := 0; i < len(body); i++ {
		if body[i] != '\\' {
			continue
		}
		i++
		if i+4 >= len(body) || body[i] != 'u' {
			continue
		}
		code, err := strconv.ParseUint(string(body[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if code >= 0xDC00 && code <= 0xDFFF {
			return false
		}
		if code >= 0xD800 && code <= 0xDBFF {
			if i+6 >= len(body) || body[i+1] != '\\' || body[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(body[i+3:i+7]), 16, 16)
			if err != nil || low < 0xDC00 || low > 0xDFFF {
				return false
			}
			i += 6
		}
	}
	return true
}
