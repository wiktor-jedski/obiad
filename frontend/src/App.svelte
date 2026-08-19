<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from './lib/queryClient';
  import { foodPlaceholderUrl } from './lib/assets';
  import Search from './lib/components/Search.svelte';
</script>

<!--
  Root application (task 21, ARCH-001; task 24, REQ-060, ISSUE-006).

  The TanStack Query client is available to the whole tree through the
  provider, but no query runs at startup and none of the excluded surfaces
  are rendered: no Interface Language control, no suggestions, no selected
  input, no result cards, and no result state. The empty state renders one
  semantic primary content column (the `<main>` element) capped at
  `1280px` with the ISSUE-006 responsive horizontal page gutters, and the
  Search control centered at `45%` of `100dvh` (task 24).

  The `data-placeholder-url` attribute (task 23, ARCH-015, ISSUE-006) exposes
  the resolved bundled placeholder URL to the real-stack presentation spec
  so it can fetch the asset from the Vite origin; later cards consume the
  same URL through `src/lib/assets`. No card or image is rendered here.
-->
<QueryClientProvider client={queryClient}>
  <main
    data-placeholder-url={foodPlaceholderUrl}
    class="mx-auto min-h-dvh w-full max-w-[1280px] px-4 pt-[calc(45dvh_-_28px)] sm:px-6 lg:px-8"
  >
    <Search />
  </main>
</QueryClientProvider>
