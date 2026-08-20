/**
 * Live Food Object suggestion slice (task 27; ARCH-001, ARCH-002, ARCH-008,
 * ARCH-010, ARCH-019, REQ-012, REQ-013, REQ-018).
 *
 * The Search control calls `GET /api/v1/food-suggestions` only through the
 * generated TypeScript HTTP client and TanStack Query. Each request is keyed
 * by the Search Query text and the active Interface Language, the query
 * function passes TanStack Query's `AbortSignal` to the generated client,
 * and automatic retry and successful-response reuse are disabled (ARCH-019):
 * `retry: false`, `gcTime: 0`, and the default zero stale time. Because the
 * stale superseded query is garbage-collected immediately, its in-flight
 * browser request is aborted, and because every query key carries the query
 * text and language, neither an aborted request nor an out-of-order response
 * can replace the list rendered for the latest key. No normalized-empty
 * validation and no suggestion failure UI belong to this slice (Phase 9,
 * task 27 scope).
 */
import { createQuery } from "@tanstack/svelte-query";
import { client } from "../client/client.gen";
import type {
  FoodSuggestionsResponse,
  GetFoodSuggestionsData,
  GetFoodSuggestionsErrors,
  GetFoodSuggestionsResponses,
} from "../client/types.gen";
import type { InterfaceLanguage } from "./i18n";

/**
 * The stable `id` of the suggestion listbox panel; the Search input's
 * `aria-controls` references it (ARCH-020 combobox/listbox pattern).
 */
export const SUGGESTIONS_LISTBOX_ID = "food-suggestions-listbox";

/**
 * Returns the stable DOM `id` of one suggestion option (ARCH-020,
 * REQ-018). The id is derived from the stable Food Object ID, so it stays
 * identical across renders, languages, and query changes, and the Search
 * input's `aria-activedescendant` can reference it.
 *
 * @param foodObjectId - the stable Food Object ID of the suggestion
 * @returns the stable option id
 */
export function suggestionOptionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
}

/** The reactive inputs the suggestion query reads from the interaction state. */
export interface SuggestionsQueryInput {
  /** The current Search Query text accessor. */
  query: () => string;
  /** Whether the Search field currently has focus. */
  focused: () => boolean;
  /** The active Interface Language accessor. */
  language: () => InterfaceLanguage;
}

/**
 * Creates the TanStack Query that owns the live suggestion list (ARCH-010,
 * ARCH-019). The query is enabled only while the Search field is focused and
 * contains nonempty text; it is keyed by the Search Query and the active
 * Interface Language; the query function passes TanStack Query's
 * `AbortSignal` through to the generated client; automatic retry and
 * successful-response reuse are disabled; and window focus never triggers a
 * suggestion refetch, so only genuine query or focus intents start requests.
 *
 * @param input - the reactive query, focus, and language accessors
 * @returns the TanStack Query result owning the HTTP data and pending state
 */
export function createSuggestionsQuery(input: SuggestionsQueryInput) {
  return createQuery(() => ({
    queryKey: ["food-suggestions", input.language(), input.query()] as const,
    queryFn: ({ signal }) =>
      fetchSuggestions({
        query: input.query(),
        language: input.language(),
        signal,
      }),
    enabled: input.focused() && input.query().length > 0,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  }));
}

/**
 * Executes one `GET /api/v1/food-suggestions` request through the generated
 * TypeScript client (ARCH-001, ARCH-008) with TanStack Query's
 * `AbortSignal`. The response envelope carries exactly five suggestions;
 * generated transport values never leave this boundary typed as Module
 * values.
 *
 * @param options - the Search Query, Interface Language, and abort signal
 * @returns the five-item suggestion envelope
 */
export function fetchSuggestions(options: {
  query: string;
  language: InterfaceLanguage;
  signal?: AbortSignal;
}): Promise<FoodSuggestionsResponse> {
  const data: GetFoodSuggestionsData = {
    url: "/api/v1/food-suggestions",
    query: { query: options.query, language: options.language },
  };
  return client.get<
    GetFoodSuggestionsResponses,
    GetFoodSuggestionsErrors,
    true,
    "data"
  >({
    ...data,
    signal: options.signal,
    throwOnError: true,
    responseStyle: "data",
  });
}
