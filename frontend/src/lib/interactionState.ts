/**
 * Browser Interaction Module (ARCH-002) — discriminated interaction state.
 *
 * Task 27 (Phase 7, Pointer Substitution Search) establishes the Phase-7
 * subset of the single discriminated browser-interaction state: the Search
 * Query text and the Search field focus intent. The state union has one
 * reachable variant today — `empty` — because no selection can start a
 * Substitution Search yet. Later Phase 7 tasks extend the same union only
 * with the required `loadingNew`, `results`, and `zeroResults` transitions
 * (task 28, REQ-020, REQ-022) while TanStack Query continues to own HTTP
 * response data and pending state; the Module never copies query results
 * into a Svelte store (ARCH-002, ARCH-010).
 *
 * The store pattern mirrors the persisted Interface Language store
 * (ARCH-012, ARCH-014): a factory for testable instances and the single
 * application store. Components subscribe with the `$` prefix and mutate
 * through the narrow typed actions, never by replacing the union value.
 */
import { writable, type Readable } from "svelte/store";

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
 * The discriminated browser-interaction state union (ARCH-002). Only the
 * Phase-7 subset for Search Query text and focus is reachable in task 27;
 * the later Substitution Search transitions extend this union.
 */
export type InteractionState = EmptyInteractionState;

/** The typed Browser Interaction Module surface of the interaction state. */
export interface InteractionStateStore extends Readable<InteractionState> {
  /** Applies the current Search Query text without changing focus. */
  setQuery: (query: string) => void;
  /** Applies the current Search field focus intent without changing text. */
  setFocused: (focused: boolean) => void;
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
  };
}

/**
 * The single browser-interaction state store of the application (ARCH-002).
 * It is initialized before the first application render like the persisted
 * Interface Language store, and every interactive surface reads it through
 * the store subscription.
 */
export const interactionState: InteractionStateStore = createInteractionState();
