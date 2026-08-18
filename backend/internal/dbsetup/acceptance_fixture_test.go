package dbsetup

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"
)

type catalogCoverageCase struct {
	id            int
	englishName   string
	polishName    string
	physicalState string
	serving       *float64
	familyID      *int
	imageKey      *string
	eligibleCount int
}

// TestAcceptanceCatalogCoverage verifies the observable catalog produced by a
// fresh database setup. It does not predict ranking, similarity, quantity, or
// paging behavior owned by later application modules.
func TestAcceptanceCatalogCoverage(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	cases := []catalogCoverageCase{
		{
			id:            1,
			englishName:   "Pizza Margherita",
			polishName:    "Pizza margherita",
			physicalState: "solid",
			serving:       f64p(350),
			familyID:      i32p(1),
			imageKey:      strp("pizza-margherita"),
			eligibleCount: 36,
		},
		{
			id:            5,
			englishName:   "Chicken breast",
			polishName:    "Pierś z kurczaka",
			physicalState: "solid",
			imageKey:      strp("chicken-breast"),
			eligibleCount: 37,
		},
		{
			id:            10,
			englishName:   "Milk",
			polishName:    "Mleko",
			physicalState: "liquid",
			imageKey:      strp("milk"),
			eligibleCount: 37,
		},
	}

	if n := countRows(t, conn, "SELECT count(*) FROM food_objects"); n != 38 {
		t.Fatalf("fresh setup has %d Food Objects, want 38", n)
	}

	eligibleByInput := make(map[int][]int, len(cases))
	for _, tc := range cases {
		var englishName, polishName, physicalState string
		var serving *float64
		var familyID *int
		var imageKey *string
		err := conn.QueryRow(ctx, `SELECT names ->> 'en', names ->> 'pl', physical_state,
			serving, food_family_id, image_key
			FROM food_objects WHERE id = $1`, tc.id).Scan(
			&englishName,
			&polishName,
			&physicalState,
			&serving,
			&familyID,
			&imageKey,
		)
		if err != nil {
			t.Fatalf("read designated Food Object %d: %v", tc.id, err)
		}
		if englishName != tc.englishName || polishName != tc.polishName || physicalState != tc.physicalState ||
			!equalFloatPtr(serving, tc.serving) || !equalIntPtr(familyID, tc.familyID) || !equalStrPtr(imageKey, tc.imageKey) {
			t.Fatalf("designated Food Object %d is (%q, %q, %q, serving=%v, family=%v, image=%v), want (%q, %q, %q, serving=%v, family=%v, image=%v)",
				tc.id, englishName, polishName, physicalState, serving, familyID, imageKey,
				tc.englishName, tc.polishName, tc.physicalState, tc.serving, tc.familyID, tc.imageKey)
		}

		for language, name := range map[string]string{"en": tc.englishName, "pl": tc.polishName} {
			var ids []int
			rows, err := conn.Query(ctx, `SELECT id FROM food_objects WHERE names ->> $1 = $2`, language, name)
			if err != nil {
				t.Fatalf("resolve %s name %q: %v", language, name, err)
			}
			for rows.Next() {
				var id int
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					t.Fatalf("scan %s name %q: %v", language, name, err)
				}
				ids = append(ids, id)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				t.Fatalf("iterate %s name %q: %v", language, name, err)
			}
			if len(ids) != 1 || ids[0] != tc.id {
				t.Fatalf("%s name %q resolves to IDs %v, want [%d]", language, name, ids, tc.id)
			}
		}

		eligible := catalogEligibleIDs(t, conn, tc.id)
		if len(eligible) != tc.eligibleCount {
			t.Fatalf("input %d has %d catalog rows after input and Food Family exclusion, want %d", tc.id, len(eligible), tc.eligibleCount)
		}
		eligibleByInput[tc.id] = eligible
	}

	if slices.Contains(eligibleByInput[1], 2) {
		t.Fatal("Pizza Capricciosa must share Pizza Margherita's Food Family and be excluded for that input")
	}
	if !slices.Contains(eligibleByInput[5], 2) || !slices.Contains(eligibleByInput[10], 2) {
		t.Fatal("Pizza Capricciosa must remain eligible for inputs outside the Pizza Food Family")
	}
	if !slices.Contains(eligibleByInput[5], 1) || !slices.Contains(eligibleByInput[10], 1) {
		t.Fatal("Pizza Margherita must remain eligible for inputs outside the Pizza Food Family")
	}

	coverageQueries := []struct {
		name  string
		query string
	}{
		{name: "solid Food Objects", query: "SELECT count(*) FROM food_objects WHERE physical_state = 'solid'"},
		{name: "liquid Food Objects", query: "SELECT count(*) FROM food_objects WHERE physical_state = 'liquid'"},
		{name: "Food Objects with a Serving", query: "SELECT count(*) FROM food_objects WHERE serving IS NOT NULL"},
		{name: "Food Objects without a Serving", query: "SELECT count(*) FROM food_objects WHERE serving IS NULL"},
		{name: "Food Objects with an image", query: "SELECT count(*) FROM food_objects WHERE image_key IS NOT NULL"},
		{name: "Food Objects without an image", query: "SELECT count(*) FROM food_objects WHERE image_key IS NULL"},
	}
	for _, coverage := range coverageQueries {
		if n := countRows(t, conn, coverage.query); n == 0 {
			t.Fatalf("fresh catalog has no %s", coverage.name)
		}
	}
}

func catalogEligibleIDs(t *testing.T, conn *pgx.Conn, inputID int) []int {
	t.Helper()
	rows, err := conn.Query(context.Background(), `WITH input_family AS (
			SELECT food_family_id FROM food_objects WHERE id = $1
		)
		SELECT fo.id FROM food_objects fo, input_family f
		WHERE fo.id <> $1
		  AND (f.food_family_id IS NULL OR fo.food_family_id IS DISTINCT FROM f.food_family_id)
		ORDER BY fo.id`, inputID)
	if err != nil {
		t.Fatalf("read catalog rows eligible by identity and Food Family for input %d: %v", inputID, err)
	}
	defer rows.Close()

	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan catalog row eligible for input %d: %v", inputID, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate catalog rows eligible for input %d: %v", inputID, err)
	}
	return ids
}
