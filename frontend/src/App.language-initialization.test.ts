/**
 * Interface Language initialization — happy-dom component integration
 * scenario (task 25; ARCH-003, ARCH-012, ARCH-014, ARCH-022, REQ-056,
 * ISSUE-006, ISSUE-007).
 *
 * `bun test` runs this file with the pinned `happy-dom` and
 * `@testing-library/svelte` packages. It proves that the root application
 * and the existing Search component share the typed active dictionary for
 * the exact English and Polish copy, that the persisted store resolves
 * valid saved values over the browser languages and ignores invalid ones
 * without rewriting them, that a failed storage read behaves as missing,
 * and that the store setter updates memory before attempting persistence
 * and retains the in-memory selection without throwing when a write fails.
 * No generated client, network call, cookie, backend, or database is
 * involved (ISSUE-007); full-deployment acceptance stays in Playwright.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import {
  INTERFACE_LANGUAGE_STORAGE_KEY,
  createInterfaceLanguageStore,
  interfaceLanguage,
} from "./lib/interfaceLanguage";
import { getDictionary } from "./lib/i18n";
import type { InterfaceLanguageEnvironment } from "./lib/interfaceLanguage";

/** The exact ISSUE-007 copy of the two supported dictionaries. */
const COPY = {
  en: { label: "Search", placeholder: "Search foods" },
  pl: { label: "Szukaj", placeholder: "Szukaj potraw" },
} as const;

/** A storage fake recording every operation in `log`. */
function recordingStorage(
  stored: string | null,
  log: string[],
  fail: { read?: boolean; write?: boolean } = {},
): InterfaceLanguageEnvironment["storage"] {
  return {
    getItem: (key) => {
      log.push(`read:${key}`);
      if (fail.read) {
        throw new Error("storage read denied");
      }
      return stored;
    },
    setItem: (key, value) => {
      log.push(`write:${key}=${value}`);
      if (fail.write) {
        throw new Error("storage write denied");
      }
    },
  };
}

describe("the persisted Interface Language store", () => {
  beforeEach(() => {
    // Make the shared store deterministic regardless of the happy-dom
    // defaults: English active and persisted before each rendered test.
    interfaceLanguage.set("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("the static dictionaries expose the exact copy through message functions", () => {
    expect(getDictionary("en").searchLabel()).toBe("Search");
    expect(getDictionary("en").searchPlaceholder()).toBe("Search foods");
    expect(getDictionary("en").interfaceLanguage()).toBe("Interface language");
    expect(getDictionary("pl").searchLabel()).toBe("Szukaj");
    expect(getDictionary("pl").searchPlaceholder()).toBe("Szukaj potraw");
    expect(getDictionary("pl").interfaceLanguage()).toBe("Język interfejsu");
  });

  test("the root application and the Search component render the exact English copy", async () => {
    render(App);
    const input = screen.getByLabelText(COPY.en.label);
    expect(input).toBeTruthy();
    expect(screen.getByPlaceholderText(COPY.en.placeholder)).toBe(input);
    expect(screen.getByText(COPY.en.label)).toBeTruthy();
  });

  test("the same typed dictionary switches the rendered Search to the exact Polish copy", async () => {
    render(App);
    interfaceLanguage.set("pl");
    await tick();
    const input = screen.getByLabelText(COPY.pl.label);
    expect(input).toBeTruthy();
    expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBe(input);
    expect(screen.getByText(COPY.pl.label)).toBeTruthy();
    expect(screen.queryByLabelText(COPY.en.label)).toBeNull();
    // The shared store persisted the selection (ARCH-014).
    expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe(
      "pl",
    );
  });

  test("rendering and a language switch make no cookie or network call", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("unexpected network call in component integration");
    }) as unknown as typeof fetch;
    try {
      render(App);
      interfaceLanguage.set("pl");
      expect(document.cookie).toBe("");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a valid stored value wins over the browser languages", () => {
    const log: string[] = [];
    const plOverBrowserEn = createInterfaceLanguageStore({
      storage: recordingStorage("pl", log),
      browserLanguages: ["en-US"],
    });
    let initial = "en";
    plOverBrowserEn.subscribe((value) => {
      initial = value;
    });
    expect(initial).toBe("pl");

    const enOverBrowserPl = createInterfaceLanguageStore({
      storage: recordingStorage("en", log),
      browserLanguages: ["pl-PL"],
    });
    enOverBrowserPl.subscribe((value) => {
      initial = value;
    });
    expect(initial).toBe("en");
  });

  test("the first supported primary language wins in browser order, defaulting to English", () => {
    const log: string[] = [];
    const cases: Array<{ languages: string[]; expected: "en" | "pl" }> = [
      { languages: ["pl-PL"], expected: "pl" },
      { languages: ["de-DE", "pl-PL"], expected: "pl" },
      { languages: ["fr-FR", "de-DE"], expected: "en" },
      { languages: ["PL-pl", "en-US"], expected: "pl" },
      { languages: [], expected: "en" },
    ];
    for (const { languages, expected } of cases) {
      const store = createInterfaceLanguageStore({
        storage: recordingStorage(null, log),
        browserLanguages: languages,
      });
      const state: { current: "en" | "pl" } = { current: "en" };
      store.subscribe((next) => {
        state.current = next;
      });
      expect(state.current, `browser languages ${languages.join(", ")}`).toBe(
        expected,
      );
    }
  });

  test("an invalid stored value is ignored without rewriting it", () => {
    const log: string[] = [];
    const store = createInterfaceLanguageStore({
      storage: recordingStorage("fr", log),
      browserLanguages: ["pl-PL"],
    });
    const state: { current: "en" | "pl" } = { current: "en" };
    store.subscribe((next) => {
      state.current = next;
    });
    expect(state.current).toBe("pl");
    // The invalid value is read once and never written back (ISSUE-007).
    expect(log).toEqual([`read:${INTERFACE_LANGUAGE_STORAGE_KEY}`]);
  });

  test("a browser-derived initial choice is never persisted", () => {
    const log: string[] = [];
    const store = createInterfaceLanguageStore({
      storage: recordingStorage(null, log),
      browserLanguages: ["pl-PL"],
    });
    const state: { current: "en" | "pl" } = { current: "en" };
    store.subscribe((next) => {
      state.current = next;
    });
    expect(state.current).toBe("pl");
    // Initialization performs no storage write (ISSUE-007, REQ-056).
    expect(log).toEqual([`read:${INTERFACE_LANGUAGE_STORAGE_KEY}`]);
  });

  test("a failed storage read behaves as a missing value", () => {
    const store = createInterfaceLanguageStore({
      storage: recordingStorage("pl", [], { read: true }),
      browserLanguages: ["en-US"],
    });
    const state: { current: "en" | "pl" } = { current: "pl" };
    store.subscribe((next) => {
      state.current = next;
    });
    expect(state.current).toBe("en");
  });

  test("the setter updates memory before attempting persistence and survives a failed write", () => {
    const log: string[] = [];
    const store = createInterfaceLanguageStore({
      storage: recordingStorage(null, log, { write: true }),
      browserLanguages: ["en-US"],
    });
    store.subscribe((value) => {
      log.push(`value:${value}`);
    });
    expect(() => store.set("pl")).not.toThrow();
    // Initialization reads storage, then memory is updated before the
    // persistence attempt, in order; the failed write is swallowed and the
    // in-memory selection is retained.
    expect(log).toEqual([
      `read:${INTERFACE_LANGUAGE_STORAGE_KEY}`,
      "value:en",
      "value:pl",
      `write:${INTERFACE_LANGUAGE_STORAGE_KEY}=pl`,
    ]);
  });
});
