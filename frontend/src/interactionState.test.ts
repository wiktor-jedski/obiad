/**
 * Pointer-selection and new-search transition — happy-dom component
 * integration scenario (task 28; ARCH-002, ARCH-003, ARCH-010, ARCH-011,
 * ARCH-022, REQ-020, REQ-022, REQ-023, REQ-024).
 *
 * `bun test` runs this file with the pinned `happy-dom` package and no
 * generated-client or network call (ISSUE-007). The store-level scenario
 * drives fresh `createInteractionState()` instances through the production
 * transition actions — the same narrow seam the real-stack Playwright
 * scenario cannot reach, because zero eligible Substitutes are unreachable
 * with the deterministic catalog (ISSUE-003, ISSUE-008). It proves that a
 * pointer selection transitions `empty` → `loadingNew` carrying the exact
 * selected Food Object, that the first page-0 outcome transitions
 * `loadingNew` → `results` or `zeroResults` while TanStack Query keeps the
 * response data (the store never copies items), that `setQuery` and
 * `setFocused` preserve the transition, and that a selection is a no-op
 * outside the empty state. Pointer activation, the pending spinner, the
 * read-only Substitution Input value, and focus retention remain covered by
 * the real-stack `pointer-substitution-search.spec.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  createInteractionState,
  type InteractionState,
  type SelectedFoodObject,
} from "./lib/interactionState";

/** A captured selection: the third seeded suggestion for `chicken` (Butter). */
const SELECTED: SelectedFoodObject = {
  foodObjectId: 18,
  names: { en: "Butter", pl: "Masło" },
  quantity: { value: 100, unit: "g" },
  capturedLanguage: "en",
} as const;

describe("the pointer-selection and new-search transitions", () => {
  test("a pointer selection transitions the empty state to loadingNew and retains the exact selected Food Object", () => {
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
      query: "chicken",
      focused: true,
      selected: SELECTED,
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
    expect(state.query).toBe("chicken");
    expect(state.selected).toEqual(SELECTED);
    // The Module never copies query results into the store (ARCH-002).
    expect("items" in state).toBe(false);
    expect("data" in state).toBe(false);
    expect(Object.keys(state).sort()).toEqual([
      "focused",
      "name",
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
    expect(state.query).toBe("chicken");
    expect(state.selected).toEqual(SELECTED);
    expect(Object.keys(state).sort()).toEqual([
      "focused",
      "name",
      "query",
      "selected",
    ]);
  });

  test("setQuery and setFocused preserve the transition", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);

    store.setQuery("pizza");
    store.setFocused(false);

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    expect(state.name).toBe("results");
    expect(state.query).toBe("pizza");
    expect(state.focused).toBe(false);
    expect(state.selected).toEqual(SELECTED);
  });

  test("a selection is a no-op outside the empty state and cannot start a second intent", () => {
    const store = createInteractionState();
    store.selectSuggestion(SELECTED);
    store.applySearchResult(true);

    store.selectSuggestion({
      foodObjectId: 10,
      names: { en: "Milk", pl: "Mleko" },
      quantity: { value: 100, unit: "ml" },
      capturedLanguage: "pl",
    });

    let state: Record<string, unknown> = {};
    store.subscribe((next) => {
      state = { ...next };
    });
    // The results transition and its selected Food Object are unchanged: no
    // duplicate intent can replace the in-flight or completed search.
    expect(state.name).toBe("results");
    expect(state.selected).toEqual(SELECTED);
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
