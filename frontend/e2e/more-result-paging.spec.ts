import { expect, test } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const PIZZA_ALL_PAGES: readonly (readonly number[])[] = [
  [13, 29, 26],
  [30, 3, 35],
  [14, 4, 21],
  [28, 24, 25],
  [10, 31, 36],
  [34, 8, 37],
  [33, 15, 32],
  [9, 16, 17],
  [12, 20, 38],
  [22, 11, 27],
  [7, 6, 5],
  [23, 18, 19],
] as const;

const CHICKEN_ALL_PAGES: readonly (readonly number[])[] = [
  [23, 11, 6],
  [7, 20, 12],
  [17, 38, 22],
  [16, 27, 33],
  [15, 10, 34],
  [21, 3, 29],
  [2, 30, 13],
  [1, 36, 24],
  [26, 25, 28],
  [4, 35, 14],
  [32, 31, 18],
  [19, 8, 37],
  [9],
] as const;

for (const fixture of [
  {
    language: "en",
    query: "margherita",
    id: 1,
    pages: PIZZA_ALL_PAGES,
    quantity: "2",
    calories: "1750 kcal",
  },
  {
    language: "pl",
    query: "kurczaka",
    id: 5,
    pages: CHICKEN_ALL_PAGES,
    quantity: "200",
    calories: "313 kcal",
  },
]) {
  test(`${fixture.language}: bottom scrolling appends every page and a new search resets the portion`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const posts: SubstituteSearchRequest[] = [];
    page.on("request", (request) => {
      if (
        !isLandingDialogueRequest(request) &&
        request.method() === "POST" &&
        request.url().includes("/substitutes/search")
      )
        posts.push(request.postDataJSON());
    });
    await page.goto("/");
    await page
      .getByRole("combobox", { name: /Interface language|Język interfejsu/ })
      .selectOption(fixture.language);
    const search = page.getByRole("combobox", { name: /^(Search|Szukaj)$/ });
    await search.fill(fixture.query);
    await page.locator(`#food-suggestion-option-${fixture.id}`).click();
    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(3);
    await cards
      .first()
      .evaluate((card) => card.setAttribute("data-retained-card", "true"));
    for (let index = 1; index < fixture.pages.length; index += 1) {
      await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
      await expect(cards).toHaveCount(
        fixture.pages.slice(0, index + 1).flat().length,
      );
      await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
      expect(
        await cards.evaluateAll((elements) =>
          elements.map((element) =>
            Number(element.getAttribute("data-food-object-id")),
          ),
        ),
      ).toEqual(fixture.pages.slice(0, index + 1).flat());
      await expect(cards.first()).toHaveAttribute("data-retained-card", "true");
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }
    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1100);
    await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
    expect(posts).toEqual(
      fixture.pages.map((_, pageIndex) => ({
        foodObjectId: fixture.id,
        pageIndex,
      })),
    );
    expect(new Set(fixture.pages.flat()).size).toBe(
      fixture.pages.flat().length,
    );
    const quantity = page.locator("[data-nutrition-editor=quantity]");
    await quantity.fill(fixture.quantity);
    await quantity.press("Enter");
    await expect(page.locator("[data-result-card-calories]")).toHaveText(
      Array(fixture.pages.flat().length).fill(fixture.calories),
    );
    expect(posts).toHaveLength(fixture.pages.length);
    await search.fill(fixture.query);
    await page.locator(`#food-suggestion-option-${fixture.id}`).click();
    await expect(cards).toHaveCount(3);
    await expect(quantity).toHaveValue(fixture.id === 1 ? "1" : "100");
    await expect(page.locator("[data-selected-food-heading]")).toBeFocused();
    expect(posts.at(-1)).toEqual({ foodObjectId: fixture.id, pageIndex: 0 });
  });
}
