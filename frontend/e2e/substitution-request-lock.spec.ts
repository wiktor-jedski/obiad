import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

/**
 * Real-stack Substitution request-lock scenario (task 39; ARCH-001,
 * ARCH-002, ARCH-003, ARCH-008, ARCH-010, ARCH-011, ARCH-019, ARCH-020,
 * ARCH-022, REQ-048, ISSUE-010, ISSUE-011, ISSUE-012; P12-G1, P12-G2).
 *
 * This scenario runs against the self-cleaning real stack behind `bun run
 * test:e2e`: disposable loopback PostgreSQL 17, fixed Fiber at
 * `127.0.0.1:8080`, and the strict-port optimized Vite preview at
 * `http://127.0.0.1:4173` (ISSUE-006, ISSUE-012).
 *
 * It verifies that:
 * - New Search, valid Food Quantity recalculation, and MORE! paging share
 *   one browser-wide Substitution Search intent lock owned by TanStack Query (ARCH-019).
 * - While any Substitution Search request is held at the browser boundary
 *   (P12-G1):
 *   - The initiating control preserves its established focus behavior
 *     (Search field for new Search, quantity editor for recalculation,
 *     MORE! for next-page paging).
 *   - Every visible suggestion-selection, quantity-number, quantity-unit,
 *     and MORE! action becomes accessibly non-operable and exposes its
 *     disabled state (`toBeDisabled()` / `aria-disabled="true"`).
 *   - Multiple activations across pointer, keyboard, blur, and dispatched
 *     events are discarded and submit no additional request (REQ-048, P12-G2).
 *   - Releasing the gate resolves the active request and produces no
 *     queued POST.
 *   - Search Query editing and suggestion GET requests continue in their
 *     independent latest-query lane, stale responses do not render, and
 *     selecting an option becomes operable only after the lock ends.
 */

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    moreButton: "MORE!",
    quantityLabel: "Quantity",
    unitLabel: "Unit",
    servings: "servings",
    loadingNutritionValues: "Loading nutrition values",
    updatingQuantities: "Updating quantities",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    moreButton: "WIĘCEJ!",
    quantityLabel: "Ilość",
    unitLabel: "Jednostka",
    servings: "porcje",
    loadingNutritionValues: "Ładowanie wartości odżywczych",
    updatingQuantities: "Aktualizowanie ilości",
  },
} as const;

/** Gray background of a pending non-operable MORE! control (REQ-082). */
const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";
/** Gray text of a pending non-operable MORE! control (REQ-082). */
const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";

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
  body: SubstituteSearchRequest;
  status: number | null;
}

/** One observed Food Suggestions GET request. */
interface SuggestionGet {
  url: string;
  status: number | null;
}

/** Requests observed while the application owns the substitution lock. */
interface RequestLog {
  posts: SubstitutePost[];
  suggestionGets: SuggestionGet[];
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * and every `GET /api/v1/food-suggestions` request.
 */
function trackRequests(page: Page): RequestLog {
  const posts: SubstitutePost[] = [];
  const suggestionGets: SuggestionGet[] = [];

  page.on("request", (request) => {
    const url = request.url();
    if (
      request.method() === "POST" &&
      url.includes("/api/v1/substitutes/search")
    ) {
      // SAFETY: This branch only handles the generated client's substitute-search route, whose body is SubstituteSearchRequest.
      posts.push({
        body: request.postDataJSON() as SubstituteSearchRequest,
        status: null,
      });
    } else if (
      request.method() === "GET" &&
      url.includes("/api/v1/food-suggestions")
    ) {
      suggestionGets.push({
        url,
        status: null,
      });
    }
  });

  page.on("response", (response) => {
    const request = response.request();
    const url = request.url();
    if (
      request.method() === "POST" &&
      url.includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
      }
    } else if (
      request.method() === "GET" &&
      url.includes("/api/v1/food-suggestions")
    ) {
      const getEntry = suggestionGets.find((entry) => entry.status === null);
      if (getEntry !== undefined) {
        getEntry.status = response.status();
      }
    }
  });

  return { posts, suggestionGets };
}

test.describe("Substitution request lock", () => {
  test("new Search, valid Food Quantity recalculation, and MORE! separately hold the lock, disable related controls while preserving initiating focus, discard repeated intents across pointer/keyboard/blur/dispatch, keep suggestion GETs in independent lane, and produce no queued POST upon release (P12-G1, P12-G2, REQ-048)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const { posts, suggestionGets } = trackRequests(page);

    // Browser-boundary gates for controlling the real Fiber responses (P12-G1)
    let postCount = 0;
    let releaseGate1: () => void = () => {};
    const gate1 = new Promise<void>((resolve) => {
      releaseGate1 = resolve;
    });
    let releaseGate2: () => void = () => {};
    const gate2 = new Promise<void>((resolve) => {
      releaseGate2 = resolve;
    });
    let releaseGate3: () => void = () => {};
    const gate3 = new Promise<void>((resolve) => {
      releaseGate3 = resolve;
    });

    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        // Gate 1: hold the new Search request
        await gate1;
      } else if (postCount === 2) {
        // Gate 2: hold the Food Quantity recalculation request
        await gate2;
      } else if (postCount === 3) {
        // Gate 3: hold the MORE! paging request
        await gate3;
      }
      await route.continue();
    });

    await page.goto("/");
    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);
    await searchInput.fill("margherita");

    const pizzaOption = page.locator("#food-suggestion-option-1");
    await expect(pizzaOption).toBeVisible();

    // -------------------------------------------------------------------------
    // Phase 1: New Search Request Lock (initiating control: suggestion selection)
    // -------------------------------------------------------------------------
    await pizzaOption.click();

    // Exactly 1 POST started for Pizza Margherita page 0
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 0,
    });

    // P12-G2 / REQ-048: While new Search is pending:
    // 1. Search field retains established focus
    await expect(searchInput).toBeFocused();

    // 2. Visible quantity controls expose disabled state
    const numberInput = page.locator("[data-quantity-number]");
    const unitSelect = page.locator("[data-quantity-unit]");
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    // 3. Activating related controls more than once through pointer, keyboard, blur, dispatch
    // Dispatched click and change events
    await numberInput.dispatchEvent("click");
    await unitSelect.dispatchEvent("change");
    await numberInput.dispatchEvent("keydown", { key: "Enter" });
    await page.locator("[data-quantity-editor]").dispatchEvent("focusout");

    // Pointer clicks and keyboard on quantity controls
    await numberInput.click({ force: true });
    await numberInput.press("Enter");

    // Total POST count MUST remain strictly 1 (no second POST initiated)
    expect(posts).toHaveLength(1);

    // 4. Typing changing Search Queries while lock is held:
    // Suggestion GET requests continue in independent latest-query lane
    const getsBeforeTyping = suggestionGets.length;
    await searchInput.fill("chicken");
    await expect
      .poll(() => suggestionGets.length)
      .toBeGreaterThan(getsBeforeTyping);

    const chickenOption = page.locator("#food-suggestion-option-5");
    await expect(chickenOption).toBeVisible();
    await expect(chickenOption).toHaveAttribute("aria-disabled", "true");

    // Selecting an option while lock is held is discarded
    await chickenOption.click({ force: true });
    await searchInput.press("Enter");
    expect(posts).toHaveLength(1);

    // 5. Release Gate 1: response resolves, producing NO queued POST
    releaseGate1();
    await expect.poll(() => posts[0]?.status).toBe(200);

    // Wait for results state
    await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    // Releasing the gate produced no queued POST
    expect(posts).toHaveLength(1);

    // Quantity controls become enabled after unlock
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    // -------------------------------------------------------------------------
    // Phase 2: Food Quantity Recalculation Lock (initiating control: quantity editor)
    // -------------------------------------------------------------------------
    await numberInput.fill("2");
    await numberInput.press("Enter");

    // Recalculation POST 2 started
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 0,
    });

    // P12-G2 / REQ-048: While recalculation is pending:
    // 1. Initiating control (numberInput) retains established focus
    await expect(numberInput).toBeFocused();

    // 2. Controls expose disabled state
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    // 3. Activating controls more than once through pointer, keyboard, blur, dispatch
    await numberInput.press("Enter");
    await numberInput.dispatchEvent("keydown", { key: "Enter" });
    await unitSelect.dispatchEvent("change");
    await page.locator("[data-quantity-editor]").dispatchEvent("focusout");

    const moreButton = page.locator("[data-more-button]");
    if ((await moreButton.count()) > 0) {
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await moreButton.dispatchEvent("click");
    }

    // POST count remains strictly 2
    expect(posts).toHaveLength(2);

    // 4. Type changing Search Queries while recalculation lock is held
    await searchInput.focus();
    const getsBeforeTyping2 = suggestionGets.length;
    await searchInput.fill("pho");
    await expect
      .poll(() => suggestionGets.length)
      .toBeGreaterThan(getsBeforeTyping2);

    const phoOption = page.locator("#food-suggestion-option-30");
    await expect(phoOption).toBeVisible();
    await expect(phoOption).toHaveAttribute("aria-disabled", "true");

    // Option selection is discarded while locked
    await phoOption.click({ force: true });
    expect(posts).toHaveLength(2);

    // 5. Release Gate 2: recalculation response resolves, producing NO queued POST
    releaseGate2();
    await expect.poll(() => posts[1]?.status).toBe(200);

    // No queued POST produced
    expect(posts).toHaveLength(2);
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    // -------------------------------------------------------------------------
    // Phase 3: MORE! Paging Request Lock (initiating control: MORE! button)
    // -------------------------------------------------------------------------
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");

    await moreButton.click();

    // Paging POST 3 started
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 1,
    });

    // P12-G2 / REQ-048: While MORE! request is pending:
    // 1. MORE! control retains established focus
    await expect(moreButton).toBeFocused();

    // 2. Controls expose disabled state
    await expect(moreButton).toHaveAttribute("aria-disabled", "true");
    await expect(moreButton).toHaveCSS(
      "background-color",
      DISABLED_MORE_BACKGROUND_COLOR,
    );
    await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    // 3. Repeated activations on MORE! and other controls are discarded
    await moreButton.click({ force: true });
    await moreButton.press("Enter");
    await moreButton.dispatchEvent("click");
    await numberInput.dispatchEvent("keydown", { key: "Enter" });
    await unitSelect.dispatchEvent("change");

    // POST count remains strictly 3
    expect(posts).toHaveLength(3);

    // 4. Type changing Search Queries while MORE! lock is held
    await searchInput.focus();
    const getsBeforeTyping3 = suggestionGets.length;
    await searchInput.fill("milk");
    await expect
      .poll(() => suggestionGets.length)
      .toBeGreaterThan(getsBeforeTyping3);

    const milkOption = page.locator("#food-suggestion-option-10");
    await expect(milkOption).toBeVisible();
    await expect(milkOption).toHaveAttribute("aria-disabled", "true");

    await milkOption.click({ force: true });
    expect(posts).toHaveLength(3);

    // 5. Release Gate 3: page-1 response resolves, producing NO queued POST
    releaseGate3();
    await expect.poll(() => posts[2]?.status).toBe(200);

    // Page 1 cards rendered, MORE! button restored
    expect(posts).toHaveLength(3);
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    // After unlock: selecting a new food object becomes operable
    await searchInput.focus();
    await searchInput.fill("chicken");
    const newChickenOption = page.locator("#food-suggestion-option-5");
    await expect(newChickenOption).toBeVisible();
    await expect(newChickenOption).not.toHaveAttribute("aria-disabled", "true");

    await newChickenOption.click();
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 5,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });
  });
});
