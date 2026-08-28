import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/svelte";
import { foodPlaceholderUrl } from "./lib/assets";
import ResultCard from "./lib/components/ResultCard.svelte";
import { formatMacronutrientValue, getDictionary } from "./lib/i18n";
import type { InterfaceLanguage } from "./lib/i18n";
import type { ProjectedSubstituteItem } from "./lib/substituteProjection";

const SEEDED_IMAGE_KEYS = [
  "pizza-margherita",
  "chicken-breast",
  "milk",
  "gyoza",
] as const;

const UNMAPPED_IMAGE_KEY = "some-unmapped-key";

const ITEM: ProjectedSubstituteItem = {
  foodObjectId: 13,
  names: { en: "Gyoza", pl: "Pierożki gyoza" },
  matchedQuantity: { value: 234, unit: "g" },
  macronutrients: { protein: 18.7, carbohydrate: 56.2, fat: 18.7 },
  calories: 456,
  similarityPercent: 85,
};

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

function expectCardBody(
  container: HTMLElement,
  language: InterfaceLanguage,
  item: ProjectedSubstituteItem = ITEM,
): void {
  const cardElement =
    container.querySelector<HTMLElement>("[data-result-card]");
  if (cardElement === null) {
    throw new Error("Result card did not render");
  }

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
  const matchedQuantity = cardElement.querySelector(
    "[data-result-card-matched-quantity]",
  );
  expect(matchedQuantity?.textContent).toBe(
    `${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
  );
  expect(cardElement.textContent ?? "").not.toMatch(/\bserving\b|\bporcja\b/i);

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

  const decimal = language === "en" ? "." : ",";
  for (const dd of ddValues.slice(0, 3)) {
    expect(dd).toMatch(new RegExp(`^[0-9]+\\${decimal}[0-9] g$`));
  }
  expect(calories?.textContent).toMatch(/^[0-9]+ kcal$/);
  expect(ddValues[3]).toMatch(/^[0-9]+%$/);
}

function renderCard(
  item: ProjectedSubstituteItem,
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
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString();
        fetchCalls.push(url);
        return new Response("", { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const container = renderCard(ITEM, "en");
      const image = container.querySelector<HTMLImageElement>(
        "[data-result-card-image]",
      );
      if (image === null) {
        throw new Error("Result card image did not render");
      }
      expect(image.getAttribute("src")).toBe(foodPlaceholderUrl);
      expect(image.getAttribute("alt")).toBe("");
      expectCardBody(container, "en");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toEqual([]);
  });

  test("each seeded opaque image key and an arbitrary unmapped key resolve to the identical bundled placeholder", () => {
    for (const imageKey of [...SEEDED_IMAGE_KEYS, UNMAPPED_IMAGE_KEY]) {
      const container = renderCard({ ...ITEM, imageKey }, "en");
      const image = container.querySelector<HTMLImageElement>(
        "[data-result-card-image]",
      );
      if (image === null) {
        throw new Error(`Result card image did not render for key ${imageKey}`);
      }
      expect(image.getAttribute("src"), `key ${imageKey}`).toBe(
        foodPlaceholderUrl,
      );
      expect(image.getAttribute("alt"), `key ${imageKey}`).toBe("");
      cleanup();
    }
  });

  test("a dispatched image error keeps the same bundled placeholder and never loops", () => {
    const container = renderCard({ ...ITEM, imageKey: "gyoza" }, "en");
    const image = container.querySelector<HTMLImageElement>(
      "[data-result-card-image]",
    );
    if (image === null) {
      throw new Error("Result card image did not render");
    }
    expect(image.getAttribute("src")).toBe(foodPlaceholderUrl);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      image.dispatchEvent(new Event("error"));
      expect(image.getAttribute("src"), `after error ${attempt + 1}`).toBe(
        foodPlaceholderUrl,
      );
    }
    expectCardBody(container, "en");
  });

  test("English and Polish cards show the exact localized name, labels, dot/comma decimals, and whole values", () => {
    expectCardBody(renderCard(ITEM, "en"), "en");

    expectCardBody(renderCard(ITEM, "pl"), "pl");
  });

  test("the card displays the exact API-provided numbers formatted for display only, without recalculation or rerounding", () => {
    const oddItem: ProjectedSubstituteItem = {
      foodObjectId: 21,
      names: { en: "Beef cheeseburger", pl: "Cheeseburger wołowy" },
      matchedQuantity: { value: 300, unit: "g" },
      macronutrients: { protein: 35.7, carbohydrate: 65.9, fat: 35.7 },
      calories: 728,
      similarityPercent: 100,
    };
    const container = renderCard(oddItem, "en");

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

    expect(ddValues[0]).toBe("35.7 g");
  });
});
