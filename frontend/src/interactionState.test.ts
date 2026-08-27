import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  createInteractionState,
  type InteractionState,
  type SelectedFoodObject,
} from "./lib/interactionState";

const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
  capturedLanguage: "en",
} as const;

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

const DEFAULT_G_FIELDS = {
  quantityText: "100",
  draftUnit: "g",
  committedValue: 100,
  committedUnit: "g",
  quantityInvalid: false,
  pageIndex: 0,
} as const;

interface ObservedInteractionState {
  name: InteractionState["name"];
  query: string;
  focused: boolean;
  selected?: SelectedFoodObject;
  quantityText?: string;
  draftUnit?: SelectedFoodObject["quantity"]["unit"];
  committedValue?: number;
  committedUnit?: SelectedFoodObject["quantity"]["unit"];
  quantityInvalid?: boolean;
  pageIndex?: number;
}

describe("the pointer-selection and new-search transitions", () => {
  test("a pointer selection replaces the query with the active-language name, initializes the quantity editor, and transitions to loadingNew", () => {
    const store = createInteractionState();
    store.setQuery("chicken");
    store.setFocused(true);

    store.selectSuggestion(SELECTED);

    let state: ObservedInteractionState = get(store);
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("results");
    expect(state.query).toBe("Butter");
    expect(state.selected).toEqual(SELECTED);
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("empty");
  });
});

describe("the ISSUE-010 quantity-editor actions", () => {
  function servingResults() {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED_SERVING);
    store.applySearchResult(true);
    return store;
  }

  test("a serving selection initializes the editor with the 1 serving default", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED_SERVING);

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.quantityText).toBe("2.5");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(1);

    store.setQuantityText("2,5");
    expect(state.quantityText).toBe("2,5");
    expect(state.quantityInvalid).toBe(true);
    expect(state.committedValue).toBe(1);

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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.quantityText).toBe("2.5");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(2.5);
    expect(state.committedUnit).toBe("serving");
    expect(state.pageIndex).toBe(0);
  });

  test("a valid draft that resolves to the committed value clears validation but starts no request", () => {
    const store = servingResults();
    store.setQuantityText("1");
    store.commitQuantity();
    store.commitQuantity();

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");
  });

  test("a valid value above the maximum is silently replaced by the whole maximum before commit, without a clamp notice", () => {
    const store = servingResults();
    store.setQuantityText("300");
    store.commitQuantity();

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.quantityText).toBe("285");
    expect(state.quantityInvalid).toBe(false);
    expect(state.committedValue).toBe(285);
    expect(state.committedUnit).toBe("serving");

    store.setQuantityText("500");
    store.commitQuantity();
    expect(state.committedValue).toBe(285);
    expect(state.quantityText).toBe("285");
  });

  test("a unit selection replaces the draft with 1 for Serving or 100 for a base unit and commits immediately", () => {
    const store = servingResults();
    store.setQuantityText("0.5");

    store.selectUnit("g");
    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.quantityText).toBe("100");
    expect(state.draftUnit).toBe("g");
    expect(state.committedValue).toBe(100);
    expect(state.committedUnit).toBe("g");
    expect(state.quantityInvalid).toBe(false);

    store.selectUnit("serving");
    expect(state.quantityText).toBe("1");
    expect(state.committedValue).toBe(1);
    expect(state.committedUnit).toBe("serving");

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
      let state: ObservedInteractionState = get(store);
      store.subscribe((next) => {
        state = next;
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
    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
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
    store.loadNextPage();
    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("empty");

    store.selectSuggestion(SELECTED);
    store.loadNextPage();
    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("loadingNew");
    expect(state.pageIndex).toBe(0);

    store.applySearchResult(false);
    expect(state.name).toBe("zeroResults");
    store.loadNextPage();
    store.subscribe((next) => {
      state = next;
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

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("results");
    expect(state.pageIndex).toBe(1);
    expect(state.selected).toEqual(SELECTED);
    expect("items" in state).toBe(false);
    expect("data" in state).toBe(false);
  });

  test("a fresh selection from page 2 resets pageIndex to 0 and transitions to loadingNew", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);
    store.loadNextPage();
    store.applySearchResult(true);
    store.loadNextPage();
    store.applySearchResult(true);

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("results");
    expect(state.pageIndex).toBe(2);

    const nextSelected: SelectedFoodObject = {
      foodObjectId: 10,
      names: { en: "Milk", pl: "Mleko" },
      quantity: { value: 100, unit: "ml" },
      allowedQuantities: [{ unit: "ml", maximumValue: 100000 }],
      capturedLanguage: "en",
    };
    store.selectSuggestion(nextSelected);

    store.subscribe((next) => {
      state = next;
    });
    expect(state.name).toBe("loadingNew");
    expect(state.pageIndex).toBe(0);
    expect(state.selected).toEqual(nextSelected);
    expect(state.query).toBe("Milk");
  });

  test("quantity commit on page 2 preserves current pageIndex", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);
    store.loadNextPage();
    store.applySearchResult(true);
    store.loadNextPage();
    store.applySearchResult(true);

    store.setQuantityText("200");
    store.commitQuantity();

    let state: ObservedInteractionState = get(store);
    store.subscribe((next) => {
      state = next;
    });
    expect(state.pageIndex).toBe(2);
    expect(state.committedValue).toBe(200);
  });
});
