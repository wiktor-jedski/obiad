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

/**
 * Rounds a nonnegative number to the nearest integer with exact halves rounded up,
 * accounting for IEEE-754 binary floating-point representation drift.
 */
function roundWhole(value: number): number {
  const integer = Math.floor(value);
  const fraction = value - integer;
  const tolerance = 4 * Number.EPSILON * Math.max(1, value);
  return fraction >= 0.5 - tolerance ? integer + 1 : integer;
}

/**
 * Rounds a nonnegative macronutrient value to 0.1 g with exact halves rounded up,
 * accounting for IEEE-754 binary floating-point representation drift.
 */
function roundMacronutrient(value: number): number {
  const scaled = value * 10;
  const integer = Math.floor(scaled);
  const fraction = scaled - integer;
  const tolerance = 4 * Number.EPSILON * Math.max(1, scaled);
  return (fraction >= 0.5 - tolerance ? integer + 1 : integer) / 10;
}

/**
 * Converts a Food Quantity to the base unit (g or ml).
 */
function toBaseQuantity(quantity: FoodQuantity, serving?: number): number {
  if (quantity.unit === "serving") {
    if (serving === undefined) {
      throw new Error(
        "Serving count provided for a food without a Serving base quantity",
      );
    }
    return quantity.value * serving;
  }
  return quantity.value;
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
  const baseQty = toBaseQuantity(quantity, selectedFood.serving);

  const unroundedInputProtein =
    (selectedFood.macroProfile.protein * baseQty) / 100;
  const unroundedInputCarbohydrate =
    (selectedFood.macroProfile.carbohydrate * baseQty) / 100;
  const unroundedInputFat = (selectedFood.macroProfile.fat * baseQty) / 100;

  const unroundedInputCalories =
    4 * unroundedInputProtein +
    4 * unroundedInputCarbohydrate +
    9 * unroundedInputFat;

  const projectedItems: ProjectedSubstituteItem[] = items.map((item) => {
    const candidateCaloriesPer100 =
      4 * item.macroProfile.protein +
      4 * item.macroProfile.carbohydrate +
      9 * item.macroProfile.fat;

    const unroundedMatchedQuantity =
      (unroundedInputCalories * 100) / candidateCaloriesPer100;

    const unroundedCandidateProtein =
      (item.macroProfile.protein * unroundedMatchedQuantity) / 100;
    const unroundedCandidateCarbohydrate =
      (item.macroProfile.carbohydrate * unroundedMatchedQuantity) / 100;
    const unroundedCandidateFat =
      (item.macroProfile.fat * unroundedMatchedQuantity) / 100;
    return {
      foodObjectId: item.foodObjectId,
      names: item.names,
      imageKey: item.imageKey,
      matchedQuantity: {
        value: roundWhole(unroundedMatchedQuantity),
        unit: item.baseUnit,
      },
      macronutrients: {
        protein: roundMacronutrient(unroundedCandidateProtein),
        carbohydrate: roundMacronutrient(unroundedCandidateCarbohydrate),
        fat: roundMacronutrient(unroundedCandidateFat),
      },
      calories: roundWhole(unroundedInputCalories),
      similarityPercent: item.similarityPercent,
    };
  });

  return {
    inputMacronutrients: {
      protein: roundMacronutrient(unroundedInputProtein),
      carbohydrate: roundMacronutrient(unroundedInputCarbohydrate),
      fat: roundMacronutrient(unroundedInputFat),
    },
    inputCalories: roundWhole(unroundedInputCalories),
    items: projectedItems,
  };
}
