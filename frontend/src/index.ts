/**
 * Compile-check entry for the generated API client.
 *
 * This minimal package compiles the generated TypeScript HTTP client and
 * types from the authoritative OpenAPI document (ISSUE-004). It intentionally
 * contains no Svelte, Vite, `/api` proxy, or suggestion interaction code; the
 * generated client is compile-checked only, and runtime behavior is verified
 * by the backend integration tests.
 */
import { client } from "./client/client.gen";

import type { Error } from "./client/types.gen";
import type { FoodSuggestionsResponse } from "./client/types.gen";
import type { SubstituteSearchRequest } from "./client/types.gen";
import type { SubstituteSearchResponse } from "./client/types.gen";
import type { SubstituteItem } from "./client/types.gen";
import type { SubstitutionQuantity } from "./client/types.gen";
import type { MatchedQuantity } from "./client/types.gen";
import type { Macronutrients } from "./client/types.gen";

export type {
  Error,
  FoodSuggestionsResponse,
  SubstituteSearchRequest,
  SubstituteSearchResponse,
  SubstituteItem,
  SubstitutionQuantity,
  MatchedQuantity,
  Macronutrients,
};

export { client };
