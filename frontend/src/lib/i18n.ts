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
import type { GetFoodSuggestionsData } from "../client/types.gen";

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
}

/** The static English dictionary (ISSUE-007 exact copy). */
const en = {
  searchLabel: () => "Search",
  searchPlaceholder: () => "Search foods",
  interfaceLanguage: () => "Interface language",
  suggestionsListLabel: () => "Suggestions",
} satisfies Messages;

/** The static Polish dictionary (ISSUE-007 exact copy). */
const pl = {
  searchLabel: () => "Szukaj",
  searchPlaceholder: () => "Szukaj potraw",
  interfaceLanguage: () => "Język interfejsu",
  suggestionsListLabel: () => "Podpowiedzi",
} satisfies Messages;

/** Shape-checked static dictionaries keyed in UI display order. */
const dictionaries = { pl, en } satisfies Record<InterfaceLanguage, Messages>;

/** Supported Interface Languages in UI display order. */
export const interfaceLanguages: readonly InterfaceLanguage[] = Object.freeze(
  Object.keys(dictionaries) as InterfaceLanguage[],
);

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
