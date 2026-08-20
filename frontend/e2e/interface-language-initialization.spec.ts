import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack Interface Language initialization scenario (task 25;
 * ARCH-003, ARCH-012, ARCH-014, ARCH-022, REQ-056, ISSUE-006, ISSUE-007).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The optimized build resolves the initial Interface Language before the
 * first render: an exact valid `en` or `pl` value under the
 * `obiad.interfaceLanguage` localStorage key wins (ARCH-014); otherwise the
 * first supported primary language in `navigator.languages` order is chosen
 * case-insensitively with English as the default (ARCH-012, REQ-056).
 *
 * The scenarios observe Polish on `pl-PL`, English on `en-US` and `de-DE`,
 * the first supported primary language in an ordered multi-language list,
 * valid saved `en` and `pl` values overriding the browser, and missing or
 * invalid saved values invoking browser resolution (P06-G1, P06-G2). Each
 * scenario also proves the first rendered Search label and placeholder use
 * the resolved dictionary, that browser-derived initialization performs no
 * storage write, and that startup performs no application API request
 * (P06-G3). Task 26 added the Interface Language control, so every scenario
 * also asserts the localized named group with the two buttons in fixed
 * PL-then-EN order and the correct `aria-pressed` active state.
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

/** The persisted Interface Language key (ARCH-014, ISSUE-007). */
const STORAGE_KEY = "obiad.interfaceLanguage";

/** The exact ISSUE-007 copy of the two supported dictionaries. */
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

/**
 * Overrides `navigator.languages` before the application scripts run, so an
 * ordered multi-language list can be simulated deterministically.
 */
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

/** Seeds the persisted preference before the application scripts run. */
async function useStoredLanguage(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ([key, stored]) => {
      window.localStorage.setItem(key, stored);
    },
    [STORAGE_KEY, value] as const,
  );
}

/**
 * Loads the application and asserts the resolved dictionary on the first
 * rendered Search label and placeholder, the localized named Interface
 * Language group with its two buttons in fixed PL-then-EN order and the
 * correct `aria-pressed` active state (task 26), and the startup network
 * contract: no application API request, every request on the preview origin.
 */
async function assertInitialCopy(
  page: Page,
  language: "en" | "pl",
): Promise<void> {
  const expected = COPY[language];
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");

  // The first rendered Search label and placeholder use the resolved
  // dictionary (P06-G3).
  const input = page.locator('input[type="search"]');
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("placeholder", expected.placeholder);
  const label = page.locator("label");
  await expect(label).toHaveText(expected.label);
  await expect(input).toHaveAccessibleName(expected.label);

  // The localized named group contains the two real buttons in fixed
  // PL-then-EN order, with the active language pressed (task 26, ISSUE-007).
  const group = page.getByRole("group");
  await expect(group).toHaveAttribute("aria-label", expected.group);
  const buttons = page.locator("button");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveText("PL");
  await expect(buttons.nth(1)).toHaveText("EN");
  await expect(buttons.nth(0)).toHaveAttribute(
    "aria-pressed",
    language === "pl" ? "true" : "false",
  );
  await expect(buttons.nth(1)).toHaveAttribute(
    "aria-pressed",
    language === "en" ? "true" : "false",
  );

  // Startup performs no application API request; every request stays on the
  // preview origin (ARCH-016, P06-G3).
  expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
      PREVIEW_ORIGIN,
    );
  }
}

/** Asserts the current persisted value under the Interface Language key. */
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
    // Browser-derived initialization performs no storage write.
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
    // The invalid value is ignored without rewriting it (ISSUE-007).
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
