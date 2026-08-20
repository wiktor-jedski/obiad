<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "./lib/queryClient";
  import { foodPlaceholderUrl } from "./lib/assets";
  import Search from "./lib/components/Search.svelte";
  import InterfaceLanguage from "./lib/components/InterfaceLanguage.svelte";
  import { interactionState } from "./lib/interactionState";
</script>

<!--
  Root application (task 21, ARCH-001; task 24, REQ-060, ISSUE-006;
  task 26, REQ-057, ISSUE-007; task 28, REQ-020, REQ-022).

  The TanStack Query client is available to the whole tree through the
  provider, but no query runs at startup: the suggestion query needs a
  focused nonempty Search Query in the empty state, and the Substitution
  Search query is disabled until a selection exists. The empty state renders
  one semantic primary content column (the `<main>` element) capped at
  `1280px` with the ISSUE-006 responsive horizontal page gutters, and the
  Search control centered at `45%` of `100dvh` (task 24).

  The Interface Language control (task 26) is the only additional surface:
  a segmented pill absolutely positioned in the primary column's top-right
  corner, inset by the existing responsive gutter. Because it is absolutely
  positioned and rendered after the Search control in DOM order, it neither
  moves the Search field nor changes the initial Tab focus target. It makes
  no application API request and adds no Search collaboration.

  The `data-placeholder-url` attribute (task 23, ARCH-015, ISSUE-006) exposes
  the resolved bundled placeholder URL to the real-stack presentation spec
  so it can fetch the asset from the Vite origin; later cards consume the
  same URL through `src/lib/assets`. No card or image is rendered here.

  The `data-interaction-state` attribute (task 28, ARCH-002) exposes the
  current interaction-state transition name to the real-stack
  pointer-substitution-search spec exactly like `data-placeholder-url`: it
  makes the discriminated state transitions observable without exposing
  response data, and later tasks reuse it for the result-state layout.
-->
<QueryClientProvider client={queryClient}>
  <main
    data-placeholder-url={foodPlaceholderUrl}
    data-interaction-state={$interactionState.name}
    class="relative mx-auto min-h-dvh w-full max-w-[1280px] px-4 pt-[calc(45dvh_-_28px)] sm:px-6 lg:px-8"
  >
    <Search />
    <InterfaceLanguage />
  </main>
</QueryClientProvider>
