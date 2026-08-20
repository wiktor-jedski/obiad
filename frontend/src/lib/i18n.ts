/**
 * Translation Module (ARCH-003) — typed static dictionaries.
 *
 * Task 25 (Phase 6, Interface Language preference) introduces the initial
 * Interface Language slice: the closed `en`/`pl` language type, the exact
 * shape every dictionary must satisfy, and the static English and Polish
 * dictionaries that expose every currently rendered interface and
 * accessibility message (ISSUE-006, ISSUE-007). Components consume the
 * dictionary of the active Interface Language through {@link getDictionary};
 * the persisted active language itself lives in `interfaceLanguage.ts`
 * (ARCH-012, ARCH-014).
 */

/**
 * The closed set of supported Interface Languages. Only `en` and `pl` are
 * valid; both are the exact values persisted under the
 * `obiad.interfaceLanguage` localStorage key (ISSUE-007, ARCH-014).
 */
export type InterfaceLanguage = "en" | "pl";

/**
 * The exact shape every static dictionary satisfies (ARCH-003). Each
 * dictionary is checked against this shape at compile time, so a message
 * added to one language without the other fails to compile.
 */
export interface Messages {
  /** Visually hidden accessible label of the empty-state Search control. */
  searchLabel: string;
  /** Placeholder of the empty-state Search control. */
  searchPlaceholder: string;
  /** Accessible name of the Interface Language control group (task 26). */
  interfaceLanguage: string;
}

/** The static English dictionary (ISSUE-007 exact copy). */
const en: Messages = {
  searchLabel: "Search",
  searchPlaceholder: "Search foods",
  interfaceLanguage: "Interface language",
};

/** The static Polish dictionary (ISSUE-007 exact copy). */
const pl: Messages = {
  searchLabel: "Szukaj",
  searchPlaceholder: "Szukaj potraw",
  interfaceLanguage: "Język interfejsu",
};

/** Shape-checked static dictionaries keyed by Interface Language. */
const dictionaries: Record<InterfaceLanguage, Messages> = { en, pl };

/**
 * Returns the static dictionary for the active Interface Language.
 *
 * @param language - the active Interface Language
 * @returns the shape-checked dictionary carrying the localized messages
 */
export function getDictionary(language: InterfaceLanguage): Messages {
  return dictionaries[language];
}
