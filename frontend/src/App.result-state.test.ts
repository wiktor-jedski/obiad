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
const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
  capturedLanguage: "en",
} as const;

const EMPTY_RESPONSE_BODY = JSON.stringify({
  pageIndex: 0,
  totalEligibleCount: 0,
  hasMore: false,
  selectedFood: {
    foodObjectId: 18,
    names: { en: "Butter", pl: "Masło" },
    macroProfile: { protein: 35, carbohydrate: 105, fat: 35 },
    baseUnit: "g",
  },
  items: [],
});

const SUGGESTION_ITEMS = Array.from({ length: 5 }, (_, index) => ({
  foodObjectId: 6 + index,
  names: { en: `Food ${6 + index}`, pl: `Potrawa ${6 + index}` },
  defaultQuantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
}));

class HappyDomRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;

  constructor(url: string | URL, init?: RequestInit) {
    this.url = String(url);
    this.method = init?.method ?? "GET";
    this.headers = new Headers(init?.headers);
  }
}

async function settle(): Promise<void> {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

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

function elementText(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

function expectEnglishZeroResultSurface(zeroMessage: Element): void {
  expect(
    document.querySelector("main")?.getAttribute("data-interaction-state"),
  ).toBe("zeroResults");
  expect(document.querySelector("[data-selected-food-summary]")).not.toBeNull();
  expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);
  expect(zeroMessage.textContent).toBe("No substitutes found");
  expect(document.activeElement).toBe(zeroMessage);
  expect(zeroMessage.hasAttribute("aria-live")).toBe(false);
  expect(zeroMessage.hasAttribute("role")).toBe(false);
  expect(elementText("[data-selected-food-summary] h3")).toBe("Butter");
  expect(
    document.querySelector<HTMLInputElement>("[data-nutrition-editor=protein]")
      ?.value,
  ).toBe("35");
  expect(
    document.querySelector<HTMLInputElement>("[data-nutrition-editor=calories]")
      ?.value,
  ).toBe("875");
  expect(
    document
      .querySelector("[data-nutrition-editor=quantity]")
      ?.getAttribute("aria-label"),
  ).toBe("Quantity");
}

function expectPolishZeroResultSurface(
  zeroMessage: Element,
  postUrls: readonly string[],
): void {
  expect(elementText("[data-zero-result-message]")).toBe(
    "Nie znaleziono zamienników",
  );
  expect(document.querySelectorAll("[data-result-card]")).toHaveLength(0);
  expect(
    document.querySelector("main")?.getAttribute("data-interaction-state"),
  ).toBe("zeroResults");
  expect(document.activeElement).toBe(zeroMessage);
  expect(zeroMessage.textContent).toBe("Nie znaleziono zamienników");
  expect(elementText("[data-selected-food-summary] h3")).toBe("Masło");
  expect(
    document
      .querySelector("[data-nutrition-editor=quantity]")
      ?.getAttribute("aria-label"),
  ).toBe("Ilość");
  expect(
    document
      .querySelector("[data-nutrition-editor=calories]")
      ?.getAttribute("aria-label"),
  ).toBe("Kalorie");
  expect(
    postUrls,
    "the language change in zeroResults performs no additional fetch",
  ).toHaveLength(1);
}

describe("the root result-state composition", () => {
  beforeEach(() => {
    interfaceLanguage.set("en");
    interactionState.reset();
    queryClient.clear();
  });

  test("a successful empty response drives the production state to zeroResults and renders the exact localized zero-result message with zero cards in English and Polish", async () => {
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
      interactionState.selectSuggestion(SELECTED);
      render(App);
      await settle();
      expect(postUrls, "one POST for the selection").toHaveLength(1);
      const zeroMessage = document.querySelector("[data-zero-result-message]");
      if (zeroMessage === null) {
        throw new Error("The zero-result message did not render");
      }
      expectEnglishZeroResultSurface(zeroMessage);

      await expectZeroResultWcagAAndAaClean("en");

      interfaceLanguage.set("pl");
      await tick();
      expectPolishZeroResultSurface(zeroMessage, postUrls);

      await expectZeroResultWcagAAndAaClean("pl");
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      globalThis.Request = OriginalRequest;
    }
  });

  test("a keyboard-only suggestion selection — typed query, Arrow Down, and Enter on the Search combobox — drives the production state to zeroResults and the localized zero-result message becomes document.activeElement in English and Polish without pointer input (REQ-018, REQ-019, REQ-084)", async () => {
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
          if (
            !(input instanceof globalThis.Request) ||
            input.headers.get("X-Obiad-Request-Purpose") !== "landing-dialogue"
          ) {
            postUrls.push(url);
          }
          const response = JSON.parse(EMPTY_RESPONSE_BODY);
          response.selectedFood.foodObjectId = 7;
          response.selectedFood.names = SUGGESTION_ITEMS[1].names;
          return new Response(JSON.stringify(response), {
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

      await fireEvent.focus(search);
      await fireEvent.input(search, { target: { value: "butt" } });
      await settle();
      const panel = view.getByRole("listbox");
      const options = panel.querySelectorAll('[role="option"]');
      expect(options.length).toBe(5);

      const firstOption = options[0];
      expect(firstOption.getAttribute("aria-selected")).toBe("true");
      expect(search.getAttribute("aria-activedescendant")).toBe(firstOption.id);

      await fireEvent.keyDown(search, { key: "ArrowDown" });

      const movedOption = options[1];
      expect(movedOption.getAttribute("aria-selected")).toBe("true");
      expect(search.getAttribute("aria-activedescendant")).toBe(movedOption.id);
      await fireEvent.keyDown(search, { key: "Enter" });
      await settle();

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

      const zeroMessage = document.querySelector("[data-zero-result-message]");
      expect(zeroMessage).not.toBeNull();
      expect(zeroMessage?.textContent).toBe("No substitutes found");
      expect(document.activeElement).toBe(zeroMessage);
      expect(zeroMessage?.hasAttribute("aria-live")).toBe(false);
      expect(zeroMessage?.hasAttribute("role")).toBe(false);

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
