import { QueryClient } from "@tanstack/svelte-query";

/**
 * The single TanStack Query client for the Obiad browser application.
 *
 * It is created at module load and provided to the whole component tree by
 * the root application. No query is registered at startup, so mounting the
 * application performs no HTTP request (task 21, ARCH-001, ARCH-002).
 */
export const queryClient = new QueryClient();
