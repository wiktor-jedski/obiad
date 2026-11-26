import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
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

function languageSummary(name: string): HTMLElement {
  return screen.getByLabelText(name, {
    selector: "[data-interface-language] summary",
  });
}

async function chooseLanguage(label: string, name: string): Promise<void> {
  await fireEvent.click(languageSummary(label));
  await fireEvent.click(screen.getByRole("button", { name }));
}

describe("the Interface Language disclosure", () => {
  beforeEach(() => {
    interfaceLanguage.set("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("shows the current language code and marks only its native button as pressed", async () => {
    render(App);
    const summary = languageSummary(COPY.en.control);
    expect(summary.textContent).toContain("EN");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);
    await fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(
      screen.getByRole("button", { name: "English", pressed: true }).tagName,
    ).toBe("BUTTON");
    const polish = screen.getByRole("button", {
      name: "Polski",
      pressed: false,
    });
    expect(polish.tagName).toBe("BUTTON");

    await fireEvent.click(polish);
    const localizedSummary = languageSummary(COPY.pl.control);
    expect(localizedSummary.textContent).toContain("PL");
    expect(localizedSummary.closest("details")?.open).toBe(false);
    expect(document.activeElement).toBe(localizedSummary);
    await fireEvent.click(localizedSummary);
    expect(
      screen.getByRole("button", { name: "Polski", pressed: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "English", pressed: false }),
    ).toBeTruthy();
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
      await chooseLanguage(COPY.en.control, "Polski");
      expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBeTruthy();
      expect(document.activeElement).toBe(languageSummary(COPY.pl.control));
      expect(calls).toEqual([[INTERFACE_LANGUAGE_STORAGE_KEY, "pl"]]);

      await chooseLanguage(COPY.pl.control, "English");
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
      await chooseLanguage(COPY.en.control, "Polski");
      expect(languageSummary(COPY.pl.control).textContent).toContain("PL");
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
