/**
 * Interface Language dropdown component integration.
 *
 * The happy-dom boundary proves the native select's localized accessible name,
 * fixed options, active value, shared-dictionary update, exact persistence, and
 * storage-failure behavior. Native keyboard interaction and responsive layout
 * remain covered by the real-stack Playwright scenario.
 */

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

describe("the Interface Language dropdown", () => {
  beforeEach(() => {
    interfaceLanguage.set("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("renders one localized native dropdown with fixed PL-then-EN options", async () => {
    render(App);

    const select = screen.getByRole("combobox", {
      name: COPY.en.control,
    }) as HTMLSelectElement;
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
    globalThis.fetch = (() => {
      throw new Error("unexpected network call in component integration");
    }) as unknown as typeof fetch;

    try {
      render(App);
      const select = screen.getByRole("combobox", {
        name: COPY.en.control,
      }) as HTMLSelectElement;

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
      const select = screen.getByRole("combobox", {
        name: COPY.en.control,
      }) as HTMLSelectElement;

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
