/**
 * Translation Module (ARCH-003) — typed static dictionaries.
 *
 * Task 25 (Phase 6, Interface Language preference) introduces the initial
 * Interface Language slice: the closed `en`/`pl` language type, the exact
 * shape every dictionary must satisfy, and the static English and Polish
 * dictionaries that expose every currently rendered interface and
 * accessibility message through zero-argument message functions (ISSUE-006,
 * ISSUE-007). Components consume the dictionary of the active Interface
 * Language through {@link getDictionary}; the persisted active language
 * itself lives in `interfaceLanguage.ts` (ARCH-012, ARCH-014).
 */
import type { FoodQuantity, GetFoodSuggestionsData } from "../client/types.gen";

/**
 * The closed set of supported Interface Languages from the authoritative
 * generated HTTP contract.
 */
export type InterfaceLanguage = GetFoodSuggestionsData["query"]["language"];

/**
 * The exact shape every static dictionary satisfies (ARCH-003). Each message
 * is a zero-argument function; the dictionaries are checked against this
 * shape at compile time (`satisfies Messages`), so a message added to one
 * language without the other — or with a different return type — fails to
 * compile.
 */
export interface Messages {
  /** Visually hidden accessible label of the empty-state Search control. */
  searchLabel: () => string;
  /** Placeholder of the empty-state Search control. */
  searchPlaceholder: () => string;
  /** Accessible name of the Interface Language control group (task 26). */
  interfaceLanguage: () => string;
  /** Accessible name of the suggestion listbox (task 27, REQ-018). */
  suggestionsListLabel: () => string;
  /** Visible label of the read-only Substitution Input (task 28, ISSUE-008). */
  selectedFoodLabel: () => string;
  /** Localized unit label of one Serving in the read-only Substitution Input (task 28, ISSUE-008). */
  servingUnit: () => string;
  /** Visually hidden accessible name of the quantity number field (task 34, ISSUE-010). */
  quantityLabel: () => string;
  /** Visually hidden accessible name of the quantity unit selector (task 34, ISSUE-010). */
  unitLabel: () => string;
  /** Plural selector option label of the Serving unit (task 34, ISSUE-010). */
  servingsLabel: () => string;
  /** Localized field message of an invalid committed quantity (task 34, REQ-026, ISSUE-010). */
  invalidQuantityMessage: () => string;
  /** Polite busy announcement of the initial new Search summary (task 34, ISSUE-010). */
  loadingNutritionValues: () => string;
  /** Polite busy announcement of a pending quantity recalculation (task 34, ISSUE-010). */
  updatingQuantities: () => string;
  /** Visible label of the protein macronutrient row on a result card (task 29, ISSUE-008). */
  proteinLabel: () => string;
  /** Visible label of the carbohydrate macronutrient row on a result card (task 29, ISSUE-008). */
  carbohydratesLabel: () => string;
  /** Visible label of the fat macronutrient row on a result card (task 29, ISSUE-008). */
  fatLabel: () => string;
  /** Visible label of the calories row (task 35, REQ-078). */
  caloriesLabel: () => string;
  /** Visible label of the Macro similarity row on a result card (task 29, ISSUE-008). */
  similarityLabel: () => string;
  /** Centered heading above the result grid (task 35, REQ-079). */
  foundSubstitutionsHeading: () => string;
  /** Localized result-area message for a successful empty page (task 30, REQ-044, ISSUE-008). */
  zeroResultsMessage: () => string;
  /** Visible label and accessible name of the MORE! paging button (task 37, REQ-041). */
  moreButtonLabel: () => string;
  /**
   * The ISSUE-013 retry message shown after a failed new Search or MORE!
   * request (task 41, task 42; REQ-050, REQ-051). Both failure states use
   * this one shared visible and assistive message.
   */
  retryMessage: () => string;
}

/** The static English dictionary (ISSUE-007 exact copy). */
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
  updatingQuantities: () => "Updating quantities",
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

/** The static Polish dictionary (ISSUE-007 exact copy). */
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
  updatingQuantities: () => "Aktualizowanie ilości",
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

/** Shape-checked static dictionaries keyed in UI display order. */
const dictionaries = { pl, en } satisfies Record<InterfaceLanguage, Messages>;

/** Supported Interface Languages in UI display order. */
export const interfaceLanguages = Object.freeze([
  "pl",
  "en",
] satisfies readonly InterfaceLanguage[]);

/**
 * Reports whether a raw value identifies a supported Interface Language.
 *
 * @param value - the raw language value
 * @returns whether the value has a corresponding static dictionary
 */
export function isInterfaceLanguage(value: string): value is InterfaceLanguage {
  return Object.hasOwn(dictionaries, value);
}

/**
 * Returns the static dictionary for the active Interface Language.
 *
 * @param language - the active Interface Language
 * @returns the shape-checked dictionary carrying the localized message
 *   functions
 */
export function getDictionary(language: InterfaceLanguage): Messages {
  return dictionaries[language];
}

/**
 * Formats one Food Quantity as the selected-food summary value. Serving
 * renders with the localized unit of the given language (`1 serving` or
 * `1 porcja`); `g` and `ml` stay invariant. The caller supplies the active
 * Interface Language so the summary updates without a new search (REQ-058).
 *
 * @param quantity - the current Food Quantity
 * @param language - the active Interface Language
 * @returns the formatted `value unit` string
 */
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

/**
 * Formats one display-ready macronutrient value for a result card (task 29;
 * REQ-037, REQ-039, REQ-040): exactly one active-locale decimal place
 * followed by the invariant `g` unit, for example `35.0 g` in English and
 * `35,0 g` in Polish. The value arrives already rounded to `0.1 g` by the
 * backend (ARCH-001, ARCH-005); the browser never recalculates or rerounds
 * nutrition, it only applies the localized display formatting.
 *
 * @param value - the backend-rounded macronutrient value in grams
 * @param language - the active Interface Language
 * @returns the formatted `value g` string with one localized decimal place
 */
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

/**
 * Formats one display-ready calorie value for the input card or a result card
 * (task 35, REQ-078): whole integer followed by the invariant `kcal` unit, for
 * example `875 kcal`. The value arrives already rounded by the backend (ARCH-001,
 * ARCH-005); the browser never calculates or rerounds calories (REQ-078), it
 * only formats the string for display.
 *
 * @param value - the backend-projected whole calorie value
 * @returns the formatted `value kcal` string
 */
export function formatCaloriesValue(value: number): string {
  return `${value} kcal`;
}
