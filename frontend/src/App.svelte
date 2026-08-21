<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "./lib/queryClient";
  import { foodPlaceholderUrl } from "./lib/assets";
  import Search from "./lib/components/Search.svelte";
  import InterfaceLanguage from "./lib/components/InterfaceLanguage.svelte";
  import SubstitutionResults from "./lib/components/SubstitutionResults.svelte";
  import { interactionState } from "./lib/interactionState";
</script>

<!--
  Root application (task 21, ARCH-001; task 24, REQ-060, ISSUE-006;
  task 26, REQ-057, ISSUE-007; task 28, REQ-020, REQ-022; task 30,
  REQ-003, REQ-044, REQ-061, REQ-062, ISSUE-008).

  The TanStack Query client is available to the whole tree through the
  provider, but no query runs at startup: the suggestion query needs a
  focused nonempty Search Query in the empty state, and the Substitution
  Search query is disabled until a selection exists.

  Task 30 composes the completed Phase 7 loading, result, and zero-result
  surfaces in the root application: one semantic primary content column
  (the `<main>` element) capped at `1280px` with the ISSUE-006 responsive
  horizontal page gutters and the stable Search, selected-input, and
  result regions in that order. The Search control keeps its suggestion
  panel and the new-search spinner `12px` below the field (REQ-046);
  `SubstitutionResults` owns the page-0 Substitution Search query under
  the provider and renders the selected-input, result-card, and zero-result
  regions (ARCH-011, ARCH-019). The empty state retains the ISSUE-006
  Search geometry — the field's vertical center at `45%` of `100dvh` via
  the column padding. From `loadingNew` onward the column padding moves
  the Search field's top edge to `96px` from the viewport top, and the
  regions follow at `24px` intervals (ISSUE-008). A successful page-0
  response renders its zero-to-three display-ready Substitutes as one card
  per item, using one column below `1024px` and three equal columns from
  `1024px` (REQ-062); a successful empty page renders no cards and exactly
  the localized zero-result message `No substitutes found` or `Nie
  znaleziono zamienników` (REQ-044). Search stays above every result card,
  and the Search field keeps focus through the whole new-search transition
  (REQ-064). No Food Quantity edit, MORE!, request failure state, result
  announcement, card motion, or active-content language change belongs to
  this task.

  The Interface Language control (task 26) is the only additional surface:
  a borderless native dropdown absolutely positioned in the primary
  column's top-right corner, inset by the existing responsive gutter.
  Because it is absolutely positioned, it never moves the Search field.

  The `data-placeholder-url` attribute (task 23, ARCH-015, ISSUE-006)
  exposes the resolved bundled placeholder URL to the real-stack
  presentation specs so they can fetch the asset from the Vite origin.
  The `data-interaction-state` attribute (task 28, ARCH-002) exposes the
  current interaction-state transition name to the real-stack specs
  exactly like `data-placeholder-url`: it makes the discriminated state
  transitions observable without exposing response data.
-->
<QueryClientProvider client={queryClient}>
  <main
    data-placeholder-url={foodPlaceholderUrl}
    data-interaction-state={$interactionState.name}
    class="relative mx-auto min-h-dvh w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 {$interactionState.name ===
    'empty'
      ? 'pt-[calc(45dvh_-_28px)]'
      : 'pt-24'}"
  >
    <Search />
    <SubstitutionResults />
    <InterfaceLanguage />
  </main>
</QueryClientProvider>
