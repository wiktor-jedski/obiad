import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chooseLanguage,
  expectHeader,
  languageSummary,
  wordmark,
} from "./header";

async function follow(page: Page, link: Locator, path: string) {
  await expect(link).toHaveAttribute("href", path);
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    link.press("Enter"),
  ]);
  await expect(page).toHaveURL(path);
}

async function expectSources(page: Page, language: "en" | "pl") {
  const main = page.getByRole("main");
  const pl = language === "pl";
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(
    pl ? "Źródła" : "Sources",
  );
  const sections = [
    [
      pl ? "Składniki" : "Foods",
      "USDA FoodData Central",
      "https://fdc.nal.usda.gov/",
    ],
    [pl ? "Przepisy" : "Recipes", "TheMealDB", "https://www.themealdb.com/"],
  ] as const;
  const lists = main.getByRole("list");
  await expect(lists).toHaveCount(2);
  let bottom = -Infinity;
  for (const [index, [heading, sample, href]] of sections.entries()) {
    const title = main.getByRole("heading", { name: heading, exact: true });
    await expect(title).toBeVisible();
    const titleBox = (await title.boundingBox())!;
    expect(titleBox.y).toBeGreaterThanOrEqual(bottom);
    bottom = titleBox.y + titleBox.height;
    const list = lists.nth(index);
    const link = list.getByRole("link", { name: sample, exact: true });
    await expect(link).toHaveAttribute("href", href);
    for (const item of await list.getByRole("listitem").all()) {
      await expect(item.getByRole("link")).toBeVisible();
      const box = (await item.boundingBox())!;
      expect(box.y, "sources form one vertical list").toBeGreaterThanOrEqual(
        bottom,
      );
      bottom = box.y + box.height;
    }
  }
  const release = main.locator('a[href="/release.json"]');
  const commit = process.env.VITE_DATA_COMMIT;
  if (commit) {
    await expect(release).toHaveText(commit);
  } else {
    await expect(release).toHaveCount(0);
  }
}

for (const width of [320, 1280]) {
  test.describe(`source navigation at ${width}px`, () => {
    test.use({ locale: "en-US", viewport: { width, height: 720 } });

    test("direct entry and reload preserve localized sources; both links navigate to a new document", async ({
      page,
    }) => {
      const manifestRequests: string[] = [];
      page.on("request", (request) => {
        const { pathname } = new URL(request.url());
        if (
          [
            "/release.json",
            "/catalog.json",
            "/prototype-manifest.json",
          ].includes(pathname)
        ) {
          manifestRequests.push(pathname);
        }
      });
      await page.goto("/sources");
      await expectHeader(page, "en");
      await expectSources(page, "en");

      const menu = wordmark(page);
      const language = languageSummary(page);
      await menu.click();
      const outside = page.getByRole("heading", {
        name: "Recipes",
        exact: true,
      });
      await expect(
        page.getByRole("link", { name: "Search", exact: true }),
      ).toHaveAttribute("href", "/");
      await expect(
        page.getByRole("link", { name: "Sources", exact: true }),
      ).toHaveAttribute("href", "/sources");
      await outside.click();
      await expect(page.locator("details[open]")).toHaveCount(0);

      await language.click();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(language).toBeFocused();
      await expect(page.locator("details[open]")).toHaveCount(0);
      await language.click();
      await outside.click();
      await expect(page.locator("details[open]")).toHaveCount(0);
      await chooseLanguage(page, "pl");
      await expectSources(page, "pl");
      await page.reload();
      await expectHeader(page, "pl");
      await expectSources(page, "pl");

      await menu.press("Enter");
      const searchLink = page.getByRole("link", {
        name: "Szukaj",
        exact: true,
      });
      await page.keyboard.press("Tab");
      await expect(searchLink).toBeFocused();
      await follow(page, searchLink, "/");
      await expectHeader(page, "pl");
      await expect(
        page.getByRole("combobox", { name: "Szukaj" }),
      ).toBeFocused();
      await expect(page.locator('a[href="/release.json"]')).toHaveCount(0);

      await page.keyboard.press("Shift+Tab");
      await expect(menu).toBeFocused();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(page.locator("details[open]")).toHaveCount(0);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expect(searchLink).toBeFocused();
      await page.keyboard.press("Tab");
      const sourcesLink = page.getByRole("link", {
        name: "Źródła",
        exact: true,
      });
      await expect(sourcesLink).toBeFocused();
      await follow(page, sourcesLink, "/sources");
      await expectHeader(page, "pl");
      await expectSources(page, "pl");
      expect(manifestRequests).toEqual([]);
    });
  });
}
