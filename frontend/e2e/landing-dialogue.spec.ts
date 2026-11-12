import { expect, test, type Request } from "@playwright/test";
import type { SubstituteSearchResponse } from "../src/client/types.gen";
import { isLandingDialogueRequest } from "./request-purpose";

const presentations = [
  { language: "en", locale: "en-US", width: 1280, height: 720 },
  { language: "pl", locale: "pl-PL", width: 320, height: 568 },
] as const;

for (const presentation of presentations) {
  test(`landing dialogue uses real food data, translates in place, and returns home (${presentation.language})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: presentation.locale,
      viewport: { width: presentation.width, height: presentation.height },
    });
    const page = await context.newPage();
    const requests: Request[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request);
    });
    const exampleResponse = page.waitForResponse(
      (response) =>
        isLandingDialogueRequest(response.request()) &&
        response.request().method() === "POST",
    );
    try {
      await page.goto("/");
      const response = await exampleResponse;
      expect(response.status()).toBe(200);
      const example: SubstituteSearchResponse = await response.json();
      const language = presentation.language;
      const firstAlternative = example.items[0];
      expect(firstAlternative).toBeDefined();
      const dialogue = page.locator("[data-dialogue-step]");
      const search = page.locator("#food-search");
      const searchBox = await search.boundingBox();
      expect(searchBox).not.toBeNull();
      await expect(dialogue).toHaveAttribute("data-dialogue-step", "1");
      await expect(page.locator("[data-dialogue-line]")).toHaveCount(2);
      await expect(
        page.locator('[data-dialogue-line="0"] p[aria-hidden="true"]'),
      ).toContainText(example.selectedFood.names[language]);
      await expect(page.locator("[data-dialogue-meal] h2")).toHaveText(
        example.selectedFood.names[language],
      );
      await expect(page.locator("[data-dialogue-avatar] img")).toBeVisible();

      await expect(dialogue).toHaveAttribute("data-dialogue-step", "3");
      await expect(page.locator("[data-dialogue-line]")).toHaveCount(2);
      await expect(
        page.locator('[data-dialogue-line="2"] p[aria-hidden="true"]'),
      ).toContainText(firstAlternative.names[language]);
      await expect(page.locator("[data-dialogue-meal] h2")).toHaveText(
        firstAlternative.names[language],
      );
      await expect
        .poll(() =>
          page
            .locator("[data-dialogue-meal] img")
            .evaluate(
              (image) =>
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0,
            ),
        )
        .toBe(true);
      const cardBox = await page.locator("[data-dialogue-meal]").boundingBox();
      expect(cardBox).not.toBeNull();
      expect(
        Math.abs(cardBox!.x + cardBox!.width / 2 - presentation.width / 2),
      ).toBeLessThanOrEqual(1);

      await expect(dialogue).toHaveAttribute("data-dialogue-complete", "true");
      await expect(page.locator("[data-dialogue-line]")).toHaveCount(2);
      await expect(
        page.locator('[data-dialogue-line="4"] p[aria-hidden="true"]'),
      ).toHaveText("ME GUSTA");
      expect(await search.boundingBox()).toEqual(searchBox);
      expect(requests.filter(isLandingDialogueRequest)).toHaveLength(2);
      expect(
        requests.filter((request) => !isLandingDialogueRequest(request)),
      ).toHaveLength(0);

      const otherLanguage = language === "en" ? "pl" : "en";
      await page
        .locator("[data-interface-language] select")
        .selectOption(otherLanguage);
      await expect(page.locator("[data-dialogue-meal] h2")).toHaveText(
        firstAlternative.names[otherLanguage],
      );
      await expect(
        page.locator('[data-dialogue-line="4"] p[aria-hidden="true"]'),
      ).toHaveText("ME GUSTA");
      expect(requests).toHaveLength(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      await search.fill("pizza");
      await page.locator("#food-suggestion-option-1").click();
      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );
      await expect(page.locator("[data-result-card]")).toHaveCount(3);
      await expect(
        page.getByRole("link", { name: "obiad", exact: true }),
      ).toBeVisible();
      await expect(dialogue).toHaveCount(0);
      await page.getByRole("link", { name: "obiad", exact: true }).click();
      await expect(page).toHaveURL("/");
      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "empty",
      );
      await expect(search).toHaveValue("");
      await expect(page.locator("[data-result-card]")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
