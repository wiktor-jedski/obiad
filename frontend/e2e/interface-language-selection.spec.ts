import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Real-stack Interface Language dropdown scenario.
 *
 * The optimized application runs over the disposable PostgreSQL, Fiber, and
 * Vite stack. These checks cover selection, persistence, native keyboard
 * interaction, the borderless language-and-chevron presentation, responsive
 * placement, Search geometry, and the absence of application API requests.
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const STORAGE_KEY = "obiad.interfaceLanguage";
const PRIMARY_RGB = "rgb(74, 222, 128)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";
const TRANSPARENT_RGBA = "rgba(0, 0, 0, 0)";
const MIN_TARGET_PX = 44;
const FIELD_HEIGHT_PX = 56;
const FIELD_MAX_WIDTH_PX = 640;
const VERTICAL_CENTER_DVH = 0.45;
const REVIEW_COPY_DIR = "/tmp/obiad-interface-language-dropdown";

const COPY = {
  en: {
    placeholder: "Search foods",
    control: "Interface language",
  },
  pl: {
    placeholder: "Szukaj potraw",
    control: "Język interfejsu",
  },
} as const;

const VIEWPORTS = [
  { name: "mobile-320x568", width: 320, height: 568, gutterPx: 16 },
  { name: "tablet-768x1024", width: 768, height: 1024, gutterPx: 24 },
  { name: "desktop-1280x720", width: 1280, height: 720, gutterPx: 32 },
] as const;

async function useBrowserLanguages(
  page: Page,
  languages: string[],
): Promise<void> {
  await page.addInitScript((values) => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => values,
    });
  }, languages);
}

async function expectStored(page: Page, value: string): Promise<void> {
  expect(
    await page.evaluate(([key]) => window.localStorage.getItem(key), [
      STORAGE_KEY,
    ] as const),
  ).toBe(value);
}

test.describe("Interface Language selection", () => {
  test("selecting PL and EN applies, persists, and survives conflicting browser locales", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    const searchInput = page.locator('input[type="search"]');
    let languageSelect = page.getByRole("combobox", {
      name: COPY.pl.control,
    });
    await expect(languageSelect).toHaveValue("pl");
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );

    await languageSelect.selectOption("en");
    languageSelect = page.getByRole("combobox", {
      name: COPY.en.control,
    });
    await expect(languageSelect).toHaveValue("en");
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.en.placeholder,
    );
    await expectStored(page, "en");

    await page.reload();
    languageSelect = page.getByRole("combobox", {
      name: COPY.en.control,
    });
    await expect(languageSelect).toHaveValue("en");
    await expectStored(page, "en");

    await languageSelect.selectOption("pl");
    languageSelect = page.getByRole("combobox", {
      name: COPY.pl.control,
    });
    await expect(languageSelect).toHaveValue("pl");
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );
    await expectStored(page, "pl");

    await useBrowserLanguages(page, ["en-US"]);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: COPY.pl.control }),
    ).toHaveValue("pl");
    await expectStored(page, "pl");

    expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
    for (const url of requestUrls) {
      expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
    }
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("changing language retains unfinished Search text and leaves focus on the dropdown", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    const searchInput = page.locator('input[type="search"]');
    const languageSelect = page.getByRole("combobox", {
      name: COPY.en.control,
    });

    // Task 27: a focused nonempty Search Query starts exactly one live
    // suggestion request, so the suggestion panel opens while the field is
    // focused (ARCH-010, REQ-012).
    await searchInput.fill("abc");
    await expect(page.getByRole("listbox")).toBeVisible();
    const requestsAfterTyping = requestUrls.length;

    // Moving focus to the language control closes the suggestion list
    // (REQ-059); the language change retains the unfinished text, leaves
    // focus on the dropdown, and starts no further application request
    // because the Search field is not focused.
    await languageSelect.focus();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await languageSelect.selectOption("pl");

    await expect(searchInput).toHaveValue("abc");
    await expect(
      page.getByRole("combobox", { name: COPY.pl.control }),
    ).toBeFocused();
    await expect(page.locator("button, [role='listbox'], ul, ol")).toHaveCount(
      0,
    );
    expect(
      requestUrls
        .slice(requestsAfterTyping)
        .some((url) => url.includes("/api/")),
    ).toBe(false);
  });
});

test.describe("Interface Language dropdown geometry and styles", () => {
  for (const viewport of VIEWPORTS) {
    test(`the borderless dropdown at ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await assertControlAtViewport(page, testInfo, viewport);
    });
  }
});

async function assertControlAtViewport(
  page: Page,
  testInfo: TestInfo,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  await useBrowserLanguages(page, ["en-US"]);
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/");

  const wrapper = page.locator("[data-interface-language]");
  const languageSelect = page.getByRole("combobox", {
    name: COPY.en.control,
  });
  const searchInput = page.locator('input[type="search"]');
  const chevron = wrapper.locator('[aria-hidden="true"]');

  await expect(wrapper).toBeVisible();
  await expect(languageSelect).toBeVisible();
  await expect(languageSelect).toHaveValue("en");
  await expect(languageSelect.locator("option")).toHaveCount(2);
  await expect(languageSelect.locator("option").nth(0)).toHaveText("PL");
  await expect(languageSelect.locator("option").nth(1)).toHaveText("EN");
  await expect(chevron).toHaveText("⌄");
  await expect(page.locator("button")).toHaveCount(0);

  const wrapperBox = (await wrapper.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(Math.abs(wrapperBox.y - viewport.gutterPx)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      viewport.width - (wrapperBox.x + wrapperBox.width) - viewport.gutterPx,
    ),
  ).toBeLessThanOrEqual(1);

  const selectBox = (await languageSelect.boundingBox()) as {
    width: number;
    height: number;
  };
  expect(selectBox.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(selectBox.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  await expect(languageSelect).toHaveCSS("border-top-width", "0px");
  await expect(languageSelect).toHaveCSS("border-right-width", "0px");
  await expect(languageSelect).toHaveCSS("border-bottom-width", "0px");
  await expect(languageSelect).toHaveCSS("border-left-width", "0px");
  await expect(languageSelect).toHaveCSS("background-color", TRANSPARENT_RGBA);
  await expect(languageSelect).toHaveCSS("color", TEXT_PRIMARY_RGB);

  await page.keyboard.press("Tab");
  await expect(searchInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(languageSelect).toBeFocused();
  expect(
    await languageSelect.evaluate((element) =>
      element.matches(":focus-visible"),
    ),
  ).toBe(true);
  await expect(languageSelect).toHaveCSS("outline-style", "solid");
  await expect(languageSelect).toHaveCSS("outline-width", "2px");
  await expect(languageSelect).toHaveCSS("outline-color", PRIMARY_RGB);
  await expect(languageSelect).toHaveCSS("outline-offset", "2px");

  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("combobox", { name: COPY.pl.control }),
  ).toHaveValue("pl");
  await expectStored(page, "pl");

  const searchBox = (await searchInput.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const expectedWidth = Math.min(
    viewport.width - 2 * viewport.gutterPx,
    FIELD_MAX_WIDTH_PX,
  );
  expect(Math.abs(searchBox.width - expectedWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBox.height - FIELD_HEIGHT_PX)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(searchBox.x + searchBox.width / 2 - viewport.width / 2),
  ).toBeLessThanOrEqual(1);
  const dvhHeight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.height = "100dvh";
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
  expect(
    Math.abs(
      searchBox.y + searchBox.height / 2 - VERTICAL_CENTER_DVH * dvhHeight,
    ),
  ).toBeLessThanOrEqual(1);

  const overflow = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(
    overflow.documentClientWidth,
  );
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
  expect(wrapperBox.x).toBeGreaterThanOrEqual(0);
  expect(wrapperBox.x + wrapperBox.width).toBeLessThanOrEqual(viewport.width);

  expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
  }

  const screenshotName = `interface-language-dropdown-${viewport.name}.png`;
  const screenshotPath = testInfo.outputPath(screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(screenshotName, {
    path: screenshotPath,
    contentType: "image/png",
  });
  const mirror = `${REVIEW_COPY_DIR}/${screenshotName}`;
  if (!existsSync(dirname(mirror))) {
    mkdirSync(dirname(mirror), { recursive: true });
  }
  cpSync(screenshotPath, mirror);
}
