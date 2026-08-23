/**
 * Pointer-selection and new-search transition — happy-dom component
 * integration scenario (task 28; ARCH-002, ARCH-003, ARCH-010, ARCH-011,
 * ARCH-022, REQ-020, REQ-022, REQ-023, REQ-024) with the ISSUE-010
 * quantity-editor state (task 34, REQ-025, REQ-026, REQ-027, REQ-028).
 *
 * `bun test` runs this file with the pinned `happy-dom` package and no
 * generated-client or network call (ISSUE-007). The store-level scenario
 * drives fresh `createInteractionState()` instances through the production
 * transition actions — the same narrow seam the real-stack Playwright
 * scenario cannot reach, because zero eligible Substitutes are unreachable
 * with the deterministic catalog (ISSUE-003, ISSUE-008). It proves that a
 * pointer selection transitions `empty` → `loadingNew` carrying the exact
 * selected Food Object and the initialized quantity-editor fields, that
 * the first page-0 outcome transitions `loadingNew` → `results` or
 * `zeroResults` while TanStack Query keeps the response data (the store
 * never copies items), that changed draft Search Query text preserves the
 * committed result, that `setFocused` preserves the transition, that a
 * fresh selection from a completed result commits the next `loadingNew`
 * intent, and that the ISSUE-010 quantity actions keep the exact raw text,
 * follow the draft-unit syntax, commit only changed valid values, clamp
 * above the advertised maximum without a clamp notice, and start no
 * request for an unchanged or invalid draft. Pointer activation, the
 * pending summary value, and focus retention remain covered by the
 * real-stack `food-quantity-editing.spec.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  createInteractionState,
  type InteractionState,
  type SelectedFoodObject,
} from "./lib/interactionState";

/**
 * A captured Butter selection fixture for transition tests: a solid
 * without a Serving, so its allowed quantity-editor units contain only the
 * `g` base unit with the ISSUE-010 `100000` maximum (task 33).
 */
const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
  capturedLanguage: "en",
} as const;

/**
 * A captured Pizza Margherita selection fixture for quantity-editor
 * transition tests: a solid with a 350 g Serving, so the allowed units
 * are `serving` first (whole-number floor of 100000 / 350 = 285) and then
 * the `g` base unit with maximum `100000` (task 33, ISSUE-010).
 */
const SELECTED_SERVING: SelectedFoodObject = {
  foodObjectId: 1,
  names: { en: "Pizza Margherita", pl: "Pizza margherita" },
  quantity: { value: 1, unit: "serving" },
  allowedQuantities: [
    { unit: "serving", maximumValue: 285 },
    { unit: "g", maximumValue: 100000 },
  ],
  capturedLanguage: "en",
} as const;

/** The expected quantity-editor fields of a selection with default `100 g`. */
const DEFAULT_G_FIELDS = {
  quantityText: "100",
  draftUnit: "g",
  committedValue: 100,
  committedUnit: "g",
  quantityInvalid: false,
  pageIndex: 0,
} as const;

describe("the pointer-selection and new-search transitions", () => {
  test("a pointer selection replaces the query with the active-language name, initializes the quantity editor, and transitions to loadingNew", () => {
    const store = createInteractionState();
    store.setQuery("chicken");
    store.setFocused(true);

    store.selectSuggestion(SELECTED);

    let state: InteractionState | undefined;
    store.subscribe((next) => {
      state = next;
    });
    expect(state).toEqual({
      name: "loadingNew",
      query: "Butter",
      focused: true,
      selected: SELECTED,
      ...DEFAULT_G_FIELDS,
    });
  });

  test("a successful page with items transitions loadingNew to results without copying response data", () => {
    const store = createInteractionState();
    store.setQuery("chicken");
    store.selectSuggestion(SELECTED);

    store.applySearchResult(true);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("results");
    expect(state.query).toBe("Butter");
    expect(state.selected).toEqual(SELECTED);
    // The Module never copies query results into the store (ARCH-002).
    expect("items" in state).toBe(false);
    expect("data" in state).toBe(false);
    expect(Object.keys(state).sort()).toEqual([
      "committedUnit",
      "committedValue",
      "draftUnit",
      "focused",
      "name",
      "pageIndex",
      "quantityInvalid",
      "quantityText",
      "query",
      "selected",
    ]);
  });

  test("a successful empty page transitions loadingNew to zeroResults", () => {
    const store = createInteractionState();
    store.setQuery("chicken");
    store.selectSuggestion(SELECTED);

    store.applySearchResult(false);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("zeroResults");
    expect(state.query).toBe("Butter");
    expect(state.selected).toEqual(SELECTED);
    expect(state.quantityText).toBe("100");
    expect(state.committedUnit).toBe("g");
    expect(state.pageIndex).toBe(0);
    expect(Object.keys(state).sort()).toEqual([
      "committedUnit",
      "committedValue",
      "draftUnit",
      "focused",
      "name",
      "pageIndex",
      "quantityInvalid",
      "quantityText",
      "query",
      "selected",
    ]);
  });

  test("changed Search Query text after results keeps the committed result, focus, and quantity editor", () => {
    const store = createInteractionState();
    store.setQuery("chicken");
    store.setFocused(true);
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);

    store.setQuery("pizza");

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state).toEqual({
      name: "results",
      query: "pizza",
      focused: true,
      selected: SELECTED,
      ...DEFAULT_G_FIELDS,
    });
  });

  test("a fresh selection from results commits the next loadingNew intent", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);

    const nextSelected: SelectedFoodObject = {
      foodObjectId: 10,
      names: { en: "Milk", pl: "Mleko" },
      quantity: { value: 100, unit: "ml" },
      allowedQuantities: [{ unit: "ml", maximumValue: 100000 }],
      capturedLanguage: "pl",
    };
    store.setQuery("milk");
    store.selectSuggestion(nextSelected);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state).toEqual({
      name: "loadingNew",
      query: "Mleko",
      focused: false,
      selected: nextSelected,
      quantityText: "100",
      draftUnit: "ml",
      committedValue: 100,
      committedUnit: "ml",
      quantityInvalid: false,
      pageIndex: 0,
    });
  });

  test("applySearchResult is a no-op outside the loadingNew transition", () => {
    const store = createInteractionState();
    store.applySearchResult(true);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("empty");
  });
});

describe("the ISSUE-010 quantity-editor actions", () => {
  /** Returns the store driven into the results transition with SELECTED_SERVING. */
  function servingResults() {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED_SERVING);
    store.applySearchResult(true);
    return store;
  }

  test("a serving selection initializes the editor with the 1 serving default", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED_SERVING);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityText).toBe("1");
    expect(state.draftUnit).toBe("serving");
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");
    expect(state.quantityInvalid).toBe(false);
    expect(state.pageIndex).toBe(0);
  });

  test("draft text stays exact and the validation state follows the draft-unit syntax; a valid draft clears the error without committing", () => {
    const store = servingResults();
    store.setQuantityText("2.5");

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityText).toBe("2.5");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(1);

    // An invalid Serving draft raises the error and keeps the exact text.
    store.setQuantityText("2,5");
    expect(state.quantityText).toBe("2,5");
    expect(state.quantityInvalid).toBe(true);
    expect(state.committedValue).toBe(1);

    // The error clears as soon as the draft becomes syntactically valid,
    // without committing it (ISSUE-010).
    store.setQuantityText("3");
    expect(state.quantityText).toBe("3");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");
  });

  test("an invalid commit keeps the exact text and raises the error without committing or starting a request", () => {
    const store = servingResults();
    store.setQuantityText("abc");
    store.commitQuantity();

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityText).toBe("abc");
    expect(state.quantityInvalid).toBe(true);
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");
  });

  test("a valid changed commit replaces the committed transport quantity", () => {
    const store = servingResults();
    store.setQuantityText("2.5");
    store.commitQuantity();

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityText).toBe("2.5");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(2.5);
    expect(state.committedUnit).toBe("serving");
    // The page index never changes through a quantity commit.
    expect(state.pageIndex).toBe(0);
  });

  test("a valid draft that resolves to the committed value clears validation but starts no request", () => {
    const store = servingResults();
    // The committed default is 1 serving; typing the same value commits
    // nothing, and Enter followed by blur stays request-free.
    store.setQuantityText("1");
    store.commitQuantity();
    store.commitQuantity();

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");
  });

  test("a valid value above the maximum is silently replaced by the whole maximum before commit, without a clamp notice", () => {
    const store = servingResults();
    // The Serving maximum is 285 (100000 / 350 floored). A draft of 300 is
    // silently clamped to 285 before commit.
    store.setQuantityText("300");
    store.commitQuantity();

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityText).toBe("285");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(285);
    expect(state.committedUnit).toBe("serving");

    // A clamp back to the committed maximum starts no new request: the
    // resolved value equals the committed value.
    store.setQuantityText("500");
    store.commitQuantity();
    expect(state.committedValue).toBe(285);
    expect(state.quantityText).toBe("285");
  });

  test("a unit selection replaces the draft with 1 for Serving or 100 for a base unit and commits immediately", () => {
    const store = servingResults();
    store.setQuantityText("0.5");

    // Moving to the base unit replaces the draft with 100 g and commits.
    store.selectUnit("g");
    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityText).toBe("100");
    expect(state.draftUnit).toBe("g");
    expect(state.committedValue).toBe(100);
    expect(state.committedUnit).toBe("g");
    expect(state.quantityInvalid).toBe(false);

    // Selecting the Serving unit again replaces the draft with 1 and
    // commits immediately.
    store.selectUnit("serving");
    expect(state.quantityText).toBe("1");
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");

    // Reselecting the already committed unit starts no new request.
    store.selectUnit("serving");
    expect(state.committedValue).toBe(1);
  });

  test("base-unit drafts accept only canonical positive ASCII integers", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);

    for (const invalid of [
      "0",
      "01",
      "1.5",
      ".5",
      "1.",
      "1e3",
      "+5",
      " 5",
      "5 ",
      "-5",
      "",
      "abc",
      "1,5",
    ]) {
      store.setQuantityText(invalid);
      let state: Record<string, unknown> = {};
      store.subscribe((next) => {
        state = { ...next };
      });
      expect(
        state.quantityInvalid,
        `base draft ${JSON.stringify(invalid)} must be invalid`,
      ).toBe(true);
      expect(
        state.committedValue,
        `base draft ${JSON.stringify(invalid)} must not commit`,
      ).toBe(100);
    }

    store.setQuantityText("250");
    store.commitQuantity();
    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(250);
  });
});

describe("the intermediate MORE! result-paging transitions", () => {
  test("loadNextPage transitions results to loadingMore with pageIndex incremented", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);

    store.loadNextPage();

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state).toEqual({
      name: "loadingMore",
      query: "Butter",
      focused: false,
      selected: SELECTED,
      quantityText: "100",
      draftUnit: "g",
      committedValue: 100,
      committedUnit: "g",
      quantityInvalid: false,
      pageIndex: 1,
    });
  });

  test("loadNextPage is a no-op when not in results state", () => {
    const store = createInteractionState();
    // empty state
    store.loadNextPage();
    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("empty");

    // loadingNew state
    store.selectSuggestion(SELECTED);
    store.loadNextPage();
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("loadingNew");
    expect(state.pageIndex).toBe(0);

    // zeroResults state
    store.applySearchResult(false);
    expect(state.name).toBe("zeroResults");
    store.loadNextPage();
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("zeroResults");
    expect(state.pageIndex).toBe(0);
  });

  test("applySearchResult transitions loadingMore back to results on intermediate success", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);
    store.loadNextPage();

    store.applySearchResult(true);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("results");
    expect(state.pageIndex).toBe(1);
    expect(state.selected).toEqual(SELECTED);
    expect("items" in state).toBe(false);
    expect("data" in state).toBe(false);
  });

  test("a fresh selection after paging resets pageIndex to 0 and transitions to loadingNew", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);
    store.loadNextPage();
    store.applySearchResult(true);

    const nextSelected: SelectedFoodObject = {
      foodObjectId: 10,
      names: { en: "Milk", pl: "Mleko" },
      quantity: { value: 100, unit: "ml" },
      allowedQuantities: [{ unit: "ml", maximumValue: 100000 }],
      capturedLanguage: "en",
    };
    store.selectSuggestion(nextSelected);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("loadingNew");
    expect(state.pageIndex).toBe(0);
    expect(state.selected).toEqual(nextSelected);
    expect(state.query).toBe("Milk");
  });

  test("quantity commit on later page preserves current pageIndex", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);
    store.loadNextPage();
    store.applySearchResult(true);

    store.setQuantityText("200");
    store.commitQuantity();

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.pageIndex).toBe(1);
    expect(state.committedValue).toBe(200);
  });
});
