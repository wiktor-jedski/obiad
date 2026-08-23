/**
 * Result-card component integration — happy-dom component integration
 * scenario (task 29; ARCH-001, ARCH-003, ARCH-015, ARCH-020, ARCH-022,
 * REQ-011, REQ-037, REQ-038, REQ-039, REQ-040, ISSUE-008).
 *
 * `bun test` runs this file with the pinned `happy-dom` and
 * `@testing-library/svelte` packages (no generated-client or network call,
 * no backend or database; ISSUE-007). The scenario renders the production
 * `ResultCard.svelte` directly with generated `SubstituteItem` values and
 * proves the full card contract:
 *
 *   - the approved card field order — image, localized name, whole Matched
 *     Quantity, centered calorie value, protein, carbohydrate, fat, and
 *     similarity — with the exact English and Polish labels and copy
 *     (ISSUE-008);
 *   - Matched Quantity stays whole with only `g` or `ml` and no Serving
 *     equivalent (REQ-038), similarity stays a whole percentage, and every
 *     macronutrient shows exactly one active-locale decimal place followed
 *     by `g` — a dot in English and a comma in Polish (REQ-039, ISSUE-008);
 *   - the identical bundled placeholder and empty `alt` for an absent key,
 *     each of the four seeded opaque keys (`pizza-margherita`,
 *     `chicken-breast`, `milk`, `gyoza`), and an arbitrary unmapped key,
 *     with no third-party request (REQ-011, ARCH-015, ISSUE-008);
 *   - a dispatched image error keeps the same bundled placeholder with no
 *     error loop; and
 *   - the card never recalculates or rerounds a nutrition value: the
 *     displayed strings are the exact API-provided numbers formatted for
 *     display (REQ-040).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/svelte";
import { foodPlaceholderUrl } from "./lib/assets";
import ResultCard from "./lib/components/ResultCard.svelte";
import { formatMacronutrientValue, getDictionary } from "./lib/i18n";
import type { InterfaceLanguage } from "./lib/i18n";
import type { SubstituteItem } from "./client/types.gen";

/** The four seeded opaque image keys (ISSUE-002, ISSUE-008). */
const SEEDED_IMAGE_KEYS = [
  "pizza-margherita",
  "chicken-breast",
  "milk",
  "gyoza",
] as const;

/** An arbitrary unmapped image key. */
const UNMAPPED_IMAGE_KEY = "some-unmapped-key";

/** A display-ready generated Substitute with an absent image key. */
const ITEM: SubstituteItem = {
  foodObjectId: 13,
  names: { en: "Gyoza", pl: "Pierożki gyoza" },
  matchedQuantity: { value: 234, unit: "g" },
  macronutrients: { protein: 18.7, carbohydrate: 56.2, fat: 18.7 },
  calories: 456,
  similarityPercent: 85,
};

/** The exact ISSUE-008 card labels of the two supported dictionaries. */
const LABELS = {
  en: {
    protein: "Protein",
    carbohydrates: "Carbohydrates",
    fat: "Fat",
    calories: "Calories",
    similarityLabel: "Similarity",
  },
  pl: {
    protein: "Białko",
    carbohydrates: "Węglowodany",
    fat: "Tłuszcz",
    calories: "Kalorie",
    similarityLabel: "Podobieństwo",
  },
} as const;

/**
 * heading, whole Matched Quantity, centered calorie value, three labeled
 * macronutrient rows, and similarity, with API-provided values formatted for
 * display only (REQ-037, REQ-038, REQ-039, REQ-040).
 */
function expectCardBody(
  container: HTMLElement,
  language: InterfaceLanguage,
  item: SubstituteItem = ITEM,
): void {
  const card = container.querySelector("[data-result-card]");
  expect(card).not.toBeNull();
  const cardElement = card as HTMLElement;

  // Approved field order: image, localized name, whole Matched Quantity,
  // centered calorie value, protein, carbohydrate, fat, similarity (ISSUE-008).
  const sequence = Array.from(
    cardElement.querySelectorAll(
      "img, h3, [data-result-card-matched-quantity], [data-result-card-calories], dt",
    ),
  ).map((node) => `${node.tagName}:${node.textContent ?? ""}`);
  expect(sequence).toEqual([
    "IMG:",
    `H3:${item.names[language]}`,
    `P:${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
    `P:${item.calories} kcal`,
    `DT:${getDictionary(language).proteinLabel()}`,
    `DT:${getDictionary(language).carbohydratesLabel()}`,
    `DT:${getDictionary(language).fatLabel()}`,
    `DT:${getDictionary(language).similarityLabel()}`,
  ]);

  // The exact ISSUE-008 label copy.
  const labels = LABELS[language];
  expect(getDictionary(language).proteinLabel()).toBe(labels.protein);
  expect(getDictionary(language).carbohydratesLabel()).toBe(
    labels.carbohydrates,
  );
  expect(getDictionary(language).fatLabel()).toBe(labels.fat);
  expect(getDictionary(language).caloriesLabel()).toBe(labels.calories);
  expect(getDictionary(language).similarityLabel()).toBe(
    labels.similarityLabel,
  );
  // Matched Quantity stays whole with only `g` or `ml` (REQ-038).
  const matchedQuantity = cardElement.querySelector(
    "[data-result-card-matched-quantity]",
  );
  expect(matchedQuantity?.textContent).toBe(
    `${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
  );
  expect(cardElement.textContent ?? "").not.toMatch(/\bserving\b|\bporcja\b/i);

  // Every macronutrient shows exactly one localized decimal place and `g`;
  // calories shows whole kcal and similarity stays a whole percentage (REQ-039,
  // REQ-078, ISSUE-008).
  const ddValues = Array.from(cardElement.querySelectorAll("dd")).map(
    (node) => node.textContent ?? "",
  );
  expect(ddValues[0]).toBe(
    formatMacronutrientValue(item.macronutrients.protein, language),
  );
  expect(ddValues[1]).toBe(
    formatMacronutrientValue(item.macronutrients.carbohydrate, language),
  );
  expect(ddValues[2]).toBe(
    formatMacronutrientValue(item.macronutrients.fat, language),
  );
  expect(ddValues[3]).toBe(`${item.similarityPercent}%`);

  const calories = cardElement.querySelector("[data-result-card-calories]");
  expect(calories?.textContent).toBe(`${item.calories} kcal`);

  // English keeps a dot, Polish a comma, always with exactly one decimal
  // place (REQ-039, ISSUE-008).
  const decimal = language === "en" ? "." : ",";
  for (const dd of ddValues.slice(0, 3)) {
    expect(dd).toMatch(new RegExp(`^[0-9]+\\${decimal}[0-9] g$`));
  }
  expect(calories?.textContent).toMatch(/^[0-9]+ kcal$/);
  expect(ddValues[3]).toMatch(/^[0-9]+%$/);
}

/** Renders one ResultCard and returns the container element. */
function renderCard(
  item: SubstituteItem,
  language: InterfaceLanguage,
): HTMLElement {
  const { container } = render(ResultCard, { item, language });
  return container;
}

describe("the result-card component", () => {
  afterEach(() => {
    cleanup();
  });

  test("an absent image key renders the identical bundled placeholder with empty alt and no third-party request", () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : (input as { url: string }).url;
      fetchCalls.push(url);
      return new Response("", { status: 200 });
    }) as typeof fetch;

    try {
      const container = renderCard(ITEM, "en");
      const image = container.querySelector(
        "[data-result-card-image]",
      ) as HTMLImageElement;
      expect(image).not.toBeNull();
      // The identical bundled placeholder (REQ-011, ARCH-015, ISSUE-008).
      expect(image.getAttribute("src")).toBe(foodPlaceholderUrl);
      // Empty alternative text: the adjacent heading names the Food Object.
      expect(image.getAttribute("alt")).toBe("");
      expectCardBody(container, "en");
    } finally {
      globalThis.fetch = originalFetch;
    }

    // No third-party request: the card performs no fetch, XHR, or external
    // image load (ISSUE-008).
    expect(fetchCalls).toEqual([]);
  });

  test("each seeded opaque image key and an arbitrary unmapped key resolve to the identical bundled placeholder", () => {
    for (const imageKey of [...SEEDED_IMAGE_KEYS, UNMAPPED_IMAGE_KEY]) {
      const container = renderCard({ ...ITEM, imageKey }, "en");
      const image = container.querySelector(
        "[data-result-card-image]",
      ) as HTMLImageElement;
      expect(image.getAttribute("src"), `key ${imageKey}`).toBe(
        foodPlaceholderUrl,
      );
      expect(image.getAttribute("alt"), `key ${imageKey}`).toBe("");
      cleanup();
    }
  });

  test("a dispatched image error keeps the same bundled placeholder and never loops", () => {
    const container = renderCard({ ...ITEM, imageKey: "gyoza" }, "en");
    const image = container.querySelector(
      "[data-result-card-image]",
    ) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(foodPlaceholderUrl);

    // An error event on the placeholder source must not rewrite or loop:
    // the source stays the identical bundled placeholder (REQ-011).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      image.dispatchEvent(new Event("error"));
      expect(image.getAttribute("src"), `after error ${attempt + 1}`).toBe(
        foodPlaceholderUrl,
      );
    }
    expectCardBody(container, "en");
  });

  test("English and Polish cards show the exact localized name, labels, dot/comma decimals, and whole values", () => {
    // English: dot decimal separator, English labels and name.
    expectCardBody(renderCard(ITEM, "en"), "en");
    // Polish: comma decimal separator, Polish labels and name, no Serving
    // equivalent (REQ-038, ISSUE-008).
    expectCardBody(renderCard(ITEM, "pl"), "pl");
  });

  test("the card displays the exact API-provided numbers formatted for display only, without recalculation or rerounding", () => {
    const oddItem: SubstituteItem = {
      foodObjectId: 21,
      names: { en: "Beef cheeseburger", pl: "Cheeseburger wołowy" },
      matchedQuantity: { value: 300, unit: "g" },
      macronutrients: { protein: 35.7, carbohydrate: 65.9, fat: 35.7 },
      calories: 728,
      similarityPercent: 100,
    };
    const container = renderCard(oddItem, "en");

    // Each rendered value equals the API value formatted for display; no
    // browser-side rounding or calculation is applied (REQ-040, ARCH-001).
    expect(
      container.querySelector("[data-result-card-matched-quantity]")
        ?.textContent,
    ).toBe("300 g");
    const ddValues = Array.from(container.querySelectorAll("dd")).map(
      (node) => node.textContent ?? "",
    );
    expect(ddValues).toEqual([
      formatMacronutrientValue(oddItem.macronutrients.protein, "en"),
      formatMacronutrientValue(oddItem.macronutrients.carbohydrate, "en"),
      formatMacronutrientValue(oddItem.macronutrients.fat, "en"),
      "100%",
    ]);
    expect(
      container.querySelector("[data-result-card-calories]")?.textContent,
    ).toBe("728 kcal");
    // The exact values survive: 35.7 formats to one decimal place, not a
    // computed or rerounded number.
    expect(ddValues[0]).toBe("35.7 g");
  });
});
