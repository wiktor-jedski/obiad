/**
 * New-search and quantity-recalculation slice (task 28, task 34;
 * ARCH-001, ARCH-002, ARCH-008, ARCH-010, ARCH-011, ARCH-019, REQ-020,
 * REQ-022, REQ-023, REQ-024, REQ-027, REQ-028).
 *
 * Pointer selection of one suggestion starts exactly one
 * `POST /api/v1/substitutes/search` request through the generated
 * TypeScript HTTP client and TanStack Query: the selected Food Object ID,
 * the unchanged returned default Food Quantity, and page index `0`
 * (ARCH-010, ARCH-011). Task 34 extends the same query to the committed
 * transport quantity: each changed valid quantity commit replaces the
 * committed Food Quantity and starts one fresh request with the same Food
 * Object ID and current page (REQ-027, REQ-028, ISSUE-010). Each request
 * is keyed by the selected Food Object ID, the committed Food Quantity,
 * and the current page index; the query function passes TanStack Query's
 * `AbortSignal` to the generated client; automatic retry and
 * successful-response reuse are disabled (ARCH-019) with `retry: false`
 * and `gcTime: 0`, and every lifecycle-driven refetch path is disabled
 * (`retryOnMount`, `refetchOnMount`, `refetchOnReconnect`,
 * `refetchOnWindowFocus`) so a network reconnect or a component remount
 * never submits a second request. There is no duplicate intent, queue,
 * second submit action, or response-data store: the query is enabled only
 * while a committed input exists, one key change starts one fresh request,
 * and the interaction state receives only the success outcome, never the
 * response data (ARCH-002).
 * Every selected-food and result-card spinner is bound directly to the real
 * Substitution Search pending interval (task 40, ARCH-019, REQ-049). No
 * artificial loading floor, trailing timer, or minimum duration delays the
 * request or extends spinner presentation.
 * While a recalculation is in flight, `placeholderData: keepPreviousData`
 * keeps the previous page mounted so each card preserves its layout and
 * result image while its non-image content is hidden behind one centered
 * spinner (REQ-081, ISSUE-010). The fresh
 * request still runs; the placeholder rows are replaced by the current
 * response when it arrives, and `isPlaceholderData` distinguishes the
 * retained previous page from the current response so the `loadingNew`
 * transition effect never fires on retained data.
 */
import { createQuery, keepPreviousData } from "@tanstack/svelte-query";
import { readable, type Readable } from "svelte/store";
import { client } from "../client/client.gen";
import type {
  SearchSubstitutesData,
  SearchSubstitutesErrors,
  SearchSubstitutesResponses,
  SubstituteSearchResponse,
} from "../client/types.gen";
import type { CommittedSubstitutionInput } from "./interactionState";
import { queryClient } from "./queryClient";

/**
 * The query-key prefix of every Substitution Search query. The full key
 * adds the committed Food Object ID, the committed Food Quantity, and the
 * current page index, so each new selection and each changed valid commit
 * starts a real backend request instead of reusing a successful response
 * (ARCH-019).
 */
export const SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX = [
  "substitute-search",
] as const;

/**
 * Whether a Substitution Search request is currently in-flight and holding
 * the global substitution request lock (ARCH-011, ARCH-019, REQ-048).
 *
 * New Search, valid Food Quantity recalculation, and MORE! paging share this
 * single lock owned by TanStack Query.
 *
 * @returns true if any Substitution Search query is fetching
 */
export function isSubstitutionSearchLocked(): boolean {
  return (
    queryClient.isFetching({
      queryKey: SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX,
    }) > 0
  );
}

/**
 * A readable Svelte store exposing the TanStack Query-owned Substitution Search
 * intent lock (ARCH-011, ARCH-019, REQ-048).
 *
 * It notifies subscribers whenever any Substitution Search query begins or
 * completes.
 */
export const substitutionSearchLock: Readable<boolean> = readable(
  isSubstitutionSearchLocked(),
  (set) => {
    const update = () => {
      set(isSubstitutionSearchLocked());
    };
    update();
    return queryClient.getQueryCache().subscribe(update);
  },
);

/** The reactive input the Substitution Search query reads from the interaction state. */
export interface SubstitutionSearchQueryInput {
  /**
   * The committed Substitution Search input accessor (task 34): the
   * selected Food Object ID, the committed transport Food Quantity, and
   * the current page index, or undefined before any selection.
   */
  committed: () => CommittedSubstitutionInput | undefined;
}

/**
 * Creates the TanStack Query that owns the Substitution Search (ARCH-011,
 * ARCH-019). The query is enabled only while a committed input exists and
 * is keyed by the selected Food Object ID, the committed Food Quantity,
 * and the current page index; the query function passes TanStack Query's
 * `AbortSignal` through to the generated client; automatic retry and
 * successful-response reuse are disabled; and every lifecycle-driven
 * refetch path is disabled — `retry: false` (no automatic retry),
 * `retryOnMount: false` (no mount retry of an errored query),
 * `refetchOnMount: false` (no refetch when an observer mounts with cached
 * data), `refetchOnWindowFocus: false`, and `refetchOnReconnect: false` —
 * so only a genuine selection or changed valid commit starts a
 * Substitution Search POST and neither a network reconnect nor a
 * component remount submits a second request (REQ-022, ARCH-019). While a
 * recalculation is pending, `placeholderData: keepPreviousData` retains
 * the previous page so each card can preserve its layout and result image
 * behind one centered loading spinner (task 34, REQ-081, ISSUE-010).
 *
 * @param input - the committed Substitution Search input accessor
 * @returns the TanStack Query result owning the HTTP data and pending state
 */
export function createSubstitutionSearchQuery(
  input: SubstitutionSearchQueryInput,
) {
  return createQuery(
    () => {
      const committed = input.committed();
      const queryKey =
        committed === undefined
          ? SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX
          : ([
              ...SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX,
              committed.foodObjectId,
              committed.quantity.value,
              committed.quantity.unit,
              committed.pageIndex,
            ] as const);
      return {
        queryKey,
        queryFn: async ({ signal }) => {
          // The query function runs only while the query is enabled, which
          // requires a committed input (ARCH-011); the guard keeps the
          // request body well-formed even if the option evaluation raced the
          // store update.
          const active = input.committed();
          if (active === undefined) {
            throw new Error("substitution search started without a selection");
          }
          return searchSubstitutes({
            foodObjectId: active.foodObjectId,
            quantity: active.quantity,
            pageIndex: active.pageIndex,
            signal,
          });
        },
        enabled: committed !== undefined,
        placeholderData: keepPreviousData,
        staleTime: Infinity,
        retry: false,
        retryOnMount: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        gcTime: 0,
      };
    },
    () => queryClient,
  );
}

/**
 * Executes one `POST /api/v1/substitutes/search` request through the
 * generated TypeScript client (ARCH-001, ARCH-008) with TanStack Query's
 * `AbortSignal`. The body carries the selected Food Object ID, the
 * committed transport Food Quantity, and the current page index
 * (ARCH-010, ARCH-011, ISSUE-010): the initial selection sends the
 * returned default quantity on page 0, and each changed valid quantity
 * commit sends the newly committed quantity on the current page.
 * Generated transport values never leave this boundary typed as Module
 * values.
 *
 * @param options - the Food Object ID, committed Food Quantity, page index, and abort signal
 * @returns the page-0 Substitute Search response envelope
 */
export function searchSubstitutes(options: {
  foodObjectId: number;
  quantity: CommittedSubstitutionInput["quantity"];
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
