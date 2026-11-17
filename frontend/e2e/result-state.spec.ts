import { expect, test, type Page } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

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
  expect(box.height).toBe(56);
  expect(
    Math.abs(box.y - Math.max(340, VERTICAL_CENTER_DVH * dvhHeight - 28)),
    "the landing Search top reserves room for the dialogue",
  ).toBeLessThanOrEqual(1);
}

async function expectResultStateComposition(page: Page): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("[data-selected-food-summary] h3")).toHaveText(
    "Pizza Margherita",
  );
  await expect(page.locator("[data-nutrition-editor=quantity]")).toHaveValue(
    "1",
  );
  const cards = page.locator(
    "[data-selected-food-summary], [data-result-card]",
  );
  await expect(cards).toHaveCount(4);
  const boxes = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  for (let index = 1; index < boxes.length; index += 1) {
    expect(Math.abs(boxes[index].x - boxes[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[index].width - boxes[0].width)).toBeLessThanOrEqual(
      1,
    );
    expect(boxes[index].y).toBeGreaterThanOrEqual(
      boxes[index - 1].y + boxes[index - 1].height,
    );
  }
  expect(boxes[0].width).toBeLessThanOrEqual(920);
  await expect(
    page.locator("[data-result-card]").first().getByRole("heading"),
  ).toHaveText("Gyoza");
}

test.describe("result state", () => {
  test("the anonymous pointer flow shows one vertical card column and uses same-origin catalog requests", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    const userRequestUrls: string[] = [];
    page.on("request", (request) => {
      requestUrls.push(request.url());
      if (!isLandingDialogueRequest(request))
        userRequestUrls.push(request.url());
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto("/");

    await expectEmptyStateGeometry(page);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "empty",
    );

    await selectPizzaMargherita(page);

    await expectResultStateComposition(page);

    const foodData = userRequestUrls.filter((url) => url.includes("/api/"));
    expect(foodData.length).toBeGreaterThanOrEqual(1);
    for (const url of foodData) {
      expect(new URL(url).origin, `unexpected food-data origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
      expect(new URL(url).pathname).toMatch(/^\/api\//);
    }
    for (const url of requestUrls) {
      expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
    }
    expect(requestUrls.some((url) => url.startsWith(FIBER_ORIGIN))).toBe(false);
  });

  test("a pending search keeps focus and fulfillment reveals selected food and substitutes", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);

    let postCount = 0;
    const { promise: firstGate, resolve: releaseFirst } =
      Promise.withResolvers<void>();
    await page.route("**/api/v1/substitutes/search", async (route) => {
      if (isLandingDialogueRequest(route.request())) {
        await route.continue();
        return;
      }
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
    await expect(search).toBeFocused();
    await expect(page.locator("[data-result-card]")).toHaveCount(0);

    releaseFirst();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-selected-food-heading]")).toBeFocused();
    await expect(page.locator("[data-result-card]")).toHaveCount(CARD_COUNT);
  });
  test("desktop results center the cards and localize nutrition input names", async ({
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
    await expect(heading).toHaveText("Substitutes");
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
    expect(isScrollable, "the vertical result list scrolls").toBe(true);

    await expect(page.locator("[data-nutrition-editor=calories]")).toHaveValue(
      "875",
    );
    await expect(
      page.locator("[data-nutrition-editor=calories]"),
    ).toHaveAttribute("aria-label", "Calories");

    await page
      .getByRole("combobox", { name: "Interface language" })
      .selectOption("pl");
    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      "Zamienniki",
    );
    await expect(
      page.locator("[data-nutrition-editor=calories]"),
    ).toHaveAttribute("aria-label", "Kalorie");

    const searchPl = page.getByRole("combobox", { name: "Szukaj" });
    await searchPl.fill("margherita");
    const panelPl = page.getByRole("listbox", { name: "Podpowiedzi" });
    await expect(panelPl).toBeVisible();
    await page.locator(`#${PIZZA_MARGHERITA_OPTION_ID}`).click();
    await expect(panelPl).toHaveCount(0);

    await expect(
      page.locator("[data-nutrition-editor=calories]"),
    ).toHaveAttribute("aria-label", "Kalorie");
    await expect(page.locator("[data-nutrition-editor=calories]")).toHaveValue(
      "875",
    );
  });
});
