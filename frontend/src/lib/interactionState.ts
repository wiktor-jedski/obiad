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
import type { AllowedQuantity } from "../client/types.gen";
import type { InterfaceLanguage } from "./i18n";
import {
  isValidQuantitySyntax,
  resolveCommittedValue,
  unitSelectionValue,
} from "./quantity";

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
 * default Food Quantity, the returned allowed quantity-editor units
 * (task 34, ISSUE-010), and the Interface Language active at selection for
 * the Search Query transition. The summary and result cards use the active
 * Interface Language with the retained names (REQ-058). The Module keeps
 * these selected values and no response data.
 */
export interface SelectedFoodObject {
  /** The stable Food Object ID of the selected suggestion. */
  readonly foodObjectId: number;
  /** Both localized names returned by the suggestion response. */
  readonly names: { readonly en: string; readonly pl: string };
  /** The returned default Food Quantity, sent unchanged on page 0. */
  readonly quantity: { readonly value: number; readonly unit: QuantityUnit };
  /**
   * The returned allowed quantity-editor units, default unit first
   * (task 34, ISSUE-010). One or two unique closed objects; the summary
   * renders the selector options from this list.
   */
  readonly allowedQuantities: readonly AllowedQuantity[];
  /** The Interface Language used for the Search Query at selection time. */
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
 * the Search Query text, the focus intent, the selected Food Object
 * retained as the Substitution Input, and the ISSUE-010 quantity-editor
 * fields (task 34). The variants differ only in the transition name;
 * TanStack Query owns the page-0 response data and pending state.
 *
 * The quantity editor keeps the exact raw number text local until Enter
 * or focus leaves the complete editor (ARCH-002, REQ-027). The draft unit
 * is the unit the selector currently shows; the committed unit and value
 * form the committed transport quantity sent with the Substitution Search
 * request. A draft is committed only when it is syntactically valid for
 * the draft unit (REQ-025); an invalid commit keeps the exact text and
 * raises the validation state without starting a request (REQ-026). The
 * page index stays `0` through Phase 10; Phase 11 owns MORE! paging.
 */
export interface SubstitutionSearchInteractionState {
  /** The current Search Query text, exactly as typed by the visitor. */
  readonly query: string;
  /** Whether the Search field currently has focus (focus intent). */
  readonly focused: boolean;
  /** The selected Food Object of the in-flight or completed new search. */
  readonly selected: SelectedFoodObject;
  /** The exact raw number text of the quantity editor, as typed. */
  readonly quantityText: string;
  /** The unit the quantity editor currently edits in (the selector value). */
  readonly draftUnit: QuantityUnit;
  /** The unit of the committed transport quantity. */
  readonly committedUnit: QuantityUnit;
  /** The numeric value of the committed transport quantity. */
  readonly committedValue: number;
  /**
   * Whether the current quantity draft is syntactically invalid for the
   * draft unit. The error state and message clear as soon as the draft
   * becomes syntactically valid, without committing it (ISSUE-010).
   */
  readonly quantityInvalid: boolean;
  /** The current page index of the committed Substitution Search. */
  readonly pageIndex: number;
}

/**
 * The committed Substitution Search input (task 34, ISSUE-010): the
 * selected Food Object ID, the committed transport Food Quantity, and the
 * current page index. The Substitution Search query keys and sends exactly
 * this committed input; a changed valid commit replaces it and starts one
 * fresh generated-client request.
 */
export interface CommittedSubstitutionInput {
  /** The stable Food Object ID of the selected suggestion. */
  readonly foodObjectId: number;
  /** The committed transport Food Quantity. */
  readonly quantity: { readonly value: number; readonly unit: QuantityUnit };
  /** The current page index. */
  readonly pageIndex: number;
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
 * The next-page transition: MORE! was activated from a successful result
 * with later pages and the next-page Substitution Search request is
 * pending (task 37, ARCH-002, REQ-041, REQ-047). The current cards stay
 * retained and the spinner inside the MORE! control shows for the complete
 * pending interval.
 */
export interface LoadingMoreInteractionState extends SubstitutionSearchInteractionState {
  readonly name: "loadingMore";
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
 * reached only `empty`; task 28 adds `loadingNew`, `results`, and
 * `zeroResults`; task 37 adds `loadingMore` (REQ-041).
 * Transitions, not independent booleans, determine the visible controls.
 */
export type InteractionState =
  | EmptyInteractionState
  | LoadingNewInteractionState
  | LoadingMoreInteractionState
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
   * Applies the Substitution Search response outcome (task 28, task 37,
   * ARCH-002): transitions `loadingNew` or `loadingMore` to `results` when
   * the page contains items, otherwise to `zeroResults`. The response data
   * itself stays in TanStack Query; the store receives only the outcome.
   */
  applySearchResult: (hasItems: boolean) => void;
  /**
   * Commits the next page index (`pageIndex + 1`) from a successful result
   * (task 37, ARCH-002, REQ-041): transitions `results` to `loadingMore`
   * with the unchanged selected Food Object, committed Food Quantity, and
   * `pageIndex: state.pageIndex + 1`. It is a no-op when not in the `results`
   * state.
   */
  loadNextPage: () => void;
  /**
   * Applies draft number text from the quantity editor (task 34,
   * ISSUE-010): the exact raw text is kept unchanged, and the validation
   * state follows the ISSUE-010 syntax of the current draft unit. The
   * error clears as soon as the draft becomes syntactically valid, without
   * committing it; a valid draft starts no request.
   */
  setQuantityText: (text: string) => void;
  /**
   * Applies a unit selection from the quantity editor (task 34,
   * ISSUE-010): the draft is replaced with `1` for Serving or `100` for a
   * base unit and committed immediately. A changed resolved value or unit
   * starts one fresh Substitution Search request through the query key;
   * an unchanged one starts none.
   */
  selectUnit: (unit: QuantityUnit) => void;
  /**
   * Commits the current draft number on Enter or focus leaving the
   * complete quantity editor (task 34, ISSUE-010). A syntactically valid
   * value above the selected maximum is silently replaced by that whole
   * maximum before commit. A changed resolved value or unit clears the
   * error and starts one fresh request; a draft that resolves to the
   * committed value clears validation but starts no request. An invalid
   * draft keeps the exact text, raises the validation state, and starts no
   * request.
   */
  commitQuantity: () => void;
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
 * Applies one resolved valid quantity draft as the committed transport
 * quantity (task 34, ISSUE-010): the field text becomes the resolved
 * (clamped) value, the draft unit becomes the committed unit, and the
 * validation state clears. The committed value and unit change only when
 * the resolved draft differs from the committed quantity, so an unchanged
 * draft (including a clamp back to the committed maximum) starts no
 * request through the query key.
 */
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
        if (state.name !== "loadingNew" && state.name !== "loadingMore") {
          return state;
        }
        return {
          ...state,
          name: hasItems ? "results" : "zeroResults",
        };
      });
    },
    loadNextPage() {
      update((state) => {
        if (state.name !== "results") {
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
      update((state) => {
        if (state.name === "empty") {
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
      update((state) => {
        if (state.name === "empty") {
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
      update((state) => {
        if (state.name === "empty") {
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

/**
 * The single browser-interaction state store of the application (ARCH-002).
 * It is initialized before the first application render like the persisted
 * Interface Language store, and every interactive surface reads it through
 * the store subscription.
 */
export const interactionState: InteractionStateStore = createInteractionState();
