import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack result-state composition scenario (task 30; ARCH-001,
 * ARCH-002, ARCH-003, ARCH-011, ARCH-019, ARCH-020, ARCH-022, REQ-003,
 * REQ-044, REQ-061, REQ-062, ISSUE-008; P07-G1, P07-G3, P07-G4, P07-G16).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * Each scenario starts in a fresh unauthenticated browser context and runs
 * the complete anonymous pointer flow: it observes the unchanged empty-state
 * Search geometry, selects the seeded Pizza Margherita suggestion with a
 * pointer, and observes the root application's result-state composition —
 * one primary content column containing distinct Search, selected-input,
 * and result regions in that order; the Search field's top edge `96px`
 * from the viewport top; the approved vertical gaps (the new-search
 * spinner `12px` below Search while pending, then the selected-input and
 * result regions at `24px` intervals); the three result cards in three
 * equal desktop columns with Search geometrically above every card; and
 * every food-data request on the Vite origin under `/api` against the
 * seeded PostgreSQL catalog (REQ-002, REQ-003, REQ-044, REQ-061, REQ-062).
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

/** ISSUE-008: the Search field's top edge from the viewport top. */
const SEARCH_TOP_PX = 96;
/** ISSUE-008: the new-search spinner's gap below the Search field. */
const SPINNER_OFFSET_PX = 12;
/** ISSUE-008: the interval between the selected-input and result regions. */
const REGION_GAP_PX = 24;
/** ISSUE-006: the Search field vertical-center line, as a share of 100dvh. */
const VERTICAL_CENTER_DVH = 0.45;
/** REQ-036: a successful page-0 response renders exactly three cards. */
const CARD_COUNT = 3;

const COPY = {
  search: "Search",
  listbox: "Suggestions",
} as const;

/** The seeded Pizza Margherita suggestion option id (task 27, REQ-020). */
const PIZZA_MARGHERITA_OPTION_ID = "food-suggestion-option-1";

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
 * Runs the complete anonymous pointer flow: fills the Search Query, waits
 * for the five seeded suggestions, selects Pizza Margherita with a pointer,
 * and waits for the successful result transition.
 */
async function selectPizzaMargherita(page: Page): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.search });
  await search.fill("margherita");
  const panel = page.getByRole("listbox", { name: COPY.listbox });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("option")).toHaveCount(5);
  await page.locator(`#${PIZZA_MARGHERITA_OPTION_ID}`).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "results",
  );
}

/**
 * Measures the empty-state Search geometry: the field's vertical center
 * must stay at `45%` of `100dvh` (ISSUE-006), proving task 30 retains the
 * existing empty-state geometry unchanged.
 */
async function expectEmptyStateGeometry(page: Page): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.search });
  const box = (await search.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const dvhHeight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.height = "100dvh";
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
  expect(
    Math.abs(box.y + box.height / 2 - VERTICAL_CENTER_DVH * dvhHeight),
    "the empty-state Search center stays at 45% of 100dvh",
  ).toBeLessThanOrEqual(1);
}

/**
 * Asserts the desktop result-state region composition and geometry: one
 * primary column with the distinct Search, selected-input, and result
 * regions in that order; the Search field's top edge `96px` from the
 * viewport top; the `24px` vertical gaps between the regions; exactly
 * three cards in three equal columns; and Search geometrically above every
 * card (REQ-003, REQ-061, REQ-062, ISSUE-008).
 */
async function expectResultStateComposition(page: Page): Promise<void> {
  // One semantic primary content column (REQ-003, ARCH-001).
  await expect(page.locator("main")).toHaveCount(1);

  // The distinct Search, selected-input, and result regions appear in that
  // order inside the primary column (REQ-003).
  const regionSequence = await page.evaluate(() => {
    const regions = Array.from(
      document.querySelectorAll(
        "main [data-search-region], main [data-selected-input-region], main [data-result-region]",
      ),
    );
    return regions.map((element) =>
      element.hasAttribute("data-search-region")
        ? "search"
        : element.hasAttribute("data-selected-input-region")
          ? "selected-input"
          : "result",
    );
  });
  expect(regionSequence).toEqual(["search", "selected-input", "result"]);
  await expect(page.locator("[data-selected-input-region]")).toContainText(
    "Pizza Margherita · 1 serving",
  );

  // The Search field's top edge sits 96px from the viewport top (ISSUE-008).
  const search = page.getByRole("combobox", { name: COPY.search });
  const searchBox = (await search.boundingBox()) as {
    y: number;
    height: number;
  };
  expect(
    Math.abs(searchBox.y - SEARCH_TOP_PX),
    "the Search field's top edge is 96px from the viewport top",
  ).toBeLessThanOrEqual(1);

  // The approved vertical gaps: the selected-input region starts 24px below
  // the Search field and the result region 24px below the selected-input
  // region (ISSUE-008).
  const selectedBox = (await page
    .locator("[data-selected-input-region]")
    .boundingBox()) as { y: number; height: number };
  expect(
    Math.abs(selectedBox.y - (searchBox.y + searchBox.height) - REGION_GAP_PX),
    "the selected-input region is 24px below the Search field",
  ).toBeLessThanOrEqual(1);
  const resultBox = (await page
    .locator("[data-result-region]")
    .boundingBox()) as { y: number; height: number };
  expect(
    Math.abs(
      resultBox.y - (selectedBox.y + selectedBox.height) - REGION_GAP_PX,
    ),
    "the result region is 24px below the selected-input region",
  ).toBeLessThanOrEqual(1);

  // A successful three-item page renders exactly three equal card columns
  // in ranked left-to-right order at the desktop viewport (REQ-036,
  // REQ-062).
  const cards = page.locator("[data-result-card]");
  await expect(cards).toHaveCount(CARD_COUNT);
  const cardBoxes = (await Promise.all(
    Array.from({ length: CARD_COUNT }, (_, index) =>
      cards.nth(index).boundingBox(),
    ),
  )) as Array<{ x: number; y: number; width: number; height: number }>;
  for (let index = 1; index < CARD_COUNT; index += 1) {
    expect(
      Math.abs(cardBoxes[index].y - cardBoxes[0].y),
      `card ${index + 1} stays in the desktop card row`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(cardBoxes[index].width - cardBoxes[0].width),
    ).toBeLessThanOrEqual(1);
    expect(
      cardBoxes[index].x,
      `card ${index + 1} is after card ${index}`,
    ).toBeGreaterThanOrEqual(
      cardBoxes[index - 1].x + cardBoxes[index - 1].width,
    );
  }

  // Search is geometrically above every result card (REQ-061): the field's
  // bottom edge is above the first card's top edge.
  expect(cardBoxes[0].y).toBeGreaterThan(searchBox.y + searchBox.height);

  // The cards show seeded-catalog data: Pizza Margherita's rank 1 is the
  // seeded Gyoza (result-cards spec: ranks [13, 29, 26]).
  await expect(cards.first().getByRole("heading")).toHaveText("Gyoza");
}

test.describe("result state", () => {
  test("the complete anonymous pointer flow composes one primary column with distinct Search, selected-input, and result regions in order; Search sits 96px from the viewport top; the regions use the approved gaps; the three cards use equal desktop columns below Search; and every food-data request uses /api against the seeded catalog", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto("/");

    // The existing empty-state Search geometry remains unchanged (ISSUE-006,
    // REQ-060): the field's vertical center is still 45% of 100dvh before
    // any selection.
    await expectEmptyStateGeometry(page);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "empty",
    );

    // The complete anonymous pointer flow (REQ-001, REQ-020, REQ-022).
    await selectPizzaMargherita(page);

    // The desktop result-state composition and geometry (REQ-003, REQ-061,
    // REQ-062, ISSUE-008, P07-G3, P07-G4).
    await expectResultStateComposition(page);

    // REQ-002: every food-data request stays on the Vite origin under
    // `/api`; none reaches Fiber directly or a third-party host, and the
    // data comes from the seeded PostgreSQL catalog through the real stack.
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

  test("while the new search is pending, the spinner stays 12px below Search and the selected-input region follows 24px below it; fulfillment completes the results composition", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);

    // Hold the first Substitution Search POST at the browser boundary so
    // the real Fiber and PostgreSQL response stays pending while the
    // pending-state gaps are measured (REQ-046, ISSUE-008).
    let postCount = 0;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        await firstGate;
      }
      await route.continue();
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.search });
    await search.fill("margherita");
    const panel = page.getByRole("listbox", { name: COPY.listbox });
    await expect(panel).toBeVisible();
    await page.locator(`#${PIZZA_MARGHERITA_OPTION_ID}`).click();

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    const spinner = page.locator("[data-new-search-spinner]");
    await expect(spinner).toBeVisible();
    await expect(page.locator("[data-selected-input-region]")).toBeVisible();

    // The spinner uses offsets within the positioned Search region so its
    // animation transform cannot affect the measurement. The selected-input
    // region uses `main` as its offset parent, so translate the spinner's
    // Search-local bottom edge into the same coordinate system.
    const layout = await page.evaluate(() => {
      const input = document.getElementById("food-search") as HTMLElement;
      const searchRegion = document.querySelector(
        "[data-search-region]",
      ) as HTMLElement;
      const spin = document.querySelector(
        "[data-new-search-spinner]",
      ) as HTMLElement;
      const selected = document.querySelector(
        "[data-selected-input-region]",
      ) as HTMLElement;
      return {
        spinnerOffset: spin.offsetTop - (input.offsetTop + input.offsetHeight),
        selectedGap:
          selected.offsetTop -
          (searchRegion.offsetTop + spin.offsetTop + spin.offsetHeight),
      };
    });
    expect(
      layout.spinnerOffset,
      "the spinner layout box starts 12px below the Search field",
    ).toBe(SPINNER_OFFSET_PX);
    expect(
      layout.selectedGap,
      "the selected-input region starts 24px below the spinner",
    ).toBe(REGION_GAP_PX);

    // Fulfillment completes the transition: the spinner disappears, the
    // Search field keeps focus (REQ-064), and the result region renders.
    releaseFirst();
    await expect(spinner).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(search).toBeFocused();
    await expect(page.locator("[data-result-card]")).toHaveCount(CARD_COUNT);
  });

  test("at 1920 × 1080 desktop viewport, a three-card result search shows the centered selected-food card, centered substitutions heading, and all cards without vertical scroll, showing API calories with localized labels and kcal in English and Polish (REQ-078, REQ-079, P19-G4, P19-G5)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.goto("/");
    await selectPizzaMargherita(page);

    // Centered selected-food card and centered substitutions heading (REQ-079)
    const selectedCard = page.locator("[data-selected-food-summary]");
    const selectedBox = (await selectedCard.boundingBox())!;
    const cardCenter = selectedBox.x + selectedBox.width / 2;
    expect(
      Math.abs(cardCenter - 1920 / 2),
      "the selected-food card is horizontally centered",
    ).toBeLessThanOrEqual(1);

    const heading = page.locator("[data-substitutions-heading]");
    await expect(heading).toHaveText("Found substitutions");
    const headingBox = (await heading.boundingBox())!;
    const headingCenter = headingBox.x + headingBox.width / 2;
    expect(
      Math.abs(headingCenter - 1920 / 2),
      "the substitutions heading is horizontally centered",
    ).toBeLessThanOrEqual(1);

    // All three cards are visible
    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(CARD_COUNT);
    for (let index = 0; index < CARD_COUNT; index += 1) {
      await expect(cards.nth(index)).toBeVisible();
    }

    // No vertical scroll at 1920 x 1080 (REQ-079)
    const isScrollable = await page.evaluate(
      () =>
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    );
    expect(isScrollable, "page has no vertical scrollbar").toBe(false);

    // English calories on input and result cards (REQ-078, P19-G5)
    await expect(page.locator("[data-selected-food-summary]")).toContainText(
      "Calories",
    );
    await expect(page.locator("[data-input-calories]")).toHaveText("875 kcal");

    for (let index = 0; index < CARD_COUNT; index += 1) {
      await expect(cards.nth(index)).toContainText("Calories");
      await expect(
        cards.nth(index).locator("[data-result-card-calories]"),
      ).toHaveText("875 kcal");
    }

    // Switching interface language locally translates the heading (interface text)
    // while retaining captured active content (ISSUE-008, ARCH-003, ARCH-012).
    await page
      .getByRole("combobox", { name: "Interface language" })
      .selectOption("pl");
    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      "Znalezione zamienniki",
    );
    await expect(page.locator("[data-selected-food-summary]")).toContainText(
      "Calories",
    );

    // A fresh search in Polish captures Polish as the active content language (P19-G3, P19-G5).
    const searchPl = page.getByRole("combobox", { name: "Szukaj" });
    await searchPl.fill("margherita");
    const panelPl = page.getByRole("listbox", { name: "Podpowiedzi" });
    await expect(panelPl).toBeVisible();
    await page.locator(`#${PIZZA_MARGHERITA_OPTION_ID}`).click();
    await expect(panelPl).toHaveCount(0);

    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      "Znalezione zamienniki",
    );
    await expect(page.locator("[data-selected-food-summary]")).toContainText(
      "Kalorie",
    );
    await expect(page.locator("[data-input-calories]")).toHaveText("875 kcal");
    for (let index = 0; index < CARD_COUNT; index += 1) {
      await expect(cards.nth(index)).toContainText("Kalorie");
      await expect(
        cards.nth(index).locator("[data-result-card-calories]"),
      ).toHaveText("875 kcal");
    }
  });
});
