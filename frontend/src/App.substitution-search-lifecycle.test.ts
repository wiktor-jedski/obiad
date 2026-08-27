import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import { interfaceLanguage } from "./lib/interfaceLanguage";
import {
  interactionState,
  type SelectedFoodObject,
} from "./lib/interactionState";
import { queryClient } from "./lib/queryClient";
const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
  capturedLanguage: "en",
} as const;

const RESPONSE_BODY = JSON.stringify({
  pageIndex: 0,
  totalEligibleCount: 1,
  hasMore: false,
  inputMacronutrients: { protein: 31, carbohydrate: 0, fat: 3.6 },
  items: [
    {
      foodObjectId: 20,
      names: { en: "Protein shake", pl: "Shake białkowy" },
      matchedQuantity: { value: 100, unit: "ml" },
      macronutrients: { protein: 8, carbohydrate: 4, fat: 1 },
      similarityPercent: 85,
    },
  ],
});

class HappyDomRequest {
  readonly url: string;
  readonly method: string;

  constructor(url: string | URL, init?: RequestInit) {
    this.url = String(url);
    this.method = init?.method ?? "GET";
  }
}

async function settle(): Promise<void> {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("the Substitution Search lifecycle", () => {
  beforeEach(() => {
    interfaceLanguage.set("en");
    interactionState.reset();
    queryClient.clear();
  });

  afterEach(() => {
    cleanup();
  });

  test("one selection performs exactly one generated-client POST, and remounting the application with the selection active performs no second POST", async () => {
    const postUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    Object.defineProperty(globalThis, "Request", {
      configurable: true,
      writable: true,
      value: HappyDomRequest,
    });
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url =
          input instanceof globalThis.Request ? input.url : input.toString();
        if (url.includes("/api/v1/substitutes/search")) {
          postUrls.push(url);
          return new Response(RESPONSE_BODY, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      interactionState.selectSuggestion(SELECTED);
      render(App);
      await settle();

      expect(postUrls, "one POST for the selection").toHaveLength(1);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");

      cleanup();
      render(App);
      await settle();

      expect(
        postUrls,
        "a remount must not start a second Substitution Search",
      ).toHaveLength(1);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });

  test("typing keeps one dropdown mounted during suggestion refetches, preserves committed results, and Enter starts a second search", async () => {
    const postUrls: string[] = [];
    let releaseButterSuggestions: (() => void) | undefined;
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    Object.defineProperty(globalThis, "Request", {
      configurable: true,
      writable: true,
      value: HappyDomRequest,
    });
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url =
          input instanceof globalThis.Request ? input.url : input.toString();
        if (url.includes("/api/v1/food-suggestions")) {
          const suggestionQuery = new URL(
            url,
            "http://localhost",
          ).searchParams.get("query");
          if (suggestionQuery === "butter") {
            await new Promise<void>((resolve) => {
              releaseButterSuggestions = resolve;
            });
          }
          const firstFoodObjectId =
            suggestionQuery === "olive"
              ? 11
              : suggestionQuery === "butter"
                ? 6
                : 1;
          return new Response(
            JSON.stringify({
              items: Array.from({ length: 5 }, (_, index) => ({
                foodObjectId: firstFoodObjectId + index,
                names: {
                  en: `Food ${firstFoodObjectId + index}`,
                  pl: `Potrawa ${firstFoodObjectId + index}`,
                },
                defaultQuantity: { value: 100, unit: "g" },
                allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
              })),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.includes("/api/v1/substitutes/search")) {
          postUrls.push(url);
          return new Response(RESPONSE_BODY, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const view = render(App);
      const search = view.getByRole("combobox", { name: "Search" });
      if (!(search instanceof HTMLInputElement)) {
        throw new TypeError("Search combobox must be an input element");
      }
      await fireEvent.focus(search);
      await fireEvent.input(search, { target: { value: "b" } });
      await settle();
      const suggestionPanel = view.getByRole("listbox");
      expect(
        suggestionPanel.querySelector('[role="option"]')?.textContent,
      ).toBe("Food 1");

      await fireEvent.input(search, { target: { value: "butter" } });
      await tick();
      expect(
        view.getByRole("listbox"),
        "the dropdown stays mounted while fresh suggestions load",
      ).toBe(suggestionPanel);
      expect(
        suggestionPanel.querySelector('[role="option"]')?.textContent,
      ).toBe("Food 1");

      expect(releaseButterSuggestions).toBeDefined();
      releaseButterSuggestions?.();
      await settle();
      expect(view.getByRole("listbox")).toBe(suggestionPanel);
      expect(
        suggestionPanel.querySelector('[role="option"]')?.textContent,
      ).toBe("Food 6");
      await fireEvent.keyDown(search, { key: "Enter" });
      await settle();

      expect(postUrls, "the first selection starts one search").toHaveLength(1);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");
      expect(search.value).toBe("Food 6");

      await fireEvent.focus(search);
      await fireEvent.input(search, { target: { value: "olive" } });
      await settle();
      expect(
        view.getByRole("listbox").querySelectorAll('[role="option"]'),
        "typing after results opens fresh suggestions",
      ).toHaveLength(5);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
        "typing keeps the committed result state",
      ).toBe("results");
      expect(document.querySelectorAll("[data-result-card]")).toHaveLength(1);
      expect(
        document.querySelector("[data-selected-input]")?.textContent,
      ).toContain("Food 6 · 100 g");
      await fireEvent.keyDown(search, { key: "Enter" });
      await settle();

      expect(postUrls, "Enter starts the second search").toHaveLength(2);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");
      expect(search.value).toBe("Food 11");
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });
});
