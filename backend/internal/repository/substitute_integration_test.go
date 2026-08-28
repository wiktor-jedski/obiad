package repository

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5"

	"obiad/backend/internal/testdb"
)

const nearEqual = 1e-12

var wantCalories = map[int32]float64{
	1:  250.0,
	2:  255.0,
	3:  180.0,
	4:  197.0,
	5:  156.4,
	6:  234.0,
	7:  239.0,
	8:  56.5,
	9:  45.3,
	10: 50.8,
	11: 61.8,
	12: 97.0,
	13: 200.0,
	14: 45.5,
	15: 240.0,
	16: 238.0,
	17: 21.0,
	18: 742.0,
	19: 821.6999999999999,
	20: 57.0,
	21: 265.0,
	22: 300.0,
	23: 134.0,
	24: 11.8,
	25: 21.0,
	26: 199.0,
	27: 156.0,
	28: 71.5,
	29: 157.0,
	30: 57.5,
	31: 36.5,
	32: 116.0,
	33: 96.0,
	34: 263.0,
	35: 286.0,
	36: 290.0,
	37: 44.599999999999994,
	38: 174.0,
}

type wantCandidate struct {
	id     int32
	cosine float64
}

type wantSubstituteInput struct {
	inputID      int32
	en           string
	pl           string
	macroProfile MacroProfile
	baseUnit     Unit
	serving      *float64
	candidates   []wantCandidate
}

func float64Ptr(v float64) *float64 { return &v }

var wantSubstituteInputs = []wantSubstituteInput{
	{
		inputID:      1,
		en:           "Pizza Margherita",
		pl:           "Pizza margherita",
		macroProfile: MacroProfile{Protein: 10, Carbohydrate: 30, Fat: 10},
		baseUnit:     UnitGram,
		serving:      float64Ptr(350),
		candidates: []wantCandidate{
			/* rank  0, page  0 */ {id: 13, cosine: 0.99999999999999989},
			/* rank  1, page  0 */ {id: 29, cosine: 0.99534144489797338},
			/* rank  2, page  0 */ {id: 26, cosine: 0.99212296718022097},
			/* rank  3, page  1 */ {id: 30, cosine: 0.99059302410933336},
			/* rank  4, page  1 */ {id: 3, cosine: 0.98849752162647253},
			/* rank  5, page  1 */ {id: 35, cosine: 0.98319847464190124},
			/* rank  6, page  2 */ {id: 14, cosine: 0.98023086290149108},
			/* rank  7, page  2 */ {id: 4, cosine: 0.97942811387419959},
			/* rank  8, page  2 */ {id: 21, cosine: 0.97736466830340329},
			/* rank  9, page  3 */ {id: 28, cosine: 0.97662700047796813},
			/* rank 10, page  3 */ {id: 24, cosine: 0.97532602772189436},
			/* rank 11, page  3 */ {id: 25, cosine: 0.96303230673730089},
			/* rank 12, page  4 */ {id: 10, cosine: 0.96089336670421754},
			/* rank 13, page  4 */ {id: 31, cosine: 0.95701367263300507},
			/* rank 14, page  4 */ {id: 36, cosine: 0.95441748441655705},
			/* rank 15, page  5 */ {id: 34, cosine: 0.94593161370340229},
			/* rank 16, page  5 */ {id: 8, cosine: 0.93815987573180126},
			/* rank 17, page  5 */ {id: 37, cosine: 0.92921089993463635},
			/* rank 18, page  6 */ {id: 33, cosine: 0.92913077810332301},
			/* rank 19, page  6 */ {id: 15, cosine: 0.92773097920446679},
			/* rank 20, page  6 */ {id: 32, cosine: 0.91543242728538932},
			/* rank 21, page  7 */ {id: 9, cosine: 0.90994085956348081},
			/* rank 22, page  7 */ {id: 16, cosine: 0.75075719352954817},
			/* rank 23, page  7 */ {id: 17, cosine: 0.7385489458759964},
			/* rank 24, page  8 */ {id: 12, cosine: 0.70973641756239825},
			/* rank 25, page  8 */ {id: 20, cosine: 0.70352647068144836},
			/* rank 26, page  8 */ {id: 38, cosine: 0.68236777983388608},
			/* rank 27, page  9 */ {id: 22, cosine: 0.6463137929731515},
			/* rank 28, page  9 */ {id: 11, cosine: 0.59754135466993774},
			/* rank 29, page  9 */ {id: 27, cosine: 0.48065801332024816},
			/* rank 30, page 10 */ {id: 7, cosine: 0.41183676957073301},
			/* rank 31, page 10 */ {id: 6, cosine: 0.40645890961921988},
			/* rank 32, page 10 */ {id: 5, cosine: 0.33427907805525386},
			/* rank 33, page 11 */ {id: 23, cosine: 0.32154147286708462},
			/* rank 34, page 11 */ {id: 18, cosine: 0.30885379676350377},
			/* rank 35, page 11 */ {id: 19, cosine: 0.30151134457776357},
		},
	},
	{
		inputID:      5,
		en:           "Chicken breast",
		pl:           "Pierś z kurczaka",
		macroProfile: MacroProfile{Protein: 31, Carbohydrate: 0, Fat: 3.6},
		baseUnit:     UnitGram,
		serving:      nil,
		candidates: []wantCandidate{
			/* rank  0, page  0 */ {id: 23, cosine: 0.99890719857858201},
			/* rank  1, page  0 */ {id: 11, cosine: 0.93535433249885147},
			/* rank  2, page  0 */ {id: 6, cosine: 0.93492763601015461},
			/* rank  3, page  1 */ {id: 7, cosine: 0.91804822498748984},
			/* rank  4, page  1 */ {id: 20, cosine: 0.89577217256673414},
			/* rank  5, page  1 */ {id: 12, cosine: 0.86160056181276767},
			/* rank  6, page  2 */ {id: 17, cosine: 0.85813902726377311},
			/* rank  7, page  2 */ {id: 38, cosine: 0.84491605851046025},
			/* rank  8, page  2 */ {id: 22, cosine: 0.78468728734341198},
			/* rank  9, page  3 */ {id: 16, cosine: 0.78292975774517792},
			/* rank 10, page  3 */ {id: 27, cosine: 0.75482448906251631},
			/* rank 11, page  3 */ {id: 33, cosine: 0.65282674601996615},
			/* rank 12, page  4 */ {id: 15, cosine: 0.61858229128418618},
			/* rank 13, page  4 */ {id: 10, cosine: 0.58072988739794151},
			/* rank 14, page  4 */ {id: 34, cosine: 0.49223882873981217},
			/* rank 15, page  5 */ {id: 21, cosine: 0.47673363382577982},
			/* rank 16, page  5 */ {id: 3, cosine: 0.45541951203801828},
			/* rank 17, page  5 */ {id: 29, cosine: 0.38543987921897471},
			/* rank 18, page  6 */ {id: 2, cosine: 0.38073652613741499},
			/* rank 19, page  6 */ {id: 30, cosine: 0.36347227209025246},
			/* rank 20, page  6 */ {id: 13, cosine: 0.33427907805525392},
			/* rank 21, page  7 */ {id: 1, cosine: 0.33427907805525386},
			/* rank 22, page  7 */ {id: 36, cosine: 0.28582825480619889},
			/* rank 23, page  7 */ {id: 24, cosine: 0.25092945495719499},
			/* rank 24, page  8 */ {id: 26, cosine: 0.22956911771261368},
			/* rank 25, page  8 */ {id: 25, cosine: 0.2288370278298418},
			/* rank 26, page  8 */ {id: 28, cosine: 0.21510427823253631},
			/* rank 27, page  9 */ {id: 4, cosine: 0.1984470913577818},
			/* rank 28, page  9 */ {id: 35, cosine: 0.17307953999582959},
			/* rank 29, page  9 */ {id: 14, cosine: 0.16135694984683235},
			/* rank 30, page 10 */ {id: 32, cosine: 0.14917245987891201},
			/* rank 31, page 10 */ {id: 31, cosine: 0.14826384208245511},
			/* rank 32, page 10 */ {id: 18, cosine: 0.12140615187084042},
			/* rank 33, page 11 */ {id: 19, cosine: 0.11535380918585926},
			/* rank 34, page 11 */ {id: 8, cosine: 0.087205768302707792},
			/* rank 35, page 11 */ {id: 37, cosine: 0.071650166917796534},
			/* rank 36, page 12 */ {id: 9, cosine: 0.010078060565712477},
		},
	},
	{
		inputID:      10,
		en:           "Milk",
		pl:           "Mleko",
		macroProfile: MacroProfile{Protein: 3.4, Carbohydrate: 4.8, Fat: 2},
		baseUnit:     UnitMillilitre,
		serving:      nil,
		candidates: []wantCandidate{
			/* rank  0, page  0 */ {id: 33, cosine: 0.99482938450652125},
			/* rank  1, page  0 */ {id: 3, cosine: 0.98848837741846673},
			/* rank  2, page  0 */ {id: 21, cosine: 0.98705869736992069},
			/* rank  3, page  1 */ {id: 15, cosine: 0.98683208369120634},
			/* rank  4, page  1 */ {id: 2, cosine: 0.973837378656768},
			/* rank  5, page  1 */ {id: 29, cosine: 0.96951859463850432},
			/* rank  6, page  2 */ {id: 34, cosine: 0.96814236323306369},
			/* rank  7, page  2 */ {id: 1, cosine: 0.96089336670421754},
			/* rank  8, page  2 */ {id: 13, cosine: 0.96089336670421743},
			/* rank  9, page  3 */ {id: 30, cosine: 0.95742066518632907},
			/* rank 10, page  3 */ {id: 26, cosine: 0.92165609980746077},
			/* rank 11, page  3 */ {id: 36, cosine: 0.91607443714257097},
			/* rank 12, page  4 */ {id: 24, cosine: 0.90920865935486916},
			/* rank 13, page  4 */ {id: 35, cosine: 0.90157488391175633},
			/* rank 14, page  4 */ {id: 28, cosine: 0.90063635401934694},
			/* rank 15, page  5 */ {id: 4, cosine: 0.89910269944186316},
			/* rank 16, page  5 */ {id: 17, cosine: 0.89365446758050615},
			/* rank 17, page  5 */ {id: 25, cosine: 0.89083058438498153},
			/* rank 18, page  6 */ {id: 14, cosine: 0.89068305815677939},
			/* rank 19, page  6 */ {id: 16, cosine: 0.88687949567358415},
			/* rank 20, page  6 */ {id: 12, cosine: 0.87142018678415756},
			/* rank 21, page  7 */ {id: 20, cosine: 0.86558395975041902},
			/* rank 22, page  7 */ {id: 31, cosine: 0.86282339297222865},
			/* rank 23, page  7 */ {id: 38, cosine: 0.84544096634169896},
			/* rank 24, page  8 */ {id: 32, cosine: 0.84454787223358119},
			/* rank 25, page  8 */ {id: 8, cosine: 0.82801835989513983},
			/* rank 26, page  8 */ {id: 37, cosine: 0.81517565841487349},
			/* rank 27, page  9 */ {id: 22, cosine: 0.8008680059623664},
			/* rank 28, page  9 */ {id: 11, cosine: 0.78371386182773795},
			/* rank 29, page  9 */ {id: 9, cosine: 0.78042430215501002},
			/* rank 30, page 10 */ {id: 27, cosine: 0.65331633757277108},
			/* rank 31, page 10 */ {id: 7, cosine: 0.63488585980185142},
			/* rank 32, page 10 */ {id: 6, cosine: 0.63400444006631873},
			/* rank 33, page 11 */ {id: 5, cosine: 0.58072988739794151},
			/* rank 34, page 11 */ {id: 23, cosine: 0.56810073866781585},
			/* rank 35, page 11 */ {id: 18, cosine: 0.32994690745915994},
			/* rank 36, page 12 */ {id: 19, cosine: 0.32191138998982521},
		},
	},
}

func setupSubstituteFixture(t *testing.T) (db *testdb.DB, module *FindSubstitutePage, tracer *stmtTracer, wantSQL string, owner *pgx.Conn) {
	t.Helper()
	db = testdb.NewDB(t)
	runDBSetupCommand(t, db.OwnerURL)
	owner = connect(t, db.OwnerURL)
	db.GrantRuntimeCatalogRead(t, owner)
	tracer = &stmtTracer{}
	runtimeConn := connectWithTracer(t, db.RuntimeURL, tracer)
	var err error
	module, err = NewFindSubstitutePage(runtimeConn)
	if err != nil {
		t.Fatalf("NewFindSubstitutePage: %v", err)
	}
	wantSQL, err = loadCatalogSelect()
	if err != nil {
		t.Fatalf("read embedded catalog SELECT: %v", err)
	}
	return db, module, tracer, wantSQL, owner
}

func pageIDs(page *Page) []int32 {
	ids := make([]int32, len(page.Items))
	for i, item := range page.Items {
		ids[i] = item.FoodObjectID
	}
	return ids
}

func assertPageIDs(t *testing.T, page *Page, want ...int32) {
	t.Helper()
	if len(page.Items) != len(want) {
		t.Fatalf("page %d has %d items with IDs %v, want %d IDs %v", page.PageIndex, len(page.Items), pageIDs(page), len(want), want)
	}
	for i, id := range want {
		if page.Items[i].FoodObjectID != id {
			t.Fatalf("page %d item %d has ID %d, want %d (full order %v)", page.PageIndex, i, page.Items[i].FoodObjectID, id, pageIDs(page))
		}
	}
}

func assertNearEqual(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > nearEqual {
		t.Fatalf("%s = %.17g, want %.17g (abs difference %.3g exceeds 1e-12)", name, got, want, math.Abs(got-want))
	}
}

func assertSelectedFood(t *testing.T, got SelectedFood, want wantSubstituteInput) {
	t.Helper()
	if got.FoodObjectID != want.inputID {
		t.Fatalf("SelectedFood.FoodObjectID %d, want %d", got.FoodObjectID, want.inputID)
	}
	if got.Names.En != want.en || got.Names.Pl != want.pl {
		t.Fatalf("SelectedFood.Names (%q, %q), want (%q, %q)", got.Names.En, got.Names.Pl, want.en, want.pl)
	}
	if got.MacroProfile != want.macroProfile {
		t.Fatalf("SelectedFood.MacroProfile %+v, want %+v", got.MacroProfile, want.macroProfile)
	}
	if got.BaseUnit != want.baseUnit {
		t.Fatalf("SelectedFood.BaseUnit %q, want %q", got.BaseUnit, want.baseUnit)
	}
	if want.serving == nil {
		if got.Serving != nil {
			t.Fatalf("SelectedFood.Serving %v, want nil", *got.Serving)
		}
	} else {
		if got.Serving == nil || *got.Serving != *want.serving {
			t.Fatalf("SelectedFood.Serving %v, want %v", got.Serving, *want.serving)
		}
	}
}

func assertCandidateItem(t *testing.T, item SubstituteItem, want wantCandidate, candObject foodObject) {
	t.Helper()
	if item.FoodObjectID != want.id {
		t.Fatalf("item.FoodObjectID %d, want %d", item.FoodObjectID, want.id)
	}
	if item.Names != candObject.names {
		t.Fatalf("item %d Names %+v, want %+v", item.FoodObjectID, item.Names, candObject.names)
	}
	if candObject.imageKey == nil {
		if item.ImageKey != nil {
			t.Fatalf("item %d ImageKey %v, want nil", item.FoodObjectID, *item.ImageKey)
		}
	} else {
		if item.ImageKey == nil || *item.ImageKey != *candObject.imageKey {
			t.Fatalf("item %d ImageKey %v, want %v", item.FoodObjectID, item.ImageKey, *candObject.imageKey)
		}
	}
	wantProfile := MacroProfile{Protein: candObject.protein, Carbohydrate: candObject.carbohydrate, Fat: candObject.fat}
	if item.MacroProfile != wantProfile {
		t.Fatalf("item %d MacroProfile %+v, want %+v", item.FoodObjectID, item.MacroProfile, wantProfile)
	}
	wantBaseUnit := baseUnit(candObject.physicalState)
	if item.BaseUnit != wantBaseUnit {
		t.Fatalf("item %d BaseUnit %q, want %q", item.FoodObjectID, item.BaseUnit, wantBaseUnit)
	}
	if candObject.serving == nil {
		if item.Serving != nil {
			t.Fatalf("item %d Serving %v, want nil", item.FoodObjectID, *item.Serving)
		}
	} else {
		if item.Serving == nil || *item.Serving != *candObject.serving {
			t.Fatalf("item %d Serving %v, want %v", item.FoodObjectID, item.Serving, *candObject.serving)
		}
	}
	assertNearEqual(t, "cosineSimilarity", item.Similarity, want.cosine)
	if wantPercent := projectSimilarityPercent(want.cosine); item.SimilarityPercent != wantPercent {
		t.Fatalf("item %d SimilarityPercent %d, want %d", item.FoodObjectID, item.SimilarityPercent, wantPercent)
	}
}

func loadFoodObjectsMap(t *testing.T, module *FindSubstitutePage, ctx context.Context) map[int32]foodObject {
	t.Helper()
	objects, err := module.loader.load(ctx)
	if err != nil {
		t.Fatalf("load catalog through the private Loader: %v", err)
	}
	res := make(map[int32]foodObject, len(objects))
	for _, object := range objects {
		res[object.id] = object
	}
	return res
}

func assertBitIdenticalTie(t *testing.T, module *FindSubstitutePage, ctx context.Context, inputID, aID, bID int32) {
	t.Helper()
	profiles := loadProfiles(t, module, ctx)
	inputProfile, ok := profiles[inputID]
	if !ok {
		t.Fatalf("loaded catalog has no tie input %d", inputID)
	}
	simA := cosineSimilarity(inputProfile, profiles[aID])
	simB := cosineSimilarity(inputProfile, profiles[bID])
	if simA != simB {
		t.Fatalf("identical-profile candidates %d and %d must have bit-identical similarity: %.17g vs %.17g", aID, bID, simA, simB)
	}
}

func loadProfiles(t *testing.T, module *FindSubstitutePage, ctx context.Context) map[int32]macroProfile {
	t.Helper()
	objects, err := module.loader.load(ctx)
	if err != nil {
		t.Fatalf("load catalog through the private Loader: %v", err)
	}
	profiles := make(map[int32]macroProfile, len(objects))
	for _, object := range objects {
		profiles[object.id] = macroProfile{protein: object.protein, carbohydrate: object.carbohydrate, fat: object.fat}
	}
	return profiles
}

func TestFindSubstitutePageIntegration(t *testing.T) {
	_, module, tracer, wantSQL, owner := setupSubstituteFixture(t)
	ctx := context.Background()

	run := func(inputID int32, pageIndex int32) *Page {
		t.Helper()
		tracer.reset()
		page, err := module.Run(ctx, inputID, pageIndex)
		if err != nil {
			t.Fatalf("Run(input %d, page %d): %v", inputID, pageIndex, err)
		}
		tracer.assertSingleSelect(t, wantSQL)
		return page
	}

	objectsMap := loadFoodObjectsMap(t, module, ctx)
	excludedByInput := map[int32][]int32{1: {1, 2}, 5: {5}, 10: {10}}

	for _, want := range wantSubstituteInputs {
		totalCandidates := len(want.candidates)
		totalPages := (totalCandidates + pageSize - 1) / pageSize

		var concatenatedIDs []int32
		for p := 0; p < totalPages; p++ {
			pageIndex := int32(p)
			page := run(want.inputID, pageIndex)
			if page.PageIndex != pageIndex {
				t.Fatalf("input %d, page %d: echoed index %d, want %d", want.inputID, p, page.PageIndex, pageIndex)
			}
			if page.TotalEligibleCount != totalCandidates {
				t.Fatalf("input %d, page %d: total eligible count %d, want %d", want.inputID, p, page.TotalEligibleCount, totalCandidates)
			}
			wantHasMore := p < totalPages-1
			if page.HasMore != wantHasMore {
				t.Fatalf("input %d, page %d: hasMore %v, want %v", want.inputID, p, page.HasMore, wantHasMore)
			}
			assertSelectedFood(t, page.SelectedFood, want)

			startRank := p * pageSize
			endRank := min(startRank+pageSize, totalCandidates)
			pageWants := want.candidates[startRank:endRank]
			if len(page.Items) != len(pageWants) {
				t.Fatalf("input %d, page %d: returned %d items, want %d", want.inputID, p, len(page.Items), len(pageWants))
			}

			pageSeen := make(map[int32]bool, len(page.Items))
			for i, cand := range pageWants {
				item := page.Items[i]
				if item.FoodObjectID != cand.id {
					t.Fatalf("input %d, page %d, item %d: ID %d, want %d", want.inputID, p, i, item.FoodObjectID, cand.id)
				}
				if pageSeen[item.FoodObjectID] {
					t.Fatalf("input %d, page %d: duplicate item ID %d", want.inputID, p, item.FoodObjectID)
				}
				pageSeen[item.FoodObjectID] = true
				concatenatedIDs = append(concatenatedIDs, item.FoodObjectID)

				for _, excludedID := range excludedByInput[want.inputID] {
					if item.FoodObjectID == excludedID {
						t.Fatalf("input %d, page %d: excluded Food Object %d appears in page items", want.inputID, p, excludedID)
					}
				}

				candObject := objectsMap[cand.id]
				assertCandidateItem(t, item, cand, candObject)
			}
		}

		if len(concatenatedIDs) != totalCandidates {
			t.Fatalf("input %d: concatenated sequence length %d, want %d", want.inputID, len(concatenatedIDs), totalCandidates)
		}
		allSeen := make(map[int32]bool, len(concatenatedIDs))
		for idx, id := range concatenatedIDs {
			if id != want.candidates[idx].id {
				t.Fatalf("input %d, rank %d: ID %d, want %d", want.inputID, idx, id, want.candidates[idx].id)
			}
			if allSeen[id] {
				t.Fatalf("input %d: duplicate Food Object ID %d in concatenated result sequence", want.inputID, id)
			}
			allSeen[id] = true
		}
		for _, excludedID := range excludedByInput[want.inputID] {
			if allSeen[excludedID] {
				t.Fatalf("input %d: excluded Food Object %d appears in concatenated result sequence", want.inputID, excludedID)
			}
		}

		firstAfterLast := int32(totalPages)
		tracer.reset()
		outPage, err := module.Run(ctx, want.inputID, firstAfterLast)
		if outPage != nil {
			t.Fatalf("input %d, page %d returned page %+v, want CodePageOutOfRange", want.inputID, firstAfterLast, outPage)
		}
		assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
		tracer.assertSingleSelect(t, wantSQL)

		tracer.reset()
		maxPage, err := module.Run(ctx, want.inputID, math.MaxInt32)
		if maxPage != nil {
			t.Fatalf("input %d, page MaxInt32 returned page %+v, want CodePageOutOfRange", want.inputID, maxPage)
		}
		assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
		tracer.assertSingleSelect(t, wantSQL)

		tracer.reset()
		negPage, err := module.Run(ctx, want.inputID, -1)
		if negPage != nil {
			t.Fatalf("input %d, page -1 returned page %+v, want CodeInvalidPageIndex", want.inputID, negPage)
		}
		assertStableFailure(t, err, CodeInvalidPageIndex, "pageIndex")
		if len(tracer.stmts) != 0 {
			t.Fatalf("catalog-independent rejection executed %d statements, want zero", len(tracer.stmts))
		}
	}

	profiles := loadProfiles(t, module, ctx)
	for id, want := range wantCalories {
		profile, ok := profiles[id]
		if !ok {
			t.Fatalf("loaded catalog has no Food Object %d", id)
		}
		assertNearEqual(t, "calories(profile 1)", calories(profile), want)
	}
	if n := countFoodObjects(t, owner); n != 38 {
		t.Fatalf("catalog has %d Food Objects after the Runs, want the unchanged 38 seeded rows", n)
	}
	wantColumns := []string{"id", "names", "physical_state", "protein", "carbohydrate", "fat", "serving", "food_family_id", "image_key"}
	assertFoodObjectColumns(t, owner, wantColumns)

	insertTieObject := func(id int32, en, pl string, protein, carbohydrate, fat float64) {
		t.Helper()
		if _, err := owner.Exec(ctx,
			`INSERT INTO food_objects (id, names, physical_state, protein, carbohydrate, fat) VALUES ($1, $2::jsonb, 'solid', $3, $4, $5)`,
			id, `{"en": "`+en+`", "pl": "`+pl+`"}`, protein, carbohydrate, fat,
		); err != nil {
			t.Fatalf("owner tie-fixture insert for ID %d: %v", id, err)
		}
	}

	insertTieObject(43, "Tie input", "Wprowadzenie wiazania", 10, 20, 5)
	insertTieObject(44, "Tie duplicate", "Duplikat wiazania", 10, 20, 5)
	insertTieObject(45, "Tie duplicate", "Duplikat wiazania", 10, 20, 5)
	idTie := run(43, 0)
	if idTie.TotalEligibleCount != 40 {
		t.Fatalf("tie input 43: total eligible count %d, want 40 (38 seeded + 3 fixtures minus the input)", idTie.TotalEligibleCount)
	}
	if !idTie.HasMore {
		t.Fatalf("tie input 43: hasMore false, want true")
	}
	assertPageIDs(t, idTie, 44, 45, 29)
	assertBitIdenticalTie(t, module, ctx, 43, 44, 45)
	if idTie.Items[0].Names.En != "Tie duplicate" || idTie.Items[1].Names.En != "Tie duplicate" {
		t.Fatalf("stable-ID tie fixtures carry names %q and %q, want both \"Tie duplicate\"", idTie.Items[0].Names.En, idTie.Items[1].Names.En)
	}
	if idTie.Items[0].FoodObjectID != 44 || idTie.Items[1].FoodObjectID != 45 {
		t.Fatalf("identical-name tie ordered as %v, want [44 45] by stable Food Object ID", pageIDs(idTie)[:2])
	}

	insertTieObject(53, "Tie zulu input", "Wprowadzenie zulu", 4, 6, 8)
	insertTieObject(54, "Tie zulu", "Zulu wiazania", 4, 6, 8)
	insertTieObject(55, "Tie alpha", "Alfa wiazania", 4, 6, 8)
	nameTie := run(53, 0)
	if nameTie.TotalEligibleCount != 43 {
		t.Fatalf("tie input 53: total eligible count %d, want 43 (38 seeded + 6 fixtures minus the input)", nameTie.TotalEligibleCount)
	}
	if !nameTie.HasMore {
		t.Fatalf("tie input 53: hasMore false, want true")
	}
	assertPageIDs(t, nameTie, 55, 54, 34)
	assertBitIdenticalTie(t, module, ctx, 53, 55, 54)
	if nameTie.Items[0].Names.En != "Tie alpha" || nameTie.Items[1].Names.En != "Tie zulu" {
		t.Fatalf("English-name tie ordered as %q then %q, want \"Tie alpha\" then \"Tie zulu\"", nameTie.Items[0].Names.En, nameTie.Items[1].Names.En)
	}
	if nameTie.Items[0].FoodObjectID != 55 || nameTie.Items[1].FoodObjectID != 54 {
		t.Fatalf("English-name tie ordered as %v, want [55 54]: the pinned English collation must override the ascending stable-ID order",
			pageIDs(nameTie)[:2])
	}

	insertTieObject(66, "Tie case input", "Wprowadzenie wielkosci liter", 2, 2, 2)
	insertTieObject(67, "Tie case", "Wielkosc liter", 2, 2, 2)
	insertTieObject(68, "tie case", "wielkosc liter", 2, 2, 2)
	caseTie := run(66, 0)
	if caseTie.TotalEligibleCount != 46 {
		t.Fatalf("tie input 66: total eligible count %d, want 46 (38 seeded + 9 fixtures minus the input)", caseTie.TotalEligibleCount)
	}
	if !caseTie.HasMore {
		t.Fatalf("tie input 66: hasMore false, want true")
	}
	assertPageIDs(t, caseTie, 68, 67, 15)
	assertBitIdenticalTie(t, module, ctx, 66, 68, 67)
	if caseTie.Items[0].Names.En != "tie case" || caseTie.Items[1].Names.En != "Tie case" {
		t.Fatalf("case tie ordered as %q then %q, want \"tie case\" then \"Tie case\" by the raw English collation", caseTie.Items[0].Names.En, caseTie.Items[1].Names.En)
	}
	if caseTie.Items[0].FoodObjectID != 68 || caseTie.Items[1].FoodObjectID != 67 {
		t.Fatalf("case tie ordered as %v, want [68 67]: the raw stored-name collation must order lowercase before title case",
			pageIDs(caseTie)[:2])
	}

	insertTieObject(76, "Tie whitespace input", "Wprowadzenie spacji", 5, 3, 1)
	insertTieObject(77, "Tie space", "Spacja", 5, 3, 1)
	insertTieObject(78, "Tie  space", "Podwojna spacja", 5, 3, 1)
	spaceTie := run(76, 0)
	if spaceTie.TotalEligibleCount != 49 {
		t.Fatalf("tie input 76: total eligible count %d, want 49 (38 seeded + 12 fixtures minus the input)", spaceTie.TotalEligibleCount)
	}
	if !spaceTie.HasMore {
		t.Fatalf("tie input 76: hasMore false, want true")
	}
	assertPageIDs(t, spaceTie, 78, 77, 20)
	assertBitIdenticalTie(t, module, ctx, 76, 78, 77)
	if spaceTie.Items[0].Names.En != "Tie  space" || spaceTie.Items[1].Names.En != "Tie space" {
		t.Fatalf("whitespace tie ordered as %q then %q, want \"Tie  space\" then \"Tie space\" by the raw English collation", spaceTie.Items[0].Names.En, spaceTie.Items[1].Names.En)
	}
	if spaceTie.Items[0].FoodObjectID != 78 || spaceTie.Items[1].FoodObjectID != 77 {
		t.Fatalf("whitespace tie ordered as %v, want [78 77]: the raw stored-name collation must order the double-space name before the single-space name",
			pageIDs(spaceTie)[:2])
	}

	insertTieObject(95, "Zero result input", "Wprowadzenie zero wynikow", 10, 20, 5)
	if _, err := owner.Exec(ctx, "INSERT INTO food_families (id) VALUES (99)"); err != nil {
		t.Fatalf("owner insert food_families 99: %v", err)
	}
	if _, err := owner.Exec(ctx, "UPDATE food_objects SET food_family_id = 99"); err != nil {
		t.Fatalf("owner update food_objects to food_family_id 99: %v", err)
	}
	zeroPage0 := run(95, 0)
	if zeroPage0.PageIndex != 0 {
		t.Fatalf("zero-result page index %d, want 0", zeroPage0.PageIndex)
	}
	if zeroPage0.TotalEligibleCount != 0 {
		t.Fatalf("zero-result total count %d, want 0", zeroPage0.TotalEligibleCount)
	}
	if zeroPage0.HasMore {
		t.Fatalf("zero-result hasMore true, want false")
	}
	if len(zeroPage0.Items) != 0 {
		t.Fatalf("zero-result items length %d, want 0", len(zeroPage0.Items))
	}
	tracer.reset()
	zeroPage1, err := module.Run(ctx, 95, 1)
	if zeroPage1 != nil {
		t.Fatalf("zero-result page 1 returned page %+v, want CodePageOutOfRange", zeroPage1)
	}
	assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
	tracer.assertSingleSelect(t, wantSQL)

	runExpectInternalError := func(foodObjectID int32) {
		t.Helper()
		tracer.reset()
		page, err := module.Run(ctx, foodObjectID, 0)
		if err == nil {
			t.Fatalf("Run(input %d) returned page %+v, want INTERNAL_ERROR for the nonfinite derived arithmetic", foodObjectID, page)
		}
		var moduleErr *Error
		if !errors.As(err, &moduleErr) || moduleErr.Code != CodeInternalError {
			t.Fatalf("Run(input %d) failure %v, want the stable INTERNAL_ERROR classification", foodObjectID, err)
		}
		tracer.assertSingleSelect(t, wantSQL)
	}
	insertTieObject(90, "Small normal input", "Maly normalny produkt", 0.1, 0, 0)
	insertTieObject(91, "Largest calories candidate", "Kandydat o najwiekszej kalorycznosci", math.MaxFloat64, 0, 0)
	runExpectInternalError(90)

	insertTieObject(88, "Subnormal candidate", "Subnormalny kandydat", math.SmallestNonzeroFloat64, 0, 0)
	runExpectInternalError(43)

	insertTieObject(89, "Subnormal input", "Subnormalne wprowadzenie", math.SmallestNonzeroFloat64, 0, 0)
	runExpectInternalError(89)

	insertTieObject(87, "Largest candidate", "Najwiekszy kandydat", math.MaxFloat64, 0, 0)
	runExpectInternalError(43)

	insertTieObject(86, "Largest input", "Najwieksze wprowadzenie", math.MaxFloat64, 0, 0)
	runExpectInternalError(86)
}

func countFoodObjects(t *testing.T, owner *pgx.Conn) int {
	t.Helper()
	var n int
	if err := owner.QueryRow(context.Background(), "SELECT count(*) FROM food_objects").Scan(&n); err != nil {
		t.Fatalf("count Food Objects: %v", err)
	}
	return n
}

func assertFoodObjectColumns(t *testing.T, owner *pgx.Conn, want []string) {
	t.Helper()
	rows, err := owner.Query(context.Background(), `SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'food_objects'
		ORDER BY ordinal_position`)
	if err != nil {
		t.Fatalf("list food_objects columns: %v", err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan food_objects column: %v", err)
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate food_objects columns: %v", err)
	}
	if len(columns) != len(want) {
		t.Fatalf("food_objects has %d columns %v, want exactly %v (ARCH-013 source fields only)", len(columns), columns, want)
	}
	for i, column := range want {
		if columns[i] != column {
			t.Fatalf("food_objects column %d is %q, want %q (full set %v)", i, columns[i], column, columns)
		}
	}
}
