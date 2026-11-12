import { createQuery, keepPreviousData } from "@tanstack/svelte-query";
import { client } from "../client/client.gen";
import { isNormalizedEmptySearchQuery } from "./searchQuery";
import type {
  FoodSuggestionsResponse,
  GetFoodSuggestionsData,
  GetFoodSuggestionsErrors,
  GetFoodSuggestionsResponses,
} from "../client/types.gen";
import type { InterfaceLanguage } from "./i18n";

export const SUGGESTIONS_LISTBOX_ID = "food-suggestions-listbox";

export const SUGGESTIONS_QUERY_KEY_PREFIX = ["food-suggestions"] as const;

export function suggestionOptionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
}

export interface SuggestionsQueryInput {
  query: () => string;

  focused: () => boolean;

  language: () => InterfaceLanguage;

  active: () => boolean;
}

export function createSuggestionsQuery(input: SuggestionsQueryInput) {
  return createQuery(() => ({
    queryKey: [
      ...SUGGESTIONS_QUERY_KEY_PREFIX,
      input.language(),
      input.query(),
    ] as const,
    queryFn: ({ signal }) =>
      fetchSuggestions({
        query: input.query(),
        language: input.language(),
        signal,
      }),
    enabled:
      input.active() &&
      input.focused() &&
      !isNormalizedEmptySearchQuery(input.query()),
    placeholderData: keepPreviousData,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  }));
}

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
