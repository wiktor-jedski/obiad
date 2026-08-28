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

export const SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX = [
  "substitute-search",
] as const;

export function isSubstitutionSearchLocked(): boolean {
  return (
    queryClient.isFetching({
      queryKey: SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX,
    }) > 0
  );
}

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

export interface SubstitutionSearchQueryInput {
  committed: () => CommittedSubstitutionInput | undefined;
}

export interface RetainedPageQueryInput extends SubstitutionSearchQueryInput {
  displayedPageIndex: () => number | undefined;
}

function substitutionSearchKey(
  committed: CommittedSubstitutionInput,
  pageIndex: number,
): readonly unknown[] {
  return [
    ...SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX,
    committed.foodObjectId,
    committed.quantity.value,
    committed.quantity.unit,
    pageIndex,
  ] as const;
}

export function createSubstitutionSearchQuery(
  input: SubstitutionSearchQueryInput,
) {
  return createQuery(
    () => {
      const committed = input.committed();
      const queryKey =
        committed === undefined
          ? SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX
          : substitutionSearchKey(committed, committed.pageIndex);
      return {
        queryKey,
        queryFn: async ({ signal }) => {
          const active = input.committed();
          if (active === undefined) {
            throw new Error("substitution search started without a selection");
          }
          return searchSubstitutes({
            foodObjectId: active.foodObjectId,
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

export function createRetainedPageQuery(input: RetainedPageQueryInput) {
  return createQuery(
    () => {
      const committed = input.committed();
      const displayed = input.displayedPageIndex();
      const queryKey =
        committed === undefined || displayed === undefined
          ? SUBSTITUTE_SEARCH_QUERY_KEY_PREFIX
          : substitutionSearchKey(committed, displayed);
      return {
        queryKey,

        enabled: false,
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

export function searchSubstitutes(options: {
  foodObjectId: number;
  pageIndex: number;
  signal?: AbortSignal;
}): Promise<SubstituteSearchResponse> {
  const data: SearchSubstitutesData = {
    url: "/api/v1/substitutes/search",
    body: {
      foodObjectId: options.foodObjectId,
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
