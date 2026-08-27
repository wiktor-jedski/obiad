import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const OPTION_COUNT = 5;

const PRIMARY_RGB = "rgb(74, 222, 128)";
const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
    selectedFood: "Selected food",
    languageControl: "Interface language",
  },
} as const;

const CHICKEN_SUGGESTIONS = [
  { foodObjectId: 5, name: "Chicken breast" },
  { foodObjectId: 22, name: "Fried chicken wings" },
  { foodObjectId: 17, name: "Polish chicken soup" },
  { foodObjectId: 10, name: "Milk" },
  { foodObjectId: 26, name: "Pancakes" },
] as const;

const CHICKEN_SOUP_DEFAULT = { value: 1, unit: "serving" } as const;

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

interface SubstitutePost {
  body: SubstituteSearchRequest;

  status: number | null;
}

function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        // SAFETY: The request payload matches the generated API contract.
        body: request.postDataJSON() as SubstituteSearchRequest,
        status: null,
      });
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
      }
    }
  });
  return posts;
}

function trackSuggestionDefaults(
  page: Page,
): Map<number, { value: number; unit: string }> {
  const defaults = new Map<number, { value: number; unit: string }>();
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/food-suggestions")) {
      void response.json().then(
        (body: {
          items: Array<{
            foodObjectId: number;
            defaultQuantity: { value: number; unit: string };
          }>;
        }) => {
          for (const item of body.items) {
            defaults.set(item.foodObjectId, item.defaultQuantity);
          }
        },
      );
    }
  });
  return defaults;
}

async function expectOpenPanel(page: Page): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.en.search });
  const panel = page.getByRole("listbox", { name: COPY.en.listbox });
  const options = panel.getByRole("option");

  await expect(panel).toBeVisible();
  await expect(options).toHaveCount(OPTION_COUNT);
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveText(
      CHICKEN_SUGGESTIONS[index].name,
    );
    await expect(options.nth(index)).toHaveAttribute(
      "id",
      optionId(CHICKEN_SUGGESTIONS[index].foodObjectId),
    );
  }
  await expect(search).toHaveAttribute("aria-expanded", "true");
}

async function expectActiveOption(page: Page, index: number): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.en.search });
  const options = page
    .getByRole("listbox", { name: COPY.en.listbox })
    .getByRole("option");

  for (let optionIndex = 0; optionIndex < OPTION_COUNT; optionIndex += 1) {
    await expect(options.nth(optionIndex)).toHaveAttribute(
      "aria-selected",
      String(optionIndex === index),
    );
    if (optionIndex === index) {
      await expect(options.nth(optionIndex)).toHaveCSS(
        "background-color",
        PRIMARY_RGB,
      );
      await expect(options.nth(optionIndex)).toHaveCSS(
        "color",
        TEXT_ON_BRIGHT_RGB,
      );
    } else {
      await expect(options.nth(optionIndex)).toHaveCSS(
        "color",
        TEXT_PRIMARY_RGB,
      );
    }
  }
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    optionId(CHICKEN_SUGGESTIONS[index].foodObjectId),
  );
}

function selectedInput(page: Page) {
  return page.locator("[data-selected-input]");
}

test.describe("suggestion keyboard control", () => {
  test("keyboard selection loads results, then draft typing keeps those results and overlays fresh suggestions without moving Search or starting another POST", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectOpenPanel(page);
    await expectActiveOption(page, 0);
    await expect(search).toBeFocused();

    await search.press("ArrowUp");
    await expectActiveOption(page, 0);

    await search.press("ArrowDown");
    await expectActiveOption(page, 1);
    await search.press("ArrowDown");
    await expectActiveOption(page, 2);
    await search.press("ArrowDown");
    await expectActiveOption(page, 3);
    await search.press("ArrowDown");
    await expectActiveOption(page, 4);

    await search.press("ArrowDown");
    await expectActiveOption(page, 4);
    await expect(page.getByRole("listbox")).toHaveCount(1);

    await search.press("ArrowUp");
    await expectActiveOption(page, 3);
    await search.press("ArrowUp");
    await expectActiveOption(page, 2);

    await search.press("Enter");

    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("Polish chicken soup");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    expect(posts, "exactly one Substitution Search POST").toHaveLength(1);
    expect(posts[0].body).toEqual({
      foodObjectId: 17,
      quantity: CHICKEN_SOUP_DEFAULT,
      pageIndex: 0,
    });

    await expect
      .poll(() => observedDefaults.get(17))
      .toEqual(CHICKEN_SOUP_DEFAULT);
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);

    await expect(selectedInput(page)).toContainText(COPY.en.selectedFood);
    await expect(selectedInput(page)).toContainText(
      "Polish chicken soup · 1 serving",
    );
    await expect(page.locator("[data-result-card]").first()).toBeVisible();
    await expect(page.locator("[data-substitutions-heading]")).toBeFocused();

    const committedSearchBox = await search.boundingBox();
    await search.fill("olive");
    const draftPanel = page.getByRole("listbox", {
      name: COPY.en.listbox,
    });
    await expect(draftPanel).toBeVisible();
    await expect(draftPanel.getByRole("option")).toHaveCount(OPTION_COUNT);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(selectedInput(page)).toContainText(
      "Polish chicken soup · 1 serving",
    );
    await expect(page.locator("[data-result-card]").first()).toBeVisible();

    const draftSearchBox = await search.boundingBox();
    const panelBox = await draftPanel.boundingBox();
    const selectedBox = await selectedInput(page).boundingBox();
    expect(draftSearchBox?.y).toBe(committedSearchBox?.y);
    expect(
      Math.abs(
        (panelBox?.y ?? 0) -
          ((draftSearchBox?.y ?? 0) + (draftSearchBox?.height ?? 0)),
      ),
    ).toBeLessThanOrEqual(1);
    expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThan(
      selectedBox?.y ?? Number.POSITIVE_INFINITY,
    );
    await expect(draftPanel).toHaveCSS("z-index", "20");
    expect(
      posts,
      "no second submit action after the successful page",
    ).toHaveLength(1);
  });

  test("Escape closes the list while retaining the Search Query text and Search focus, starts zero Substitution Searches, and typing reopens exactly five options", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectOpenPanel(page);
    await expectActiveOption(page, 0);

    await search.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("chicken");
    await expect(search).toBeFocused();
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    expect(posts, "Escape must not start a Substitution Search").toHaveLength(
      0,
    );

    await search.fill("pizza");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(
      OPTION_COUNT,
    );
    expect(posts).toHaveLength(0);
  });

  test("Tab closes the list, moves focus natively to the next control, and starts zero Substitution Searches", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectOpenPanel(page);
    await expectActiveOption(page, 0);

    await search.press("Tab");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("combobox", { name: COPY.en.languageControl }),
    ).toBeFocused();
    expect(posts, "Tab must not start a Substitution Search").toHaveLength(0);
  });
});
