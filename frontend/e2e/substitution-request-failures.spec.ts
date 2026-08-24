import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack Substitution request-failure scenario (task 41, task 42;
 * ARCH-001, ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-019, ARCH-020,
 * ARCH-022, REQ-050, REQ-051, ISSUE-013; P13-G1, P13-G2).
 *
 * This scenario runs serially on the separate outage stack behind `bun run
 * test:e2e` (ARCH-022): the launcher hands the fixed loopback Fiber
 * listener to a second Fiber process backed by its own disposable
 * PostgreSQL container, runs only this spec against it, and never touches
 * the normal stack's PostgreSQL, credentials, or preview. The outage
 * container name reaches the spec through `OBIAD_E2E_OUTAGE_CONTAINER`.
 *
 * It verifies the failed new-Search slice over task 40 and the failed
 * MORE! slice over task 41:
 * - One English page and one Polish page prepare successful browser state
 *   — three result cards for a first suggestion and an open suggestion
 *   panel holding a second suggestion — before the outage begins.
 * - Two further English and Polish pages prepare a successful
 *   intermediate result page — page 0 followed by one successful MORE!
 *   activation reaching page 1 with MORE! still present — before the
 *   outage begins.
 * - Stopping only the outage stack's PostgreSQL process makes the outage
 *   Fiber report catalog unavailability (`GET /health` stops returning
 *   ready) while the Fiber process itself stays up.
 * - Selecting the prepared suggestion on the first pair produces exactly
 *   one current generated-client `POST /api/v1/substitutes/search` and
 *   one closed `503 CATALOG_UNAVAILABLE` response without `field`; no
 *   second POST starts automatically (ARCH-019: no retry, no queued
 *   intent, no successful-response reuse). Each page reaches the
 *   `newSearchFailure` interaction transition, keeps the exact newly
 *   selected Substitution Input (name and committed 100 g quantity), the
 *   exact returned Search text, and Search focus, renders zero result
 *   cards and no MORE!, removes every pending spinner, makes the related
 *   controls operable after the request ends, and shows and announces the
 *   exact ISSUE-013 retry message
 *   (`Could not load substitutions. Try again.` / `Nie udało się wczytać
 *   zamienników. Spróbuj ponownie.`) in one atomic polite status region
 *   (`role="status"`), with no duplicate visually hidden message and no
 *   programmatic focus movement (REQ-050, ISSUE-013).
 * - Activating MORE! on the second pair produces exactly one current
 *   next-page `POST` (pageIndex 2) and one closed `503
 *   CATALOG_UNAVAILABLE` response without `field`; no automatic retry or
 *   second POST follows. Each page reaches the `moreFailure` interaction
 *   transition, keeps the exact Substitution Input, the displayed page
 *   index and the current page's ordered card IDs and content in TanStack
 *   Query, the MORE! control, and its natural focus, removes the pending
 *   presentation, restores the control's operable state, and shows and
 *   announces the exact ISSUE-013 retry message in the active Interface
 *   Language. A deliberate manual re-activation of the retained MORE!
 *   control produces exactly one further `POST` with the same failed next
 *   page index (pageIndex 2) — no skip — fails again with the same closed
 *   `503`, and the page retains the same cards and failure state with no
 *   third request (REQ-051, ISSUE-013).
 */

const COPY = {
  en: {
    language: "en",
    searchPlaceholder: "Search foods",
    retryMessage: "Could not load substitutions. Try again.",
    chickenName: "Chicken breast",
    pizzaName: "Pizza Margherita",
  },
  pl: {
    language: "pl",
    searchPlaceholder: "Szukaj potraw",
    retryMessage: "Nie udało się wczytać zamienników. Spróbuj ponownie.",
    chickenName: "Pierś z kurczaka",
    pizzaName: "Pizza margherita",
  },
} as const;

/** The seeded Pizza Margherita suggestion (ID 1, 1 serving = 350 g). */
const PIZZA_FOOD_OBJECT_ID = 1;
/** The seeded Chicken breast suggestion (ID 5, 100 g, no Serving). */
const CHICKEN_FOOD_OBJECT_ID = 5;
/**
 * The seeded Pizza Margherita page-1 ranking (ISSUE-002, REQ-072): the
 * successful intermediate result page this scenario prepares before the
 * outage, so the failed MORE! request targets page 2 while page 1's
 * ordered cards must stay retained.
 */
const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

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

/** One observed generated-client Substitution Search POST. */
interface SubstitutePost {
  body: {
    foodObjectId?: number;
    quantity?: { value: number; unit: string };
    pageIndex?: number;
  };
  status: number | null;
  responseBody: unknown;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * with the status and parsed body of its real-stack response.
 */
function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        body: request.postDataJSON() as SubstitutePost["body"],
        status: null,
        responseBody: undefined,
      });
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
        void response
          .json()
          .then((body: unknown) => {
            post.responseBody = body;
          })
          .catch(() => {
            post.responseBody = undefined;
          });
      }
    }
  });
  return posts;
}

/**
 * Drives one pointer selection of the successful preparation suggestion and
 * waits for the three-card result page.
 */
async function prepareSuccessfulCards(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(query);
  const option = page.locator(`#food-suggestion-option-${foodObjectId}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator("[data-result-grid]")).toBeVisible();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

/**
 * Types the second suggestion query and waits for its open suggestion
 * option without selecting it, so the prepared suggestion is ready before
 * the outage begins.
 */
async function prepareSecondSuggestion(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(query);
  const option = page.locator(`#food-suggestion-option-${foodObjectId}`);
  await expect(option).toBeVisible();
  // Search keeps focus on the prepared suggestion so a later selection is a
  // pointer activation of the exact prepared option (REQ-020).
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

/** Asserts the complete new-Search failure surface on one page. */
async function expectNewSearchFailure(
  page: Page,
  posts: SubstitutePost[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);

  // Exactly one current Substitute POST and one closed 503
  // CATALOG_UNAVAILABLE response without `field`; no automatic retry.
  await expect.poll(() => posts.length).toBe(2);
  await expect.poll(() => posts[1]?.status).toBe(503);
  await expect.poll(() => posts[1]?.responseBody).toBeDefined();
  const body = posts[1]?.responseBody as Record<string, unknown> | undefined;
  expect(body?.code).toBe("CATALOG_UNAVAILABLE");
  expect("field" in (body ?? {})).toBe(false);
  expect(posts[0]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 0,
  });
  expect(posts[1]?.body).toEqual({
    foodObjectId: CHICKEN_FOOD_OBJECT_ID,
    quantity: { value: 100, unit: "g" },
    pageIndex: 0,
  });

  // The page reaches the newSearchFailure interaction transition.
  const state = page.locator("[data-interaction-state]");
  await expect(state).toHaveAttribute(
    "data-interaction-state",
    "newSearchFailure",
  );

  // Search text keeps the exact returned active-language name, and Search
  // keeps focus (no programmatic focus movement after a failure).
  await expect(searchInput).toHaveValue(copy.chickenName);
  await expect(searchInput).toBeFocused();

  // The selected Substitution Input keeps the exact newly selected Food
  // Object: the localized name and the committed 100 g quantity.
  await expect(page.locator("[data-selected-name]")).toHaveText(
    copy.chickenName,
  );
  await expect(page.locator("[data-quantity-number]")).toHaveValue("100");
  await expect(page.locator("[data-quantity-static-unit]")).toHaveText("g");

  // Result cards and MORE! are cleared from the rendered state.
  await expect(page.locator("[data-result-card]")).toHaveCount(0);
  await expect(page.locator("[data-more-button]")).toHaveCount(0);

  // Every pending spinner ends.
  await expect(page.locator("[data-card-spinner]")).toHaveCount(0);

  // The exact ISSUE-013 retry message renders visibly in one atomic polite
  // status region and is the only failure announcement: no duplicate
  // visually hidden message exists.
  const retryMessage = page.locator("[data-retry-message]");
  await expect(retryMessage).toBeVisible();
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(copy.retryMessage)).toHaveCount(1);

  // The related controls become operable after the request ends: the
  // quantity editor is enabled and a fresh suggestion selection works.
  await expect(page.locator("[data-quantity-number]")).toBeEnabled();
  await expect(page.locator("[data-quantity-unit]")).toHaveCount(0);

  // No second POST starts automatically after the terminal failure.
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(2);
}

/**
 * Drives one Pizza Margherita selection followed by one successful MORE!
 * activation, so the page reaches the successful intermediate result page
 * 1 (ranks 4 through 6) with MORE! still present before the outage begins
 * (task 42, REQ-051, ISSUE-011).
 */
async function prepareSuccessfulIntermediatePage(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  await prepareSuccessfulCards(page, "margherita", PIZZA_FOOD_OBJECT_ID, copy);
  const moreButton = page.locator("[data-more-button]");
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(moreButton).toBeVisible();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");
}

/** Returns the Food Object IDs of all currently rendered result cards. */
async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

/** Asserts the complete MORE! failure surface on one page. */
async function expectMoreFailure(
  page: Page,
  posts: SubstitutePost[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const moreButton = page.locator("[data-more-button]");
  const retryMessage = page.locator("[data-retry-message]");

  // Activating MORE! produces exactly one current next-page POST with the
  // unchanged Substitution Input and pageIndex 2, and one closed 503
  // CATALOG_UNAVAILABLE response without `field`; no automatic retry.
  await moreButton.click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[0]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 0,
  });
  expect(posts[1]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 1,
  });
  expect(posts[2]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 2,
  });
  await expect.poll(() => posts[2]?.status).toBe(503);
  await expect.poll(() => posts[2]?.responseBody).toBeDefined();
  const body = posts[2]?.responseBody as Record<string, unknown> | undefined;
  expect(body?.code).toBe("CATALOG_UNAVAILABLE");
  expect("field" in (body ?? {})).toBe(false);

  // The page reaches the moreFailure interaction transition.
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "moreFailure",
  );

  // The exact Substitution Input is retained: the selected Food Object
  // name and the committed 1 serving quantity.
  await expect(page.locator("[data-selected-name]")).toHaveText(copy.pizzaName);
  await expect(page.locator("[data-quantity-number]")).toHaveValue("1");
  await expect(page.locator("[data-quantity-unit]")).toHaveValue("serving");

  // The displayed page index and the current page's ordered card IDs and
  // content stay retained from the successful page-1 response.
  const page1Response = posts[1]?.responseBody as
    | {
        pageIndex: number;
        items?: Array<{
          foodObjectId: number;
          names: { en: string; pl: string };
        }>;
      }
    | undefined;
  expect(page1Response?.pageIndex).toBe(1);
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
  const firstCardName = await page
    .locator("[data-result-card] h3")
    .first()
    .textContent();
  expect(firstCardName).toBe(page1Response?.items?.[0]?.names[copy.language]);

  // The retained MORE! control keeps its natural focus, removes the
  // pending presentation, and becomes operable again.
  await expect(moreButton).toBeFocused();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");

  // The exact ISSUE-013 retry message renders visibly in one atomic polite
  // status region and is the only failure announcement.
  await expect(retryMessage).toBeVisible();
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(copy.retryMessage)).toHaveCount(1);

  // No automatic retry or second POST follows the terminal failure.
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(3);

  // A deliberate manual re-activation of the retained MORE! control
  // requests the same failed next page (pageIndex 2) without skipping one;
  // the second failure retains the same cards, control, and failure state,
  // and no third request follows.
  await moreButton.click();
  await expect.poll(() => posts.length).toBe(4);
  expect(posts[3]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 2,
  });
  await expect.poll(() => posts[3]?.status).toBe(503);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "moreFailure",
  );
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(moreButton).toBeFocused();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(4);
}

test.describe("Substitution request failures", () => {
  test("a new Search and a MORE! request fail after only the outage stack's PostgreSQL stops: each prepared English and Polish page keeps its retained state, control state, and focus, ends every pending spinner, releases the lock, and shows and announces the exact ISSUE-013 retry message with exactly one closed 503 CATALOG_UNAVAILABLE response per activation and no automatic retry (P13-G1, P13-G2, REQ-050, REQ-051)", async ({
    browser,
  }) => {
    const englishContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const polishContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const englishPage = await englishContext.newPage();
    const polishPage = await polishContext.newPage();
    await useBrowserLanguages(englishPage, ["en-US"]);
    await useBrowserLanguages(polishPage, ["pl-PL"]);
    const englishPosts = trackSubstitutePosts(englishPage);
    const polishPosts = trackSubstitutePosts(polishPage);

    // A second page pair prepares successful intermediate result pages for
    // the MORE! failure slice (task 42, REQ-051).
    const englishMorePage = await englishContext.newPage();
    const polishMorePage = await polishContext.newPage();
    await useBrowserLanguages(englishMorePage, ["en-US"]);
    await useBrowserLanguages(polishMorePage, ["pl-PL"]);
    const englishMorePosts = trackSubstitutePosts(englishMorePage);
    const polishMorePosts = trackSubstitutePosts(polishMorePage);

    await englishPage.goto("/");
    await polishPage.goto("/");
    await englishMorePage.goto("/");
    await polishMorePage.goto("/");

    // Prepare successful English and Polish pages with three result cards
    // and a second suggestion before the outage begins.
    await prepareSuccessfulCards(
      englishPage,
      "margherita",
      PIZZA_FOOD_OBJECT_ID,
      COPY.en,
    );
    await prepareSecondSuggestion(
      englishPage,
      "chicken",
      CHICKEN_FOOD_OBJECT_ID,
      COPY.en,
    );
    await prepareSuccessfulCards(
      polishPage,
      "margherita",
      PIZZA_FOOD_OBJECT_ID,
      COPY.pl,
    );
    await prepareSecondSuggestion(
      polishPage,
      "kurczak",
      CHICKEN_FOOD_OBJECT_ID,
      COPY.pl,
    );

    // Prepare successful English and Polish intermediate result pages
    // (page 1 with MORE! still present) for the MORE! failure slice.
    await prepareSuccessfulIntermediatePage(englishMorePage, COPY.en);
    await prepareSuccessfulIntermediatePage(polishMorePage, COPY.pl);

    // Stop only the outage stack's PostgreSQL process.
    await stopOutagePostgresAndWait();

    // Selecting the prepared suggestion on each page produces exactly one
    // current Substitute POST and one closed 503 CATALOG_UNAVAILABLE
    // response without `field`; no second POST starts automatically.
    await englishPage
      .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
      .click();
    await expectNewSearchFailure(englishPage, englishPosts, COPY.en);

    await polishPage
      .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
      .click();
    await expectNewSearchFailure(polishPage, polishPosts, COPY.pl);

    // Activating MORE! on each intermediate page produces exactly one
    // current next-page POST and one closed 503 CATALOG_UNAVAILABLE
    // response without `field`; no automatic retry follows, the retained
    // cards, input, page index, and MORE! control stay, and a manual
    // re-activation requests the same failed next page without a skip.
    await expectMoreFailure(englishMorePage, englishMorePosts, COPY.en);
    await expectMoreFailure(polishMorePage, polishMorePosts, COPY.pl);

    await englishContext.close();
    await polishContext.close();
  });
});
