import type {
  FoodQuantity,
  LocalizedNames,
  SelectedFood,
  SubstituteItem,
} from "../client/types.gen";

/**
 * Displayed macronutrients with 0.1 g display precision.
 */
export interface ProjectedMacronutrients {
  readonly protein: number;
  readonly carbohydrate: number;
  readonly fat: number;
}

/**
 * Displayed equal-calorie matched quantity with whole-unit precision.
 */
export interface ProjectedMatchedQuantity {
  readonly value: number;
  readonly unit: "g" | "ml";
}

/**
 * Display-ready candidate substitute item.
 */
export interface ProjectedSubstituteItem {
  readonly foodObjectId: number;
  readonly names: LocalizedNames;
  readonly imageKey?: string;
  readonly matchedQuantity: ProjectedMatchedQuantity;
  readonly macronutrients: ProjectedMacronutrients;
  readonly calories: number;
  readonly similarityPercent: number;
}

/**
 * Display-ready substitution page containing selected-input and card values.
 */
export interface ProjectedSubstitutePage {
  readonly inputMacronutrients: ProjectedMacronutrients;
  readonly inputCalories: number;
  readonly items: readonly ProjectedSubstituteItem[];
}

interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a < 0n ? -a : a;
}

function makeRational(num: bigint, den = 1n): Rational {
  if (den === 0n) {
    throw new Error("Division by zero in Rational");
  }
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const d = gcd(num < 0n ? -num : num, den);
  return { num: num / d, den: den / d };
}

function toRational(v: number): Rational {
  const s = v.toString();
  if (s.includes("e") || s.includes("E")) {
    const [coeff, exp] = s.toLowerCase().split("e");
    const r = toRational(Number(coeff));
    const e = BigInt(exp ?? "0");
    if (e >= 0n) {
      return makeRational(r.num * 10n ** e, r.den);
    }
    return makeRational(r.num, r.den * 10n ** -e);
  }
  const parts = s.split(".");
  if (parts.length === 1) {
    return makeRational(BigInt(parts[0] ?? "0"), 1n);
  }
  const intPart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "0";
  const sign = intPart.startsWith("-") ? -1n : 1n;
  const absIntPart = intPart.replace("-", "");
  const den = 10n ** BigInt(fracPart.length);
  const num = sign * (BigInt(absIntPart) * den + BigInt(fracPart));
  return makeRational(num, den);
}

function add(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

function mul(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.num, a.den * b.den);
}

function div(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den, a.den * b.num);
}

function roundToWhole(r: Rational): number {
  if (r.num <= 0n) {
    return 0;
  }
  return Number((2n * r.num + r.den) / (2n * r.den));
}

function roundToTenth(r: Rational): number {
  if (r.num <= 0n) {
    return 0;
  }
  return Number((20n * r.num + r.den) / (2n * r.den)) / 10;
}

/**
 * Pure projection from calculation basis data to display-ready values.
 *
 * @param selectedFood - Calculation basis of the selected Food Object.
 * @param items - Current-page candidate items.
 * @param quantity - Committed Food Quantity.
 * @returns Display-ready selected-input and card values.
 */
export function projectSubstitutePage(
  selectedFood: SelectedFood,
  items: readonly SubstituteItem[],
  quantity: FoodQuantity,
): ProjectedSubstitutePage {
  const serving =
    selectedFood.serving !== undefined
      ? toRational(selectedFood.serving)
      : undefined;
  const qtyVal = toRational(quantity.value);
  let baseQty: Rational;
  if (quantity.unit === "serving") {
    if (serving === undefined) {
      throw new Error(
        "Serving count provided for a food without a Serving base quantity",
      );
    }
    baseQty = mul(qtyVal, serving);
  } else {
    baseQty = qtyVal;
  }

  const rat100 = toRational(100);
  const rat4 = toRational(4);
  const rat9 = toRational(9);

  const selP = toRational(selectedFood.macroProfile.protein);
  const selC = toRational(selectedFood.macroProfile.carbohydrate);
  const selF = toRational(selectedFood.macroProfile.fat);

  const inputProtein = div(mul(selP, baseQty), rat100);
  const inputCarbohydrate = div(mul(selC, baseQty), rat100);
  const inputFat = div(mul(selF, baseQty), rat100);

  const inputCalories = add(
    add(mul(rat4, inputProtein), mul(rat4, inputCarbohydrate)),
    mul(rat9, inputFat),
  );

  const projectedItems: ProjectedSubstituteItem[] = items.map((item) => {
    const candP = toRational(item.macroProfile.protein);
    const candC = toRational(item.macroProfile.carbohydrate);
    const candF = toRational(item.macroProfile.fat);

    const candidateCaloriesPer100 = add(
      add(mul(rat4, candP), mul(rat4, candC)),
      mul(rat9, candF),
    );
    const unroundedMatchedQuantity = div(
      mul(inputCalories, rat100),
      candidateCaloriesPer100,
    );

    const unroundedCandidateProtein = div(
      mul(candP, unroundedMatchedQuantity),
      rat100,
    );
    const unroundedCandidateCarbohydrate = div(
      mul(candC, unroundedMatchedQuantity),
      rat100,
    );
    const unroundedCandidateFat = div(
      mul(candF, unroundedMatchedQuantity),
      rat100,
    );

    return {
      foodObjectId: item.foodObjectId,
      names: item.names,
      imageKey: item.imageKey,
      matchedQuantity: {
        value: roundToWhole(unroundedMatchedQuantity),
        unit: item.baseUnit,
      },
      macronutrients: {
        protein: roundToTenth(unroundedCandidateProtein),
        carbohydrate: roundToTenth(unroundedCandidateCarbohydrate),
        fat: roundToTenth(unroundedCandidateFat),
      },
      calories: roundToWhole(inputCalories),
      similarityPercent: item.similarityPercent,
    };
  });

  return {
    inputMacronutrients: {
      protein: roundToTenth(inputProtein),
      carbohydrate: roundToTenth(inputCarbohydrate),
      fat: roundToTenth(inputFat),
    },
    inputCalories: roundToWhole(inputCalories),
    items: projectedItems,
  };
}
