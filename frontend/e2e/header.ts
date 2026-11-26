import { expect, type Page } from "@playwright/test";

type Language = "en" | "pl";

/** Locates the native wordmark control on either page. */
export function wordmark(page: Page) {
  return page.locator("details > summary").filter({ hasText: "obiad" });
}

/** Locates the language control even after its accessible name changes. */
export function languageSummary(page: Page) {
  return page.locator("[data-interface-language] summary");
}

/** Checks the visible current code and the localized name of the control. */
export async function expectLanguage(page: Page, language: Language) {
  const summary = languageSummary(page);
  await expect(summary).toContainText(language.toUpperCase());
  await expect(summary).toHaveAccessibleName(
    language === "en" ? "Interface language" : "Język interfejsu",
  );
}

/** Selects a language through the same disclosure used by a pointer user. */
export async function chooseLanguage(page: Page, language: Language) {
  await languageSummary(page).click();
  await page
    .locator("[data-interface-language]")
    .getByRole("button", {
      name: language === "en" ? "English" : "Polski",
      exact: true,
    })
    .click();
  await expectLanguage(page, language);
  await expect(languageSummary(page)).toBeFocused();
}

/** Checks the closed disclosures shared by the Search and Sources pages. */
export async function expectHeader(page: Page, language: Language) {
  await expect(page.locator("details > summary")).toHaveCount(2);
  await expect(wordmark(page)).toHaveAccessibleName("obiad — menu");
  await expectLanguage(page, language);
  await expect(page.locator("details[open], footer")).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
}
