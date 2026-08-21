/**
 * Browser Interaction Module (ARCH-002) — discriminated interaction state.
 *
 * Task 27 (Phase 7, Pointer Substitution Search) established the Phase-7
 * subset of the single discriminated browser-interaction state: the Search
 * Query text and the Search field focus intent. Task 28 extends the same
 * union with exactly the required `loadingNew`, `results`, and `zeroResults`
 * transitions (REQ-020, REQ-022): pointer selection of one suggestion
 * transitions `empty` → `loadingNew` carrying the selected Food Object, and
 * the first successful page-0 response transitions `loadingNew` → `results`
 * when it contains items or → `zeroResults` when it is empty. Typing a
 * changed Search Query after either completed outcome updates only the
 * draft text: the committed selection and result transition stay visible
 * until the visitor selects a fresh suggestion. That selection replaces the
 * draft query with the exact returned active-language name and transitions
 * `empty`, `results`, or `zeroResults` to `loadingNew`, which is the commit
 * boundary that replaces the prior result (REQ-077). TanStack Query
 * continues to own HTTP response data and pending state; the Module never
 * copies query results into the store (ARCH-002, ARCH-010, ARCH-011). The
 * union has no duplicate intent, queue, automatic retry, second submit
 * action, or response-data store.
 *
 * The store pattern mirrors the persisted Interface Language store
 * (ARCH-012, ARCH-014): a factory for testable instances and the single
 * application store. Components subscribe with the `$` prefix and mutate
 * through the narrow typed actions, never by replacing the union value.
 */
import { writable, type Readable } from "svelte/store";
import type { InterfaceLanguage } from "./i18n";

/**
 * The closed set of Food Quantity units the read-only Substitution Input
 * and the Substitution Search request carry: one Serving, direct grams, or
 * direct millilitres (ARCH-008, ISSUE-005).
 */
export type QuantityUnit = "serving" | "g" | "ml";

/**
 * The selected Food Object captured at pointer activation (task 28,
 * REQ-020, REQ-022, REQ-023, REQ-024). It retains the exact returned
 * suggestion: the stable Food Object ID, both localized names, the returned
 * default Food Quantity, and the Interface Language active at selection so
 * the read-only Substitution Input value never re-translates with the
 * current Interface Language (ISSUE-008). The Module keeps these selected
 * values and no response data.
 */
export interface SelectedFoodObject {
  /** The stable Food Object ID of the selected suggestion. */
  readonly foodObjectId: number;
  /** Both localized names returned by the suggestion response. */
  readonly names: { readonly en: string; readonly pl: string };
  /** The returned default Food Quantity, sent unchanged on page 0. */
  readonly quantity: { readonly value: number; readonly unit: QuantityUnit };
  /** The Interface Language captured at selection for the active-content value. */
  readonly capturedLanguage: InterfaceLanguage;
}

/**
 * The empty interaction state: the Search field is not performing a
 * Substitution Search. The variant carries the current Search Query text
 * and whether the Search field currently has focus; a focused nonempty
 * Search Query drives the live suggestion request (ARCH-010, REQ-012).
 */
export interface EmptyInteractionState {
  readonly name: "empty";
  /** The current Search Query text, exactly as typed by the visitor. */
  readonly query: string;
  /** Whether the Search field currently has focus (focus intent). */
  readonly focused: boolean;
}

/**
 * The base shape of every Substitution Search interaction state (task 28):
 * the Search Query text, the focus intent, and the selected Food Object
 * retained as the read-only Substitution Input. The variants differ only in
 * the transition name; TanStack Query owns the page-0 response data.
 */
export interface SubstitutionSearchInteractionState {
  /** The current Search Query text, exactly as typed by the visitor. */
  readonly query: string;
  /** Whether the Search field currently has focus (focus intent). */
  readonly focused: boolean;
  /** The selected Food Object of the in-flight or completed new search. */
  readonly selected: SelectedFoodObject;
}

/**
 * The new-search transition: a suggestion was selected and the page-0
 * Substitution Search request is pending (REQ-020, REQ-022). The new-search
 * spinner shows for the complete pending interval; the read-only
 * Substitution Input is already visible.
 */
export interface LoadingNewInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "loadingNew";
}

/**
 * The successful result transition: the first page-0 response arrived with
 * at least one eligible Substitute (REQ-022, REQ-036). The response data
 * stays in TanStack Query; later phases render the result cards.
 */
export interface ResultsInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "results";
}

/**
 * The successful zero-result transition: the first page-0 response arrived
 * with zero eligible Substitutes (REQ-044). The response data stays in
 * TanStack Query; later phases render the localized zero-result message.
 */
export interface ZeroResultsInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "zeroResults";
}

/**
 * The discriminated browser-interaction state union (ARCH-002). Task 27
 * reached only `empty`; task 28 adds the required `loadingNew`, `results`,
 * and `zeroResults` transitions and nothing else. Transitions, not
 * independent booleans, determine the visible controls.
 */
export type InteractionState =
  | EmptyInteractionState
  | LoadingNewInteractionState
  | ResultsInteractionState
  | ZeroResultsInteractionState;

/** The typed Browser Interaction Module surface of the interaction state. */
export interface InteractionStateStore extends Readable<InteractionState> {
  /**
   * Applies draft Search Query text without changing the committed result
   * transition or selection.
   */
  setQuery: (query: string) => void;
  /** Applies the current Search field focus intent without changing the transition. */
  setFocused: (focused: boolean) => void;
  /**
   * Applies a pointer or keyboard selection of one suggestion: replaces the
   * Search Query with the exact returned name for the captured active
   * Interface Language, then transitions `empty`, `results`, or
   * `zeroResults` to `loadingNew` with the selected Food Object, closes the
   * suggestion list, and starts one page-0 Substitution Search. It is a no-op
   * only while another new search is loading, so no duplicate intent can
   * replace in-flight work (REQ-077).
   */
  selectSuggestion: (selected: SelectedFoodObject) => void;
  /**
   * Applies the first page-0 response outcome: transitions `loadingNew` to
   * `results` when the page contains items, otherwise to `zeroResults`.
   * The response data itself stays in TanStack Query; the store receives
   * only the outcome.
   */
  applySearchResult: (hasItems: boolean) => void;
  /**
   * Restores the initial empty state: no Search Query, no focus intent, and
   * no selection. Production components reach the empty state only through
   * the transition actions; this action exists so tests can establish a
   * deterministic start with the single application store before a scenario
   * drives it (task 30), mirroring the persisted Interface Language store
   * reset in the component integration suite.
   */
  reset: () => void;
}

/**
 * Creates one interaction state store starting in the empty state.
 *
 * @returns the initialized store
 */
export function createInteractionState(): InteractionStateStore {
  const { subscribe, update } = writable<InteractionState>({
    name: "empty",
    query: "",
    focused: false,
  });
  return {
    subscribe,
    setQuery(query) {
      update((state) => ({ ...state, query }));
    },
    setFocused(focused) {
      update((state) => ({ ...state, focused }));
    },
    selectSuggestion(selected) {
      update((state) => {
        if (state.name === "loadingNew") {
          return state;
        }
        return {
          name: "loadingNew",
          query: selected.names[selected.capturedLanguage],
          focused: state.focused,
          selected,
        };
      });
    },
    applySearchResult(hasItems) {
      update((state) => {
        if (state.name !== "loadingNew") {
          return state;
        }
        return {
          name: hasItems ? "results" : "zeroResults",
          query: state.query,
          focused: state.focused,
          selected: state.selected,
        };
      });
    },
    reset() {
      update(() => ({ name: "empty", query: "", focused: false }));
    },
  };
}

/**
 * The single browser-interaction state store of the application (ARCH-002).
 * It is initialized before the first application render like the persisted
 * Interface Language store, and every interactive surface reads it through
 * the store subscription.
 */
export const interactionState: InteractionStateStore = createInteractionState();
