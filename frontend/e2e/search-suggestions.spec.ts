import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack live Food Object suggestion scenario (task 27; ARCH-001,
 * ARCH-002, ARCH-008, ARCH-010, ARCH-019, ARCH-020, ARCH-022, REQ-001,
 * REQ-002, REQ-012, REQ-013, REQ-018, ISSUE-008; P07-G2, P07-G5, P07-G6,
 * P07-G7, P07-G20).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The scenario starts in a fresh unauthenticated browser context, observes
 * no startup application request, focuses the Search field and enters a
 * normal Search Query and `zzzzzz`, and sees exactly five distinct seeded
 * suggestions in English and Polish with the approved panel geometry and
 * colors, the baseline combobox/listbox semantics, and the first option's
 * stable id as the Search input's `aria-activedescendant`. It controls two
 * real-stack responses to prove that a superseded browser request is
 * aborted and its delayed response cannot change the latest list, and it
 * verifies that every food-data request stays on the Vite origin under
 * `/api`.
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

const FIELD_HEIGHT_PX = 56;
const FIELD_MAX_WIDTH_PX = 640;
const PANEL_OFFSET_PX = 8;
const ROW_HEIGHT_PX = 48;
const OPTION_COUNT = 5;

const SURFACE_RGB = "rgb(22, 29, 22)";
const SECONDARY_RGB = "rgb(134, 239, 172)";
const PRIMARY_RGB = "rgb(74, 222, 128)";
const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";

const COPY = {
  en: {
    search: "Search",
    placeholder: "Search foods",
    listbox: "Suggestions",
    languageControl: "Interface language",
  },
  pl: {
    search: "Szukaj",
    placeholder: "Szukaj potraw",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
  },
} as const;

/**
 * The deterministic seeded suggestion lists for the queries the scenario
 * drives (verified against the real Fiber process and the freshly seeded
 * PostgreSQL catalog; seed migration `0005_seed_food_catalog.sql`).
 * `foodObjectId` is the seeded stable ID and `name` is the localized name
 * the panel must render for the active Interface Language (REQ-013).
 */
const SEEDED_SUGGESTIONS = {
  en: {
    chicken: [
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 26, name: "Pancakes" },
      { foodObjectId: 18, name: "Butter" },
      { foodObjectId: 36, name: "Cheesecake" },
      { foodObjectId: 30, name: "Pho" },
    ],
    zzzzzz: [
      { foodObjectId: 13, name: "Gyoza" },
      { foodObjectId: 18, name: "Butter" },
      { foodObjectId: 16, name: "Gyros" },
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 10, name: "Milk" },
    ],
    pizza: [
      { foodObjectId: 13, name: "Gyoza" },
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 29, name: "Paella" },
      { foodObjectId: 30, name: "Pho" },
      { foodObjectId: 16, name: "Gyros" },
    ],
  },
  pl: {
    kurczak: [
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 36, name: "Sernik" },
      { foodObjectId: 38, name: "Gulasz" },
      { foodObjectId: 16, name: "Gyros" },
      { foodObjectId: 29, name: "Paella" },
    ],
    zzzzzz: [
      { foodObjectId: 38, name: "Gulasz" },
      { foodObjectId: 16, name: "Gyros" },
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 3, name: "Lazania" },
      { foodObjectId: 18, name: "Masło" },
    ],
  },
} as const;

/** The stable option DOM id of one suggestion (suggestions.ts). */
function optionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
}

/** Overrides `navigator.languages` before the application scripts run. */
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

/**
 * Asserts that the panel renders exactly the expected seeded suggestions in
 * the expected order with the approved geometry, colors, and baseline
 * combobox/listbox semantics: `OPTION_COUNT` `48px` rows in a panel that
 * matches the Search field's maximum `640px` width and starts `8px` below
 * it, Surface with a Secondary border, the first option with Primary and
 * Text-On-Bright, stable option ids, and the first option's stable id as
 * the Search input's `aria-activedescendant` (ISSUE-008, REQ-018).
 */
async function expectSuggestionPanel(
  page: Page,
  expected: readonly { foodObjectId: number; name: string }[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  const panel = page.getByRole("listbox", { name: copy.listbox });
  const options = panel.getByRole("option");

  await expect(panel).toBeVisible();
  await expect(options).toHaveCount(OPTION_COUNT);

  // Panel and row geometry (ISSUE-008).
  const searchBox = (await search.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const panelBox = (await panel.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(searchBox.height).toBe(FIELD_HEIGHT_PX);
  expect(panelBox.width).toBe(FIELD_MAX_WIDTH_PX);
  expect(
    Math.abs(panelBox.x - searchBox.x),
    "the panel horizontally matches the Search field",
  ).toBeLessThanOrEqual(1);
  expect(
    panelBox.y - (searchBox.y + searchBox.height),
    "the panel starts 8px below the Search field",
  ).toBe(PANEL_OFFSET_PX);
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    const rowBox = (await options.nth(index).boundingBox()) as {
      height: number;
      width: number;
    };
    expect(rowBox.height, `option ${index + 1} is 48px tall`).toBe(
      ROW_HEIGHT_PX,
    );
    // Rows fill the panel's content box: the 640px border-box panel carries
    // a 1px Secondary border on each side (ISSUE-008).
    expect(rowBox.width).toBe(FIELD_MAX_WIDTH_PX - 2);
  }

  // Resting and active colors (ISSUE-008, style.md).
  await expect(panel).toHaveCSS("background-color", SURFACE_RGB);
  await expect(panel).toHaveCSS("border-top-color", SECONDARY_RGB);
  await expect(panel).toHaveCSS("border-bottom-color", SECONDARY_RGB);
  await expect(options.nth(0)).toHaveCSS("background-color", PRIMARY_RGB);
  await expect(options.nth(0)).toHaveCSS("color", TEXT_ON_BRIGHT_RGB);
  await expect(options.nth(1)).toHaveCSS("color", TEXT_PRIMARY_RGB);

  // The exact seeded localized names in ranked order (REQ-002, REQ-013).
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveText(expected[index].name);
  }

  // Stable option ids; the first option is the active descendant (REQ-018).
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveAttribute(
      "id",
      optionId(expected[index].foodObjectId),
    );
  }
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    optionId(expected[0].foodObjectId),
  );
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect(search).toHaveAttribute(
    "aria-controls",
    "food-suggestions-listbox",
  );
}

/** Records every browser request and returns a predicate for food-data URLs. */
function trackRequests(
  page: Page,
  urls: string[],
): { foodDataRequests: () => string[] } {
  page.on("request", (request) => urls.push(request.url()));
  return {
    foodDataRequests: () => urls.filter((url) => url.includes("/api/")),
  };
}

test.describe("live Food Object suggestions", () => {
  test("a fresh unauthenticated context starts with no request and shows five seeded English suggestions for a normal query and zzzzzz", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    const { foodDataRequests } = trackRequests(page, requestUrls);

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");

    // P07-G2, REQ-001: fresh context, no authentication, no startup request.
    expect(foodDataRequests(), "no startup application request").toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe("");

    const search = page.getByRole("combobox", { name: COPY.en.search });
    await expect(search).toHaveAttribute("role", "combobox");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");

    // P07-G5: a normal Search Query shows exactly five suggestions.
    await search.fill("chicken");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);

    // P07-G5: `zzzzzz` also shows exactly five distinct suggestions.
    await search.fill("zzzzzz");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.zzzzzz, COPY.en);

    // The list closes when the field loses focus and the text remains; the
    // active-descendant must be absent for the closed list (ARCH-020).
    await search.blur();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("zzzzzz");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");

    // P07-G20, REQ-002: every food-data request stays on the Vite origin
    // under `/api`; none reaches Fiber or a third-party host.
    const foodData = foodDataRequests();
    expect(foodData.length).toBeGreaterThanOrEqual(2);
    for (const url of foodData) {
      expect(new URL(url).origin, `unexpected food-data origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
      expect(new URL(url).pathname).toMatch(/^\/api\//);
    }
    expect(requestUrls.some((url) => url.startsWith(FIBER_ORIGIN))).toBe(false);
  });

  test("Polish mode shows five seeded Polish suggestions for a normal query and zzzzzz", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.goto("/");

    // Switch through the real Interface Language control (task 26).
    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    const search = page.getByRole("combobox", { name: COPY.pl.search });
    await expect(search).toHaveAttribute("placeholder", COPY.pl.placeholder);

    // REQ-013: Polish mode compares and renders Polish names.
    await search.fill("kurczak");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl.kurczak, COPY.pl);

    await search.fill("zzzzzz");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl.zzzzzz, COPY.pl);
  });

  test("refocusing with the same Search Query starts a fresh request and never reuses the earlier response", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const suggestionRequestUrls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/food-suggestions")) {
        suggestionRequestUrls.push(request.url());
      }
    });

    // Hold only the second "chicken" request — the refocus intent — so the
    // scenario can prove the panel stays closed until that fresh response
    // returns (ARCH-019: no successful-response reuse; each intent starts a
    // real backend request).
    let chickenCount = 0;
    let releaseSecond: () => void = () => {};
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    await page.route("**/api/v1/food-suggestions*", async (route) => {
      const queryParam = new URL(route.request().url()).searchParams.get(
        "query",
      );
      if (queryParam === "chicken") {
        chickenCount += 1;
        if (chickenCount === 2) {
          await secondGate;
        }
      }
      await route.continue();
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    const panel = page.getByRole("listbox", { name: COPY.en.listbox });

    // First intent: focus and type a normal Search Query, then see the five
    // seeded suggestions from the real stack.
    await search.fill("chicken");
    await expect(panel).toBeVisible();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);

    // Blur closes the list and removes the inactive suggestion query.
    await search.blur();
    await expect(panel).toHaveCount(0);
    await expect(search).not.toHaveAttribute("aria-activedescendant");

    // Second intent: refocus with the same text. The fresh request is held,
    // so the earlier response must never appear: the panel stays closed
    // until the new request returns.
    await search.focus();
    await expect(panel).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(panel).toHaveCount(0);
    await expect(search).not.toHaveAttribute("aria-activedescendant");

    // Releasing the held response shows only the fresh intent's list.
    releaseSecond();
    await expect(panel).toBeVisible();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);

    // Exactly one request per intent — the refocus never reused the first
    // successful response (ARCH-019).
    expect(
      suggestionRequestUrls.filter((url) => url.includes("query=chicken")),
    ).toHaveLength(2);
  });

  test("a superseded suggestion request is aborted and its delayed response cannot change the latest list", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    const failedRequests: { url: string; error: string }[] = [];
    trackRequests(page, requestUrls);
    page.on("requestfailed", (request) =>
      failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? "unknown failure",
      }),
    );

    // Hold the first ("chicken") request so it stays in flight when the
    // second query supersedes it; every other request reaches the real
    // Fiber and PostgreSQL stack through the preview `/api` proxy.
    let sawFirst = false;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstSeen: () => void = () => {};
    const firstSeen = new Promise<void>((resolve) => {
      markFirstSeen = resolve;
    });
    await page.route("**/api/v1/food-suggestions*", async (route) => {
      const queryParam = new URL(route.request().url()).searchParams.get(
        "query",
      );
      if (queryParam === "chicken" && !sawFirst) {
        sawFirst = true;
        markFirstSeen();
        await firstGate;
        try {
          await route.continue();
        } catch {
          // The superseded request was already aborted by the browser, so
          // there is no response left to forward to it.
        }
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    await search.fill("chicken");
    await firstSeen;

    // Supersede the held request with a new Search Query.
    await search.fill("pizza");
    const panel = page.getByRole("listbox", { name: COPY.en.listbox });
    await expect(panel).toBeVisible();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.pizza, COPY.en);

    // P07-G20: the latest list matches the freshly seeded catalog and the
    // superseded browser request was aborted (ARCH-010, ARCH-019).
    await expect
      .poll(() => failedRequests.find((r) => r.url.includes("query=chicken")))
      .toBeTruthy();
    const aborted = failedRequests.find((r) =>
      r.url.includes("query=chicken"),
    ) as { url: string; error: string };
    expect(aborted.error).toContain("ERR_ABORTED");

    // Releasing the held (already aborted) response cannot change the list.
    releaseFirst();
    await page.waitForTimeout(400);
    await expect(panel.getByRole("option")).toHaveCount(OPTION_COUNT);
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.pizza, COPY.en);
  });
});
