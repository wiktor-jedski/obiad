import type { FoodQuantity, GetFoodSuggestionsData } from "../client/types.gen";

export type InterfaceLanguage = GetFoodSuggestionsData["query"]["language"];

export interface Messages {
  searchLabel: () => string;

  searchPlaceholder: () => string;

  interfaceLanguage: () => string;

  suggestionsListLabel: () => string;

  selectedFoodLabel: () => string;

  servingUnit: () => string;

  quantityLabel: () => string;

  unitLabel: () => string;

  servingsLabel: () => string;

  invalidQuantityMessage: () => string;

  loadingNutritionValues: () => string;

  proteinLabel: () => string;

  carbohydratesLabel: () => string;

  fatLabel: () => string;

  caloriesLabel: () => string;

  similarityLabel: () => string;

  foundSubstitutionsHeading: () => string;

  zeroResultsMessage: () => string;

  moreButtonLabel: () => string;

  retryMessage: () => string;
}

const en = {
  searchLabel: () => "Search",
  searchPlaceholder: () => "Search foods",
  interfaceLanguage: () => "Interface language",
  suggestionsListLabel: () => "Suggestions",
  selectedFoodLabel: () => "Selected food",
  servingUnit: () => "serving",
  quantityLabel: () => "Quantity",
  unitLabel: () => "Unit",
  servingsLabel: () => "servings",
  invalidQuantityMessage: () => "Enter a valid quantity.",
  loadingNutritionValues: () => "Loading nutrition values",
  proteinLabel: () => "Protein",
  carbohydratesLabel: () => "Carbohydrates",
  fatLabel: () => "Fat",
  caloriesLabel: () => "Calories",
  similarityLabel: () => "Similarity",
  foundSubstitutionsHeading: () => "Found substitutions",
  zeroResultsMessage: () => "No substitutes found",
  moreButtonLabel: () => "MORE!",
  retryMessage: () => "Could not load substitutions. Try again.",
} satisfies Messages;

const pl = {
  searchLabel: () => "Szukaj",
  searchPlaceholder: () => "Szukaj potraw",
  interfaceLanguage: () => "Język interfejsu",
  suggestionsListLabel: () => "Podpowiedzi",
  selectedFoodLabel: () => "Wybrany produkt",
  servingUnit: () => "porcja",
  quantityLabel: () => "Ilość",
  unitLabel: () => "Jednostka",
  servingsLabel: () => "porcje",
  invalidQuantityMessage: () => "Wpisz prawidłową ilość.",
  loadingNutritionValues: () => "Ładowanie wartości odżywczych",
  proteinLabel: () => "Białko",
  carbohydratesLabel: () => "Węglowodany",
  fatLabel: () => "Tłuszcz",
  caloriesLabel: () => "Kalorie",
  similarityLabel: () => "Podobieństwo",
  foundSubstitutionsHeading: () => "Znalezione zamienniki",
  zeroResultsMessage: () => "Nie znaleziono zamienników",
  moreButtonLabel: () => "WIĘCEJ!",
  retryMessage: () => "Nie udało się wczytać zamienników. Spróbuj ponownie.",
} satisfies Messages;

const dictionaries = { pl, en } satisfies Record<InterfaceLanguage, Messages>;

export const interfaceLanguages = Object.freeze([
  "pl",
  "en",
] satisfies readonly InterfaceLanguage[]);

export function isInterfaceLanguage(value: string): value is InterfaceLanguage {
  return Object.hasOwn(dictionaries, value);
}

export function getDictionary(language: InterfaceLanguage): Messages {
  return dictionaries[language];
}

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

export function formatCaloriesValue(value: number): string {
  return `${value} kcal`;
}
