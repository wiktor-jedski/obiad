<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "./lib/queryClient";
  import { foodPlaceholderUrl } from "./lib/assets";
  import Search from "./lib/components/Search.svelte";
  import InterfaceLanguage from "./lib/components/InterfaceLanguage.svelte";
  import SubstitutionResults from "./lib/components/SubstitutionResults.svelte";
  import { interactionState } from "./lib/interactionState";
</script>

<QueryClientProvider client={queryClient}>
  <main
    data-placeholder-url={foodPlaceholderUrl}
    data-interaction-state={$interactionState.name}
    class="relative mx-auto min-h-dvh w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 {$interactionState.name ===
    'empty'
      ? 'pt-[calc(45dvh_-_28px)]'
      : 'pt-16'}"
  >
    <Search />
    <SubstitutionResults />
    <InterfaceLanguage />
  </main>
</QueryClientProvider>
