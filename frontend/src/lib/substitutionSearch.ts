/**
 * New-search slice (task 28; ARCH-001, ARCH-002, ARCH-008, ARCH-010,
 * ARCH-011, ARCH-019, REQ-020, REQ-022, REQ-023, REQ-024).
 *
 * Pointer selection of one suggestion starts exactly one
 * `POST /api/v1/substitutes/search` request through the generated
 * TypeScript HTTP client and TanStack Query: the selected Food Object ID,
 * the unchanged returned default Food Quantity, and page index `0`
 * (ARCH-010, ARCH-011). Each request is keyed by the selected Food Object
 * ID, the Food Quantity, and page index `0`; the query function passes
 * TanStack Query's `AbortSignal` to the generated client; automatic retry
 * and successful-response reuse are disabled (ARCH-019) with `retry: false`
 * and `gcTime: 0`, and every lifecycle-driven refetch path is disabled
 * (`retryOnMount`, `refetchOnMount`, `refetchOnReconnect`,
 * `refetchOnWindowFocus`) so a network reconnect or a component remount
 * never submits a second request. There is no duplicate intent, queue,
 * second submit action, or response-data store: the query is enabled only
 * while a selection exists, one key change starts one fresh request, and
 * the interaction state receives only the success outcome, never the
 * response data (ARCH-002).
 */
import { createQuery } from "@tanstack/svelte-query";
import { client } from "../client/client.gen";
import type {
  SearchSubstitutesData,
  SearchSubstitutesErrors,
  SearchSubstitutesResponses,
  SubstituteSearchResponse,
} from "../client/types.gen";
import type { SelectedFoodObject } from "./interactionState";

/**
 * The query-key prefix of every Substitution Search query. The full key
 * adds the selected Food Object ID, the Food Quantity, and the page index
 * `0`, so each new selection starts a real backend request instead of
 * reusing a successful response (ARCH-019).
 */
export const SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX = [
  "substitute-search",
] as const;

/** The reactive input the Substitution Search query reads from the interaction state. */
export interface SubstitutionSearchQueryInput {
  /** The selected Food Object accessor, or undefined before any selection. */
  selected: () => SelectedFoodObject | undefined;
}

/**
 * Creates the TanStack Query that owns the page-0 Substitution Search
 * (ARCH-011, ARCH-019). The query is enabled only while a selection exists
 * and is keyed by the selected Food Object ID, the Food Quantity, and page
 * index `0`; the query function passes TanStack Query's `AbortSignal`
 * through to the generated client; automatic retry and successful-response
 * reuse are disabled; and every lifecycle-driven refetch path is disabled
 * — `retry: false` (no automatic retry), `retryOnMount: false` (no mount
 * retry of an errored query), `refetchOnMount: false` (no refetch when an
 * observer mounts with cached data), `refetchOnWindowFocus: false`, and
 * `refetchOnReconnect: false` — so only a genuine selection intent starts
 * a Substitution Search POST and neither a network reconnect nor a
 * component remount submits a second request (REQ-022, ARCH-019).
 *
 * @param input - the selected Food Object accessor
 * @returns the TanStack Query result owning the HTTP data and pending state
 */
export function createSubstitutionSearchQuery(
  input: SubstitutionSearchQueryInput,
) {
  return createQuery(() => {
    const selected = input.selected();
    const queryKey =
      selected === undefined
        ? SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX
        : ([
            ...SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX,
            selected.foodObjectId,
            selected.quantity.value,
            selected.quantity.unit,
            0,
          ] as const);
    return {
      queryKey,
      queryFn: ({ signal }) => {
        // The query function runs only while the query is enabled, which
        // requires a selection (ARCH-011); the guard keeps the request body
        // well-formed even if the option evaluation raced the store update.
        const active = input.selected();
        if (active === undefined) {
          throw new Error("substitution search started without a selection");
        }
        return searchSubstitutes({
          foodObjectId: active.foodObjectId,
          quantity: active.quantity,
          pageIndex: 0,
          signal,
        });
      },
      enabled: selected !== undefined,
      retry: false,
      retryOnMount: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      gcTime: 0,
    };
  });
}

/**
 * Executes one `POST /api/v1/substitutes/search` request through the
 * generated TypeScript client (ARCH-001, ARCH-008) with TanStack Query's
 * `AbortSignal`. The body carries the selected Food Object ID, the
 * unchanged returned default Food Quantity, and page index `0` (ARCH-010,
 * ARCH-011). Generated transport values never leave this boundary typed as
 * Module values.
 *
 * @param options - the Food Object ID, Food Quantity, page index, and abort signal
 * @returns the page-0 Substitute Search response envelope
 */
export function searchSubstitutes(options: {
  foodObjectId: number;
  quantity: SelectedFoodObject["quantity"];
  pageIndex: number;
  signal?: AbortSignal;
}): Promise<SubstituteSearchResponse> {
  const data: SearchSubstitutesData = {
    url: "/api/v1/substitutes/search",
    body: {
      foodObjectId: options.foodObjectId,
      quantity: options.quantity,
      pageIndex: options.pageIndex,
    },
  };
  return client.post<
    SearchSubstitutesResponses,
    SearchSubstitutesErrors,
    true,
    "data"
  >({
    ...data,
    signal: options.signal,
    throwOnError: true,
    responseStyle: "data",
  });
}
