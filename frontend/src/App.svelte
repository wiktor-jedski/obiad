<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from './lib/queryClient';
  import { foodPlaceholderUrl } from './lib/assets';
</script>

<!--
  Minimal root application (task 21, ARCH-001).

  The TanStack Query client is available to the whole tree through the
  provider, but no query runs at startup and none of the excluded surfaces
  are rendered: no Interface Language control, no suggestions, no selected
  input, no result cards, and no result state. The Search control and the
  primary content column arrive with task 24.

  The `data-placeholder-url` attribute (task 23, ARCH-015, ISSUE-006) exposes
  the resolved bundled placeholder URL to the real-stack presentation spec
  so it can fetch the asset from the Vite origin; later cards consume the
  same URL through `src/lib/assets`. No card or image is rendered here.
-->
<QueryClientProvider client={queryClient}>
  <main data-placeholder-url={foodPlaceholderUrl}></main>
</QueryClientProvider>
