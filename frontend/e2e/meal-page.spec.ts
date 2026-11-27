import { expect, test } from "@playwright/test";
import { chooseLanguage } from "./header";
import { isLandingDialogueRequest } from "./request-purpose";

test("open a full recipe, scale its ingredients, then return to paged results", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let searches = 0;
  page.on("request", (request) => {
    if (
      !isLandingDialogueRequest(request) &&
      request.url().endsWith("/substitutes/search")
    )
      searches++;
  });
  await page.goto("/");
  await chooseLanguage(page, "en");
  const search = page.getByRole("combobox");
  await search.fill("margherita");
  await page.getByRole("option", { name: "Pizza Margherita" }).click();
  const input = (field: string) =>
    page.locator(`[data-nutrition-editor=${field}]`);
  await input("quantity").fill("2");
  await input("quantity").press("Enter");
  const selectedLink = page.getByRole("link", { name: "Pizza Margherita" });
  await expect(selectedLink).toHaveAttribute("href", "/meals/1");
  await selectedLink.click();
  await expect(page).toHaveURL(/\/meals\/1$/);
  await expect(input("quantity")).toHaveValue("800");
  const source = page.getByRole("region", { name: "Source", exact: true });
  await expect(
    source.getByRole("link", { name: "example.org" }),
  ).toHaveAttribute("href", "https://example.org/recipes/1");
  const ingredients = page
    .locator("ul")
    .filter({ hasText: "Flour" })
    .getByRole("listitem");
  const steps = page.locator("ol li");
  const directions = ["Mix in 200 g of tomato.", "Cook for 15 minutes."];
  await expect(steps).toHaveText(directions);
  await input("protein").fill("40");
  await input("protein").press("Enter");
  await expect(input("quantity")).toHaveValue("400");
  await expect(input("calories")).toHaveValue("1000");
  await expect(input("carbohydrate")).toHaveValue("120");
  await expect(input("fat")).toHaveValue("40");
  await expect(ingredients).toHaveText([/Flour.*300\s*g/, /Tomato.*100\s*g/]);
  await expect(steps).toHaveText(directions);
  const scalingNote = page
    .getByRole("region", { name: "Recipe", exact: true })
    .locator("p");
  await expect(scalingNote).toBeVisible();
  await input("calories").fill("1500");
  await input("calories").press("Enter");
  await expect(input("quantity")).toHaveValue("600");
  await expect(ingredients).toHaveText([/Flour.*450\s*g/, /Tomato.*150\s*g/]);
  await page.reload();
  await expect(input("quantity")).toHaveValue("800");
  await expect(scalingNote).toHaveCount(0);
  await chooseLanguage(page, "pl");
  await expect(
    page.getByRole("heading", { name: "Przepis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Mąka" }),
  ).toContainText("600 g");
  await expect(steps).toHaveText(directions);
  await chooseLanguage(page, "en");
  await page.goBack();
  await expect(search).toHaveValue("Pizza Margherita");
  await expect(input("quantity")).toHaveValue("2");
  const cards = page.locator("[data-result-card]");
  await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
  const substitute = cards.getByRole("link", { name: "Lasagna" });
  await substitute.scrollIntoViewIfNeeded();
  const loaded = await cards.count();
  const requests = searches;
  const scroll = await page.evaluate(() => window.scrollY);
  await substitute.click();
  await expect(page).toHaveURL(/\/meals\/3$/);
  await expect(input("quantity")).toHaveValue("800");
  await page.goBack();
  await expect(cards).toHaveCount(loaded);
  await expect(input("quantity")).toHaveValue("2");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  expect(searches).toBe(requests);
});
