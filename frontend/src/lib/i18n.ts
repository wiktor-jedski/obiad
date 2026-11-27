import type { FoodQuantity, GetFoodSuggestionsData } from "../client/types.gen";

/** Supported interface languages from the API contract. */
export type InterfaceLanguage = GetFoodSuggestionsData["query"]["language"];

/** Localized application labels and validation messages. */
export interface Messages {
  searchLabel: () => string;

  searchPlaceholder: () => string;

  interfaceLanguage: () => string;

  dataSourcesHeading: () => string;

  navigationLabel: () => string;

  foodsHeading: () => string;

  recipesHeading: () => string;

  nutritionHeading: () => string;

  ingredientsHeading: () => string;

  recipeHeading: () => string;

  recipeSourceLabel: () => string;

  scaledRecipeNote: () => string;

  loadingRecipeMessage: () => string;

  recipeNotFoundMessage: () => string;

  recipeFailureMessage: () => string;

  dataVersionLabel: () => string;

  suggestionsListLabel: () => string;

  selectedFoodLabel: () => string;

  servingUnit: () => string;

  quantityLabel: () => string;

  unitLabel: () => string;

  servingsLabel: () => string;

  loadingNutritionValues: () => string;

  proteinLabel: () => string;

  carbohydratesLabel: () => string;

  fatLabel: () => string;

  caloriesLabel: () => string;

  similarityLabel: () => string;

  foundSubstitutionsHeading: () => string;

  zeroResultsMessage: () => string;

  retryButtonLabel: () => string;

  endOfResultsMessage: () => string;

  imageUnavailableMessage: () => string;

  positiveNumberMessage: () => string;

  precisionMessage: (places: number) => string;

  portionLimitMessage: (maximum: string) => string;

  retryMessage: () => string;
}

const en = {
  searchLabel: () => "Search",
  searchPlaceholder: () => "Search foods",
  interfaceLanguage: () => "Interface language",
  dataSourcesHeading: () => "Sources",
  navigationLabel: () => "Navigation",
  foodsHeading: () => "Foods",
  recipesHeading: () => "Recipes",
  nutritionHeading: () => "Nutrition",
  ingredientsHeading: () => "Ingredients",
  recipeHeading: () => "Recipe",
  recipeSourceLabel: () => "Source",
  scaledRecipeNote: () =>
    "The ingredient list is scaled. Amounts in the steps are for the original recipe.",
  loadingRecipeMessage: () => "Loading recipe…",
  recipeNotFoundMessage: () => "Recipe not found.",
  recipeFailureMessage: () => "Could not load the recipe.",
  dataVersionLabel: () => "Data version:",
  suggestionsListLabel: () => "Suggestions",
  selectedFoodLabel: () => "Selected food",
  servingUnit: () => "serving",
  quantityLabel: () => "Quantity",
  unitLabel: () => "Unit",
  servingsLabel: () => "servings",
  loadingNutritionValues: () => "Loading nutrition values",
  proteinLabel: () => "Protein",
  carbohydratesLabel: () => "Carbohydrates",
  fatLabel: () => "Fat",
  caloriesLabel: () => "Calories",
  similarityLabel: () => "Similarity",
  foundSubstitutionsHeading: () => "Substitutes",
  zeroResultsMessage: () => "No substitutes found",
  retryButtonLabel: () => "Try again",
  endOfResultsMessage: () => "You have seen all substitutes.",
  imageUnavailableMessage: () => "Image unavailable",
  positiveNumberMessage: () => "Enter a positive number without a unit.",
  precisionMessage: (places: number) => `Allowed decimal places: ${places}.`,
  portionLimitMessage: (maximum: string) =>
    `The value exceeds the portion limit. Maximum for this field: ${maximum}.`,
  retryMessage: () => "Could not load substitutions. Try again.",
} satisfies Messages;

const pl = {
  searchLabel: () => "Szukaj",
  searchPlaceholder: () => "Szukaj potraw",
  interfaceLanguage: () => "Język interfejsu",
  dataSourcesHeading: () => "Źródła",
  navigationLabel: () => "Nawigacja",
  foodsHeading: () => "Składniki",
  recipesHeading: () => "Przepisy",
  nutritionHeading: () => "Wartości odżywcze",
  ingredientsHeading: () => "Składniki",
  recipeHeading: () => "Przepis",
  recipeSourceLabel: () => "Źródło",
  scaledRecipeNote: () =>
    "Ilości na liście składników zostały przeliczone. Ilości podane w instrukcjach dotyczą oryginalnego przepisu.",
  loadingRecipeMessage: () => "Wczytywanie przepisu…",
  recipeNotFoundMessage: () => "Nie znaleziono przepisu.",
  recipeFailureMessage: () => "Nie udało się wczytać przepisu.",
  dataVersionLabel: () => "Wersja danych:",
  suggestionsListLabel: () => "Podpowiedzi",
  selectedFoodLabel: () => "Wybrany produkt",
  servingUnit: () => "porcja",
  quantityLabel: () => "Ilość",
  unitLabel: () => "Jednostka",
  servingsLabel: () => "porcje",
  loadingNutritionValues: () => "Ładowanie wartości odżywczych",
  proteinLabel: () => "Białko",
  carbohydratesLabel: () => "Węglowodany",
  fatLabel: () => "Tłuszcz",
  caloriesLabel: () => "Kalorie",
  similarityLabel: () => "Podobieństwo",
  foundSubstitutionsHeading: () => "Zamienniki",
  zeroResultsMessage: () => "Nie znaleziono zamienników",
  retryButtonLabel: () => "Spróbuj ponownie",
  endOfResultsMessage: () => "To wszystkie zamienniki.",
  imageUnavailableMessage: () => "Obraz niedostępny",
  positiveNumberMessage: () => "Wpisz liczbę większą od zera, bez jednostki.",
  precisionMessage: (places: number) =>
    `Dozwolona liczba miejsc po przecinku: ${places}.`,
  portionLimitMessage: (maximum: string) =>
    `Wartość przekracza limit porcji. Maksimum dla tego pola: ${maximum}.`,
  retryMessage: () => "Nie udało się wczytać zamienników. Spróbuj ponownie.",
} satisfies Messages;

const dictionaries = { pl, en } satisfies Record<InterfaceLanguage, Messages>;

/** Languages offered by the interface selector. */
export const interfaceLanguages = Object.freeze([
  "pl",
  "en",
] satisfies readonly InterfaceLanguage[]);

/** Checks whether a value names a supported interface language. */
export function isInterfaceLanguage(value: string): value is InterfaceLanguage {
  return Object.hasOwn(dictionaries, value);
}

/** Returns labels for one supported language. */
export function getDictionary(language: InterfaceLanguage): Messages {
  return dictionaries[language];
}

/** Formats a quantity and its localized unit. */
export function formatFoodQuantityValue(
  quantity: FoodQuantity,
  language: InterfaceLanguage,
): string {
  const unit =
    quantity.unit === "serving"
      ? getDictionary(language).servingUnit()
      : quantity.unit;
  return `${quantity.value} ${unit}`;
}

/** Formats landing-dialogue macros with one decimal place. */
export function formatMacronutrientValue(
  value: number,
  language: InterfaceLanguage,
): string {
  const locale = language === "en" ? "en" : "pl";
  return `${value.toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} g`;
}
