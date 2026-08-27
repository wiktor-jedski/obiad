import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import App from "./App.svelte";
import {
  INTERFACE_LANGUAGE_STORAGE_KEY,
  createInterfaceLanguageStore,
  interfaceLanguage,
} from "./lib/interfaceLanguage";
import { getDictionary } from "./lib/i18n";
import type { InterfaceLanguageEnvironment } from "./lib/interfaceLanguage";

const COPY = {
  en: { label: "Search", placeholder: "Search foods" },
  pl: { label: "Szukaj", placeholder: "Szukaj potraw" },
} as const;

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
    expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe(
      "pl",
    );
  });

  test("rendering and a language switch make no cookie or network call", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      function unexpectedFetch() {
        throw new Error("unexpected network call in component integration");
      },
      { preconnect: originalFetch.preconnect },
    );
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
    expect(get(plOverBrowserEn)).toBe("pl");

    const enOverBrowserPl = createInterfaceLanguageStore({
      storage: recordingStorage("en", log),
      browserLanguages: ["pl-PL"],
    });
    expect(get(enOverBrowserPl)).toBe("en");
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
      expect(get(store), `browser languages ${languages.join(", ")}`).toBe(
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
    expect(get(store)).toBe("pl");
    expect(log).toEqual([`read:${INTERFACE_LANGUAGE_STORAGE_KEY}`]);
  });

  test("a browser-derived initial choice is never persisted", () => {
    const log: string[] = [];
    const store = createInterfaceLanguageStore({
      storage: recordingStorage(null, log),
      browserLanguages: ["pl-PL"],
    });
    expect(get(store)).toBe("pl");
    expect(log).toEqual([`read:${INTERFACE_LANGUAGE_STORAGE_KEY}`]);
  });

  test("a failed storage read behaves as a missing value", () => {
    const store = createInterfaceLanguageStore({
      storage: recordingStorage("pl", [], { read: true }),
      browserLanguages: ["en-US"],
    });
    expect(get(store)).toBe("en");
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
    expect(log).toEqual([
      `read:${INTERFACE_LANGUAGE_STORAGE_KEY}`,
      "value:en",
      "value:pl",
      `write:${INTERFACE_LANGUAGE_STORAGE_KEY}=pl`,
    ]);
  });
});
