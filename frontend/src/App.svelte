<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from './lib/queryClient';
</script>

<!--
  Minimal root application (task 21, ARCH-001).

  The TanStack Query client is available to the whole tree through the
  provider, but no query runs at startup and none of the excluded surfaces
  are rendered: no Interface Language control, no suggestions, no selected
  input, no result cards, and no result state. The Search control and the
  primary content column arrive with task 24.
-->
<QueryClientProvider client={queryClient}>
  <main></main>
</QueryClientProvider>
