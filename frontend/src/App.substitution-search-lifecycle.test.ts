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
 * This scenario proves the remount half of the adversarial lifecycle
 * coverage: with a selection active, mounting the root application performs
 * exactly one generated-client POST, and remounting the application (the
 * query observer mounting again with cached page-0 data) performs no second
 * POST. The reconnect half is covered by the real-stack
 * `pointer-substitution-search.spec.ts` scenario, which toggles the browser
 * network offline and online through Playwright. The component-level remount
 * cannot be driven by the real stack (the single-page application never
 * unmounts itself), so this narrow ARCH-022 seam drives the production
 * interaction state, components, query options, and generated client end to
 * end in happy-dom. happy-dom rejects relative `Request` URLs on its
 * `about:blank` document, so the scenario installs a minimal `Request` stub
 * and a fetch stub that counts every generated-client POST; no real network
 * is touched (ISSUE-007, ISSUE-008).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import {
  interactionState,
  type SelectedFoodObject,
} from "./lib/interactionState";

/** A captured selection: the third seeded suggestion for `chicken` (Butter). */
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
    // single application interaction-state store may carry a selection from
    // another scenario. Resetting it makes this scenario order-independent
    // (task 30 adds the reset action; the result-state scenario resets the
    // same store in its own beforeEach).
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
        typeof input === "string" ? input : (input as { url: string }).url;
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
});
