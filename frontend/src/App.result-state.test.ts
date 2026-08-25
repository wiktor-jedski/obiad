/**
 * Result-state composition — happy-dom component integration scenario
 * (task 30; ARCH-001, ARCH-002, ARCH-003, ARCH-011, ARCH-019, ARCH-020,
 * ARCH-022, REQ-003, REQ-044, REQ-061, ISSUE-003, ISSUE-008).
 *
 * `bun test` runs this file with the pinned `happy-dom` and
 * `@testing-library/svelte` packages. ISSUE-003 records that zero eligible
 * Substitutes are unreachable in the supported real stack with the
 * deterministic catalog, so the real-stack Playwright scenario cannot drive
 * the successful empty response; this narrow ARCH-022 seam drives it through
 * the production browser interaction state, the rendered root application
 * and its production components, and the generated client — with no
 * repository fake — and observes the exact localized zero-result message
 * with zero cards in English and Polish (REQ-044, ISSUE-008). The scenario
 * stubs only the network boundary (the generated client's `fetch`), exactly
 * like the Substitution Search lifecycle scenario; no fake data layer or
 * repository replaces the store or the query (ARCH-022).
 *
 * The scenario selects a suggestion through the production interaction
 * state, lets the generated-client page-0 request resolve to a successful
 * empty envelope, and proves that the root application composes the
 * zero-result surface: no result cards, exactly the active-dictionary
 * message `No substitutes found` / `Nie znaleziono zamienników`, the
 * read-only selected-input region still present, and the main element's
 * `data-interaction-state` at `zeroResults`.
 *
 * Task 44 extends the same scenario to change the Interface Language in
 * the production `zeroResults` state (P14-G4, REQ-044, REQ-058, ISSUE-014):
 * the language change performs no additional fetch, keeps zero cards and
 * the retained selection, and updates every visible and accessibility
 * string of the zero-result surface — the localized message, the selected
 * Food Object name, the sr-only `Selected food` / `Wybrany produkt`
 * region value, the quantity and unit accessible names, the macronutrient
 * labels, and the localized one-decimal values — in place to the active
 * dictionary, in English and in Polish.
 *
 * Task 46 extends the same scenario with the Phase 15 zero-result focus
 * contract (P15-G4, P15-G5, P15-G7, REQ-084, REQ-085): after the
 * successful empty page-0 response renders zero cards, the localized
 * zero-result message is the stable programmatically focusable active
 * element in English and Polish, and the transition inserts or updates no
 * result-count or result-status live-region message.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import {
  interactionState,
  type SelectedFoodObject,
} from "./lib/interactionState";
import { interfaceLanguage } from "./lib/interfaceLanguage";
import { queryClient } from "./lib/queryClient";
/** A captured Butter selection fixture for result-state rendering. */
const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
  capturedLanguage: "en",
} as const;

/** A successful page-0 Substitute Search response with zero items (REQ-044). */
const EMPTY_RESPONSE_BODY = JSON.stringify({
  pageIndex: 0,
  totalEligibleCount: 0,
  hasMore: false,
  inputMacronutrients: { protein: 35, carbohydrate: 105, fat: 35 },
  inputCalories: 875,
  items: [],
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

describe("the root result-state composition", () => {
  beforeEach(() => {
    // Deterministic shared stores before each rendered test: the persisted
    // Interface Language store resets to English (ISSUE-007), and the
    // single application interaction-state store resets to its initial
    // empty state. Bun's test runner reuses worker processes across files,
    // so the shared interaction state may carry a selection left by another
    // scenario (task 30); the reset makes this scenario order-independent
    // exactly like the Interface Language reset.
    interfaceLanguage.set("en");
    interactionState.reset();
    queryClient.clear();
  });

  test("a successful empty response drives the production state to zeroResults and renders the exact localized zero-result message with zero cards in English and Polish", async () => {
    // Count every generated-client POST through a fetch stub; no real
    // network is touched. The stub returns a successful empty page-0
    // response so the production state machine reaches the zeroResults
    // transition (REQ-044, ISSUE-003).
    const postUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    const OriginalRequest = globalThis.Request;
    globalThis.Request = HappyDomRequest as unknown as typeof Request;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : (input as { url: string }).url;
      if (url.includes("/api/v1/substitutes/search")) {
        postUrls.push(url);
        return new Response(EMPTY_RESPONSE_BODY, {
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
      expect(postUrls, "one POST for the selection").toHaveLength(1);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("zeroResults");

      // The read-only Substitution Input region is still present after a
      // selection (task 28), and the result area is replaced by the
      // localized zero-result message with zero cards (REQ-044).
      expect(document.querySelector("[data-selected-input-region]")).not.toBe(
        null,
      );
      expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);
      expect(document.querySelectorAll("[data-result-region]")).toHaveLength(0);

      // REQ-084 (task 46, P15-G4): after the successful empty page-0
      // response renders zero cards, the localized zero-result message is
      // the stable programmatically focusable active element.
      const zeroMessage = document.querySelector("[data-zero-result-message]");
      expect(zeroMessage).not.toBeNull();
      expect(zeroMessage?.textContent).toBe("No substitutes found");
      expect(document.activeElement).toBe(zeroMessage);

      // REQ-085 (task 46, P15-G5, P15-G7): the successful zero-result
      // transition inserts or updates no result-count or result-status
      // live-region message. The message itself carries no live-region
      // semantics, and the only live region in the zero-result surface is
      // the established empty loading-status span (ISSUE-010), which holds
      // no result message.
      expect(zeroMessage?.hasAttribute("aria-live")).toBe(false);
      expect(zeroMessage?.hasAttribute("role")).toBe(false);
      const liveRegions = Array.from(
        document.querySelectorAll(
          '[aria-live], [role="status"], [role="alert"]',
        ),
      );
      expect(liveRegions).toHaveLength(1);
      expect(liveRegions[0]?.getAttribute("data-editor-status")).not.toBeNull();
      expect(liveRegions[0]?.textContent).toBe("");

      // The complete English zero-result surface (task 44, P14-G4,
      // REQ-044, REQ-055, REQ-058): the retained selected Food Object and
      // the localized sr-only region value, quantity and unit accessible
      // names, macronutrient labels, and one-decimal values.
      expect(document.querySelector("[data-selected-name]")?.textContent).toBe(
        "Butter",
      );
      const englishSrOnly = Array.from(
        document.querySelectorAll("[data-selected-food-summary] .sr-only"),
      ).map((element) => element.textContent);
      expect(englishSrOnly).toContain("Selected food: Butter · 100 g");
      expect(englishSrOnly).toContain("Quantity");
      expect(englishSrOnly).toContain("Unit");
      expect(
        Array.from(
          document.querySelectorAll("[data-input-macronutrients] dt"),
        ).map((element) => element.textContent),
      ).toEqual(["Protein", "Carbohydrates", "Fat"]);
      expect(
        document.querySelector("[data-input-macro-protein]")?.textContent,
      ).toBe("35.0 g");
      expect(
        document
          .querySelector("[data-input-calories]")
          ?.getAttribute("aria-label"),
      ).toBe("Calories");
      expect(document.querySelector("[data-input-calories]")?.textContent).toBe(
        "875 kcal",
      );
      expect(
        document.querySelector("[data-quantity-static-unit]")?.textContent,
      ).toBe("g");

      // The zero-result surface follows the active Interface Language
      // dictionary (ARCH-003): switching to Polish re-renders the exact
      // Polish message and every visible and accessibility string in place
      // without touching the captured selection, zero cards, or the
      // interaction transition, and performs no additional fetch
      // (P14-G4, REQ-044, REQ-055, REQ-058, ISSUE-014).
      interfaceLanguage.set("pl");
      await tick();
      expect(
        document.querySelector("[data-zero-result-region]")?.textContent,
      ).toBe("Nie znaleziono zamienników");
      expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("zeroResults");

      // REQ-084 (task 46, P15-G4): the zero-result message stays the
      // active element in Polish — the language change re-renders the
      // localized text in place without replacing the stable
      // programmatically focusable element, so the same node keeps focus.
      expect(document.activeElement).toBe(zeroMessage);
      expect(zeroMessage?.textContent).toBe("Nie znaleziono zamienników");
      // REQ-085 (task 46, P15-G5, P15-G7): the language change still
      // emits no result-count or result-status live-region message; the
      // established loading-status span stays the only live region and
      // remains empty.
      const polishLiveRegions = Array.from(
        document.querySelectorAll(
          '[aria-live], [role="status"], [role="alert"]',
        ),
      );
      expect(polishLiveRegions).toHaveLength(1);
      expect(
        polishLiveRegions[0]?.getAttribute("data-editor-status"),
      ).not.toBeNull();
      expect(polishLiveRegions[0]?.textContent).toBe("");
      expect(document.querySelector("[data-selected-name]")?.textContent).toBe(
        "Masło",
      );
      const polishSrOnly = Array.from(
        document.querySelectorAll("[data-selected-food-summary] .sr-only"),
      ).map((element) => element.textContent);
      expect(polishSrOnly).toContain("Wybrany produkt: Masło · 100 g");
      expect(polishSrOnly).toContain("Ilość");
      expect(polishSrOnly).toContain("Jednostka");
      expect(
        Array.from(
          document.querySelectorAll("[data-input-macronutrients] dt"),
        ).map((element) => element.textContent),
      ).toEqual(["Białko", "Węglowodany", "Tłuszcz"]);
      expect(
        document.querySelector("[data-input-macro-protein]")?.textContent,
      ).toBe("35,0 g");
      expect(
        document
          .querySelector("[data-input-calories]")
          ?.getAttribute("aria-label"),
      ).toBe("Kalorie");
      expect(
        document.querySelector("[data-quantity-static-unit]")?.textContent,
      ).toBe("g");
      expect(
        postUrls,
        "the language change in zeroResults performs no additional fetch",
      ).toHaveLength(1);
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });
});
