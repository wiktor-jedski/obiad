/**
 * Substitution Search lifecycle — happy-dom component integration scenario
 * (task 28 repair; ARCH-002, ARCH-011, ARCH-019, ARCH-022, REQ-022).
 *
 * The repair review found that `retry: false` alone does not stop TanStack
 * Query's lifecycle-driven defaults: `refetchOnMount`, `refetchOnReconnect`,
 * and `retryOnMount` default to `true` and can start an extra Substitution
 * Search POST without a new selection. The production query now disables
 * every applicable reconnect/mount refetch and retry path
 * (see `createSubstitutionSearchQuery` in `substitutionSearch.ts`).
 *
 * These scenarios cover two lifecycle boundaries through the production
 * interaction state, components, query options, and generated client:
 *
 * - With a selection active, mounting the root application performs exactly
 *   one generated-client POST, and remounting with cached page-0 data
 *   performs no second POST. The reconnect half of this adversarial coverage
 *   is in `pointer-substitution-search.spec.ts`, which toggles the browser
 *   network offline and online through Playwright.
 * - After the first completed result, changed draft Search Query text keeps
 *   the committed result visible, opens five fresh suggestions, and Enter
 *   commits the active suggestion to perform exactly one second POST.
 *
 * The component-level remount cannot be driven by the real stack (the
 * single-page application never unmounts itself), so this narrow ARCH-022
 * seam uses happy-dom. happy-dom rejects relative `Request` URLs on its
 * `about:blank` document, so the scenarios install a minimal `Request` stub
 * and fetch stubs that count generated-client POSTs; no real network is
 * touched (ISSUE-007, ISSUE-008).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import { interfaceLanguage } from "./lib/interfaceLanguage";
import {
  interactionState,
  type SelectedFoodObject,
} from "./lib/interactionState";

/** A captured Butter selection fixture for lifecycle setup. */
const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  capturedLanguage: "en",
} as const;

/** A page-0 Substitute Search response with one display-ready item. */
const RESPONSE_BODY = JSON.stringify({
  pageIndex: 0,
  totalEligibleCount: 1,
  hasMore: false,
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

/**
 * The minimal `Request` stand-in happy-dom needs to run the generated
 * client: the real constructor rejects relative URLs on its `about:blank`
 * document location. The client only builds the request to hand it to
 * `fetch`, so a url/method carrier is sufficient.
 */
class HappyDomRequest {
  readonly url: string;
  readonly method: string;

  constructor(url: string | URL, init?: RequestInit) {
    this.url = String(url);
    this.method = init?.method ?? "GET";
  }
}

/** Yields to the event loop so pending fetch promises and effects settle. */
async function settle(): Promise<void> {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("the Substitution Search lifecycle", () => {
  beforeEach(() => {
    // Bun's test runner reuses worker processes across files, so the shared
    // language and interaction stores may carry state from another scenario.
    // Reset both to make this scenario order-independent.
    interfaceLanguage.set("en");
    interactionState.reset();
  });

  afterEach(() => {
    cleanup();
  });

  test("one selection performs exactly one generated-client POST, and remounting the application with the selection active performs no second POST", async () => {
    // Count every generated-client POST through a fetch stub; no real
    // network is touched. The stub returns a successful page-0 response so
    // the production state machine reaches the results transition.
    const postUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    globalThis.Request = HappyDomRequest as unknown as typeof Request;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/v1/substitutes/search")) {
        postUrls.push(url);
        return new Response(RESPONSE_BODY, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      // A selection exists before the first application mount (REQ-022):
      // the interaction state is the loadingNew transition.
      interactionState.selectSuggestion(SELECTED);
      render(App);
      await settle();

      // The first mount performs exactly one generated-client POST and the
      // page-0 response transitions the state to results.
      expect(postUrls, "one POST for the selection").toHaveLength(1);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("results");

      // Adversarial remount: unmounting and remounting the root application
      // re-mounts the query observer with the cached page-0 data. The
      // disabled `refetchOnMount` and `retryOnMount` paths must prevent any
      // second POST without a new selection (ARCH-019, REQ-022).
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
    globalThis.Request = HappyDomRequest as unknown as typeof Request;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
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
    }) as typeof fetch;

    try {
      const view = render(App);
      const search = view.getByRole("combobox", { name: "Search" });

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
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });
});
