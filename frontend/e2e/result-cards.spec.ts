import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack result-card scenario (task 29; ARCH-001, ARCH-003, ARCH-015,
 * ARCH-020, ARCH-022, REQ-011, REQ-036, REQ-037, REQ-038, REQ-039,
 * REQ-040, ISSUE-008; P07-G12, P07-G13, P07-G14, P07-G15).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * Each scenario drives a real pointer selection and observes the successful
 * page's three result cards rendered by the production `ResultCard.svelte`.
 *
 * The seeded input fixtures produce the deterministic first pages
 * (verified against the real Fiber process and the freshly seeded
 * PostgreSQL catalog; seed migration `0005_seed_food_catalog.sql`):
 * Pizza Margherita (Food Object 1) ranks `[13, 29, 26]` (Gyoza, Paella,
 * Pancakes), Chicken breast (5) ranks `[23, 11, 6]` (Turkey breast, Skyr
 * yogurt, Pork chop), and Milk (10) ranks `[33, 3, 21]` (Mondongo,
 * Lasagna, Beef cheeseburger). The scenario captures the API-provided
 * display-ready values from the real response and proves each card renders
 * those exact values formatted for display only: whole Matched Quantity in
 * `g` or `ml` with no Serving equivalent (REQ-038), one active-locale
 * decimal place per macronutrient — a dot in English and a comma in Polish
 * (REQ-039, ISSUE-008) — a whole similarity percentage, and the exact
 * localized names and labels in the approved field order (REQ-037,
 * ISSUE-008). No nutrition value is calculated or rerounded in the browser
 * (REQ-040).
 *
 * The supported image-key map is empty (ISSUE-008): both the image-less
 * Chicken-breast page (ranks 23, 11, and 6 have no image keys) and the
 * seeded-key Gyoza card (image key `gyoza`) show the identical bundled
 * placeholder that loads successfully, with empty alternative text because
 * the adjacent card heading names the Food Object (REQ-011, ARCH-015).
 */

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
    similarity: "Similarity",
  },
  pl: {
    search: "Szukaj",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
    protein: "Białko",
    carbohydrates: "Węglowodany",
    fat: "Tłuszcz",
    similarity: "Podobieństwo",
  },
} as const;

/**
 * One display-ready Substitute as returned by the real Fiber process; the
 * scenario compares every rendered card field against these API values.
 */
interface SubstituteItem {
  foodObjectId: number;
  names: { en: string; pl: string };
  imageKey?: string;
  matchedQuantity: { value: number; unit: "g" | "ml" };
  macronutrients: { protein: number; carbohydrate: number; fat: number };
  similarityPercent: number;
}

/** Overrides `navigator.languages` before the application scripts run. */
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

/**
 * Captures every display-ready item the real `POST /api/v1/substitutes/
 * search` response carries, keyed by stable Food Object ID. The scenario
 * compares each rendered card field against these API-provided values.
 */
function captureSubstituteItems(page: Page): Map<number, SubstituteItem> {
  const items = new Map<number, SubstituteItem>();
  page.on("response", async (response) => {
    if (response.url().includes("/api/v1/substitutes/search")) {
      const body = (await response.json()) as { items: SubstituteItem[] };
      for (const item of body.items) {
        items.set(item.foodObjectId, item);
      }
    }
  });
  return items;
}

/**
 * Drives one pointer selection: fills the Search Query, waits for the five
 * seeded suggestions, clicks the option with the given stable Food Object
 * ID, and waits for the successful result transition.
 */
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

/**
 * The exact macronutrient display formatting oracle: one active-locale
 * decimal place, mirroring `formatMacronutrientValue` in `src/lib/i18n.ts`
 * (REQ-039, ISSUE-008).
 */
function formatMacronutrient(value: number, locale: "en" | "pl"): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} g`;
}

/**
 * Asserts one full result card against the API-provided item: the exact
 * localized name heading, whole Matched Quantity in `g` or `ml`, the four
 * labeled rows in the approved order with the exact localized copy and
 * one-decimal display values, the whole similarity percentage, and the
 * identical bundled placeholder image with empty alternative text.
 */
async function expectCard(
  card: import("@playwright/test").Locator,
  item: SubstituteItem,
  copy: (typeof COPY)[keyof typeof COPY],
  locale: "en" | "pl",
  placeholderUrl: string,
): Promise<void> {
  // The localized name heading carries the Food Object name (ISSUE-008).
  await expect(
    card.getByRole("heading", { name: item.names[locale] }),
  ).toBeVisible();
  await expect(card.getByRole("heading")).toHaveText(item.names[locale]);

  // Whole Matched Quantity with only `g` or `ml` (REQ-038): the exact
  // API-provided whole value, no Serving equivalent and no recalculation.
  await expect(card.locator("[data-result-card-matched-quantity]")).toHaveText(
    `${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
  );
  await expect(card).not.toContainText(/serving|porcja/i);

  // The four labeled rows with the exact localized copy (REQ-037,
  // ISSUE-008) and the API-provided values formatted for display only
  // (REQ-039, REQ-040).
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
  await expect(card).toContainText(copy.similarity);
  await expect(card).toContainText(`${item.similarityPercent}%`);

  // The identical bundled placeholder image with empty alternative text
  // (REQ-011, ARCH-015, ISSUE-008): the empty supported image-key map
  // resolves every absent, seeded, or unmapped key to the placeholder.
  const image = card.locator("[data-result-card-image]");
  await expect(image).toHaveAttribute("alt", "");
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).src))
    .toBe(new URL(placeholderUrl, PREVIEW_ORIGIN).href);
}

/**
 * Asserts the approved in-card field order — image, localized name,
 * Matched Quantity, protein, carbohydrate, fat, similarity — by DOM
 * sequence (ISSUE-008, REQ-037).
 */
async function expectCardFieldOrder(
  card: import("@playwright/test").Locator,
  item: SubstituteItem,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const sequence = await card.evaluate((element) =>
    Array.from(
      element.querySelectorAll(
        "img, h3, [data-result-card-matched-quantity], dt",
      ),
    ).map((node) => `${node.tagName}|${node.textContent ?? ""}`),
  );
  expect(sequence).toEqual([
    "IMG|",
    `H3|${item.names[copy === COPY.en ? "en" : "pl"]}`,
    `P|${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
    `DT|${copy.protein}`,
    `DT|${copy.carbohydrates}`,
    `DT|${copy.fat}`,
    `DT|${copy.similarity}`,
  ]);
}

/**
 * Asserts that the page renders exactly three unique result cards for the
 * expected ranked Food Object IDs, that each card matches its API-provided
 * item, and that the requested requests stayed on the Vite origin under
 * `/api` (REQ-002, REQ-036).
 */
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
    const item = items.get(foodObjectId) as SubstituteItem;
    await expectCard(cards.nth(index), item, copy, locale, placeholderUrl);
    await expectCardFieldOrder(cards.nth(index), item, copy);
  }

  // REQ-036: the designated inputs show the expected ranks 1, 2, and 3.
  expect(
    cards.evaluateAll((elements) =>
      elements.map(
        (element) =>
          (element.querySelector("h3") as HTMLElement | null)?.textContent,
      ),
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
    const placeholderUrl = (await page
      .locator("main")
      .getAttribute("data-placeholder-url")) as string;

    // P07-G12, REQ-036: Pizza Margherita (1) ranks 13, 29, and 26.
    await expectRankedCards(
      page,
      [13, 29, 26],
      items,
      COPY.en,
      "en",
      placeholderUrl,
    );

    // The seeded-key Gyoza card (rank 1, image key `gyoza`) shows a valid
    // placeholder card: the image is the identical bundled placeholder and
    // it loaded successfully (REQ-011, ARCH-015, ISSUE-008).
    const gyozaImage = page
      .locator("[data-result-card]")
      .first()
      .locator("[data-result-card-image]");
    await expect
      .poll(() =>
        gyozaImage.evaluate(
          (element) =>
            (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);

    // P07-G13, REQ-037, REQ-038: whole `g` Matched Quantity, one-decimal
    // English dot macronutrients, whole similarity percentage; the API item
    // for Paella (29) is a solid with a gram unit.
    const paella = items.get(29) as SubstituteItem;
    expect(paella.matchedQuantity.unit).toBe("g");
    await expect(page.locator("[data-result-card]").nth(1)).toContainText(
      `${paella.matchedQuantity.value} g`,
    );

    // No current-result language-change transition (ISSUE-008): switching
    // the Interface Language after the results arrive leaves the cards
    // exactly as captured by the search.
    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    await expect(page.locator("[data-result-card]").first()).toContainText(
      "Gyoza",
    );
    await expect(page.locator("[data-result-card]").first()).toContainText(
      "Protein",
    );
    await expect(page.locator("[data-result-card]").first()).not.toContainText(
      "Białko",
    );
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    // P07-G15, REQ-002: every food-data request stays on the Vite origin
    // under `/api`; none reaches Fiber or a third-party host.
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
    const placeholderUrl = (await page
      .locator("main")
      .getAttribute("data-placeholder-url")) as string;

    // P07-G12, REQ-036: Chicken breast (5) ranks 23, 11, and 6.
    await expectRankedCards(
      page,
      [23, 11, 6],
      items,
      COPY.en,
      "en",
      placeholderUrl,
    );

    // REQ-011: the image-less page (ranks 23, 11, and 6 have no image key)
    // renders three valid placeholder cards — each image is the identical
    // bundled placeholder that loads successfully.
    const images = page.locator("[data-result-card] [data-result-card-image]");
    await expect(images).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect
        .poll(() =>
          images
            .nth(index)
            .evaluate(
              (element) =>
                (element as HTMLImageElement).complete &&
                (element as HTMLImageElement).naturalWidth > 0,
            ),
        )
        .toBe(true);
    }
    const absolutePlaceholder = new URL(placeholderUrl, PREVIEW_ORIGIN).href;
    for (let index = 0; index < 3; index += 1) {
      expect(
        await images
          .nth(index)
          .evaluate((element) => (element as HTMLImageElement).src),
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
    const placeholderUrl = (await page
      .locator("main")
      .getAttribute("data-placeholder-url")) as string;

    // P07-G12, REQ-036: Milk (10) ranks 33, 3, and 21.
    await expectRankedCards(
      page,
      [33, 3, 21],
      items,
      COPY.pl,
      "pl",
      placeholderUrl,
    );

    // REQ-039, ISSUE-008: Polish macronutrients keep a comma with exactly
    // one decimal place, and the visible labels are the Polish copy.
    const mondongo = items.get(33) as SubstituteItem;
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
