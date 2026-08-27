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
	id              int32
	calories        float64
	cosine          float64
	matchedQuantity float64
	protein         float64
	carbohydrate    float64
	fat             float64
	unit            Unit
}

type wantSubstituteInput struct {
	inputID       int32
	quantity      FoodQuantity
	baseQuantity  float64
	totalCalories float64
	candidates    []wantCandidate
}

var wantSubstituteInputs = []wantSubstituteInput{
	{
		inputID:       1,
		quantity:      FoodQuantity{Value: 1, Unit: UnitServing},
		baseQuantity:  350,
		totalCalories: 875.0,
		candidates: []wantCandidate{
			/* rank  0, page  0 */ {id: 13, calories: 200, cosine: 0.99999999999999989, matchedQuantity: 437.5, protein: 35, carbohydrate: 105, fat: 35, unit: UnitGram},
			/* rank  1, page  0 */ {id: 29, calories: 157, cosine: 0.99534144489797338, matchedQuantity: 557.32484076433116, protein: 44.585987261146492, carbohydrate: 111.46496815286623, fat: 27.866242038216559, unit: UnitGram},
			/* rank  2, page  0 */ {id: 26, calories: 199, cosine: 0.99212296718022097, matchedQuantity: 439.69849246231155, protein: 26.38190954773869, carbohydrate: 123.11557788944724, fat: 30.778894472361809, unit: UnitGram},
			/* rank  3, page  1 */ {id: 30, calories: 57.5, cosine: 0.99059302410933336, matchedQuantity: 1521.7391304347825, protein: 45.652173913043477, carbohydrate: 121.7391304347826, fat: 22.826086956521738, unit: UnitMillilitre},
			/* rank  4, page  1 */ {id: 3, calories: 180, cosine: 0.98849752162647253, matchedQuantity: 486.11111111111109, protein: 43.75, carbohydrate: 87.5, fat: 38.888888888888886, unit: UnitGram},
			/* rank  5, page  1 */ {id: 35, calories: 286, cosine: 0.98319847464190124, matchedQuantity: 305.94405594405595, protein: 15.297202797202797, carbohydrate: 107.08041958041959, fat: 42.832167832167833, unit: UnitGram},
			/* rank  6, page  2 */ {id: 14, calories: 45.5, cosine: 0.98023086290149108, matchedQuantity: 1923.0769230769231, protein: 19.23076923076923, carbohydrate: 134.61538461538461, fat: 28.846153846153847, unit: UnitMillilitre},
			/* rank  7, page  2 */ {id: 4, calories: 197, cosine: 0.97942811387419959, matchedQuantity: 444.16243654822335, protein: 26.649746192893399, carbohydrate: 142.13197969543148, fat: 22.208121827411169, unit: UnitGram},
			/* rank  8, page  2 */ {id: 21, calories: 265, cosine: 0.97736466830340329, matchedQuantity: 330.18867924528303, protein: 42.924528301886795, carbohydrate: 79.245283018867923, fat: 42.924528301886795, unit: UnitGram},
			/* rank  9, page  3 */ {id: 28, calories: 71.5, cosine: 0.97662700047796813, matchedQuantity: 1223.7762237762238, protein: 30.594405594405593, carbohydrate: 146.85314685314685, fat: 18.356643356643357, unit: UnitGram},
			/* rank 10, page  3 */ {id: 24, calories: 11.800000000000001, cosine: 0.97532602772189436, matchedQuantity: 7415.2542372881353, protein: 37.076271186440678, carbohydrate: 148.30508474576271, fat: 14.830508474576272, unit: UnitGram},
			/* rank 11, page  3 */ {id: 25, calories: 21, cosine: 0.96303230673730089, matchedQuantity: 4166.666666666667, protein: 37.500000000000007, carbohydrate: 162.5, fat: 8.3333333333333357, unit: UnitGram},
			/* rank 12, page  4 */ {id: 10, calories: 50.799999999999997, cosine: 0.96089336670421754, matchedQuantity: 1722.4409448818899, protein: 58.562992125984259, carbohydrate: 82.677165354330725, fat: 34.4488188976378, unit: UnitMillilitre},
			/* rank 13, page  4 */ {id: 31, calories: 36.5, cosine: 0.95701367263300507, matchedQuantity: 2397.2602739726026, protein: 23.972602739726025, carbohydrate: 167.80821917808217, fat: 11.986301369863012, unit: UnitMillilitre},
			/* rank 14, page  4 */ {id: 36, calories: 290, cosine: 0.95441748441655705, matchedQuantity: 301.72413793103448, protein: 21.120689655172413, carbohydrate: 75.431034482758619, fat: 54.310344827586206, unit: UnitGram},
			/* rank 15, page  5 */ {id: 34, calories: 263, cosine: 0.94593161370340229, matchedQuantity: 332.69961977186313, protein: 39.923954372623577, carbohydrate: 66.539923954372625, fat: 49.904942965779462, unit: UnitGram},
			/* rank 16, page  5 */ {id: 8, calories: 56.5, cosine: 0.93815987573180126, matchedQuantity: 1548.6725663716813, protein: 15.486725663716813, carbohydrate: 185.84070796460176, fat: 7.7433628318584065, unit: UnitGram},
			/* rank 17, page  5 */ {id: 37, calories: 44.599999999999994, cosine: 0.92921089993463635, matchedQuantity: 1961.883408071749, protein: 13.733183856502242, carbohydrate: 196.18834080717491, fat: 3.9237668161434982, unit: UnitMillilitre},
			/* rank 18, page  6 */ {id: 33, calories: 96, cosine: 0.92913077810332301, matchedQuantity: 911.45833333333337, protein: 63.802083333333343, carbohydrate: 72.916666666666671, fat: 36.458333333333336, unit: UnitMillilitre},
			/* rank 19, page  6 */ {id: 15, calories: 240, cosine: 0.92773097920446679, matchedQuantity: 364.58333333333331, protein: 54.6875, carbohydrate: 65.625, fat: 43.75, unit: UnitGram},
			/* rank 20, page  6 */ {id: 32, calories: 116, cosine: 0.91543242728538932, matchedQuantity: 754.31034482758616, protein: 7.5431034482758612, carbohydrate: 75.431034482758619, fat: 60.34482758620689, unit: UnitGram},
			/* rank 21, page  7 */ {id: 9, calories: 45.299999999999997, cosine: 0.90994085956348081, matchedQuantity: 1931.5673289183223, protein: 1.9315673289183224, carbohydrate: 212.47240618101546, fat: 1.9315673289183224, unit: UnitMillilitre},
			/* rank 22, page  7 */ {id: 16, calories: 238, cosine: 0.75075719352954817, matchedQuantity: 367.64705882352939, protein: 66.17647058823529, carbohydrate: 36.764705882352935, fat: 51.470588235294116, unit: UnitGram},
			/* rank 23, page  7 */ {id: 17, calories: 21, cosine: 0.7385489458759964, matchedQuantity: 4166.666666666667, protein: 83.333333333333343, carbohydrate: 41.666666666666671, fat: 41.666666666666671, unit: UnitMillilitre},
			/* rank 24, page  8 */ {id: 12, calories: 97, cosine: 0.70973641756239825, matchedQuantity: 902.06185567010311, protein: 81.185567010309285, carbohydrate: 36.082474226804123, fat: 45.103092783505154, unit: UnitGram},
			/* rank 25, page  8 */ {id: 20, calories: 57, cosine: 0.70352647068144836, matchedQuantity: 1535.0877192982457, protein: 122.80701754385966, carbohydrate: 61.403508771929829, fat: 15.350877192982457, unit: UnitMillilitre},
			/* rank 26, page  8 */ {id: 38, calories: 174, cosine: 0.68236777983388608, matchedQuantity: 502.87356321839081, protein: 75.431034482758619, carbohydrate: 30.172413793103452, fat: 50.287356321839077, unit: UnitGram},
			/* rank 27, page  9 */ {id: 22, calories: 300, cosine: 0.6463137929731515, matchedQuantity: 291.66666666666669, protein: 64.166666666666671, carbohydrate: 23.333333333333336, fat: 58.333333333333343, unit: UnitGram},
			/* rank 28, page  9 */ {id: 11, calories: 61.799999999999997, cosine: 0.59754135466993774, matchedQuantity: 1415.8576051779935, protein: 155.74433656957927, carbohydrate: 56.63430420711974, fat: 2.8317152103559868, unit: UnitGram},
			/* rank 29, page  9 */ {id: 27, calories: 156, cosine: 0.48065801332024816, matchedQuantity: 560.89743589743591, protein: 61.698717948717949, carbohydrate: 5.6089743589743595, fat: 67.307692307692307, unit: UnitGram},
			/* rank 30, page 10 */ {id: 7, calories: 239, cosine: 0.41183676957073301, matchedQuantity: 366.10878661087867, protein: 95.188284518828453, carbohydrate: 0, fat: 54.916317991631807, unit: UnitGram},
			/* rank 31, page 10 */ {id: 6, calories: 234, cosine: 0.40645890961921988, matchedQuantity: 373.9316239316239, protein: 100.96153846153845, carbohydrate: 0, fat: 52.350427350427346, unit: UnitGram},
			/* rank 32, page 10 */ {id: 5, calories: 156.40000000000001, cosine: 0.33427907805525386, matchedQuantity: 559.46291560102304, protein: 173.43350383631713, carbohydrate: 0, fat: 20.14066496163683, unit: UnitGram},
			/* rank 33, page 11 */ {id: 23, calories: 134, cosine: 0.32154147286708462, matchedQuantity: 652.98507462686564, protein: 189.36567164179104, carbohydrate: 0, fat: 13.059701492537313, unit: UnitGram},
			/* rank 34, page 11 */ {id: 18, calories: 742, cosine: 0.30885379676350377, matchedQuantity: 117.9245283018868, protein: 0.589622641509434, carbohydrate: 0.589622641509434, fat: 96.698113207547181, unit: UnitGram},
			/* rank 35, page 11 */ {id: 19, calories: 821.69999999999993, cosine: 0.30151134457776357, matchedQuantity: 106.48655226968481, protein: 0, carbohydrate: 0, fat: 97.222222222222229, unit: UnitMillilitre},
		},
	},
	{
		inputID:       5,
		quantity:      FoodQuantity{Value: 100, Unit: UnitGram},
		baseQuantity:  100,
		totalCalories: 156.4,
		candidates: []wantCandidate{
			/* rank  0, page  0 */ {id: 23, calories: 134, cosine: 0.99890719857858201, matchedQuantity: 116.71641791044776, protein: 33.84776119402985, carbohydrate: 0, fat: 2.3343283582089551, unit: UnitGram},
			/* rank  1, page  0 */ {id: 11, calories: 61.799999999999997, cosine: 0.93535433249885147, matchedQuantity: 253.07443365695795, protein: 27.838187702265373, carbohydrate: 10.122977346278319, fat: 0.50614886731391595, unit: UnitGram},
			/* rank  2, page  0 */ {id: 6, calories: 234, cosine: 0.93492763601015461, matchedQuantity: 66.837606837606842, protein: 18.046153846153846, carbohydrate: 0, fat: 9.3572649572649578, unit: UnitGram},
			/* rank  3, page  1 */ {id: 7, calories: 239, cosine: 0.91804822498748984, matchedQuantity: 65.439330543933053, protein: 17.014225941422595, carbohydrate: 0, fat: 9.8158995815899583, unit: UnitGram},
			/* rank  4, page  1 */ {id: 20, calories: 57, cosine: 0.89577217256673414, matchedQuantity: 274.38596491228071, protein: 21.950877192982457, carbohydrate: 10.975438596491228, fat: 2.7438596491228071, unit: UnitMillilitre},
			/* rank  5, page  1 */ {id: 12, calories: 97, cosine: 0.86160056181276767, matchedQuantity: 161.23711340206185, protein: 14.511340206185567, carbohydrate: 6.4494845360824744, fat: 8.0618556701030926, unit: UnitGram},
			/* rank  6, page  2 */ {id: 17, calories: 21, cosine: 0.85813902726377311, matchedQuantity: 744.76190476190482, protein: 14.895238095238096, carbohydrate: 7.4476190476190478, fat: 7.4476190476190478, unit: UnitMillilitre},
			/* rank  7, page  2 */ {id: 38, calories: 174, cosine: 0.84491605851046025, matchedQuantity: 89.885057471264375, protein: 13.482758620689657, carbohydrate: 5.3931034482758626, fat: 8.9885057471264371, unit: UnitGram},
			/* rank  8, page  2 */ {id: 22, calories: 300, cosine: 0.78468728734341198, matchedQuantity: 52.133333333333333, protein: 11.469333333333333, carbohydrate: 4.1706666666666665, fat: 10.426666666666668, unit: UnitGram},
			/* rank  9, page  3 */ {id: 16, calories: 238, cosine: 0.78292975774517792, matchedQuantity: 65.714285714285708, protein: 11.828571428571427, carbohydrate: 6.5714285714285712, fat: 9.1999999999999993, unit: UnitGram},
			/* rank 10, page  3 */ {id: 27, calories: 156, cosine: 0.75482448906251631, matchedQuantity: 100.25641025641026, protein: 11.02820512820513, carbohydrate: 1.0025641025641026, fat: 12.030769230769231, unit: UnitGram},
			/* rank 11, page  3 */ {id: 33, calories: 96, cosine: 0.65282674601996615, matchedQuantity: 162.91666666666666, protein: 11.404166666666665, carbohydrate: 13.033333333333333, fat: 6.5166666666666666, unit: UnitMillilitre},
			/* rank 12, page  4 */ {id: 15, calories: 240, cosine: 0.61858229128418618, matchedQuantity: 65.166666666666671, protein: 9.7750000000000004, carbohydrate: 11.73, fat: 7.8200000000000003, unit: UnitGram},
			/* rank 13, page  4 */ {id: 10, calories: 50.799999999999997, cosine: 0.58072988739794151, matchedQuantity: 307.87401574803152, protein: 10.467716535433071, carbohydrate: 14.777952755905511, fat: 6.1574803149606305, unit: UnitMillilitre},
			/* rank 14, page  4 */ {id: 34, calories: 263, cosine: 0.49223882873981217, matchedQuantity: 59.467680608365022, protein: 7.1361216730038031, carbohydrate: 11.893536121673005, fat: 8.9201520912547529, unit: UnitGram},
			/* rank 15, page  5 */ {id: 21, calories: 265, cosine: 0.47673363382577982, matchedQuantity: 59.018867924528301, protein: 7.6724528301886785, carbohydrate: 14.164528301886792, fat: 7.6724528301886785, unit: UnitGram},
			/* rank 16, page  5 */ {id: 3, calories: 180, cosine: 0.45541951203801828, matchedQuantity: 86.888888888888886, protein: 7.8200000000000003, carbohydrate: 15.640000000000001, fat: 6.9511111111111106, unit: UnitGram},
			/* rank 17, page  5 */ {id: 29, calories: 157, cosine: 0.38543987921897471, matchedQuantity: 99.617834394904463, protein: 7.9694267515923567, carbohydrate: 19.923566878980893, fat: 4.9808917197452232, unit: UnitGram},
			/* rank 18, page  6 */ {id: 2, calories: 255, cosine: 0.38073652613741499, matchedQuantity: 61.333333333333336, protein: 6.746666666666667, carbohydrate: 17.173333333333336, fat: 6.746666666666667, unit: UnitGram},
			/* rank 19, page  6 */ {id: 30, calories: 57.5, cosine: 0.36347227209025246, matchedQuantity: 272, protein: 8.1600000000000001, carbohydrate: 21.760000000000002, fat: 4.0800000000000001, unit: UnitMillilitre},
			/* rank 20, page  6 */ {id: 13, calories: 200, cosine: 0.33427907805525392, matchedQuantity: 78.200000000000003, protein: 6.2560000000000002, carbohydrate: 18.768000000000001, fat: 6.2560000000000002, unit: UnitGram},
			/* rank 21, page  7 */ {id: 1, calories: 250, cosine: 0.33427907805525386, matchedQuantity: 62.560000000000002, protein: 6.2560000000000002, carbohydrate: 18.768000000000001, fat: 6.2560000000000002, unit: UnitGram},
			/* rank 22, page  7 */ {id: 36, calories: 290, cosine: 0.28582825480619889, matchedQuantity: 53.931034482758619, protein: 3.7751724137931033, carbohydrate: 13.482758620689657, fat: 9.7075862068965506, unit: UnitGram},
			/* rank 23, page  7 */ {id: 24, calories: 11.800000000000001, cosine: 0.25092945495719499, matchedQuantity: 1325.4237288135591, protein: 6.6271186440677958, carbohydrate: 26.508474576271183, fat: 2.6508474576271186, unit: UnitGram},
			/* rank 24, page  8 */ {id: 26, calories: 199, cosine: 0.22956911771261368, matchedQuantity: 78.5929648241206, protein: 4.7155778894472355, carbohydrate: 22.006030150753769, fat: 5.5015075376884424, unit: UnitGram},
			/* rank 25, page  8 */ {id: 25, calories: 21, cosine: 0.2288370278298418, matchedQuantity: 744.76190476190482, protein: 6.7028571428571437, carbohydrate: 29.04571428571429, fat: 1.4895238095238097, unit: UnitGram},
			/* rank 26, page  8 */ {id: 28, calories: 71.5, cosine: 0.21510427823253631, matchedQuantity: 218.74125874125875, protein: 5.4685314685314692, carbohydrate: 26.248951048951049, fat: 3.2811188811188812, unit: UnitGram},
			/* rank 27, page  9 */ {id: 4, calories: 197, cosine: 0.1984470913577818, matchedQuantity: 79.390862944162436, protein: 4.7634517766497462, carbohydrate: 25.405076142131978, fat: 3.969543147208122, unit: UnitGram},
			/* rank 28, page  9 */ {id: 35, calories: 286, cosine: 0.17307953999582959, matchedQuantity: 54.685314685314687, protein: 2.7342657342657346, carbohydrate: 19.13986013986014, fat: 7.6559440559440564, unit: UnitGram},
			/* rank 29, page  9 */ {id: 14, calories: 45.5, cosine: 0.16135694984683235, matchedQuantity: 343.73626373626371, protein: 3.4373626373626371, carbohydrate: 24.061538461538458, fat: 5.1560439560439555, unit: UnitMillilitre},
			/* rank 30, page 10 */ {id: 32, calories: 116, cosine: 0.14917245987891201, matchedQuantity: 134.82758620689654, protein: 1.3482758620689654, carbohydrate: 13.482758620689653, fat: 10.786206896551723, unit: UnitGram},
			/* rank 31, page 10 */ {id: 31, calories: 36.5, cosine: 0.14826384208245511, matchedQuantity: 428.49315068493149, protein: 4.2849315068493148, carbohydrate: 29.994520547945204, fat: 2.1424657534246574, unit: UnitMillilitre},
			/* rank 32, page 10 */ {id: 18, calories: 742, cosine: 0.12140615187084042, matchedQuantity: 21.078167115902964, protein: 0.10539083557951483, carbohydrate: 0.10539083557951483, fat: 17.284097035040432, unit: UnitGram},
			/* rank 33, page 11 */ {id: 19, calories: 821.69999999999993, cosine: 0.11535380918585926, matchedQuantity: 19.033710599975663, protein: 0, carbohydrate: 0, fat: 17.37777777777778, unit: UnitMillilitre},
			/* rank 34, page 11 */ {id: 8, calories: 56.5, cosine: 0.087205768302707792, matchedQuantity: 276.81415929203541, protein: 2.7681415929203541, carbohydrate: 33.217699115044255, fat: 1.3840707964601771, unit: UnitGram},
			/* rank 35, page 11 */ {id: 37, calories: 44.599999999999994, cosine: 0.071650166917796534, matchedQuantity: 350.67264573991037, protein: 2.4547085201793721, carbohydrate: 35.067264573991039, fat: 0.70134529147982083, unit: UnitMillilitre},
			/* rank 36, page 12 */ {id: 9, calories: 45.299999999999997, cosine: 0.010078060565712477, matchedQuantity: 345.25386313465788, protein: 0.34525386313465789, carbohydrate: 37.977924944812365, fat: 0.34525386313465789, unit: UnitMillilitre},
		},
	},
	{
		inputID:       10,
		quantity:      FoodQuantity{Value: 100, Unit: UnitMillilitre},
		baseQuantity:  100,
		totalCalories: 50.8,
		candidates: []wantCandidate{
			/* rank  0, page  0 */ {id: 33, calories: 96, cosine: 0.99482938450652125, matchedQuantity: 52.916666666666664, protein: 3.7041666666666662, carbohydrate: 4.2333333333333334, fat: 2.1166666666666667, unit: UnitMillilitre},
			/* rank  1, page  0 */ {id: 3, calories: 180, cosine: 0.98848837741846673, matchedQuantity: 28.222222222222221, protein: 2.54, carbohydrate: 5.0800000000000001, fat: 2.2577777777777777, unit: UnitGram},
			/* rank  2, page  0 */ {id: 21, calories: 265, cosine: 0.98705869736992069, matchedQuantity: 19.169811320754718, protein: 2.4920754716981133, carbohydrate: 4.6007547169811325, fat: 2.4920754716981133, unit: UnitGram},
			/* rank  3, page  1 */ {id: 15, calories: 240, cosine: 0.98683208369120634, matchedQuantity: 21.166666666666668, protein: 3.1749999999999998, carbohydrate: 3.8100000000000001, fat: 2.54, unit: UnitGram},
			/* rank  4, page  1 */ {id: 2, calories: 255, cosine: 0.973837378656768, matchedQuantity: 19.921568627450981, protein: 2.1913725490196079, carbohydrate: 5.5780392156862737, fat: 2.1913725490196079, unit: UnitGram},
			/* rank  5, page  1 */ {id: 29, calories: 157, cosine: 0.96951859463850432, matchedQuantity: 32.35668789808917, protein: 2.5885350318471336, carbohydrate: 6.4713375796178347, fat: 1.6178343949044587, unit: UnitGram},
			/* rank  6, page  2 */ {id: 34, calories: 263, cosine: 0.96814236323306369, matchedQuantity: 19.315589353612168, protein: 2.3178707224334603, carbohydrate: 3.8631178707224336, fat: 2.8973384030418252, unit: UnitGram},
			/* rank  7, page  2 */ {id: 1, calories: 250, cosine: 0.96089336670421754, matchedQuantity: 20.32, protein: 2.032, carbohydrate: 6.0960000000000001, fat: 2.032, unit: UnitGram},
			/* rank  8, page  2 */ {id: 13, calories: 200, cosine: 0.96089336670421743, matchedQuantity: 25.399999999999999, protein: 2.032, carbohydrate: 6.0959999999999992, fat: 2.032, unit: UnitGram},
			/* rank  9, page  3 */ {id: 30, calories: 57.5, cosine: 0.95742066518632907, matchedQuantity: 88.347826086956516, protein: 2.6504347826086958, carbohydrate: 7.0678260869565213, fat: 1.3252173913043479, unit: UnitMillilitre},
			/* rank 10, page  3 */ {id: 26, calories: 199, cosine: 0.92165609980746077, matchedQuantity: 25.527638190954775, protein: 1.5316582914572865, carbohydrate: 7.1477386934673373, fat: 1.7869346733668343, unit: UnitGram},
			/* rank 11, page  3 */ {id: 36, calories: 290, cosine: 0.91607443714257097, matchedQuantity: 17.517241379310345, protein: 1.2262068965517241, carbohydrate: 4.3793103448275863, fat: 3.1531034482758624, unit: UnitGram},
			/* rank 12, page  4 */ {id: 24, calories: 11.800000000000001, cosine: 0.90920865935486916, matchedQuantity: 430.50847457627117, protein: 2.152542372881356, carbohydrate: 8.6101694915254239, fat: 0.86101694915254245, unit: UnitGram},
			/* rank 13, page  4 */ {id: 35, calories: 286, cosine: 0.90157488391175633, matchedQuantity: 17.762237762237763, protein: 0.88811188811188813, carbohydrate: 6.2167832167832167, fat: 2.4867132867132868, unit: UnitGram},
			/* rank 14, page  4 */ {id: 28, calories: 71.5, cosine: 0.90063635401934694, matchedQuantity: 71.048951048951054, protein: 1.7762237762237763, carbohydrate: 8.5258741258741271, fat: 1.0657342657342659, unit: UnitGram},
			/* rank 15, page  5 */ {id: 4, calories: 197, cosine: 0.89910269944186316, matchedQuantity: 25.786802030456851, protein: 1.547208121827411, carbohydrate: 8.2517766497461924, fat: 1.2893401015228425, unit: UnitGram},
			/* rank 16, page  5 */ {id: 17, calories: 21, cosine: 0.89365446758050615, matchedQuantity: 241.9047619047619, protein: 4.8380952380952378, carbohydrate: 2.4190476190476189, fat: 2.4190476190476189, unit: UnitMillilitre},
			/* rank 17, page  5 */ {id: 25, calories: 21, cosine: 0.89083058438498153, matchedQuantity: 241.9047619047619, protein: 2.177142857142857, carbohydrate: 9.4342857142857142, fat: 0.4838095238095238, unit: UnitGram},
			/* rank 18, page  6 */ {id: 14, calories: 45.5, cosine: 0.89068305815677939, matchedQuantity: 111.64835164835165, protein: 1.1164835164835165, carbohydrate: 7.8153846153846152, fat: 1.6747252747252748, unit: UnitMillilitre},
			/* rank 19, page  6 */ {id: 16, calories: 238, cosine: 0.88687949567358415, matchedQuantity: 21.344537815126049, protein: 3.8420168067226887, carbohydrate: 2.134453781512605, fat: 2.9882352941176471, unit: UnitGram},
			/* rank 20, page  6 */ {id: 12, calories: 97, cosine: 0.87142018678415756, matchedQuantity: 52.371134020618555, protein: 4.7134020618556702, carbohydrate: 2.0948453608247424, fat: 2.6185567010309279, unit: UnitGram},
			/* rank 21, page  7 */ {id: 20, calories: 57, cosine: 0.86558395975041902, matchedQuantity: 89.122807017543863, protein: 7.1298245614035087, carbohydrate: 3.5649122807017544, fat: 0.89122807017543859, unit: UnitMillilitre},
			/* rank 22, page  7 */ {id: 31, calories: 36.5, cosine: 0.86282339297222865, matchedQuantity: 139.17808219178082, protein: 1.3917808219178083, carbohydrate: 9.742465753424657, fat: 0.69589041095890414, unit: UnitMillilitre},
			/* rank 23, page  7 */ {id: 38, calories: 174, cosine: 0.84544096634169896, matchedQuantity: 29.195402298850574, protein: 4.3793103448275863, carbohydrate: 1.7517241379310342, fat: 2.9195402298850577, unit: UnitGram},
			/* rank 24, page  8 */ {id: 32, calories: 116, cosine: 0.84454787223358119, matchedQuantity: 43.793103448275865, protein: 0.43793103448275866, carbohydrate: 4.3793103448275863, fat: 3.5034482758620693, unit: UnitGram},
			/* rank 25, page  8 */ {id: 8, calories: 56.5, cosine: 0.82801835989513983, matchedQuantity: 89.911504424778755, protein: 0.89911504424778754, carbohydrate: 10.789380530973451, fat: 0.44955752212389377, unit: UnitGram},
			/* rank 26, page  8 */ {id: 37, calories: 44.599999999999994, cosine: 0.81517565841487349, matchedQuantity: 113.90134529147984, protein: 0.79730941704035885, carbohydrate: 11.390134529147984, fat: 0.22780269058295971, unit: UnitMillilitre},
			/* rank 27, page  9 */ {id: 22, calories: 300, cosine: 0.8008680059623664, matchedQuantity: 16.933333333333334, protein: 3.7253333333333334, carbohydrate: 1.3546666666666667, fat: 3.3866666666666667, unit: UnitGram},
			/* rank 28, page  9 */ {id: 11, calories: 61.799999999999997, cosine: 0.78371386182773795, matchedQuantity: 82.200647249190936, protein: 9.0420711974110031, carbohydrate: 3.2880258899676376, fat: 0.16440129449838189, unit: UnitGram},
			/* rank 29, page  9 */ {id: 9, calories: 45.299999999999997, cosine: 0.78042430215501002, matchedQuantity: 112.14128035320088, protein: 0.11214128035320088, carbohydrate: 12.335540838852099, fat: 0.11214128035320088, unit: UnitMillilitre},
			/* rank 30, page 10 */ {id: 27, calories: 156, cosine: 0.65331633757277108, matchedQuantity: 32.564102564102562, protein: 3.5820512820512818, carbohydrate: 0.32564102564102559, fat: 3.9076923076923071, unit: UnitGram},
			/* rank 31, page 10 */ {id: 7, calories: 239, cosine: 0.63488585980185142, matchedQuantity: 21.255230125523013, protein: 5.5263598326359826, carbohydrate: 0, fat: 3.1882845188284521, unit: UnitGram},
			/* rank 32, page 10 */ {id: 6, calories: 234, cosine: 0.63400444006631873, matchedQuantity: 21.70940170940171, protein: 5.861538461538462, carbohydrate: 0, fat: 3.0393162393162396, unit: UnitGram},
			/* rank 33, page 11 */ {id: 5, calories: 156.40000000000001, cosine: 0.58072988739794151, matchedQuantity: 32.48081841432225, protein: 10.069053708439897, carbohydrate: 0, fat: 1.1693094629156011, unit: UnitGram},
			/* rank 34, page 11 */ {id: 23, calories: 134, cosine: 0.56810073866781585, matchedQuantity: 37.910447761194028, protein: 10.994029850746267, carbohydrate: 0, fat: 0.75820895522388054, unit: UnitGram},
			/* rank 35, page 11 */ {id: 18, calories: 742, cosine: 0.32994690745915994, matchedQuantity: 6.8463611859838274, protein: 0.034231805929919139, carbohydrate: 0.034231805929919139, fat: 5.614016172506739, unit: UnitGram},
			/* rank 36, page 12 */ {id: 19, calories: 821.69999999999993, cosine: 0.32191138998982521, matchedQuantity: 6.1823049774857006, protein: 0, carbohydrate: 0, fat: 5.6444444444444448, unit: UnitMillilitre},
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

func assertProjectedItem(t *testing.T, item SubstituteItem, want wantCandidate) {
	t.Helper()
	wantMQ := int64(math.Round(want.matchedQuantity))
	if item.MatchedQuantity.Value != wantMQ || item.MatchedQuantity.Unit != want.unit {
		t.Fatalf("item %d: Matched Quantity is %+v, want value %d in unit %q (full precision %.17g)",
			item.FoodObjectID, item.MatchedQuantity, wantMQ, want.unit, want.matchedQuantity)
	}
	assertMacro := func(name string, got, full float64) {
		t.Helper()
		if want := projectMacronutrient(full); got != want {
			t.Fatalf("item %d: %s is %.17g, want the projected %.17g of the full-precision %.17g",
				item.FoodObjectID, name, got, want, full)
		}
	}
	assertMacro("protein", item.Protein, want.protein)
	assertMacro("carbohydrate", item.Carbohydrate, want.carbohydrate)
	assertMacro("fat", item.Fat, want.fat)
	wantCal := int64(math.Round(4*want.protein + 4*want.carbohydrate + 9*want.fat))
	if item.Calories != wantCal {
		t.Fatalf("item %d: calories is %d, want the projected %d of the full-precision macronutrients",
			item.FoodObjectID, item.Calories, wantCal)
	}
	if wantPercent := projectSimilarityPercent(want.cosine); item.SimilarityPercent != wantPercent {
		t.Fatalf("item %d: similarity percent is %d, want the projected %d of the full-precision %.17g",
			item.FoodObjectID, item.SimilarityPercent, wantPercent, want.cosine)
	}
}

func assertInputMacronutrients(t *testing.T, page *Page, protein, carbohydrate, fat float64) {
	t.Helper()
	got := page.InputMacronutrients
	if got.Protein != protein || got.Carbohydrate != carbohydrate || got.Fat != fat {
		t.Fatalf("input macronutrients (%v, %v, %v), want (%v, %v, %v)", got.Protein, got.Carbohydrate, got.Fat, protein, carbohydrate, fat)
	}
}

func assertInputCalories(t *testing.T, page *Page, calories int64) {
	t.Helper()
	if page.InputCalories != calories {
		t.Fatalf("input calories %v, want %v", page.InputCalories, calories)
	}
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

	run := func(input SubstituteInput, pageIndex int32) *Page {
		t.Helper()
		tracer.reset()
		page, err := module.Run(ctx, input, pageIndex)
		if err != nil {
			t.Fatalf("Run(input %d, %v, page %d): %v", input.FoodObjectID, input.Quantity, pageIndex, err)
		}
		tracer.assertSingleSelect(t, wantSQL)
		return page
	}

	profiles := loadProfiles(t, module, ctx)
	excludedByInput := map[int32][]int32{1: {1, 2}, 5: {5}, 10: {10}}

	for _, want := range wantSubstituteInputs {
		totalCandidates := len(want.candidates)
		totalPages := (totalCandidates + pageSize - 1) / pageSize
		inputProfile := profiles[want.inputID]
		inputCalories := calories(inputProfile) * want.baseQuantity / 100
		assertNearEqual(t, "input total calories", inputCalories, want.totalCalories)

		var concatenatedIDs []int32
		for p := 0; p < totalPages; p++ {
			pageIndex := int32(p)
			page := run(SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity}, pageIndex)
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

				candProfile := profiles[cand.id]
				gotCosine := cosineSimilarity(inputProfile, candProfile)
				gotCalories := calories(candProfile)
				gotMatched := matchedQuantity(inputCalories, gotCalories)
				assertNearEqual(t, "cosineSimilarity", gotCosine, cand.cosine)
				assertNearEqual(t, "calories", gotCalories, cand.calories)
				assertNearEqual(t, "matchedQuantity", gotMatched, cand.matchedQuantity)
				assertProjectedItem(t, item, cand)
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
		outPage, err := module.Run(ctx, SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity}, firstAfterLast)
		if outPage != nil {
			t.Fatalf("input %d, page %d returned page %+v, want CodePageOutOfRange", want.inputID, firstAfterLast, outPage)
		}
		assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
		tracer.assertSingleSelect(t, wantSQL)

		tracer.reset()
		maxPage, err := module.Run(ctx, SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity}, math.MaxInt32)
		if maxPage != nil {
			t.Fatalf("input %d, page MaxInt32 returned page %+v, want CodePageOutOfRange", want.inputID, maxPage)
		}
		assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
		tracer.assertSingleSelect(t, wantSQL)

		tracer.reset()
		negPage, err := module.Run(ctx, SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity}, -1)
		if negPage != nil {
			t.Fatalf("input %d, page -1 returned page %+v, want CodeInvalidPageIndex", want.inputID, negPage)
		}
		assertStableFailure(t, err, CodeInvalidPageIndex, "pageIndex")
		if len(tracer.stmts) != 0 {
			t.Fatalf("catalog-independent rejection executed %d statements, want zero", len(tracer.stmts))
		}
	}

	for id, want := range wantCalories {
		profile, ok := profiles[id]
		if !ok {
			t.Fatalf("loaded catalog has no Food Object %d", id)
		}
		assertNearEqual(t, "calories(profile 1)", calories(profile), want)
	}

	for _, want := range wantSubstituteInputs {
		page := run(SubstituteInput{FoodObjectID: want.inputID, Quantity: want.quantity}, 0)
		profile := profiles[want.inputID]
		wantInput := Macronutrients{
			Protein:      projectMacronutrient(profile.protein * want.baseQuantity / 100),
			Carbohydrate: projectMacronutrient(profile.carbohydrate * want.baseQuantity / 100),
			Fat:          projectMacronutrient(profile.fat * want.baseQuantity / 100),
		}
		if page.InputMacronutrients != wantInput {
			t.Fatalf("input %d at %v: input macronutrients %+v, want the projected %+v of the committed base quantity %v",
				want.inputID, want.quantity, page.InputMacronutrients, wantInput, want.baseQuantity)
		}
		wantInputCal := int64(math.Round(calories(profile) * want.baseQuantity / 100))
		if page.InputCalories != wantInputCal {
			t.Fatalf("input %d at %v: input calories %v, want the projected %v",
				want.inputID, want.quantity, page.InputCalories, wantInputCal)
		}
	}

	oneServing := run(SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 1, Unit: UnitServing}}, 0)
	assertInputMacronutrients(t, oneServing, 35.0, 105.0, 35.0)
	assertInputCalories(t, oneServing, 875)
	hundredGrams := run(SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
	assertInputMacronutrients(t, hundredGrams, 31.0, 0.0, 3.6)
	assertInputCalories(t, hundredGrams, 156)
	hundredMillilitres := run(SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 100, Unit: UnitMillilitre}}, 0)
	assertInputMacronutrients(t, hundredMillilitres, 3.4, 4.8, 2.0)
	assertInputCalories(t, hundredMillilitres, 51)

	changed := []struct {
		input    SubstituteInput
		protein  float64
		carb     float64
		fat      float64
		calories int64
		wantIDs  []int32
	}{
		{SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 10.0, 30.0, 10.0, 250, []int32{13, 29, 26}},
		{SubstituteInput{FoodObjectID: 1, Quantity: FoodQuantity{Value: 2, Unit: UnitServing}}, 70.0, 210.0, 70.0, 1750, []int32{13, 29, 26}},
		{SubstituteInput{FoodObjectID: 5, Quantity: FoodQuantity{Value: 200, Unit: UnitGram}}, 62.0, 0.0, 7.2, 313, []int32{23, 11, 6}},
		{SubstituteInput{FoodObjectID: 10, Quantity: FoodQuantity{Value: 250, Unit: UnitMillilitre}}, 8.5, 12.0, 5.0, 127, []int32{33, 3, 21}},
	}
	for _, tc := range changed {
		page := run(tc.input, 0)
		assertInputMacronutrients(t, page, tc.protein, tc.carb, tc.fat)
		assertInputCalories(t, page, tc.calories)
		assertPageIDs(t, page, tc.wantIDs...)
	}

	butter := run(SubstituteInput{FoodObjectID: 18, Quantity: FoodQuantity{Value: 150, Unit: UnitGram}}, 0)
	assertInputMacronutrients(t, butter, 0.8, 0.8, 123.0)
	assertInputCalories(t, butter, 1113)

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
	idTie := run(SubstituteInput{FoodObjectID: 43, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
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
	nameTie := run(SubstituteInput{FoodObjectID: 53, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
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
	caseTie := run(SubstituteInput{FoodObjectID: 66, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
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
	spaceTie := run(SubstituteInput{FoodObjectID: 76, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}, 0)
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
	zeroInput := SubstituteInput{FoodObjectID: 95, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}}
	zeroPage0 := run(zeroInput, 0)
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
	zeroPage1, err := module.Run(ctx, zeroInput, 1)
	if zeroPage1 != nil {
		t.Fatalf("zero-result page 1 returned page %+v, want CodePageOutOfRange", zeroPage1)
	}
	assertStableFailure(t, err, CodePageOutOfRange, "pageIndex")
	tracer.assertSingleSelect(t, wantSQL)

	runExpectInternalError := func(input SubstituteInput) {
		t.Helper()
		tracer.reset()
		page, err := module.Run(ctx, input, 0)
		if err == nil {
			t.Fatalf("Run(input %d, %v) returned page %+v, want INTERNAL_ERROR for the nonfinite derived arithmetic", input.FoodObjectID, input.Quantity, page)
		}
		var moduleErr *Error
		if !errors.As(err, &moduleErr) || moduleErr.Code != CodeInternalError {
			t.Fatalf("Run(input %d, %v) failure %v, want the stable INTERNAL_ERROR classification", input.FoodObjectID, input.Quantity, err)
		}
		tracer.assertSingleSelect(t, wantSQL)
	}
	insertTieObject(90, "Small normal input", "Maly normalny produkt", 0.1, 0, 0)
	insertTieObject(91, "Largest calories candidate", "Kandydat o najwiekszej kalorycznosci", math.MaxFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 90, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	insertTieObject(88, "Subnormal candidate", "Subnormalny kandydat", math.SmallestNonzeroFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 43, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	insertTieObject(89, "Subnormal input", "Subnormalne wprowadzenie", math.SmallestNonzeroFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 89, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	insertTieObject(87, "Largest candidate", "Najwiekszy kandydat", math.MaxFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 43, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})

	insertTieObject(86, "Largest input", "Najwieksze wprowadzenie", math.MaxFloat64, 0, 0)
	runExpectInternalError(SubstituteInput{FoodObjectID: 86, Quantity: FoodQuantity{Value: 100, Unit: UnitGram}})
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
