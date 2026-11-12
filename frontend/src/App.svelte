<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "./lib/queryClient";
  import { foodPlaceholderUrl } from "./lib/assets";
  import Search from "./lib/components/Search.svelte";
  import InterfaceLanguage from "./lib/components/InterfaceLanguage.svelte";
  import SubstitutionResults from "./lib/components/SubstitutionResults.svelte";
  import { interactionState } from "./lib/interactionState";
  import LandingDialogue from "./lib/components/LandingDialogue.svelte";
</script>

<QueryClientProvider client={queryClient}>
  <main
    data-placeholder-url={foodPlaceholderUrl}
    data-interaction-state={$interactionState.name}
    class="relative mx-auto min-h-dvh w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 {$interactionState.name ===
    'empty'
      ? 'pt-[max(340px,calc(45dvh_-_28px))]'
      : 'pt-16'}"
  >
    <a
      href="/"
      class="absolute left-4 top-4 flex h-11 items-center text-[30px] font-bold tracking-[-0.07em] text-dark-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary sm:left-6 lg:left-8"
    >
      obiad
    </a>
    <div class="relative mx-auto w-full max-w-[640px]">
      {#if $interactionState.name === "empty"}
        <LandingDialogue />
      {/if}
      <Search />
    </div>
    <SubstitutionResults />
    <InterfaceLanguage />
  </main>
</QueryClientProvider>
