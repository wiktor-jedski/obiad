import { writable, type Readable } from "svelte/store";
import type { AllowedQuantity } from "../client/types.gen";
import type { InterfaceLanguage } from "./i18n";
import {
  isSubstitutionSearchLocked,
  resetSubstitutionSearch,
} from "./substitutionSearch";

/** Supported portion units. */
export type QuantityUnit = "serving" | "g" | "ml";

/** Selected suggestion and its advertised quantity limits. */
export interface SelectedFoodObject {
  readonly foodObjectId: number;

  readonly names: { readonly en: string; readonly pl: string };

  readonly quantity: { readonly value: number; readonly unit: QuantityUnit };

  readonly allowedQuantities: readonly AllowedQuantity[];

  readonly capturedLanguage: InterfaceLanguage;
}

/** Search interaction before a food is selected. */
export interface EmptyInteractionState {
  readonly name: "empty";

  readonly query: string;

  readonly focused: boolean;
}

/** Shared request state; the results view owns the editable portion. */
export interface SubstitutionSearchInteractionState {
  readonly query: string;

  readonly focused: boolean;

  readonly selected: SelectedFoodObject;

  readonly pageIndex: number;
}

/** Quantity-independent identity of one substitution page. */
export interface CommittedSubstitutionInput {
  readonly foodObjectId: number;

  readonly pageIndex: number;
}

/** A new food search is pending. */
export interface LoadingNewInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "loadingNew";
}

/** The next substitution page is pending. */
export interface LoadingMoreInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "loadingMore";
}

/** The current search has substitutes. */
export interface ResultsInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "results";
}

/** The current search has no substitutes. */
export interface ZeroResultsInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "zeroResults";
}

/** The initial search failed and can be retried. */
export interface NewSearchFailureInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "newSearchFailure";
}

/** Pagination failed while earlier results remain available. */
export interface MoreFailureInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "moreFailure";
}

/** Search and request states exposed to the application. */
export type InteractionState =
  | EmptyInteractionState
  | LoadingNewInteractionState
  | LoadingMoreInteractionState
  | ResultsInteractionState
  | ZeroResultsInteractionState
  | NewSearchFailureInteractionState
  | MoreFailureInteractionState;

/** Transitions for selecting foods and loading substitution pages. */
export interface InteractionStateStore extends Readable<InteractionState> {
  setQuery: (query: string) => void;

  setFocused: (focused: boolean) => void;

  selectSuggestion: (selected: SelectedFoodObject) => void;

  applySearchResult: (hasItems: boolean) => void;

  applyNewSearchFailure: () => void;

  applyMoreFailure: () => void;

  loadNextPage: () => void;

  reset: () => void;
}

/** Creates an isolated search interaction store. */
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
      if (isSubstitutionSearchLocked()) {
        return;
      }
      update((state) => {
        if (state.name === "loadingNew" || state.name === "loadingMore") {
          return state;
        }
        resetSubstitutionSearch(selected.foodObjectId, 0);
        return {
          name: "loadingNew",
          query: selected.names[selected.capturedLanguage],
          focused: state.focused,
          selected,
          pageIndex: 0,
        };
      });
    },
    applySearchResult(hasItems) {
      update((state) => {
        if (
          state.name !== "loadingNew" &&
          state.name !== "loadingMore" &&
          state.name !== "newSearchFailure"
        ) {
          return state;
        }
        return {
          ...state,
          name: hasItems ? "results" : "zeroResults",
        };
      });
    },
    applyNewSearchFailure() {
      update((state) => {
        if (state.name !== "loadingNew") {
          return state;
        }
        return { ...state, name: "newSearchFailure" };
      });
    },
    applyMoreFailure() {
      update((state) => {
        if (state.name !== "loadingMore") {
          return state;
        }

        return {
          ...state,
          name: "moreFailure",
          pageIndex: state.pageIndex - 1,
        };
      });
    },
    loadNextPage() {
      if (isSubstitutionSearchLocked()) {
        return;
      }
      update((state) => {
        if (state.name !== "results" && state.name !== "moreFailure") {
          return state;
        }
        return {
          ...state,
          name: "loadingMore",
          pageIndex: state.pageIndex + 1,
        };
      });
    },
    reset() {
      update(() => ({ name: "empty", query: "", focused: false }));
    },
  };
}

/** Shared application search interaction. */
export const interactionState: InteractionStateStore = createInteractionState();
