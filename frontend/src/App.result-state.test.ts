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
 *
 * Task 49 completes the keyboard-only interaction path (P15-G2, P15-G7,
 * REQ-018, REQ-019, REQ-084): the same scenario drives the selection
 * through the production Search keyboard handlers — a typed query, the
 * Arrow Down active-option move, and the Enter key on the combobox — with
 * no pointer input, so the zero-result message focus target is reached
 * through the keyboard path that ISSUE-015 keeps inside this component
 * seam (a successful empty response is unreachable on the supported real
 * stack).
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import axe from "axe-core";
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
 * The five suggestion items the keyboard-selection stub returns so the
 * active-descendant panel opens and the production Search keyboard
 * handlers can move and select through Enter (task 49, REQ-018, REQ-019).
 * The selection transition captures the exact returned names, default
 * quantity, and allowed quantity-editor units like a real response.
 */
const SUGGESTION_ITEMS = Array.from({ length: 5 }, (_, index) => ({
  foodObjectId: 6 + index,
  names: { en: `Food ${6 + index}`, pl: `Potrawa ${6 + index}` },
  defaultQuantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
}));

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

/**
 * The WCAG 2.1 Level A and AA axe rule tags (task 48, ISSUE-015).
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

/**
 * Runs the pinned axe-core engine against the happy-dom document with only
 * the WCAG 2.1 Level A and AA rule tags (task 48, ISSUE-015): definite
 * violations fail the test, incomplete checks are recorded on the console
 * for manual review without failing, and the optional axe best-practice
 * rules are never enforced (P15-G2). ISSUE-015 keeps the zero-result
 * surface a component seam, so this is the only axe scan that runs on the
 * production `zeroResults` state; every other scanned state is driven on
 * the real stack. The happy-dom document mirrors the production page shell
 * (index.html: `lang="en"`, `<title>Obiad</title>`).
 */
async function expectZeroResultWcagAAndAaClean(label: string): Promise<void> {
  document.title = "Obiad";
  document.documentElement.lang = "en";
  const results = await axe.run(document, {
    runOnly: { type: "tag", values: [...AXE_TAGS] },
  });
  if (results.incomplete.length > 0) {
    console.log(
      `[axe] zero-result (${label}) incomplete checks for manual review: ` +
        results.incomplete
          .map((result) => `${result.id} (${result.nodes.length} node(s))`)
          .join(", "),
    );
  }
  expect(
    results.violations.map((violation) => violation.id),
    `zero-result (${label}): no definite WCAG 2.1 Level A or AA violation`,
  ).toEqual([]);
}

/** Returns the text content of the first element matching `selector`. */
function elementText(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

/** Checks that only the empty quantity-editor status remains live. */
function expectOnlyEmptyEditorLiveRegion(): void {
  const liveRegions = document.querySelectorAll(
    '[aria-live], [role="status"], [role="alert"]',
  );
  expect(liveRegions).toHaveLength(1);
  const liveRegion = liveRegions.item(0);
  expect(liveRegion.getAttribute("data-editor-status")).not.toBeNull();
  expect(liveRegion.textContent).toBe("");
}

/** Checks the complete English zero-result presentation and focus state. */
function expectEnglishZeroResultSurface(zeroMessage: Element): void {
  expect(
    document.querySelector("main")?.getAttribute("data-interaction-state"),
  ).toBe("zeroResults");
  expect(document.querySelector("[data-selected-input-region]")).not.toBeNull();
  expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);
  expect(document.querySelectorAll("[data-result-region]")).toHaveLength(0);
  expect(zeroMessage.textContent).toBe("No substitutes found");
  expect(document.activeElement).toBe(zeroMessage);
  expect(zeroMessage.hasAttribute("aria-live")).toBe(false);
  expect(zeroMessage.hasAttribute("role")).toBe(false);
  expectOnlyEmptyEditorLiveRegion();
  expect(elementText("[data-selected-name]")).toBe("Butter");
  const srOnly = Array.from(
    document.querySelectorAll("[data-selected-food-summary] .sr-only"),
  ).map((element) => element.textContent);
  expect(srOnly).toContain("Selected food: Butter · 100 g");
  expect(srOnly).toContain("Quantity");
  expect(srOnly).toContain("Unit");
  expect(
    Array.from(document.querySelectorAll("[data-input-macronutrients] dt")).map(
      (element) => element.textContent,
    ),
  ).toEqual(["Protein", "Carbohydrates", "Fat"]);
  expect(elementText("[data-input-macro-protein]")).toBe("35.0 g");
  expect(
    document.querySelector("[data-input-calories]")?.getAttribute("aria-label"),
  ).toBe("Calories");
  expect(elementText("[data-input-calories]")).toBe("875 kcal");
  expect(elementText("[data-quantity-static-unit]")).toBe("g");
}

/** Checks the complete Polish zero-result presentation and retained state. */
function expectPolishZeroResultSurface(
  zeroMessage: Element,
  postUrls: readonly string[],
): void {
  expect(elementText("[data-zero-result-region]")).toBe(
    "Nie znaleziono zamienników",
  );
  expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);
  expect(
    document.querySelector("main")?.getAttribute("data-interaction-state"),
  ).toBe("zeroResults");
  expect(document.activeElement).toBe(zeroMessage);
  expect(zeroMessage.textContent).toBe("Nie znaleziono zamienników");
  expectOnlyEmptyEditorLiveRegion();
  expect(elementText("[data-selected-name]")).toBe("Masło");
  const srOnly = Array.from(
    document.querySelectorAll("[data-selected-food-summary] .sr-only"),
  ).map((element) => element.textContent);
  expect(srOnly).toContain("Wybrany produkt: Masło · 100 g");
  expect(srOnly).toContain("Ilość");
  expect(srOnly).toContain("Jednostka");
  expect(
    Array.from(document.querySelectorAll("[data-input-macronutrients] dt")).map(
      (element) => element.textContent,
    ),
  ).toEqual(["Białko", "Węglowodany", "Tłuszcz"]);
  expect(elementText("[data-input-macro-protein]")).toBe("35,0 g");
  expect(
    document.querySelector("[data-input-calories]")?.getAttribute("aria-label"),
  ).toBe("Kalorie");
  expect(elementText("[data-quantity-static-unit]")).toBe("g");
  expect(
    postUrls,
    "the language change in zeroResults performs no additional fetch",
  ).toHaveLength(1);
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
          return new Response(EMPTY_RESPONSE_BODY, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      // A selection exists before the first application mount (REQ-022):
      // the interaction state is the loadingNew transition.
      interactionState.selectSuggestion(SELECTED);
      render(App);
      await settle();
      expect(postUrls, "one POST for the selection").toHaveLength(1);
      const zeroMessage = document.querySelector("[data-zero-result-message]");
      if (zeroMessage === null) {
        throw new Error("The zero-result message did not render");
      }
      expectEnglishZeroResultSurface(zeroMessage);

      // Task 48 (ISSUE-015, P15-G2): the English zero-result component
      // surface reports no definite WCAG 2.1 Level A or AA axe violation.
      await expectZeroResultWcagAAndAaClean("en");

      // The zero-result surface follows the active Interface Language
      // dictionary (ARCH-003): switching to Polish re-renders the exact
      // Polish message and every visible and accessibility string in place
      // without touching the captured selection, zero cards, or the
      // interaction transition, and performs no additional fetch
      // (P14-G4, REQ-044, REQ-055, REQ-058, ISSUE-014).
      interfaceLanguage.set("pl");
      await tick();
      expectPolishZeroResultSurface(zeroMessage, postUrls);

      // Task 48 (ISSUE-015, P15-G2, P15-G7): the Polish zero-result
      // component surface also reports no definite WCAG 2.1 Level A or AA
      // axe violation.
      await expectZeroResultWcagAAndAaClean("pl");
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });

  test("a keyboard-only suggestion selection — typed query, Arrow Down, and Enter on the Search combobox — drives the production state to zeroResults and the localized zero-result message becomes document.activeElement in English and Polish without pointer input (REQ-018, REQ-019, REQ-084)", async () => {
    // Stub only the network boundary: the suggestion GET returns five
    // items so the active-descendant panel opens, and the Substitution
    // Search POST returns a successful empty page-0 envelope (ISSUE-003,
    // ARCH-022). No pointer event is fired anywhere in this scenario.
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
          return new Response(EMPTY_RESPONSE_BODY, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            items: SUGGESTION_ITEMS,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      const view = render(App);
      const search = view.getByRole("combobox", { name: "Search" });

      // The typed query opens the panel with the first option highlighted
      // and active (REQ-018).
      await fireEvent.focus(search);
      await fireEvent.input(search, { target: { value: "butt" } });
      await settle();
      const panel = view.getByRole("listbox");
      const options = panel.querySelectorAll('[role="option"]');
      expect(options.length).toBe(5);

      const firstOption = options[0];
      expect(firstOption.getAttribute("aria-selected")).toBe("true");
      expect(search.getAttribute("aria-activedescendant")).toBe(firstOption.id);

      // Arrow Down moves the active option (REQ-019); Enter selects it
      // through the same transition a pointer click uses, with no pointer
      // input reaching the option row.
      await fireEvent.keyDown(search, { key: "ArrowDown" });

      const movedOption = options[1];
      expect(movedOption.getAttribute("aria-selected")).toBe("true");
      expect(search.getAttribute("aria-activedescendant")).toBe(movedOption.id);
      await fireEvent.keyDown(search, { key: "Enter" });
      await settle();

      // One POST for the keyboard selection; the empty envelope drives the
      // production transition to zeroResults with zero cards.

      expect(postUrls, "one POST for the keyboard selection").toHaveLength(1);
      if (!(search instanceof HTMLInputElement)) {
        throw new TypeError("Search combobox must be an input element");
      }
      expect(search.value).toBe("Food 7");
      expect(view.queryByRole("listbox")).toBeNull();
      expect(
        document.querySelector("main")?.getAttribute("data-interaction-state"),
      ).toBe("zeroResults");
      expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);

      // REQ-084 (task 46, task 49): the localized zero-result message is
      // the stable programmatically focusable active element, reached
      // through the keyboard selection path.
      const zeroMessage = document.querySelector("[data-zero-result-message]");
      expect(zeroMessage).not.toBeNull();
      expect(zeroMessage?.textContent).toBe("No substitutes found");
      expect(document.activeElement).toBe(zeroMessage);
      // REQ-085: the message carries no live-region semantics.
      expect(zeroMessage?.hasAttribute("aria-live")).toBe(false);
      expect(zeroMessage?.hasAttribute("role")).toBe(false);

      // The zero-result surface follows the active language: switching to
      // Polish re-renders the message in place, keeps the same node as
      // the active element, and performs no additional fetch.
      interfaceLanguage.set("pl");
      await tick();
      expect(zeroMessage?.textContent).toBe("Nie znaleziono zamienników");
      expect(document.activeElement).toBe(zeroMessage);
      expect(postUrls).toHaveLength(1);
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });
});
