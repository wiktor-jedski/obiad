import { chooseLanguage } from "./header";
import { expect, test } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";

for (const language of ["en", "pl"] as const) {
  test(`${language}: nutrition edits scale the portion locally and unit switching preserves it`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("obiad.interfaceLanguage", value),
      language,
    );
    await page.goto("/");
    await chooseLanguage(page, language);
    let posts = 0;
    page.on("request", (request) => {
      if (
        !isLandingDialogueRequest(request) &&
        request.method() === "POST" &&
        request.url().includes("/substitutes/search")
      )
        posts += 1;
    });
    await page
      .getByRole("combobox", { name: /^(Search|Szukaj)$/ })
      .fill("margherita");
    await page.locator("#food-suggestion-option-1").click();
    await expect(
      page
        .locator("[data-selected-food-summary]")
        .locator("xpath=ancestor::*[@data-card-reveal]"),
    ).toHaveAttribute("data-card-reveal-state", "shown");
    const quantity = page.locator("[data-nutrition-editor=quantity]");
    const calories = page.locator("[data-nutrition-editor=calories]");
    const protein = page.locator("[data-nutrition-editor=protein]");
    const carbs = page.locator("[data-nutrition-editor=carbohydrate]");
    const fat = page.locator("[data-nutrition-editor=fat]");
    const toggle = page.locator("[data-unit-toggle]");
    await expect(quantity).toHaveValue("1");
    await expect(calories).toHaveValue("875");
    await expect(toggle).toHaveAccessibleName(
      language === "en" ? "servings" : "porcje",
    );
    await quantity.fill("2,5");
    await quantity.press("Enter");
    await expect(quantity).toHaveValue(language === "en" ? "2.5" : "2,5");
    await expect(calories).toHaveValue("2188");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(quantity).toHaveValue("875");
    await expect(calories).toHaveValue("2188");
    await protein.fill("70");
    await protein.press("Enter");
    await expect(quantity).toHaveValue("700");
    await expect(carbs).toHaveValue("210");
    await expect(fat).toHaveValue("70");
    await expect(calories).toHaveValue("1750");
    await calories.fill("875");
    await calories.press("Tab");
    await expect(quantity).toHaveValue("350");
    await carbs.fill("210");
    await carbs.press("Enter");
    await expect(calories).toHaveValue("1750");
    await fat.fill("35");
    await fat.press("Enter");
    await expect(quantity).toHaveValue("350");
    await expect(page.locator("[data-result-card-calories]")).toHaveText([
      "875 kcal",
      "875 kcal",
      "875 kcal",
    ]);
    await expect(
      page.locator("[data-result-card-matched-quantity]").first(),
    ).toHaveText("438 g");
    expect(posts).toBe(1);

    for (const invalid of ["0", "-1", "abc", "1e3", "1.5", "100001"]) {
      await quantity.fill(invalid);
      await quantity.press("Enter");
      await expect(quantity).toBeFocused();
      await expect(quantity).toHaveValue(invalid);
      await expect(quantity).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("#nutrition-edit-error")).toHaveAttribute(
        "role",
        "status",
      );
      await expect(page.locator("#nutrition-edit-error")).toContainText(
        language === "en" ? "Quantity" : "Ilość",
      );
      await expect(calories).toHaveValue("875");
      await quantity.press("Escape");
      await expect(quantity).toHaveValue("350");
    }
    for (const submitBeforeBlur of [false, true]) {
      await quantity.fill("bad");
      if (submitBeforeBlur) {
        await quantity.press("Enter");
        await expect(quantity).toBeFocused();
        await expect(quantity).toHaveValue("bad");
        await expect(quantity).toHaveAttribute("aria-invalid", "true");
      }
      await quantity.press("Tab");
      await expect(quantity).toHaveValue("350");
      await expect(calories).toBeFocused();
      await expect(page.locator("#nutrition-edit-error")).toContainText(
        language === "en" ? "Quantity" : "Ilość",
      );
      await calories.press("Tab");
      await expect(protein).toBeFocused();
      await expect(page.locator("#nutrition-edit-error")).toContainText(
        language === "en" ? "Quantity" : "Ilość",
      );
    }
    await protein.fill("1.23");
    await protein.press("Enter");
    await expect(protein).toHaveAttribute("aria-invalid", "true");
    await protein.press("Escape");
    for (const [input, invalid] of [
      [protein, "10001"],
      [calories, "250001"],
      [calories, "1.1"],
    ] as const) {
      await input.fill(invalid);
      await input.press("Enter");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(quantity).toHaveValue("350");
      await input.press("Escape");
    }
    await toggle.click();
    for (const invalid of ["286", "1.001"]) {
      await quantity.fill(invalid);
      await quantity.press("Enter");
      await expect(quantity).toHaveAttribute("aria-invalid", "true");
      await quantity.press("Escape");
      await expect(quantity).toHaveValue("1");
    }
    await toggle.click();
    await quantity.fill("100000");
    await quantity.press("Enter");
    await toggle.click();
    await expect(quantity).toHaveValue(language === "en" ? "285.71" : "285,71");
    await quantity.focus();
    await quantity.press("Tab");
    await toggle.click();
    await expect(quantity).toHaveValue("100000");
    expect(posts).toBe(1);
  });
}

test("single-unit foods expose fixed units and true zero nutrients are read-only", async ({
  page,
}) => {
  await page.goto("/");
  await chooseLanguage(page, "en");
  for (const [query, id, unit] of [
    ["chicken", 5, "g"],
    ["milk", 10, "ml"],
  ] as const) {
    await page
      .getByRole("combobox", { name: "Search", exact: true })
      .fill(query);
    await page.locator(`#food-suggestion-option-${id}`).click();
    await expect(
      page
        .locator("[data-selected-food-summary]")
        .locator("xpath=ancestor::*[@data-card-reveal]"),
    ).toHaveAttribute("data-card-reveal-state", "shown");
    await expect(page.locator("[data-nutrition-editor=quantity]")).toHaveValue(
      "100",
    );
    await expect(page.locator("[data-unit-toggle]")).toHaveCount(0);
    await expect(page.locator("[data-card-summary]").first()).toContainText(
      unit,
    );
    if (id === 5) {
      await expect(
        page.locator("[data-nutrition-editor=carbohydrate]"),
      ).toHaveCount(0);
      await expect(
        page.locator("[data-nutrition-readonly=carbohydrate]"),
      ).toHaveText("0");
    }
  }
});
