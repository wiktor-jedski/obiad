import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  SubstituteItem,
  SubstituteSearchResponse,
} from "../src/client/types.gen";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
    languageControl: "Interface language",
    protein: "Protein",
    carbohydrates: "Carbohydrates",
    fat: "Fat",
    calories: "Calories",
    similarity: "Similarity",
    foundSubstitutions: "Found substitutions",
  },
  pl: {
    search: "Szukaj",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
    protein: "Białko",
    carbohydrates: "Węglowodany",
    fat: "Tłuszcz",
    calories: "Kalorie",
    similarity: "Podobieństwo",
    foundSubstitutions: "Znalezione zamienniki",
  },
} as const;

async function useBrowserLanguages(
  page: Page,
  languages: string[],
): Promise<void> {
  await page.addInitScript((tags: string[]) => {
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      get: () => tags,
    });
  }, languages);
}

function captureSubstituteItems(page: Page): Map<number, SubstituteItem> {
  const items = new Map<number, SubstituteItem>();
  page.on("response", async (response) => {
    if (response.url().includes("/api/v1/substitutes/search")) {
      // SAFETY: The endpoint response matches the generated API contract.
      const body = (await response.json()) as SubstituteSearchResponse;
      for (const item of body.items) {
        items.set(item.foodObjectId, item);
      }
    }
  });
  return items;
}

async function selectFoodObject(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  await search.fill(query);
  const panel = page.getByRole("listbox", { name: copy.listbox });
  await expect(panel).toBeVisible();
  await page.locator(`#food-suggestion-option-${foodObjectId}`).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "results",
  );
}

function formatMacronutrient(value: number, locale: "en" | "pl"): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} g`;
}

async function expectCard(
  card: Locator,
  item: SubstituteItem,
  copy: (typeof COPY)[keyof typeof COPY],
  locale: "en" | "pl",
  placeholderUrl: string,
): Promise<void> {
  await expect(
    card.getByRole("heading", { name: item.names[locale] }),
  ).toBeVisible();
  await expect(card.getByRole("heading")).toHaveText(item.names[locale]);

  await expect(card.locator("[data-result-card-matched-quantity]")).toHaveText(
    `${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
  );
  await expect(card).not.toContainText(/serving|porcja/i);

  await expect(card).toContainText(copy.protein);
  await expect(card).toContainText(
    formatMacronutrient(item.macronutrients.protein, locale),
  );
  await expect(card).toContainText(copy.carbohydrates);
  await expect(card).toContainText(
    formatMacronutrient(item.macronutrients.carbohydrate, locale),
  );
  await expect(card).toContainText(copy.fat);
  await expect(card).toContainText(
    formatMacronutrient(item.macronutrients.fat, locale),
  );
  await expect(card.locator("[data-result-card-calories]")).toHaveText(
    `${item.calories} kcal`,
  );
  await expect(card).toContainText(copy.similarity);
  await expect(card).toContainText(`${item.similarityPercent}%`);

  const image = card.locator("[data-result-card-image]");
  await expect(image).toHaveAttribute("alt", "");
  await expect
    .poll(() =>
      image.evaluate((element) => {
        if (!(element instanceof HTMLImageElement)) {
          throw new TypeError("Result card image must be an image element");
        }
        return element.src;
      }),
    )
    .toBe(new URL(placeholderUrl, PREVIEW_ORIGIN).href);
}

async function expectCardFieldOrder(
  card: Locator,
  item: SubstituteItem,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const sequence = await card.evaluate((element) =>
    Array.from(
      element.querySelectorAll(
        "img, h3, [data-result-card-matched-quantity], [data-result-card-calories], dt",
      ),
    ).map((node) => `${node.tagName}|${node.textContent ?? ""}`),
  );
  expect(sequence).toEqual([
    "IMG|",
    `H3|${item.names[copy === COPY.en ? "en" : "pl"]}`,
    `P|${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
    `P|${item.calories} kcal`,
    `DT|${copy.protein}`,
    `DT|${copy.carbohydrates}`,
    `DT|${copy.fat}`,
    `DT|${copy.similarity}`,
  ]);
}

async function expectRankedCards(
  page: Page,
  expectedRanks: readonly number[],
  items: Map<number, SubstituteItem>,
  copy: (typeof COPY)[keyof typeof COPY],
  locale: "en" | "pl",
  placeholderUrl: string,
): Promise<void> {
  const cards = page.locator("[data-result-card]");
  await expect(cards).toHaveCount(expectedRanks.length);

  for (let index = 0; index < expectedRanks.length; index += 1) {
    const foodObjectId = expectedRanks[index];
    await expect.poll(() => items.get(foodObjectId)).toBeTruthy();
    const item = items.get(foodObjectId);
    if (item === undefined) {
      throw new Error(`Substitute item ${foodObjectId} was not captured`);
    }
    await expectCard(cards.nth(index), item, copy, locale, placeholderUrl);
    await expectCardFieldOrder(cards.nth(index), item, copy);
  }

  expect(
    cards.evaluateAll((elements) =>
      elements.map((element) => element.querySelector("h3")?.textContent),
    ),
  ).resolves.toEqual(
    expectedRanks.map(
      (id) => items.get(id)?.names[locale === "en" ? "en" : "pl"],
    ),
  );
}

test.describe("result cards", () => {
  test("Pizza Margherita ranks [13, 29, 26] and renders three English cards in the approved order with the API-provided values; the seeded-key Gyoza card shows the bundled placeholder", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));
    const items = captureSubstituteItems(page);

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);
    const placeholderUrl = await page
      .locator("main")
      .getAttribute("data-placeholder-url");
    if (placeholderUrl === null || placeholderUrl === "") {
      throw new Error("Application did not expose the placeholder URL");
    }

    await expectRankedCards(
      page,
      [13, 29, 26],
      items,
      COPY.en,
      "en",
      placeholderUrl,
    );

    const gyozaImage = page
      .locator("[data-result-card]")
      .first()
      .locator("[data-result-card-image]");
    await expect
      .poll(() =>
        gyozaImage.evaluate((element) => {
          if (!(element instanceof HTMLImageElement)) {
            throw new TypeError("Gyoza card image must be an image element");
          }
          return element.complete && element.naturalWidth > 0;
        }),
      )
      .toBe(true);

    const paella = items.get(29);
    if (paella === undefined) {
      throw new Error("Paella substitute item was not captured");
    }
    expect(paella.matchedQuantity.unit).toBe("g");
    await expect(page.locator("[data-result-card]").nth(1)).toContainText(
      `${paella.matchedQuantity.value} g`,
    );

    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      COPY.pl.foundSubstitutions,
    );
    await expectRankedCards(
      page,
      [13, 29, 26],
      items,
      COPY.pl,
      "pl",
      placeholderUrl,
    );
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    const foodData = requestUrls.filter((url) => url.includes("/api/"));
    expect(foodData.length).toBeGreaterThanOrEqual(1);
    for (const url of foodData) {
      expect(new URL(url).origin, `unexpected food-data origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
      expect(new URL(url).pathname).toMatch(/^\/api\//);
    }
    expect(requestUrls.some((url) => url.startsWith(FIBER_ORIGIN))).toBe(false);
  });

  test("Chicken breast ranks [23, 11, 6] and the image-less page shows only valid bundled-placeholder cards", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const items = captureSubstituteItems(page);

    await page.goto("/");
    await selectFoodObject(page, "chicken breast", 5, COPY.en);
    const placeholderUrl = await page
      .locator("main")
      .getAttribute("data-placeholder-url");
    if (placeholderUrl === null || placeholderUrl === "") {
      throw new Error("Application did not expose the placeholder URL");
    }

    await expectRankedCards(
      page,
      [23, 11, 6],
      items,
      COPY.en,
      "en",
      placeholderUrl,
    );

    const images = page.locator("[data-result-card] [data-result-card-image]");
    await expect(images).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect
        .poll(() =>
          images.nth(index).evaluate((element) => {
            if (!(element instanceof HTMLImageElement)) {
              throw new TypeError("Result card image must be an image element");
            }
            return element.complete && element.naturalWidth > 0;
          }),
        )
        .toBe(true);
    }
    const absolutePlaceholder = new URL(placeholderUrl, PREVIEW_ORIGIN).href;
    for (let index = 0; index < 3; index += 1) {
      expect(
        await images.nth(index).evaluate((element) => {
          if (!(element instanceof HTMLImageElement)) {
            throw new TypeError("Result card image must be an image element");
          }
          return element.src;
        }),
      ).toBe(absolutePlaceholder);
    }
  });

  test("Milk ranks [33, 3, 21] in Polish with comma macronutrient decimals and the exact Polish copy", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const items = captureSubstituteItems(page);

    await page.goto("/");
    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    await selectFoodObject(page, "mleko", 10, COPY.pl);
    const placeholderUrl = await page
      .locator("main")
      .getAttribute("data-placeholder-url");
    if (placeholderUrl === null || placeholderUrl === "") {
      throw new Error("Application did not expose the placeholder URL");
    }

    await expectRankedCards(
      page,
      [33, 3, 21],
      items,
      COPY.pl,
      "pl",
      placeholderUrl,
    );

    const mondongo = items.get(33);
    if (mondongo === undefined) {
      throw new Error("Mondongo substitute item was not captured");
    }
    const proteinRow = page
      .locator("[data-result-card]")
      .first()
      .locator("dt", { hasText: COPY.pl.protein })
      .locator("xpath=following-sibling::dd");
    await expect(proteinRow).toHaveText(
      formatMacronutrient(mondongo.macronutrients.protein, "pl"),
    );
    await expect(proteinRow).toHaveText(/^[0-9]+,[0-9] g$/);
    await expect(page.locator("[data-result-card]").first()).toContainText(
      "Białko",
    );
    await expect(page.locator("[data-result-card]").first()).toContainText(
      "Podobieństwo",
    );
  });
});
