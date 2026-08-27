import { writable, type Readable } from "svelte/store";
import type { AllowedQuantity } from "../client/types.gen";
import type { InterfaceLanguage } from "./i18n";
import {
  isValidQuantitySyntax,
  resolveCommittedValue,
  unitSelectionValue,
} from "./quantity";
import { isSubstitutionSearchLocked } from "./substitutionSearch";

export type QuantityUnit = "serving" | "g" | "ml";

export interface SelectedFoodObject {
  readonly foodObjectId: number;

  readonly names: { readonly en: string; readonly pl: string };

  readonly quantity: { readonly value: number; readonly unit: QuantityUnit };

  readonly allowedQuantities: readonly AllowedQuantity[];

  readonly capturedLanguage: InterfaceLanguage;
}

export interface EmptyInteractionState {
  readonly name: "empty";

  readonly query: string;

  readonly focused: boolean;
}

export interface SubstitutionSearchInteractionState {
  readonly query: string;

  readonly focused: boolean;

  readonly selected: SelectedFoodObject;

  readonly quantityText: string;

  readonly draftUnit: QuantityUnit;

  readonly committedUnit: QuantityUnit;

  readonly committedValue: number;

  readonly quantityInvalid: boolean;

  readonly pageIndex: number;
}

export interface CommittedSubstitutionInput {
  readonly foodObjectId: number;

  readonly quantity: { readonly value: number; readonly unit: QuantityUnit };

  readonly pageIndex: number;
}

export interface LoadingNewInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "loadingNew";
}

export interface LoadingMoreInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "loadingMore";
}

export interface ResultsInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "results";
}

export interface ZeroResultsInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "zeroResults";
}

export interface NewSearchFailureInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "newSearchFailure";
}

export interface MoreFailureInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "moreFailure";
}

export type InteractionState =
  | EmptyInteractionState
  | LoadingNewInteractionState
  | LoadingMoreInteractionState
  | ResultsInteractionState
  | ZeroResultsInteractionState
  | NewSearchFailureInteractionState
  | MoreFailureInteractionState;

export interface InteractionStateStore extends Readable<InteractionState> {
  setQuery: (query: string) => void;

  setFocused: (focused: boolean) => void;

  selectSuggestion: (selected: SelectedFoodObject) => void;

  applySearchResult: (hasItems: boolean) => void;

  applyNewSearchFailure: () => void;

  applyMoreFailure: () => void;

  loadNextPage: () => void;

  setQuantityText: (text: string) => void;

  selectUnit: (unit: QuantityUnit) => void;

  commitQuantity: () => void;

  reset: () => void;
}

function withCommittedQuantity<S extends SubstitutionSearchInteractionState>(
  state: S,
  text: string,
  unit: QuantityUnit,
): S {
  const value = resolveCommittedValue(
    text,
    unit,
    state.selected.allowedQuantities,
  );
  const changed =
    value !== state.committedValue || unit !== state.committedUnit;
  return {
    ...state,
    quantityText: String(value),
    draftUnit: unit,
    quantityInvalid: false,
    committedValue: changed ? value : state.committedValue,
    committedUnit: changed ? unit : state.committedUnit,
  };
}

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
        return {
          name: "loadingNew",
          query: selected.names[selected.capturedLanguage],
          focused: state.focused,
          selected,
          quantityText: String(selected.quantity.value),
          draftUnit: selected.quantity.unit,
          committedValue: selected.quantity.value,
          committedUnit: selected.quantity.unit,
          quantityInvalid: false,
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
    setQuantityText(text) {
      if (isSubstitutionSearchLocked()) {
        return;
      }
      update((state) => {
        if (
          state.name === "empty" ||
          state.name === "loadingNew" ||
          state.name === "loadingMore" ||
          state.name === "moreFailure"
        ) {
          return state;
        }
        return {
          ...state,
          quantityText: text,
          quantityInvalid: !isValidQuantitySyntax(text, state.draftUnit),
        };
      });
    },
    selectUnit(unit) {
      if (isSubstitutionSearchLocked()) {
        return;
      }
      update((state) => {
        if (
          state.name === "empty" ||
          state.name === "loadingNew" ||
          state.name === "loadingMore" ||
          state.name === "moreFailure"
        ) {
          return state;
        }
        return withCommittedQuantity(
          state,
          String(unitSelectionValue(unit)),
          unit,
        );
      });
    },
    commitQuantity() {
      if (isSubstitutionSearchLocked()) {
        return;
      }
      update((state) => {
        if (
          state.name === "empty" ||
          state.name === "loadingNew" ||
          state.name === "loadingMore" ||
          state.name === "moreFailure"
        ) {
          return state;
        }
        if (!isValidQuantitySyntax(state.quantityText, state.draftUnit)) {
          return { ...state, quantityInvalid: true };
        }
        return withCommittedQuantity(
          state,
          state.quantityText,
          state.draftUnit,
        );
      });
    },
    reset() {
      update(() => ({ name: "empty", query: "", focused: false }));
    },
  };
}

export const interactionState: InteractionStateStore = createInteractionState();
