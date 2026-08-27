import { expect, test, type Page } from "@playwright/test";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

const FIELD_HEIGHT_PX = 56;
const FIELD_MAX_WIDTH_PX = 640;
const OUTER_RADIUS_PX = FIELD_HEIGHT_PX / 2;
const ROW_HEIGHT_PX = 48;
const OPTION_COUNT = 5;

const SURFACE_RGB = "rgb(22, 29, 22)";
const SECONDARY_RGB = "rgb(134, 239, 172)";
const PRIMARY_RGB = "rgb(74, 222, 128)";
const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";

const COPY = {
  en: {
    search: "Search",
    placeholder: "Search foods",
    listbox: "Suggestions",
    languageControl: "Interface language",
  },
  pl: {
    search: "Szukaj",
    placeholder: "Szukaj potraw",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
  },
} as const;

const SEEDED_SUGGESTIONS = {
  en: {
    chicken: [
      { foodObjectId: 5, name: "Chicken breast" },
      { foodObjectId: 22, name: "Fried chicken wings" },
      { foodObjectId: 17, name: "Polish chicken soup" },
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 26, name: "Pancakes" },
    ],
    zzzzzz: [
      { foodObjectId: 13, name: "Gyoza" },
      { foodObjectId: 18, name: "Butter" },
      { foodObjectId: 16, name: "Gyros" },
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 10, name: "Milk" },
    ],
    pizza: [
      { foodObjectId: 1, name: "Pizza Margherita" },
      { foodObjectId: 2, name: "Pizza Capricciosa" },
      { foodObjectId: 13, name: "Gyoza" },
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 29, name: "Paella" },
    ],
  },
  pl: {
    kurczak: [
      { foodObjectId: 5, name: "Pierś z kurczaka" },
      { foodObjectId: 22, name: "Smażone skrzydełka z kurczaka" },
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 36, name: "Sernik" },
      { foodObjectId: 38, name: "Gulasz" },
    ],
    zzzzzz: [
      { foodObjectId: 38, name: "Gulasz" },
      { foodObjectId: 16, name: "Gyros" },
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 3, name: "Lazania" },
      { foodObjectId: 18, name: "Masło" },
    ],
  },
} as const;

function optionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
}

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

async function expectSuggestionPanel(
  page: Page,
  expected: readonly { foodObjectId: number; name: string }[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  const panel = page.getByRole("listbox", { name: copy.listbox });
  const options = panel.getByRole("option");

  await expect(panel).toBeVisible();
  await expect(options).toHaveCount(OPTION_COUNT);

  const searchBox = await search.boundingBox();
  const panelBox = await panel.boundingBox();
  if (searchBox === null || panelBox === null) {
    throw new Error(
      "Search field and suggestion panel must have bounding boxes",
    );
  }
  expect(searchBox.height).toBe(FIELD_HEIGHT_PX);
  expect(panelBox.width).toBe(FIELD_MAX_WIDTH_PX);
  expect(
    Math.abs(panelBox.x - searchBox.x),
    "the panel horizontally matches the Search field",
  ).toBeLessThanOrEqual(1);
  expect(
    panelBox.y - (searchBox.y + searchBox.height),
    "the panel continuously extends the Search field",
  ).toBe(0);
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    const rowBox = await options.nth(index).boundingBox();
    if (rowBox === null) {
      throw new Error(`Suggestion option ${index + 1} has no bounding box`);
    }
    expect(rowBox.height, `option ${index + 1} is 48px tall`).toBe(
      ROW_HEIGHT_PX,
    );

    expect(rowBox.width).toBe(FIELD_MAX_WIDTH_PX - 2);
  }

  await expect(search).toHaveCSS("border-bottom-width", "1px");
  await expect(search).toHaveCSS(
    "border-top-left-radius",
    `${OUTER_RADIUS_PX}px`,
  );
  await expect(search).toHaveCSS("border-bottom-left-radius", "0px");
  await expect(search).toHaveCSS("border-bottom-right-radius", "0px");
  await expect(panel).toHaveCSS("border-top-width", "0px");
  await expect(panel).toHaveCSS("border-top-left-radius", "0px");
  await expect(panel).toHaveCSS("border-top-right-radius", "0px");
  await expect(panel).toHaveCSS(
    "border-bottom-left-radius",
    `${OUTER_RADIUS_PX}px`,
  );
  await expect(panel).toHaveCSS(
    "border-bottom-right-radius",
    `${OUTER_RADIUS_PX}px`,
  );

  await expect(search).toHaveCSS("padding-left", "36px");
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveCSS("padding-left", "36px");
  }

  await expect(panel).toHaveCSS("background-color", SURFACE_RGB);
  await expect(panel).toHaveCSS("border-top-color", SECONDARY_RGB);
  await expect(panel).toHaveCSS("border-bottom-color", SECONDARY_RGB);
  await expect(options.nth(0)).toHaveCSS("background-color", PRIMARY_RGB);
  await expect(options.nth(0)).toHaveCSS("color", TEXT_ON_BRIGHT_RGB);
  await expect(options.nth(1)).toHaveCSS("color", TEXT_PRIMARY_RGB);

  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveText(expected[index].name);
  }

  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveAttribute(
      "id",
      optionId(expected[index].foodObjectId),
    );
  }
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    optionId(expected[0].foodObjectId),
  );
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect(search).toHaveAttribute(
    "aria-controls",
    "food-suggestions-listbox",
  );
}

interface RequestTracker {
  foodDataRequests: () => string[];
}

function trackRequests(page: Page, urls: string[]): RequestTracker {
  page.on("request", (request) => urls.push(request.url()));
  return {
    foodDataRequests: () => urls.filter((url) => url.includes("/api/")),
  };
}

test.describe("live Food Object suggestions", () => {
  test("a fresh unauthenticated context starts with no request and shows five seeded English suggestions for a normal query and zzzzzz", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    const { foodDataRequests } = trackRequests(page, requestUrls);

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");

    expect(foodDataRequests(), "no startup application request").toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe("");

    const search = page.getByRole("combobox", { name: COPY.en.search });
    await expect(search).toHaveAttribute("role", "combobox");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");

    await search.fill("chicken");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);

    await search.fill("zzzzzz");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.zzzzzz, COPY.en);

    await search.blur();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("zzzzzz");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");

    const foodData = foodDataRequests();
    expect(foodData.length).toBeGreaterThanOrEqual(2);
    for (const url of foodData) {
      expect(new URL(url).origin, `unexpected food-data origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
      expect(new URL(url).pathname).toMatch(/^\/api\//);
    }
    expect(requestUrls.some((url) => url.startsWith(FIBER_ORIGIN))).toBe(false);
  });

  test("Polish mode shows five seeded Polish suggestions for a normal query and zzzzzz", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.goto("/");

    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    const search = page.getByRole("combobox", { name: COPY.pl.search });
    await expect(search).toHaveAttribute("placeholder", COPY.pl.placeholder);

    await search.fill("kurczak");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl.kurczak, COPY.pl);

    await search.fill("zzzzzz");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl.zzzzzz, COPY.pl);
  });

  test("refocusing with the same Search Query starts a fresh request while placeholder rows keep the panel stable", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const suggestionRequestUrls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/food-suggestions")) {
        suggestionRequestUrls.push(request.url());
      }
    });

    let chickenCount = 0;
    let releaseSecond: () => void = () => {};
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    await page.route("**/api/v1/food-suggestions*", async (route) => {
      const queryParam = new URL(route.request().url()).searchParams.get(
        "query",
      );
      if (queryParam === "chicken") {
        chickenCount += 1;
        if (chickenCount === 2) {
          await secondGate;
        }
      }
      await route.continue();
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    const panel = page.getByRole("listbox", { name: COPY.en.listbox });

    await search.fill("chicken");
    await expect(panel).toBeVisible();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);

    await search.blur();
    await expect(panel).toHaveCount(0);
    await expect(search).not.toHaveAttribute("aria-activedescendant");

    await search.focus();
    await expect(panel).toBeVisible();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);
    await page.waitForTimeout(300);
    await expect(panel).toBeVisible();

    releaseSecond();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);

    expect(
      suggestionRequestUrls.filter((url) => url.includes("query=chicken")),
    ).toHaveLength(2);
  });

  test("a superseded suggestion request is aborted and its delayed response cannot change the latest list", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    const failedRequests: { url: string; error: string }[] = [];
    trackRequests(page, requestUrls);
    page.on("requestfailed", (request) =>
      failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? "unknown failure",
      }),
    );

    let sawFirst = false;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstSeen: () => void = () => {};
    const firstSeen = new Promise<void>((resolve) => {
      markFirstSeen = resolve;
    });
    await page.route("**/api/v1/food-suggestions*", async (route) => {
      const queryParam = new URL(route.request().url()).searchParams.get(
        "query",
      );
      if (queryParam === "chicken" && !sawFirst) {
        sawFirst = true;
        markFirstSeen();
        await firstGate;
        try {
          await route.continue();
        } catch {}
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    await search.fill("chicken");
    await firstSeen;

    await search.fill("pizza");
    const panel = page.getByRole("listbox", { name: COPY.en.listbox });
    await expect(panel).toBeVisible();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.pizza, COPY.en);

    await expect
      .poll(() => failedRequests.find((r) => r.url.includes("query=chicken")))
      .toBeTruthy();
    const aborted = failedRequests.find((request) =>
      request.url.includes("query=chicken"),
    );
    if (aborted === undefined) {
      throw new Error("Superseded chicken request did not fail");
    }
    expect(aborted.error).toContain("ERR_ABORTED");

    releaseFirst();
    await page.waitForTimeout(400);
    await expect(panel.getByRole("option")).toHaveCount(OPTION_COUNT);
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.pizza, COPY.en);
  });
});
