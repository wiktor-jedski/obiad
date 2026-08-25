import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Real-stack Responsive accessible presentation scenario (task 52,
 * task 53; Phase 17; ARCH-001, ARCH-020, ARCH-022, REQ-062, REQ-063,
 * REQ-069, REQ-073; P17-G2, P17-G3, P17-G4, P17-G6).
 *
 * `bun run test:e2e` runs this file against the complete disposable stack
 * started by `./e2e/launcher.ts`: the optimized Vite preview on the strict
 * port 4173 proxies same-origin `/api` to the real Fiber process
 * (ISSUE-006, ARCH-022). The scenario completes the responsive layout
 * contract over task 51: the centered primary content column with the
 * `1280px` maximum width, the established responsive gutters, the Search
 * positions, the ranked card order, the card motion, and the focus
 * behavior all stay unchanged, and every normal and failure surface fits
 * without page-level horizontal clipping at every width of `320px` or
 * more (REQ-063).
 *
 * The "Responsive accessible presentation" describe (P17-G2, P17-G3,
 * P17-G4, P17-G6) runs on the normal stack with one test per ISSUE-006
 * viewport — `320×568`, `768×1024`, and `1280×720` (REQ-073). Each test
 * drives the complete primary flow through the empty, open-suggestion,
 * pending new-Search, completed result, invalid-quantity,
 * recalculation-loading, pending-MORE!, and completed later-page surfaces
 * and proves that `document` and `body` `scrollWidth` are never more than
 * their corresponding `clientWidth` or the viewport width (REQ-063). The
 * completed result and completed later-page surfaces also prove the
 * REQ-062 column contract: one ranked card column at `320` and `768` px
 * and three equal ranked card columns at `1280` px, with the ranked cards
 * in stable rank order in either layout. The Substitute Search POSTs are
 * gated through `page.route` so each pending surface is observable while
 * its real request is in flight — the same established real-stack gating
 * convention as `more-result-paging.spec.ts` and
 * `result-state.spec.ts` (ARCH-022). After every task 53 contrast change,
 * one final full-page PNG per viewport is attached as non-gating review
 * evidence (P17-G6, REQ-073) showing the required card columns, no
 * clipped content, and the final passing style.md tokens; the PNG is
 * mirrored outside the launcher-managed test-results directory like the
 * empty-shell scenario.
 *
 * The "Responsive presentation failure surfaces" describe runs serially
 * on the separate outage stack (ARCH-022): the launcher hands the
 * disposable outage PostgreSQL container name through
 * `OBIAD_E2E_OUTAGE_CONTAINER`, and this scenario prepares successful
 * English and Polish intermediate pages at all three viewports, stops
 * only that stack's PostgreSQL (the outage Fiber keeps reporting catalog
 * unavailability), and then reaches the retained `newSearchFailure`
 * (REQ-050) and `moreFailure` (REQ-051) surfaces at each viewport and
 * proves the same overflow limits (P17-G4, REQ-063).
 */

/** The English and Polish copy needed to drive the primary and failure flows. */
const COPY = {
  en: {
    language: "en",
    searchPlaceholder: "Search foods",
    secondQuery: "chicken",
  },
  pl: {
    language: "pl",
    searchPlaceholder: "Szukaj potraw",
    secondQuery: "kurczak",
  },
} as const;

/** The ISSUE-006 acceptance viewports of the Phase 17 gate (REQ-073). */
const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x720", width: 1280, height: 720 },
] as const;

/** The seeded Pizza Margherita suggestion (ID 1, 1 serving = 350 g). */
const PIZZA_FOOD_OBJECT_ID = 1;
/** The seeded Chicken breast suggestion (ID 5, 100 g, no Serving). */
const CHICKEN_FOOD_OBJECT_ID = 5;
/**
 * The three page-0 cards of the seeded Pizza Margherita search (ISSUE-002,
 * REQ-072): Gyoza (13), Paella (29), Pancakes (26) in rank order.
 */
const PIZZA_PAGE_0_IDS = [13, 29, 26] as const;
/**
 * The three page-1 cards of the seeded Pizza Margherita search (ISSUE-002,
 * REQ-072): Pho (30), Lasagna (3), Pastel de nata (35) in rank order —
 * the keyed MORE! replacement page over `PIZZA_PAGE_0_IDS` (REQ-053).
 */
const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

/** Where the review PNGs are mirrored so they survive the launcher cleanup. */
const REVIEW_COPY_DIR = "/tmp/obiad-task52-responsive-accessible-presentation";

/** One prepared outage page pair of one viewport and Interface Language. */
interface PreparedPage {
  label: string;
  newSearchPage: Page;
  moreFailurePage: Page;
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
 * Returns the Food Object IDs of all currently rendered result cards.
 */
async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

/**
 * P17-G4 (REQ-063): proves that the current surface fits the viewport
 * without page-level horizontal clipping. The `document` and `body`
 * `scrollWidth` values must not exceed their corresponding `clientWidth`
 * or the viewport width at any of the required viewports. The surface
 * label identifies the exact assertion site in failure output.
 */
async function expectNoHorizontalOverflow(
  page: Page,
  surface: string,
): Promise<void> {
  const overflow = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.documentScrollWidth,
    `${surface}: document scrollWidth`,
  ).toBeLessThanOrEqual(overflow.documentClientWidth);
  expect(
    overflow.documentScrollWidth,
    `${surface}: document scrollWidth`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
  expect(
    overflow.bodyScrollWidth,
    `${surface}: body scrollWidth`,
  ).toBeLessThanOrEqual(overflow.bodyClientWidth);
  expect(
    overflow.bodyScrollWidth,
    `${surface}: body scrollWidth`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
}

/**
 * P17-G3 (REQ-062): proves the card-column contract of the current
 * completed result page. From `320px` through `1023px` the ranked cards
 * render in exactly one column, stacked in rank order; from `1024px` the
 * same cards render in exactly three equal columns, laid out left to
 * right in rank order. The column tracks are read from the computed grid
 * and the rank order from the settled slot geometry, so the assertion
 * observes the real layout and not the source classes.
 */
async function expectCardColumns(
  page: Page,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  const expectedColumns = vp.width >= 1024 ? 3 : 1;
  const grid = page.locator("[data-result-grid]");
  const tracks = await grid.evaluate((element) =>
    getComputedStyle(element)
      .gridTemplateColumns.split(" ")
      .map((value) => parseFloat(value)),
  );
  expect(tracks, `${vp.name}: column count`).toHaveLength(expectedColumns);
  if (expectedColumns === 3) {
    // Three EQUAL columns: every computed track has the same width.
    expect(
      Math.abs(tracks[0] - tracks[1]),
      "equal column widths",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(tracks[1] - tracks[2]),
      "equal column widths",
    ).toBeLessThanOrEqual(1);
  }

  // The three ranked card slots occupy the columns in rank order.
  const slots = await page
    .locator("[data-result-card-slot]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width };
      }),
    );
  expect(slots, `${vp.name}: ranked card slots`).toHaveLength(3);
  if (expectedColumns === 1) {
    // One ranked card column: every slot shares the left edge and the
    // ranks stack downward in order.
    for (const slot of slots) {
      expect(
        Math.abs(slot.x - slots[0].x),
        `${vp.name}: one shared column`,
      ).toBeLessThanOrEqual(1);
    }
    expect(slots[0].y, "rank 0 above rank 1").toBeLessThan(slots[1].y);
    expect(slots[1].y, "rank 1 above rank 2").toBeLessThan(slots[2].y);
  } else {
    // Three equal ranked card columns: every slot shares the top edge and
    // the ranks run left to right in order, each as wide as one track.
    expect(
      Math.abs(slots[0].y - slots[1].y),
      `${vp.name}: shared row`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(slots[1].y - slots[2].y),
      `${vp.name}: shared row`,
    ).toBeLessThanOrEqual(1);
    expect(slots[0].x, "rank 0 left of rank 1").toBeLessThan(slots[1].x);
    expect(slots[1].x, "rank 1 left of rank 2").toBeLessThan(slots[2].x);
    for (const slot of slots) {
      expect(
        Math.abs(slot.width - tracks[0]),
        `${vp.name}: slot equals one column track`,
      ).toBeLessThanOrEqual(1);
    }
  }
}

/**
 * Gates the real Substitute Search POSTs of one page through `page.route`
 * (ARCH-022): the first POST (new Search), the second (valid quantity
 * recalculation), and the third (MORE!) are each held until the surface
 * that needs them observable has asserted itself, then released so the
 * real response completes the transition. Later POSTs pass through
 * untouched. This is the established real-stack gating convention of
 * `more-result-paging.spec.ts` and `result-state.spec.ts`; the responses
 * themselves are the real Fiber responses.
 */
async function gateSubstitutePosts(page: Page): Promise<{
  release: (postNumber: 1 | 2 | 3) => void;
}> {
  const gates: Record<number, { promise: Promise<void>; resolve: () => void }> =
    {
      1: Promise.withResolvers<void>(),
      2: Promise.withResolvers<void>(),
      3: Promise.withResolvers<void>(),
    };
  let postCount = 0;
  await page.route("**/api/v1/substitutes/search", async (route) => {
    postCount += 1;
    const gate = gates[postCount];
    if (gate !== undefined) {
      await gate.promise;
    }
    await route.continue();
  });
  return {
    release(postNumber: 1 | 2 | 3): void {
      gates[postNumber].resolve();
    },
  };
}

/**
 * Drives one pointer selection of the seeded Pizza Margherita suggestion
 * and waits for the three-card page-0 result.
 */
async function selectPizzaMargherita(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByPlaceholder(copy.searchPlaceholder);
  await search.fill("pizza");
  await expect(page.locator('[role="listbox"]')).toBeVisible();
  await page.locator(`#food-suggestion-option-${PIZZA_FOOD_OBJECT_ID}`).click();
  await expect(page.locator("[data-result-grid]")).toBeVisible();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

/**
 * Drives one Pizza Margherita selection followed by one successful MORE!
 * activation, so the page reaches the successful intermediate result page
 * 1 (ranks 4 through 6) with MORE! still present (task 42, REQ-051,
 * ISSUE-011).
 */
async function prepareSuccessfulIntermediatePage(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  await selectPizzaMargherita(page, copy);
  const moreButton = page.locator("[data-more-button]");
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(moreButton).toBeVisible();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");
}

/**
 * Types the second suggestion query and waits for its open suggestion
 * option without selecting it, so the prepared suggestion is ready before
 * the outage begins.
 */
async function prepareSecondSuggestion(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(copy.secondQuery);
  const option = page.locator(
    `#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`,
  );
  await expect(option).toBeVisible();
  await expect(searchInput).toBeFocused();
}

/**
 * Stops only the outage stack's PostgreSQL container and waits until the
 * outage Fiber's `GET /health` stops reporting ready, proving that catalog
 * requests now fail while the Fiber process itself stays up.
 */
async function stopOutagePostgresAndWait(): Promise<void> {
  const containerName = process.env.OBIAD_E2E_OUTAGE_CONTAINER;
  if (containerName === undefined || containerName === "") {
    throw new Error(
      "OBIAD_E2E_OUTAGE_CONTAINER is not set; run through the e2e launcher outage suite",
    );
  }
  execFileSync("docker", ["stop", containerName], {
    timeout: 30_000,
    stdio: "pipe",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health", {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 503) {
        return;
      }
    } catch {
      // Transient probe failure; keep polling until the deadline.
    }
    const { promise: sleep, resolve: wake } = Promise.withResolvers<void>();
    setTimeout(wake, 250);
    await sleep;
  }
  throw new Error(
    "the outage Fiber did not report catalog unavailability after its PostgreSQL stopped",
  );
}

/**
 * Completes the full primary flow of one viewport and proves the REQ-062
 * column contract and the REQ-063 overflow limits at every required
 * surface (P17-G2, P17-G3, P17-G4). The eight surfaces in order are the
 * empty state, the open suggestion panel, the pending new Search, the
 * completed result page, the invalid-quantity error, the pending valid
 * recalculation, the pending MORE! page, and the completed later page.
 */
async function runPrimaryFlow(
  page: Page,
  testInfo: TestInfo,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");
  const main = page.locator("main");
  await expect(main).toHaveAttribute("data-interaction-state", "empty");

  // Surface 1: the empty state.
  await expectNoHorizontalOverflow(page, `${vp.name} empty`);

  const posts = await gateSubstitutePosts(page);

  // Surface 2: the open suggestion panel.
  const search = page.getByPlaceholder(COPY.en.searchPlaceholder);
  await search.fill("pizza");
  await expect(page.locator('[role="listbox"]')).toBeVisible();
  await expectNoHorizontalOverflow(page, `${vp.name} open-suggestion`);

  // Surface 3: the pending new Search. The selection commits page 0 and
  // the summary spinner renders while the gated first POST is in flight.
  await page.locator(`#food-suggestion-option-${PIZZA_FOOD_OBJECT_ID}`).click();
  await expect(main).toHaveAttribute("data-interaction-state", "loadingNew");
  await expect(page.locator("[data-card-spinner]").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, `${vp.name} pending new-Search`);
  posts.release(1);
  await expect(main).toHaveAttribute("data-interaction-state", "results");
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_0_IDS]);

  // Surface 4: the completed result page.
  await expectCardColumns(page, vp);
  await expectNoHorizontalOverflow(page, `${vp.name} completed result`);

  // Surface 5: the invalid-quantity error keeps the exact raw text visible
  // and starts no request.
  const number = page.locator("[data-quantity-number]");
  await number.fill("abc");
  await number.press("Enter");
  await expect(page.locator("[data-quantity-error]")).toBeVisible();
  await expectNoHorizontalOverflow(page, `${vp.name} invalid-quantity`);

  // Surface 6: the pending valid recalculation. The committed quantity
  // changes, the retained page stays as placeholder data, and the summary
  // and card spinners render while the gated second POST is in flight.
  await number.fill("200");
  await number.press("Enter");
  await expect(main).toHaveAttribute("data-interaction-state", "results");
  await expect(page.locator("[data-card-spinner]").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, `${vp.name} recalculation-loading`);
  posts.release(2);
  await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
  await expectNoHorizontalOverflow(
    page,
    `${vp.name} completed recalculated result`,
  );

  // Surface 7: the pending MORE! page keeps the retained cards and the
  // gray aria-disabled control while the gated third POST is in flight.
  const moreButton = page.locator("[data-more-button]");
  await moreButton.click();
  await expect(main).toHaveAttribute("data-interaction-state", "loadingMore");
  await expect(moreButton).toHaveAttribute("aria-disabled", "true");
  await expectNoHorizontalOverflow(page, `${vp.name} pending-MORE!`);
  posts.release(3);
  await expect(main).toHaveAttribute("data-interaction-state", "results");
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_1_IDS]);

  // record one final full-page PNG per viewport as non-gating review
  // evidence (P17-G6, REQ-073): the attachment shows the required card
  // columns, no clipped content, and the final passing style.md tokens
  // after every task 53 contrast change.
  // record one full-page PNG per viewport as non-gating review evidence.
  await page.waitForTimeout(800);
  await expectCardColumns(page, vp);
  await expectNoHorizontalOverflow(page, `${vp.name} completed later-page`);

  const screenshotName = `responsive-accessible-presentation-${vp.name}.png`;
  const screenshotPath = testInfo.outputPath(screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(screenshotName, {
    path: screenshotPath,
    contentType: "image/png",
  });

  // Mirror the PNG outside the launcher-managed test-results so the exact
  // review attachments survive the launcher's cleanup for inspection.
  const mirror = `${REVIEW_COPY_DIR}/${screenshotName}`;
  if (!existsSync(dirname(mirror))) {
    mkdirSync(dirname(mirror), { recursive: true });
  }
  cpSync(screenshotPath, mirror);
  console.log(
    `[responsive-accessible-presentation] review attachment ${screenshotName}: ${screenshotPath} (mirrored to ${mirror})`,
  );
}

test.describe("Responsive accessible presentation", () => {
  for (const vp of VIEWPORTS) {
    test(`the primary flow fits at ${vp.name} with ${vp.width >= 1024 ? "three equal" : "one"} ranked card column and no page-level horizontal overflow across every surface (P17-G2, P17-G3, P17-G4, REQ-062, REQ-063, REQ-073)`, async ({
      page,
    }, testInfo) => {
      await useBrowserLanguages(page, ["en-US"]);
      await runPrimaryFlow(page, testInfo, vp);
    });
  }
});

test.describe("Responsive presentation failure surfaces", () => {
  /**
   * The outage-stack failure scenario (P17-G4, REQ-063): it prepares
   * successful English and Polish intermediate result pages at all three
   * viewports while the outage stack is healthy, stops only the outage
   * stack's PostgreSQL container, and then resizes each retained
   * new-Search and MORE! failure surface — English and Polish — to the
   * same three widths and proves the same overflow limits (REQ-050,
   * REQ-051, REQ-063). The launcher runs this describe serially on its own
   * separate outage stack through the `Responsive presentation failure
   * surfaces` OUTAGE_SUITES entry and excludes it from the normal-stack
   * run (ARCH-022).
   */
  test("after the outage, each retained new-Search and MORE! failure surface fits at 320x568, 768x1024, and 1280x720 without page-level horizontal overflow in English and Polish (P17-G4, REQ-063)", async ({
    browser,
  }) => {
    const prepared: PreparedPage[] = [];

    for (const vp of VIEWPORTS) {
      for (const copy of [COPY.en, COPY.pl] as const) {
        const context = await browser.newContext({
          baseURL: "http://127.0.0.1:4173",
          viewport: { width: vp.width, height: vp.height },
        });
        const newSearchPage = await context.newPage();
        await useBrowserLanguages(newSearchPage, [copy.language]);
        await newSearchPage.goto("/");
        await prepareSuccessfulIntermediatePage(newSearchPage, copy);
        await prepareSecondSuggestion(newSearchPage, copy);
        const moreFailurePage = await context.newPage();
        await useBrowserLanguages(moreFailurePage, [copy.language]);
        await moreFailurePage.goto("/");
        await prepareSuccessfulIntermediatePage(moreFailurePage, copy);
        prepared.push({
          label: `${vp.name} ${copy.language}`,
          newSearchPage,
          moreFailurePage,
        });
      }
    }

    // Stop only the outage stack's PostgreSQL process.
    await stopOutagePostgresAndWait();

    for (const entry of prepared) {
      // The retained new-Search failure surface (REQ-050): the prepared
      // suggestion selection fails, the exact Substitution Input and
      // Search focus stay retained, and the surface fits the viewport.
      await entry.newSearchPage
        .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
        .click();
      await expect(entry.newSearchPage.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "newSearchFailure",
      );
      await expect(
        entry.newSearchPage.locator("[data-retry-message]"),
      ).toBeVisible();
      await expectNoHorizontalOverflow(
        entry.newSearchPage,
        `${entry.label} newSearchFailure`,
      );

      // The retained MORE! failure surface (REQ-051): the MORE! activation
      // fails, the current page's cards and the operable control stay
      // retained, and the surface fits the viewport.
      await entry.moreFailurePage.locator("[data-more-button]").click();
      await expect(entry.moreFailurePage.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "moreFailure",
      );
      await expect(
        entry.moreFailurePage.locator("[data-retry-message]"),
      ).toBeVisible();
      await expect(
        entry.moreFailurePage.locator("[data-result-card]"),
      ).toHaveCount(3);
      await expectNoHorizontalOverflow(
        entry.moreFailurePage,
        `${entry.label} moreFailure`,
      );
    }

    for (const entry of prepared) {
      await entry.newSearchPage.context().close();
    }
  });
});
