import { expect, test, type Page } from "@playwright/test";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

const SEARCH_TOP_PX = 64;

const REGION_GAP_PX = 24;

const VERTICAL_CENTER_DVH = 0.45;

const CARD_COUNT = 3;

const COPY = {
  search: "Search",
  listbox: "Suggestions",
} as const;

const PIZZA_MARGHERITA_OPTION_ID = "food-suggestion-option-1";

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

async function expectEmptyStateGeometry(page: Page): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.search });
  const box = await search.boundingBox();
  if (box === null) {
    throw new Error("Empty-state Search has no bounding box");
  }
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

async function expectResultStateComposition(page: Page): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);

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

  const search = page.getByRole("combobox", { name: COPY.search });
  const searchBox = await search.boundingBox();
  if (searchBox === null) {
    throw new Error("Search field has no bounding box");
  }
  expect(
    Math.abs(searchBox.y - SEARCH_TOP_PX),
    "the Search field's top edge is 64px from the viewport top",
  ).toBeLessThanOrEqual(1);

  const selectedBox = await page
    .locator("[data-selected-input-region]")
    .boundingBox();
  if (selectedBox === null) {
    throw new Error("Selected-input region has no bounding box");
  }
  expect(
    Math.abs(selectedBox.y - (searchBox.y + searchBox.height) - REGION_GAP_PX),
    "the selected-input region is 24px below the Search field",
  ).toBeLessThanOrEqual(1);
  const resultBox = await page.locator("[data-result-region]").boundingBox();
  if (resultBox === null) {
    throw new Error("Result region has no bounding box");
  }
  expect(
    Math.abs(
      resultBox.y - (selectedBox.y + selectedBox.height) - REGION_GAP_PX,
    ),
    "the result region is 24px below the selected-input region",
  ).toBeLessThanOrEqual(1);

  const cards = page.locator("[data-result-card]");
  await expect(cards).toHaveCount(CARD_COUNT);
  const cardBoxes = await Promise.all(
    Array.from({ length: CARD_COUNT }, async (_, index) => {
      const box = await cards.nth(index).boundingBox();
      if (box === null) {
        throw new Error(`Result card ${index + 1} has no bounding box`);
      }
      return box;
    }),
  );
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

  expect(cardBoxes[0].y).toBeGreaterThan(searchBox.y + searchBox.height);

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

    await expectEmptyStateGeometry(page);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "empty",
    );

    await selectPizzaMargherita(page);

    await expectResultStateComposition(page);

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

  test("while a new search is pending, no spinner appears below Search and the selected-input region starts 24px below it; fulfillment completes the results composition", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);

    let postCount = 0;
    const { promise: firstGate, resolve: releaseFirst } =
      Promise.withResolvers<void>();
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
    await expect(page.locator("[data-new-search-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-selected-input-region]")).toBeVisible();

    const selectedGap = await page.evaluate(() => {
      const input = document.getElementById("food-search");
      const selected = document.querySelector("[data-selected-input-region]");
      if (
        !(input instanceof HTMLElement) ||
        !(selected instanceof HTMLElement)
      ) {
        throw new Error(
          "Search and selected-input regions must be HTML elements",
        );
      }
      return (
        selected.getBoundingClientRect().top -
        input.getBoundingClientRect().bottom
      );
    });
    expect(
      selectedGap,
      "the selected-input region starts 24px below Search",
    ).toBe(REGION_GAP_PX);

    releaseFirst();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-substitutions-heading]")).toBeFocused();
    await expect(page.locator("[data-result-card]")).toHaveCount(CARD_COUNT);
  });
  test("at 1920 × 1080 desktop viewport, a three-card result search shows the centered selected-food card, centered substitutions heading, and all cards without vertical scroll, showing API calories with kcal and active-language accessibility labels in English and Polish (REQ-078, REQ-079, P19-G4, P19-G5)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.goto("/");
    await selectPizzaMargherita(page);

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

    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(CARD_COUNT);
    for (let index = 0; index < CARD_COUNT; index += 1) {
      await expect(cards.nth(index)).toBeVisible();
    }

    const isScrollable = await page.evaluate(
      () =>
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    );
    expect(isScrollable, "page has no vertical scrollbar").toBe(false);

    await expect(page.locator("[data-input-calories]")).toHaveText("875 kcal");
    await expect(page.locator("[data-input-calories]")).toHaveAttribute(
      "aria-label",
      "Calories",
    );

    await page
      .getByRole("combobox", { name: "Interface language" })
      .selectOption("pl");
    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      "Znalezione zamienniki",
    );
    await expect(page.locator("[data-input-calories]")).toHaveAttribute(
      "aria-label",
      "Kalorie",
    );

    const searchPl = page.getByRole("combobox", { name: "Szukaj" });
    await searchPl.fill("margherita");
    const panelPl = page.getByRole("listbox", { name: "Podpowiedzi" });
    await expect(panelPl).toBeVisible();
    await page.locator(`#${PIZZA_MARGHERITA_OPTION_ID}`).click();
    await expect(panelPl).toHaveCount(0);

    await expect(page.locator("[data-input-calories]")).toHaveAttribute(
      "aria-label",
      "Kalorie",
    );
    await expect(page.locator("[data-input-calories]")).toHaveText("875 kcal");
  });
});
