import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import {
  INTERFACE_LANGUAGE_STORAGE_KEY,
  interfaceLanguage,
} from "./lib/interfaceLanguage";

const COPY = {
  en: {
    placeholder: "Search foods",
    control: "Interface language",
  },
  pl: {
    placeholder: "Szukaj potraw",
    control: "Język interfejsu",
  },
} as const;

function installStorageSetItem(impl: Storage["setItem"]): () => void {
  const original = window.localStorage.setItem.bind(window.localStorage);
  Object.defineProperty(window.localStorage, "setItem", {
    value: impl,
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(window.localStorage, "setItem", {
      value: original,
      writable: true,
      configurable: true,
    });
  };
}

function getLanguageSelect(name: string): HTMLSelectElement {
  const select = screen.getByRole("combobox", { name });
  if (!(select instanceof HTMLSelectElement)) {
    throw new TypeError("Interface Language combobox must be a select element");
  }
  return select;
}

describe("the Interface Language dropdown", () => {
  beforeEach(() => {
    interfaceLanguage.set("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("renders one localized native dropdown with fixed PL-then-EN options", async () => {
    render(App);

    const select = getLanguageSelect(COPY.en.control);
    expect(select.value).toBe("en");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["PL", "EN"]);
    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["pl", "en"]);

    interfaceLanguage.set("pl");
    await tick();
    expect(
      screen.getByRole("combobox", { name: COPY.pl.control }),
    ).toBeTruthy();
    expect(select.value).toBe("pl");
  });

  test("selection immediately applies the shared dictionary and persists exactly once", async () => {
    const calls: Array<[string, string]> = [];
    const restoreStorage = installStorageSetItem((key, value) => {
      calls.push([key, value]);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      function unexpectedFetch() {
        throw new Error("unexpected network call in component integration");
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      render(App);
      const select = getLanguageSelect(COPY.en.control);

      await fireEvent.change(select, { target: { value: "pl" } });
      expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBeTruthy();
      expect(
        screen.getByRole("combobox", { name: COPY.pl.control }),
      ).toBeTruthy();
      expect(calls).toEqual([[INTERFACE_LANGUAGE_STORAGE_KEY, "pl"]]);

      await fireEvent.change(select, { target: { value: "en" } });
      expect(screen.getByPlaceholderText(COPY.en.placeholder)).toBeTruthy();
      expect(calls).toEqual([
        [INTERFACE_LANGUAGE_STORAGE_KEY, "pl"],
        [INTERFACE_LANGUAGE_STORAGE_KEY, "en"],
      ]);
      expect(document.cookie).toBe("");
    } finally {
      globalThis.fetch = originalFetch;
      restoreStorage();
    }
  });

  test("a failed persistence attempt keeps the selected value in memory", async () => {
    const restoreStorage = installStorageSetItem(() => {
      throw new Error("storage write denied");
    });

    try {
      render(App);
      const select = getLanguageSelect(COPY.en.control);

      await expect(
        fireEvent.change(select, { target: { value: "pl" } }),
      ).resolves.toBeTruthy();
      expect(select.value).toBe("pl");
      expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBeTruthy();
      expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe(
        "en",
      );
      expect(document.cookie).toBe("");
    } finally {
      restoreStorage();
    }
  });
});
