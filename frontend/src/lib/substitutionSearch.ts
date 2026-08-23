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
 *
 * For visual review before the final animation phase, each successful
 * request keeps its loading state visible for at least `1000ms`. This makes
 * spinner-driven layout changes observable with a fast local response.
 *
 * While a recalculation is in flight, `placeholderData: keepPreviousData`
 * keeps the previous page visible so the summary and cards can retain
 * names, images, labels, and quantity-independent similarity with the
 * quantity-dependent values replaced by spinners (ISSUE-010). The fresh
 * request still runs; the placeholder rows are replaced by the current
 * response when it arrives, and `isPlaceholderData` distinguishes the
 * retained previous page from the current response so the `loadingNew`
 * transition effect never fires on retained data.
 */
import { createQuery, keepPreviousData } from "@tanstack/svelte-query";
import { client } from "../client/client.gen";
import type {
  SearchSubstitutesData,
  SearchSubstitutesErrors,
  SearchSubstitutesResponses,
  SubstituteSearchResponse,
} from "../client/types.gen";
import type { CommittedSubstitutionInput } from "./interactionState";

/** Temporary minimum successful-search loading duration for visual review. */
const MINIMUM_SEARCH_LOADING_DURATION_MS = 1_000;

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
 * the previous page so quantity-independent content stays visible and the
 * quantity-dependent values can show spinners (task 34, ISSUE-010).
 *
 * @param input - the committed Substitution Search input accessor
 * @returns the TanStack Query result owning the HTTP data and pending state
 */
export function createSubstitutionSearchQuery(
  input: SubstitutionSearchQueryInput,
) {
  return createQuery(() => {
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
        const { promise: minimumDuration, resolve } =
          Promise.withResolvers<void>();
        const minimumDurationTimer = setTimeout(
          resolve,
          MINIMUM_SEARCH_LOADING_DURATION_MS,
        );
        try {
          const [response] = await Promise.all([
            searchSubstitutes({
              foodObjectId: active.foodObjectId,
              quantity: active.quantity,
              pageIndex: active.pageIndex,
              signal,
            }),
            minimumDuration,
          ]);
          return response;
        } finally {
          clearTimeout(minimumDurationTimer);
        }
      },
      enabled: committed !== undefined,
      placeholderData: keepPreviousData,
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
