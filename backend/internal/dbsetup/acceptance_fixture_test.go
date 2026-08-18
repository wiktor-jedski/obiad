package dbsetup

// Phase 2, task 7: reusable PostgreSQL integration-fixture manifest for the
// plausible seeded rows approved in ISSUE-002 (ARCH-017, ARCH-018, REQ-033,
// REQ-071, REQ-072).
//
// This file is implementation-test data. It designates the three acceptance
// inputs (Pizza Margherita at one Serving, Chicken breast at 100 g, Milk at
// 100 ml) and keeps their derived expectations as explicit fixed literals:
// expected ordered fixed IDs, full-precision Nutritional Similarities,
// unrounded Matched Quantities, numeric tolerances, and page data/order
// (including the Pizza page order). None of these derived values are
// generated at runtime, appear in the product-decision issue (ISSUE-002), or
// are stored in production SQL (ARCH-013). TestAcceptanceCatalogCoverage
// recomputes the actual values independently from the live seeded catalog
// (identical after every dbsetup run, P02-G2) and compares them with the
// fixed manifest within the explicit tolerances; the runtime credential reads
// only the source catalog, never a derived value (P02-G4).
//
// Artificial similarity ties, numeric precision boundaries, unknown images,
// and other failure data stay in isolated fixtures owned by the later
// behavior phases (Phase 3/4), not in this manifest.

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5"
)

// PageSize is the fixed Substitute page size: "Count all eligible
// Substitutes, then slice pages of three" (ARCH-018).
const PageSize = 3

// SimilarityTolerance is the explicit absolute tolerance for comparing a
// full-precision Nutritional Similarity with the expected manifest value.
// 1e-12 is orders of magnitude tighter than the whole-percent display
// rounding (ARCH-018) and comfortably above float64 rounding noise for the
// catalog magnitudes.
const SimilarityTolerance = 1e-12

// MatchedQuantityTolerance is the explicit absolute tolerance, in base units
// (g or ml), for comparing an unrounded Matched Quantity with the expected
// manifest value. The largest expected Matched Quantity is about 1.5e3 base
// units (float64 ulp about 2.3e-13), so 1e-9 is about four thousand times
// machine rounding while still far tighter than the whole-base-unit display
// rounding (ARCH-018).
const MatchedQuantityTolerance = 1e-9

// AcceptanceInput is one ISSUE-002 designated acceptance input: the Food
// Object it names plus the Food Quantity it is submitted with (REQ-071).
// Quantity is the designated Food Quantity converted to base units; Unit
// follows the glossary Nutrition Basis ("g" for solid, "ml" for liquid).
type AcceptanceInput struct {
	ID            int
	EnglishName   string
	PolishName    string
	PhysicalState string
	Serving       *float64 // one-Serving base quantity; nil when the row has no Serving
	ImageKey      *string  // known opaque frontend key; nil = absent image (REQ-011)
	Protein       float64  // grams per Nutrition Basis (100 g solids, 100 ml liquids)
	Carbohydrate  float64
	Fat           float64
	Designation   string  // "one Serving", "100 g", or "100 ml"
	Quantity      float64 // designated Food Quantity in base units
	Unit          string  // "g" (solid) or "ml" (liquid)
}

// ExpectedResult is one derived expectation for an eligible Substitutes row:
// the full-precision Nutritional Similarity and the unrounded Matched
// Quantity (ARCH-018), plus the seeded row identity fields so later behavior
// phases can resolve and display the Substitute without re-deriving the
// fixture. Similarity is cosine similarity of the input and candidate Macro
// Profiles; MatchedQuantity is the amount of the Substitute with the same
// derived calorie value as the input, in the Substitute's base units.
type ExpectedResult struct {
	ID              int
	EnglishName     string
	PolishName      string
	PhysicalState   string
	Serving         *float64
	ImageKey        *string
	Similarity      float64 // full precision, unrounded (ARCH-018)
	MatchedQuantity float64 // unrounded, base units (ARCH-018)
}

// AcceptanceFixture is the complete expectation for one designated acceptance
// input: the input itself, the eligible Substitutes in ARCH-018 order
// (decreasing unrounded similarity, pinned English-name collation, stable
// Food Object ID), the full-precision similarities and unrounded Matched
// Quantities for every eligible ID, and the page order (pages of PageSize, in
// order). All derived fields come from the fixed literal manifest.
type AcceptanceFixture struct {
	Input         AcceptanceInput
	EligibleCount int
	OrderedIDs    []int
	Results       map[int]ExpectedResult
	Pages         [][]int
}

// acceptanceFixtureData is the fixed literal expectation data for one
// designated acceptance input: the ISSUE-002 designation plus the derived
// expectations. Nothing in this type is computed at runtime; every value is
// explicit implementation-test data.
type acceptanceFixtureData struct {
	inputID           int
	designation       string
	quantity          float64
	unit              string
	eligibleCount     int
	orderedIDs        []int
	similarities      map[int]float64
	matchedQuantities map[int]float64
	pages             [][]int
}

// acceptanceManifest is the fixed acceptance fixture manifest: literal
// expected ordered fixed IDs, full-precision Nutritional Similarities,
// unrounded Matched Quantities, and page data/order for the three designated
// acceptance inputs, in designated-input order (Pizza Margherita, Chicken
// breast, Milk). The values were derived once from the ISSUE-002 seeded rows
// with the ARCH-018 float64 formulas (calories 4p+4c+9f, cosine similarity,
// Matched Quantity = input total calories / candidate calories per basis,
// pages of three) and are kept here verbatim as implementation-test data.
// TestAcceptanceCatalogCoverage recomputes the actual values from the live
// seeded catalog and compares them with this fixed data within the explicit
// tolerances.
var acceptanceManifest = []acceptanceFixtureData{
	{
		inputID:       1,
		designation:   "one Serving",
		quantity:      350,
		unit:          "g",
		eligibleCount: 36,
		orderedIDs:    []int{13, 29, 26, 30, 3, 35, 14, 4, 21, 28, 24, 25, 10, 31, 36, 34, 8, 37, 33, 15, 32, 9, 16, 17, 12, 20, 38, 22, 11, 27, 7, 6, 5, 23, 18, 19},
		similarities: map[int]float64{
			13: 0.9999999999999999,
			29: 0.9953414448979734,
			26: 0.992122967180221,
			30: 0.9905930241093334,
			3:  0.9884975216264725,
			35: 0.9831984746419012,
			14: 0.9802308629014911,
			4:  0.9794281138741996,
			21: 0.9773646683034033,
			28: 0.9766270004779681,
			24: 0.9753260277218944,
			25: 0.9630323067373009,
			10: 0.9608933667042175,
			31: 0.9570136726330051,
			36: 0.954417484416557,
			34: 0.9459316137034023,
			8:  0.9381598757318013,
			37: 0.9292108999346363,
			33: 0.929130778103323,
			15: 0.9277309792044668,
			32: 0.9154324272853893,
			9:  0.9099408595634808,
			16: 0.7507571935295482,
			17: 0.7385489458759964,
			12: 0.7097364175623982,
			20: 0.7035264706814484,
			38: 0.6823677798338861,
			22: 0.6463137929731515,
			11: 0.5975413546699377,
			27: 0.48065801332024816,
			7:  0.411836769570733,
			6:  0.4064589096192199,
			5:  0.33427907805525386,
			23: 0.3215414728670846,
			18: 0.3088537967635038,
			19: 0.3015113445777636,
		},
		matchedQuantities: map[int]float64{
			13: 437.5,
			29: 557.3248407643312,
			26: 439.69849246231155,
			30: 1521.7391304347825,
			3:  486.1111111111111,
			35: 305.94405594405595,
			14: 1923.076923076923,
			4:  444.16243654822335,
			21: 330.188679245283,
			28: 1223.7762237762238,
			24: 7415.254237288135,
			25: 4166.666666666667,
			10: 1722.44094488189,
			31: 2397.2602739726026,
			36: 301.7241379310345,
			34: 332.6996197718631,
			8:  1548.6725663716813,
			37: 1961.883408071749,
			33: 911.4583333333334,
			15: 364.5833333333333,
			32: 754.3103448275862,
			9:  1931.5673289183223,
			16: 367.6470588235294,
			17: 4166.666666666667,
			12: 902.0618556701031,
			20: 1535.0877192982457,
			38: 502.8735632183908,
			22: 291.6666666666667,
			11: 1415.8576051779935,
			27: 560.8974358974359,
			7:  366.10878661087867,
			6:  373.9316239316239,
			5:  559.462915601023,
			23: 652.9850746268656,
			18: 117.9245283018868,
			19: 106.48655226968481,
		},
		pages: [][]int{
			{13, 29, 26},
			{30, 3, 35},
			{14, 4, 21},
			{28, 24, 25},
			{10, 31, 36},
			{34, 8, 37},
			{33, 15, 32},
			{9, 16, 17},
			{12, 20, 38},
			{22, 11, 27},
			{7, 6, 5},
			{23, 18, 19},
		},
	},
	{
		inputID:       5,
		designation:   "100 g",
		quantity:      100,
		unit:          "g",
		eligibleCount: 37,
		orderedIDs:    []int{23, 11, 6, 7, 20, 12, 17, 38, 22, 16, 27, 33, 15, 10, 34, 21, 3, 29, 2, 30, 13, 1, 36, 24, 26, 25, 28, 4, 35, 14, 32, 31, 18, 19, 8, 37, 9},
		similarities: map[int]float64{
			23: 0.998907198578582,
			11: 0.9353543324988515,
			6:  0.9349276360101546,
			7:  0.9180482249874898,
			20: 0.8957721725667341,
			12: 0.8616005618127677,
			17: 0.8581390272637731,
			38: 0.8449160585104603,
			22: 0.784687287343412,
			16: 0.7829297577451779,
			27: 0.7548244890625163,
			33: 0.6528267460199662,
			15: 0.6185822912841862,
			10: 0.5807298873979415,
			34: 0.4922388287398122,
			21: 0.4767336338257798,
			3:  0.4554195120380183,
			29: 0.3854398792189747,
			2:  0.380736526137415,
			30: 0.36347227209025246,
			13: 0.3342790780552539,
			1:  0.33427907805525386,
			36: 0.2858282548061989,
			24: 0.250929454957195,
			26: 0.22956911771261368,
			25: 0.2288370278298418,
			28: 0.2151042782325363,
			4:  0.1984470913577818,
			35: 0.1730795399958296,
			14: 0.16135694984683235,
			32: 0.149172459878912,
			31: 0.1482638420824551,
			18: 0.12140615187084042,
			19: 0.11535380918585926,
			8:  0.08720576830270779,
			37: 0.07165016691779653,
			9:  0.010078060565712477,
		},
		matchedQuantities: map[int]float64{
			23: 116.71641791044776,
			11: 253.07443365695795,
			6:  66.83760683760684,
			7:  65.43933054393305,
			20: 274.3859649122807,
			12: 161.23711340206185,
			17: 744.7619047619048,
			38: 89.88505747126437,
			22: 52.13333333333333,
			16: 65.71428571428571,
			27: 100.25641025641026,
			33: 162.91666666666666,
			15: 65.16666666666667,
			10: 307.8740157480315,
			34: 59.46768060836502,
			21: 59.0188679245283,
			3:  86.88888888888889,
			29: 99.61783439490446,
			2:  61.333333333333336,
			30: 272.0,
			13: 78.2,
			1:  62.56,
			36: 53.93103448275862,
			24: 1325.4237288135591,
			26: 78.5929648241206,
			25: 744.7619047619048,
			28: 218.74125874125875,
			4:  79.39086294416244,
			35: 54.68531468531469,
			14: 343.7362637362637,
			32: 134.82758620689654,
			31: 428.4931506849315,
			18: 21.078167115902964,
			19: 19.033710599975663,
			8:  276.8141592920354,
			37: 350.67264573991037,
			9:  345.2538631346579,
		},
		pages: [][]int{
			{23, 11, 6},
			{7, 20, 12},
			{17, 38, 22},
			{16, 27, 33},
			{15, 10, 34},
			{21, 3, 29},
			{2, 30, 13},
			{1, 36, 24},
			{26, 25, 28},
			{4, 35, 14},
			{32, 31, 18},
			{19, 8, 37},
			{9},
		},
	},
	{
		inputID:       10,
		designation:   "100 ml",
		quantity:      100,
		unit:          "ml",
		eligibleCount: 37,
		orderedIDs:    []int{33, 3, 21, 15, 2, 29, 34, 1, 13, 30, 26, 36, 24, 35, 28, 4, 17, 25, 14, 16, 12, 20, 31, 38, 32, 8, 37, 22, 11, 9, 27, 7, 6, 5, 23, 18, 19},
		similarities: map[int]float64{
			33: 0.9948293845065213,
			3:  0.9884883774184667,
			21: 0.9870586973699207,
			15: 0.9868320836912063,
			2:  0.973837378656768,
			29: 0.9695185946385043,
			34: 0.9681423632330637,
			1:  0.9608933667042175,
			13: 0.9608933667042174,
			30: 0.9574206651863291,
			26: 0.9216560998074608,
			36: 0.916074437142571,
			24: 0.9092086593548692,
			35: 0.9015748839117563,
			28: 0.9006363540193469,
			4:  0.8991026994418632,
			17: 0.8936544675805062,
			25: 0.8908305843849815,
			14: 0.8906830581567794,
			16: 0.8868794956735842,
			12: 0.8714201867841576,
			20: 0.865583959750419,
			31: 0.8628233929722287,
			38: 0.845440966341699,
			32: 0.8445478722335812,
			8:  0.8280183598951398,
			37: 0.8151756584148735,
			22: 0.8008680059623664,
			11: 0.783713861827738,
			9:  0.78042430215501,
			27: 0.6533163375727711,
			7:  0.6348858598018514,
			6:  0.6340044400663187,
			5:  0.5807298873979415,
			23: 0.5681007386678159,
			18: 0.32994690745915994,
			19: 0.3219113899898252,
		},
		matchedQuantities: map[int]float64{
			33: 52.916666666666664,
			3:  28.22222222222222,
			21: 19.169811320754718,
			15: 21.166666666666668,
			2:  19.92156862745098,
			29: 32.35668789808917,
			34: 19.315589353612168,
			1:  20.32,
			13: 25.4,
			30: 88.34782608695652,
			26: 25.527638190954775,
			36: 17.517241379310345,
			24: 430.50847457627117,
			35: 17.762237762237763,
			28: 71.04895104895105,
			4:  25.78680203045685,
			17: 241.9047619047619,
			25: 241.9047619047619,
			14: 111.64835164835165,
			16: 21.34453781512605,
			12: 52.371134020618555,
			20: 89.12280701754386,
			31: 139.17808219178082,
			38: 29.195402298850574,
			32: 43.793103448275865,
			8:  89.91150442477876,
			37: 113.90134529147984,
			22: 16.933333333333334,
			11: 82.20064724919094,
			9:  112.14128035320088,
			27: 32.56410256410256,
			7:  21.255230125523013,
			6:  21.70940170940171,
			5:  32.48081841432225,
			23: 37.91044776119403,
			18: 6.846361185983827,
			19: 6.182304977485701,
		},
		pages: [][]int{
			{33, 3, 21},
			{15, 2, 29},
			{34, 1, 13},
			{30, 26, 36},
			{24, 35, 28},
			{4, 17, 25},
			{14, 16, 12},
			{20, 31, 38},
			{32, 8, 37},
			{22, 11, 9},
			{27, 7, 6},
			{5, 23, 18},
			{19},
		},
	}}

// AcceptanceFixtures returns the reusable fixture manifest as one
// AcceptanceFixture per designated acceptance input, merging the fixed
// literal expectations with the seeded Food Object identity from
// issue002Catalog (itself fixed implementation-test data validated against
// the seed by TestDeterministicCatalogSeed). Later behavior phases consume
// these fixtures.
func AcceptanceFixtures() []AcceptanceFixture {
	catalog := issue002Catalog()
	byID := make(map[int]seedFoodObject, len(catalog))
	for _, row := range catalog {
		byID[row.id] = row
	}
	fixtures := make([]AcceptanceFixture, 0, len(acceptanceManifest))
	for _, d := range acceptanceManifest {
		row := byID[d.inputID]
		results := make(map[int]ExpectedResult, len(d.orderedIDs))
		for _, id := range d.orderedIDs {
			c := byID[id]
			results[id] = ExpectedResult{
				ID:              c.id,
				EnglishName:     c.en,
				PolishName:      c.pl,
				PhysicalState:   c.state,
				Serving:         c.serving,
				ImageKey:        c.imageKey,
				Similarity:      d.similarities[id],
				MatchedQuantity: d.matchedQuantities[id],
			}
		}
		fixtures = append(fixtures, AcceptanceFixture{
			Input: AcceptanceInput{
				ID:            row.id,
				EnglishName:   row.en,
				PolishName:    row.pl,
				PhysicalState: row.state,
				Serving:       row.serving,
				ImageKey:      row.imageKey,
				Protein:       row.protein,
				Carbohydrate:  row.carbohydrate,
				Fat:           row.fat,
				Designation:   d.designation,
				Quantity:      d.quantity,
				Unit:          d.unit,
			},
			EligibleCount: d.eligibleCount,
			OrderedIDs:    slices.Clone(d.orderedIDs),
			Results:       results,
			Pages:         d.pages,
		})
	}
	return fixtures
}

// liveFoodObject is one seeded Food Object row read back from PostgreSQL for
// cross-checking the manifest against a fresh setup.
type liveFoodObject struct {
	id           int
	en           string
	pl           string
	state        string
	protein      float64
	carbohydrate float64
	fat          float64
	serving      *float64
	familyID     *int
	imageKey     *string
}

// readLiveCatalog loads the complete seeded Food Object catalog from conn.
func readLiveCatalog(t *testing.T, conn *pgx.Conn) map[int]liveFoodObject {
	t.Helper()
	rows, err := conn.Query(context.Background(), `SELECT id, names ->> 'en', names ->> 'pl', physical_state,
		protein, carbohydrate, fat, serving, food_family_id, image_key
		FROM food_objects`)
	if err != nil {
		t.Fatalf("read seeded catalog: %v", err)
	}
	defer rows.Close()
	live := make(map[int]liveFoodObject)
	for rows.Next() {
		var row liveFoodObject
		if err := rows.Scan(&row.id, &row.en, &row.pl, &row.state, &row.protein, &row.carbohydrate,
			&row.fat, &row.serving, &row.familyID, &row.imageKey); err != nil {
			t.Fatalf("scan seeded row: %v", err)
		}
		live[row.id] = row
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate seeded catalog: %v", err)
	}
	return live
}

// dbEligibleIDs returns the IDs eligible as Substitutes for the Food Object
// with the given ID, computed from the seeded catalog using only the input
// and Food Family exclusion (REQ-033): every Food Object except the input
// itself and, when the input has a Food Family, the other members of that
// Family. No other filtering is applied (ARCH-018).
func dbEligibleIDs(t *testing.T, conn *pgx.Conn, inputID int) []int {
	t.Helper()
	rows, err := conn.Query(context.Background(), `WITH input_family AS (
			SELECT food_family_id FROM food_objects WHERE id = $1
		)
		SELECT fo.id FROM food_objects fo, input_family f
		WHERE fo.id <> $1
		  AND (f.food_family_id IS NULL OR fo.food_family_id IS DISTINCT FROM f.food_family_id)
		ORDER BY fo.id`, inputID)
	if err != nil {
		t.Fatalf("compute eligible IDs for input %d: %v", inputID, err)
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan eligible ID for input %d: %v", inputID, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate eligible IDs for input %d: %v", inputID, err)
	}
	return ids
}

func sortedInts(v []int) []int {
	out := append([]int(nil), v...)
	sort.Ints(out)
	return out
}

// wantUnit returns the Matched Quantity base unit for a Physical State.
func wantUnit(state string) string {
	if state == "liquid" {
		return "ml"
	}
	return "g"
}

// TestAcceptanceCatalogCoverage verifies task 7 (P02-G2, P02-G4): the fixed
// acceptance fixture manifest resolves against a fresh setup. Every
// designated input and expected-result ID resolves exactly once; the eligible
// Substitutes counts are 36, 37, and 37 using only the input and Food Family
// exclusion (REQ-033, REQ-071); the full and partial page cardinalities hold
// (ARCH-018 pages of three); Pizza Capricciosa is excluded only for the Pizza
// input; and no expected derived value is stored in a production table
// (ARCH-013).
//
// The actual values (calories, Nutritional Similarities, Matched Quantities,
// order, pages) are computed here independently and inline from the live
// seeded catalog and compared with the fixed literal manifest within the
// explicit numeric tolerances; the manifest is never generated by the code
// under test.
func TestAcceptanceCatalogCoverage(t *testing.T) {
	dbURL := newDisposableDB(t)
	runDBSetupCommand(t, dbURL)
	conn := connect(t, dbURL)
	ctx := context.Background()

	fixtures := AcceptanceFixtures()
	// ISSUE-002 eligible-candidate counts for the designated inputs.
	wantEligible := map[int]int{1: 36, 5: 37, 10: 37}
	if len(fixtures) != len(wantEligible) {
		t.Fatalf("AcceptanceFixtures returned %d fixtures, want %d designated inputs", len(fixtures), len(wantEligible))
	}

	// P02-G2: the deterministic seeded catalog is the derivation source, so
	// the manifest expectations reproduce exactly from a fresh setup. Read
	// the complete catalog back once and cross-check every fixture against
	// these live rows.
	live := readLiveCatalog(t, conn)

	for _, fx := range fixtures {
		in := fx.Input

		// Every designated input resolves exactly once: the fixed ID and both
		// localized names each match exactly one seeded row, and the English
		// and Polish names resolve to the same designated ID (REQ-005,
		// REQ-006).
		var idByEN, idByPL int
		if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'en' = $1`, in.EnglishName).Scan(&idByEN); err != nil {
			t.Fatalf("resolve English name %q for input %d: %v", in.EnglishName, in.ID, err)
		}
		if err := conn.QueryRow(ctx, `SELECT id FROM food_objects WHERE names ->> 'pl' = $1`, in.PolishName).Scan(&idByPL); err != nil {
			t.Fatalf("resolve Polish name %q for input %d: %v", in.PolishName, in.ID, err)
		}
		if idByEN != in.ID || idByPL != in.ID || idByEN != idByPL {
			t.Fatalf("designated input %d resolves by English to %d and by Polish to %d, want %d for both", in.ID, idByEN, idByPL, in.ID)
		}
		for _, name := range []string{in.EnglishName, in.PolishName} {
			var n int
			if err := conn.QueryRow(ctx, `SELECT count(*) FROM food_objects WHERE names ->> 'en' = $1 OR names ->> 'pl' = $1`, name).Scan(&n); err != nil {
				t.Fatalf("count rows for name %q: %v", name, err)
			}
			if n != 1 {
				t.Fatalf("name %q matches %d rows, want exactly 1", name, n)
			}
		}
		if n := countRows(t, conn, fmt.Sprintf("SELECT count(*) FROM food_objects WHERE id = %d", in.ID)); n != 1 {
			t.Fatalf("designated input ID %d resolves to %d rows, want exactly 1", in.ID, n)
		}
		// The fixture input mirrors the seeded row (names, state, Serving,
		// image key, Macro Profile).
		row := live[in.ID]
		if row.en != in.EnglishName || row.pl != in.PolishName || row.state != in.PhysicalState ||
			!equalFloatPtr(row.serving, in.Serving) || !equalStrPtr(row.imageKey, in.ImageKey) ||
			row.protein != in.Protein || row.carbohydrate != in.Carbohydrate || row.fat != in.Fat {
			t.Fatalf("fixture input %d does not mirror the seeded row (got %+v, want %+v)", in.ID, row, in)
		}

		// Every expected-result ID resolves exactly once, and the fixture
		// holds one ExpectedResult per eligible ID.
		seen := make(map[int]bool, fx.EligibleCount)
		for _, id := range fx.OrderedIDs {
			if seen[id] {
				t.Fatalf("fixture for input %d lists result ID %d more than once", in.ID, id)
			}
			seen[id] = true
			if n := countRows(t, conn, fmt.Sprintf("SELECT count(*) FROM food_objects WHERE id = %d", id)); n != 1 {
				t.Fatalf("expected-result ID %d for input %d resolves to %d rows, want exactly 1", id, in.ID, n)
			}
			if _, ok := fx.Results[id]; !ok {
				t.Fatalf("fixture for input %d has no ExpectedResult for ID %d", in.ID, id)
			}
		}
		if len(seen) != fx.EligibleCount {
			t.Fatalf("fixture for input %d lists %d unique expected-result IDs, want %d", in.ID, len(seen), fx.EligibleCount)
		}

		// Eligible counts: 36, 37, and 37, computed from the seeded catalog
		// using only the input and Food Family exclusion (REQ-033, REQ-071).
		dbEligible := dbEligibleIDs(t, conn, in.ID)
		if len(dbEligible) != fx.EligibleCount {
			t.Fatalf("input %d has %d eligible Substitutes, want %d", in.ID, len(dbEligible), fx.EligibleCount)
		}
		if fx.EligibleCount != wantEligible[in.ID] {
			t.Fatalf("fixture eligible count for input %d is %d, want %d (ISSUE-002)", in.ID, fx.EligibleCount, wantEligible[in.ID])
		}
		// The fixture's expected-result ID set is exactly the eligible set:
		// no other filtering is applied.
		if !slices.Equal(sortedInts(dbEligible), sortedInts(fx.OrderedIDs)) {
			t.Fatalf("input %d fixture expected-result IDs do not match the eligible set (db %v, fixture %v)",
				in.ID, sortedInts(dbEligible), sortedInts(fx.OrderedIDs))
		}

		// Page cardinalities (ARCH-018): pages of three; only the last page
		// may be partial; the pages concatenate to the ordered result IDs
		// (the literal Pizza page order).
		n := fx.EligibleCount
		wantPages := (n + PageSize - 1) / PageSize
		if len(fx.Pages) != wantPages {
			t.Fatalf("input %d has %d pages, want %d for %d eligible Substitutes", in.ID, len(fx.Pages), wantPages, n)
		}
		lastSize := n % PageSize
		var flat []int
		for i, page := range fx.Pages {
			if len(page) > PageSize {
				t.Fatalf("input %d page %d has %d items, want at most %d", in.ID, i, len(page), PageSize)
			}
			if i < len(fx.Pages)-1 && len(page) != PageSize {
				t.Fatalf("input %d non-last page %d has %d items, want %d (full page)", in.ID, i, len(page), PageSize)
			}
			if i == len(fx.Pages)-1 {
				wantLast := lastSize
				if wantLast == 0 {
					wantLast = PageSize
				}
				if len(page) != wantLast {
					t.Fatalf("input %d last page has %d items, want %d", in.ID, len(page), wantLast)
				}
			}
			flat = append(flat, page...)
		}
		if !slices.Equal(flat, fx.OrderedIDs) {
			t.Fatalf("input %d pages do not concatenate to the ordered result IDs", in.ID)
		}
		// Full and partial last pages: 36 eligible Substitutes give 12 full
		// pages and no partial page; 37 give 12 full pages plus a partial
		// last page of one.
		if in.ID == 1 {
			if n%PageSize != 0 || len(fx.Pages) != n/PageSize {
				t.Fatalf("Pizza fixture has %d eligible Substitutes, want a multiple of %d (full pages only)", n, PageSize)
			}
			for i, page := range fx.Pages {
				if len(page) != PageSize {
					t.Fatalf("Pizza page %d has %d items, want %d (full page)", i, len(page), PageSize)
				}
			}
		} else {
			if n%PageSize != 1 || len(fx.Pages) != n/PageSize+1 {
				t.Fatalf("input %d has %d eligible Substitutes, want 12 full pages plus a partial last page of one", in.ID, n)
			}
			for i := 0; i < n/PageSize; i++ {
				if len(fx.Pages[i]) != PageSize {
					t.Fatalf("input %d full page %d has %d items, want %d", in.ID, i, len(fx.Pages[i]), PageSize)
				}
			}
			if len(fx.Pages[len(fx.Pages)-1]) != 1 {
				t.Fatalf("input %d partial last page has %d items, want 1", in.ID, len(fx.Pages[len(fx.Pages)-1]))
			}
		}

		// The fixed manifest expectations are reproduced by independent
		// computation from the live seeded rows within the explicit numeric
		// tolerances. The actual values are computed inline here — never by a
		// helper that also generated the expectations, because the
		// expectations are literal data (acceptanceManifest).
		inputCalories := 4*in.Protein + 4*in.Carbohydrate + 9*in.Fat
		normIn := math.Sqrt(in.Protein*in.Protein + in.Carbohydrate*in.Carbohydrate + in.Fat*in.Fat)
		actualSim := make(map[int]float64, fx.EligibleCount)
		actualMQ := make(map[int]float64, fx.EligibleCount)
		for _, id := range fx.OrderedIDs {
			r := live[id]
			dot := in.Protein*r.protein + in.Carbohydrate*r.carbohydrate + in.Fat*r.fat
			normRow := math.Sqrt(r.protein*r.protein + r.carbohydrate*r.carbohydrate + r.fat*r.fat)
			actualSim[id] = dot / (normIn * normRow)
			actualMQ[id] = inputCalories * in.Quantity / (4*r.protein + 4*r.carbohydrate + 9*r.fat)
		}
		for _, id := range fx.OrderedIDs {
			want := fx.Results[id]
			liveRow := live[id]
			if math.Abs(actualSim[id]-want.Similarity) > SimilarityTolerance {
				t.Fatalf("input %d result %d similarity is %.17g, fixed manifest expects %.17g (tolerance %g)", in.ID, id, actualSim[id], want.Similarity, SimilarityTolerance)
			}
			if math.Abs(actualMQ[id]-want.MatchedQuantity) > MatchedQuantityTolerance {
				t.Fatalf("input %d result %d Matched Quantity is %.17g %s, fixed manifest expects %.17g (tolerance %g)", in.ID, id, actualMQ[id], wantUnit(want.PhysicalState), want.MatchedQuantity, MatchedQuantityTolerance)
			}
			if want.EnglishName != liveRow.en || want.PolishName != liveRow.pl || want.PhysicalState != liveRow.state ||
				!equalFloatPtr(want.Serving, liveRow.serving) || !equalStrPtr(want.ImageKey, liveRow.imageKey) {
				t.Fatalf("input %d result %d identity data does not mirror the seeded row", in.ID, id)
			}
		}

		// The literal ordered IDs are the ARCH-018 order: the actual
		// full-precision similarities along that order are strictly
		// decreasing (the approved distinct Macro Profiles never produce
		// artificial ties, so the pinned English-collation and stable-ID
		// tie-breaks of ARCH-018 are never needed).
		for i := 1; i < len(fx.OrderedIDs); i++ {
			if actualSim[fx.OrderedIDs[i-1]] <= actualSim[fx.OrderedIDs[i]] {
				t.Fatalf("input %d actual similarity is not strictly decreasing at rank %d (%.17g then %.17g)", in.ID, i, actualSim[fx.OrderedIDs[i-1]], actualSim[fx.OrderedIDs[i]])
			}
		}

		// Gram and millilitre results: eligibility ignores Physical State, so
		// every fixture covers solid results (g) and liquid results (ml).
		hasSolid, hasLiquid := false, false
		for _, r := range fx.Results {
			hasSolid = hasSolid || r.PhysicalState == "solid"
			hasLiquid = hasLiquid || r.PhysicalState == "liquid"
		}
		if !hasSolid || !hasLiquid {
			t.Fatalf("input %d fixture must cover gram (solid) and millilitre (liquid) Matched Quantities, got solid=%t liquid=%t", in.ID, hasSolid, hasLiquid)
		}

		// Serving and no-Serving defaults: Pizza Margherita is designated at
		// one Serving (its 350 g base quantity); Chicken breast and Milk have
		// no Serving and are designated at the 100 g / 100 ml Nutrition Basis
		// defaults. The Unit always follows the glossary Nutrition Basis.
		if in.ID == 1 {
			if in.Serving == nil || *in.Serving != 350 || in.Quantity != 350 || in.Unit != "g" {
				t.Fatalf("Pizza input must designate one Serving (350 g), got serving=%v quantity=%v unit=%q", in.Serving, in.Quantity, in.Unit)
			}
		} else {
			if in.Serving != nil || in.Quantity != 100 {
				t.Fatalf("input %d must use the no-Serving default 100 %s, got serving=%v quantity=%v", in.ID, in.Unit, in.Serving, in.Quantity)
			}
		}
		if (in.PhysicalState == "solid") != (in.Unit == "g") || (in.PhysicalState == "liquid") != (in.Unit == "ml") {
			t.Fatalf("input %d unit %q does not follow the %s Nutrition Basis", in.ID, in.Unit, in.PhysicalState)
		}

		// Absent images: the designated inputs carry the known image keys
		// (ISSUE-002), and absent images (NULL, the single placeholder state
		// of REQ-011/ARCH-015) are covered by the expected results: every
		// eligible NULL-image seeded row appears with a nil ImageKey.
		if in.ID == 1 && (in.ImageKey == nil || *in.ImageKey != "pizza-margherita") {
			t.Fatalf("Pizza input image key is %v, want %q", in.ImageKey, "pizza-margherita")
		}
		if in.ID == 5 && (in.ImageKey == nil || *in.ImageKey != "chicken-breast") {
			t.Fatalf("Chicken breast input image key is %v, want %q", in.ImageKey, "chicken-breast")
		}
		if in.ID == 10 && (in.ImageKey == nil || *in.ImageKey != "milk") {
			t.Fatalf("Milk input image key is %v, want %q", in.ImageKey, "milk")
		}
		hasAbsent := false
		for _, id := range fx.OrderedIDs {
			r := fx.Results[id]
			if (r.ImageKey == nil) != (live[id].imageKey == nil) {
				t.Fatalf("input %d result %d image state does not mirror the seeded row", in.ID, id)
			}
			hasAbsent = hasAbsent || r.ImageKey == nil
		}
		if !hasAbsent {
			t.Fatalf("input %d fixture covers no absent-image (NULL) expected result", in.ID)
		}
	}

	// Pizza Capricciosa (ID 2) is excluded only for the Pizza input: it is
	// the sole other member of Food Family 1 (REQ-033). It must be absent
	// from the Pizza fixture and present for every other designated input.
	byInputID := make(map[int]AcceptanceFixture, len(fixtures))
	for _, fx := range fixtures {
		byInputID[fx.Input.ID] = fx
	}
	if slices.Contains(byInputID[1].OrderedIDs, 2) {
		t.Fatal("Pizza Capricciosa must be excluded from Pizza Margherita results (Food Family exclusion, REQ-033)")
	}
	if !slices.Contains(byInputID[5].OrderedIDs, 2) {
		t.Fatal("Pizza Capricciosa must be eligible for the Chicken breast input")
	}
	if !slices.Contains(byInputID[10].OrderedIDs, 2) {
		t.Fatal("Pizza Capricciosa must be eligible for the Milk input")
	}
	// Pizza Margherita (ID 1) is excluded only for its own input: it must be
	// eligible for every other designated input.
	if !slices.Contains(byInputID[5].OrderedIDs, 1) || !slices.Contains(byInputID[10].OrderedIDs, 1) {
		t.Fatal("Pizza Margherita must be eligible for the Chicken breast and Milk inputs")
	}

	// P02-G4: no expected derived value is stored in a production table
	// (ARCH-013). food_objects carries exactly the source fields — no derived
	// calories, Nutritional Similarity, Matched Quantity, page, or rounded
	// display values — and the public schema holds no derived-value tables or
	// columns.
	wantColumns := []string{"id", "names", "physical_state", "protein", "carbohydrate", "fat", "serving", "food_family_id", "image_key"}
	rows, err := conn.Query(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'food_objects'
		ORDER BY ordinal_position`)
	if err != nil {
		t.Fatalf("list food_objects columns: %v", err)
	}
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan food_objects column: %v", err)
		}
		columns = append(columns, column)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate food_objects columns: %v", err)
	}
	if len(columns) != len(wantColumns) {
		t.Fatalf("food_objects has %d columns %v, want exactly %v (ARCH-013 source fields only)", len(columns), columns, wantColumns)
	}
	for i, want := range wantColumns {
		if columns[i] != want {
			t.Fatalf("food_objects column %d is %q, want %q (full set %v)", i, columns[i], want, columns)
		}
	}

	wantTables := []string{"food_families", "food_objects", "schema_migrations"}
	rows, err = conn.Query(ctx, `SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		ORDER BY table_name`)
	if err != nil {
		t.Fatalf("list public tables: %v", err)
	}
	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			t.Fatalf("scan public table: %v", err)
		}
		tables = append(tables, table)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate public tables: %v", err)
	}
	if len(tables) != len(wantTables) {
		t.Fatalf("public schema has %d tables %v, want exactly %v (no derived-value tables)", len(tables), tables, wantTables)
	}
	for i, want := range wantTables {
		if tables[i] != want {
			t.Fatalf("public table %d is %q, want %q (full set %v)", i, tables[i], want, tables)
		}
	}
	// No public column name suggests a derived value: the manifest's expected
	// similarities, Matched Quantities, page orders, calories, and rounded
	// display values exist only as implementation-test data.
	derivedColumn := regexp.MustCompile(`(?i)calor|similar|matched|page|round|display`)
	rows, err = conn.Query(ctx, `SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = 'public' ORDER BY table_name, column_name`)
	if err != nil {
		t.Fatalf("list public columns: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			t.Fatalf("scan public column: %v", err)
		}
		if derivedColumn.MatchString(column) {
			t.Fatalf("production column %s.%s suggests a derived value; derived expectations must stay in implementation-test data", table, column)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate public columns: %v", err)
	}
}
