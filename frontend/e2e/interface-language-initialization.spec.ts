import { expect, test, type Page } from "@playwright/test";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

const STORAGE_KEY = "obiad.interfaceLanguage";

const COPY = {
  en: {
    label: "Search",
    placeholder: "Search foods",
    group: "Interface language",
  },
  pl: {
    label: "Szukaj",
    placeholder: "Szukaj potraw",
    group: "Język interfejsu",
  },
} as const;

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

async function useStoredLanguage(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ([key, stored]) => {
      window.localStorage.setItem(key, stored);
    },
    [STORAGE_KEY, value] as const,
  );
}

async function assertInitialCopy(
  page: Page,
  language: "en" | "pl",
): Promise<void> {
  const expected = COPY[language];
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");

  const input = page.locator('input[type="search"]');
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("placeholder", expected.placeholder);
  const label = page.locator("label");
  await expect(label).toHaveText(expected.label);
  await expect(input).toHaveAccessibleName(expected.label);

  const languageSelect = page.getByRole("combobox", {
    name: expected.group,
  });
  await expect(languageSelect).toHaveValue(language);
  const options = languageSelect.locator("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveText("PL");
  await expect(options.nth(0)).toHaveAttribute("value", "pl");
  await expect(options.nth(1)).toHaveText("EN");
  await expect(options.nth(1)).toHaveAttribute("value", "en");

  expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
      PREVIEW_ORIGIN,
    );
  }
}

async function expectStored(page: Page, value: string | null): Promise<void> {
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).toBe(value);
}

test.describe("browser-derived Interface Language initialization", () => {
  test("renders Polish on pl-PL", async ({ page }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    await assertInitialCopy(page, "pl");

    await expectStored(page, null);
  });

  test("renders English on en-US", async ({ page }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await assertInitialCopy(page, "en");
    await expectStored(page, null);
  });

  test("renders English on de-DE", async ({ page }) => {
    await useBrowserLanguages(page, ["de-DE"]);
    await assertInitialCopy(page, "en");
    await expectStored(page, null);
  });

  test("uses the first supported primary language in an ordered multi-language list", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["de-DE", "pl-PL"]);
    await assertInitialCopy(page, "pl");
    await expectStored(page, null);
  });

  test("falls back to English when no browser language is supported", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["fr-FR", "de-DE"]);
    await assertInitialCopy(page, "en");
    await expectStored(page, null);
  });

  test("matches a supported primary language case-insensitively", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["PL-pl", "en-US"]);
    await assertInitialCopy(page, "pl");
    await expectStored(page, null);
  });
});

test.describe("persisted Interface Language preference", () => {
  test("a valid saved pl value overrides the browser languages", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await useStoredLanguage(page, "pl");
    await assertInitialCopy(page, "pl");
    await expectStored(page, "pl");
  });

  test("a valid saved en value overrides the browser languages", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    await useStoredLanguage(page, "en");
    await assertInitialCopy(page, "en");
    await expectStored(page, "en");
  });
});

test.describe("missing and invalid saved values", () => {
  test("a missing saved value invokes browser resolution", async ({ page }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    await assertInitialCopy(page, "pl");
    await expectStored(page, null);
  });

  test("an invalid saved value invokes browser resolution and is not rewritten", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    await useStoredLanguage(page, "fr");
    await assertInitialCopy(page, "pl");

    await expectStored(page, "fr");
  });

  test("a non-exact saved value invokes browser resolution and is not rewritten", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    await useStoredLanguage(page, "PL");
    await assertInitialCopy(page, "pl");
    await expectStored(page, "PL");
  });
});
