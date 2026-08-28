import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import type { SubstituteSearchResponse } from "./client/types.gen";
import { interfaceLanguage } from "./lib/interfaceLanguage";
import {
  interactionState,
  type SelectedFoodObject,
} from "./lib/interactionState";
import { queryClient } from "./lib/queryClient";
import { isSubstitutionSearchLocked } from "./lib/substitutionSearch";
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
  selectedFood: {
    foodObjectId: 18,
    names: { en: "Butter", pl: "Masło" },
    macroProfile: { protein: 31, carbohydrate: 0, fat: 3.6 },
    baseUnit: "g",
    serving: 350,
  },
  items: [
    {
      foodObjectId: 20,
      names: { en: "Protein shake", pl: "Shake białkowy" },
      macroProfile: { protein: 8, carbohydrate: 4, fat: 1 },
      baseUnit: "ml",
      similarityPercent: 85,
    },
  ],
});

class HappyDomRequest {
  readonly url: string;
  readonly method: string;
  readonly signal: AbortSignal | null;
  readonly body: BodyInit | null;

  constructor(url: string | URL, init?: RequestInit) {
    this.url = String(url);
    this.method = init?.method ?? "GET";
    this.signal = init?.signal ?? null;
    this.body = init?.body ?? null;
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

  test("a new selection of the same food refetches after a local quantity commit", async () => {
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
          const responseIndex = postUrls.length;
          return new Response(
            JSON.stringify({
              pageIndex: 0,
              totalEligibleCount: 1,
              hasMore: false,
              selectedFood: {
                foodObjectId: SELECTED.foodObjectId,
                names: SELECTED.names,
                macroProfile: { protein: 31, carbohydrate: 0, fat: 3.6 },
                baseUnit: "g",
              },
              items: [
                {
                  foodObjectId: 20 + responseIndex,
                  names: {
                    en: `Fresh result ${responseIndex}`,
                    pl: `Świeży wynik ${responseIndex}`,
                  },
                  macroProfile: { protein: 8, carbohydrate: 4, fat: 1 },
                  baseUnit: "ml",
                  similarityPercent: 85,
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      interactionState.selectSuggestion(SELECTED);
      render(App);
      await settle();
      const firstCard = document.querySelector(
        '[data-result-card][data-food-object-id="21"]',
      );
      expect(firstCard).not.toBeNull();
      interactionState.setQuantityText("200");
      interactionState.commitQuantity();
      await tick();
      expect(postUrls, "the local commit remains request-free").toHaveLength(1);

      interactionState.selectSuggestion(SELECTED);
      await settle();

      expect(
        postUrls,
        "a new same-food selection starts a fresh Substitute Search",
      ).toHaveLength(2);
      const secondCard = document.querySelector(
        '[data-result-card][data-food-object-id="22"]',
      );
      expect(secondCard).not.toBeNull();
      expect(secondCard).not.toBe(firstCard);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });

  test("changed valid quantity commits synchronously reproject the current response without a second POST or request transition", async () => {
    const postUrls: string[] = [];
    let aborts = 0;
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    Object.defineProperty(globalThis, "Request", {
      configurable: true,
      writable: true,
      value: HappyDomRequest,
    });
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof globalThis.Request ? input : undefined;
        const url = request?.url ?? input.toString();
        if (url.includes("/api/v1/substitutes/search")) {
          postUrls.push(url);
          const signal = request?.signal ?? init?.signal;
          signal?.addEventListener("abort", () => {
            aborts += 1;
          });
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
      interactionState.selectSuggestion({
        ...SELECTED,
        allowedQuantities: [
          { unit: "g", maximumValue: 100000 },
          { unit: "serving", maximumValue: 285 },
        ],
      });
      const view = render(App);
      await settle();

      const quantity = view.container.querySelector("[data-quantity-number]");
      const unit = view.container.querySelector("[data-quantity-unit]");
      const editor = view.container.querySelector("[data-quantity-editor]");
      if (
        !(quantity instanceof HTMLInputElement) ||
        !(unit instanceof HTMLSelectElement) ||
        !(editor instanceof HTMLElement)
      ) {
        throw new TypeError("Quantity editor controls must be present");
      }

      expect(postUrls, "the initial selection starts one search").toHaveLength(1);
      await fireEvent.input(quantity, { target: { value: "200" } });
      await fireEvent.keyDown(quantity, { key: "Enter" });
      await tick();
      expect(document.querySelector("[data-input-calories]")?.textContent).toBe(
        "313 kcal",
      );

      await fireEvent.change(unit, { target: { value: "serving" } });
      await tick();
      expect(document.querySelector("[data-input-calories]")?.textContent).toBe(
        "547 kcal",
      );

      await fireEvent.input(quantity, { target: { value: "1.5" } });
      await fireEvent.focusOut(editor, { relatedTarget: document.body });
      await tick();
      expect(document.querySelector("[data-input-calories]")?.textContent).toBe(
        "821 kcal",
      );
      expect(postUrls, "local commits start no additional POST").toHaveLength(1);
      expect(aborts, "local commits cancel no request").toBe(0);
      expect(queryClient.isFetching(), "local commits start no pending query").toBe(
        0,
      );
      expect(isSubstitutionSearchLocked(), "local commits acquire no lock").toBe(
        false,
      );
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });

  test("a local quantity commit keeps the later-page response and page identity", async () => {
    const postUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    Object.defineProperty(globalThis, "Request", {
      configurable: true,
      writable: true,
      value: HappyDomRequest,
    });
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof HappyDomRequest ? input : undefined;
        const url = request?.url ?? input.toString();
        if (url.includes("/api/v1/substitutes/search")) {
          postUrls.push(url);
          const pageIndex =
            typeof request?.body === "string"
              ? JSON.parse(request.body).pageIndex
              : typeof init?.body === "string"
                ? JSON.parse(init.body).pageIndex
                : postUrls.length - 1;
          return new Response(
            JSON.stringify({
              pageIndex,
              totalEligibleCount: 2,
              hasMore: pageIndex === 0,
              selectedFood: {
                foodObjectId: SELECTED.foodObjectId,
                names: SELECTED.names,
                macroProfile: { protein: 31, carbohydrate: 0, fat: 3.6 },
                baseUnit: "g",
              },
              items: [
                {
                  foodObjectId: 20 + pageIndex,
                  names: {
                    en: `Food ${20 + pageIndex}`,
                    pl: `Potrawa ${20 + pageIndex}`,
                  },
                  macroProfile: { protein: 8, carbohydrate: 4, fat: 1 },
                  baseUnit: "ml",
                  similarityPercent: 85,
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      interactionState.selectSuggestion(SELECTED);
      const view = render(App);
      await settle();
      interactionState.loadNextPage();
      await settle();

      const pageRequestCount = postUrls.length;
      const pageOneCard = view.container.querySelector(
        '[data-result-card][data-food-object-id="21"]',
      );
      const pageOneResponse = queryClient.getQueryData<SubstituteSearchResponse>([
        "substitute-search",
        SELECTED.foodObjectId,
        1,
      ]);
      expect(pageOneCard).not.toBeNull();
      expect(pageRequestCount, "MORE! starts a later-page request").toBeGreaterThan(
        1,
      );

      interactionState.setQuantityText("200");
      interactionState.commitQuantity();
      await tick();

      expect(
        postUrls,
        "the local commit starts no page-one refetch",
      ).toHaveLength(pageRequestCount);
      expect(
        queryClient.getQueryData<SubstituteSearchResponse>([
          "substitute-search",
          SELECTED.foodObjectId,
          1,
        ]),
      ).toBe(pageOneResponse);
      expect(
        view.container.querySelector(
          '[data-result-card][data-food-object-id="21"]',
        ),
      ).toBe(pageOneCard);
      expect(document.querySelector("[data-input-calories]")?.textContent).toBe(
        "313 kcal",
      );
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
          const foodObjectId = postUrls.length === 1 ? 6 : 11;
          return new Response(
            JSON.stringify({
              pageIndex: 0,
              totalEligibleCount: 1,
              hasMore: false,
              selectedFood: {
                foodObjectId,
                names: {
                  en: `Food ${foodObjectId}`,
                  pl: `Potrawa ${foodObjectId}`,
                },
                macroProfile: { protein: 31, carbohydrate: 0, fat: 3.6 },
                baseUnit: "g",
              },
              items: [
                {
                  foodObjectId: 20,
                  names: { en: "Protein shake", pl: "Shake białkowy" },
                  macroProfile: { protein: 8, carbohydrate: 4, fat: 1 },
                  baseUnit: "ml",
                  similarityPercent: 85,
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
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
