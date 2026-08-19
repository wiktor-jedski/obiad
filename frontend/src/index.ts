/**
 * Compile-check entry for the generated API client.
 *
 * This minimal package compiles the generated TypeScript HTTP client and
 * types from the authoritative OpenAPI document (ISSUE-004). It intentionally
 * contains no Svelte, Vite, `/api` proxy, or suggestion interaction code; the
 * generated client is compile-checked only, and runtime behavior is verified
 * by the backend integration tests.
 */
import { client } from './client/client.gen';

import type { FoodSuggestionsResponse } from './client/types.gen';

export type { FoodSuggestionsResponse };

export { client };
