/**
 * Persisted Interface Language preference (ARCH-012, ARCH-014, REQ-056).
 *
 * Task 25 (Phase 6) initializes one persisted Svelte store before the first
 * application render: an exact valid `en` or `pl` value under the
 * `obiad.interfaceLanguage` localStorage key wins (ARCH-014); otherwise the
 * first supported primary language in `navigator.languages` order is chosen
 * case-insensitively, defaulting to English (ARCH-012, REQ-056). No cookie
 * is used. A failed storage read behaves as a missing value; any other
 * stored value is ignored without rewriting it; and a browser-derived
 * initial choice is never persisted (ISSUE-007). The store setter updates
 * memory before attempting persistence and retains the in-memory selection
 * without throwing when a write fails (ISSUE-007).
 */

import { writable, type Readable } from "svelte/store";
import type { InterfaceLanguage } from "./i18n";

/** The localStorage key that persists the Interface Language (ARCH-014). */
export const INTERFACE_LANGUAGE_STORAGE_KEY = "obiad.interfaceLanguage";

/**
 * The browser storage surface the preference uses. Only read and write are
 * needed; the narrowed shape keeps the store testable with minimal fakes.
 */
export interface InterfaceLanguageEnvironment {
  /** The browser storage the preference persists to (ARCH-014). */
  storage: Pick<Storage, "getItem" | "setItem">;
  /** The ordered browser language tags, from `navigator.languages`. */
  browserLanguages: readonly string[];
}

/** A persisted Interface Language store (ARCH-014). */
export interface InterfaceLanguageStore extends Readable<InterfaceLanguage> {
  /**
   * Applies a user selection: updates memory first, then persists; a failed
   * write keeps the in-memory selection without throwing (ISSUE-007).
   */
  set: (language: InterfaceLanguage) => void;
}

/** The exact values the persisted preference may hold (ARCH-014). */
const SUPPORTED_LANGUAGES: readonly string[] = ["en", "pl"];

/**
 * Reads the persisted value. A failed storage read behaves as a missing
 * value (ISSUE-007).
 */
function readStoredLanguage(storage: Pick<Storage, "getItem">): string | null {
  try {
    return storage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolves the initial Interface Language (ARCH-012, REQ-056, ISSUE-007):
 * an exact valid stored `en` or `pl` value wins; otherwise the first
 * supported primary language in browser order, otherwise English. Never
 * writes storage.
 */
function resolveInitialLanguage(
  environment: InterfaceLanguageEnvironment,
): InterfaceLanguage {
  const stored = readStoredLanguage(environment.storage);
  if (stored !== null && SUPPORTED_LANGUAGES.includes(stored)) {
    return stored as InterfaceLanguage;
  }
  for (const tag of environment.browserLanguages) {
    const primary = tag.split(/[-_]/u)[0]?.toLowerCase() ?? "";
    if (primary === "en" || primary === "pl") {
      return primary;
    }
  }
  return "en";
}

/**
 * Creates one persisted Interface Language store bound to a browser
 * environment (ARCH-012, ARCH-014, ISSUE-007).
 *
 * @param environment - the storage and ordered browser language tags
 * @returns the initialized store
 */
export function createInterfaceLanguageStore(
  environment: InterfaceLanguageEnvironment,
): InterfaceLanguageStore {
  const { subscribe, set } = writable<InterfaceLanguage>(
    resolveInitialLanguage(environment),
  );
  return {
    subscribe,
    set(language) {
      // Update memory before attempting persistence (ISSUE-007).
      set(language);
      try {
        environment.storage.setItem(INTERFACE_LANGUAGE_STORAGE_KEY, language);
      } catch {
        // Retain the in-memory selection; persistence may be lost on reload.
      }
    },
  };
}

/**
 * The single persisted Interface Language store of the application. Its
 * initial value resolves at module load — before the first application
 * render — from the stored preference or the browser languages (task 25;
 * ARCH-012, ARCH-014, REQ-056, ISSUE-007).
 */
export const interfaceLanguage: InterfaceLanguageStore =
  createInterfaceLanguageStore({
    storage: window.localStorage,
    browserLanguages: navigator.languages,
  });
