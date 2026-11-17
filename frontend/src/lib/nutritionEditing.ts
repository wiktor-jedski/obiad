import { getDictionary, type InterfaceLanguage } from "./i18n";

/** Editable portion targets; each target scales the same food profile. */
export type NutritionField =
  "quantity" | "calories" | "protein" | "carbohydrate" | "fat";

/** Validation details retained independently of the interface language. */
export type NutritionEditError =
  | { field: NutritionField; reason: "positive" }
  | { field: NutritionField; reason: "precision"; places: number }
  | { field: NutritionField; reason: "limit"; maximum: number };

const labelMethods = {
  quantity: "quantityLabel",
  calories: "caloriesLabel",
  protein: "proteinLabel",
  carbohydrate: "carbohydratesLabel",
  fat: "fatLabel",
} as const;

/** Returns the localized label for a portion target. */
export function nutritionFieldLabel(
  field: NutritionField,
  language: InterfaceLanguage,
): string {
  return getDictionary(language)[labelMethods[field]]();
}

/** Formats the current error without changing the stored portion or draft. */
export function formatNutritionError(
  error: NutritionEditError | undefined,
  language: InterfaceLanguage,
): string {
  if (!error) return "";
  const dictionary = getDictionary(language);
  let message: string;
  switch (error.reason) {
    case "positive":
      message = dictionary.positiveNumberMessage();
      break;
    case "precision":
      message = dictionary.precisionMessage(error.places);
      break;
    case "limit":
      message = dictionary.portionLimitMessage(
        error.maximum.toLocaleString(language, { maximumFractionDigits: 2 }),
      );
      break;
  }
  return `${nutritionFieldLabel(error.field, language)}: ${message}`;
}
