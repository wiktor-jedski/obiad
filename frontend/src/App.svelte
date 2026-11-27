<script lang="ts">
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "./lib/queryClient";
  import { foodPlaceholderUrl } from "./lib/assets";
  import DataSources from "./lib/components/DataSources.svelte";
  import Search from "./lib/components/Search.svelte";
  import InterfaceLanguage from "./lib/components/InterfaceLanguage.svelte";
  import SubstitutionResults from "./lib/components/SubstitutionResults.svelte";
  import { interactionState } from "./lib/interactionState";
  import LandingDialogue from "./lib/components/LandingDialogue.svelte";
  import HeaderDropdown from "./lib/components/HeaderDropdown.svelte";
  import { getDictionary } from "./lib/i18n";
  import { interfaceLanguage } from "./lib/interfaceLanguage";
  import { isNormalizedEmptySearchQuery } from "./lib/searchQuery";
  import MealPage from "./lib/components/MealPage.svelte";
  import type { SearchReturn } from "./lib/searchReturn";

  let { restored }: { restored?: SearchReturn } = $props();

  const dataCommit = import.meta.env.VITE_DATA_COMMIT;
  const sourcesPage = window.location.pathname === "/sources";
  const mealPage = window.location.pathname.match(/^\/meals\/([^/]+)\/?$/);
  const mealId =
    mealPage && /^[1-9]\d*$/.test(mealPage[1]) ? Number(mealPage[1]) : 0;
  const searchPage = !sourcesPage && !mealPage;
  const dictionary = $derived(getDictionary($interfaceLanguage));
  const editingDraft = $derived(
    $interactionState.name === "empty" &&
      $interactionState.focused &&
      !isNormalizedEmptySearchQuery($interactionState.query),
  );
</script>

<QueryClientProvider client={queryClient}>
  <main
    data-placeholder-url={foodPlaceholderUrl}
    data-interaction-state={$interactionState.name}
    class="relative mx-auto min-h-dvh w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 {searchPage &&
    $interactionState.name === 'empty'
      ? 'pt-[max(340px,calc(45dvh_-_28px))]'
      : 'pt-16'} {editingDraft ? 'max-sm:pt-16' : ''}"
  >
    <div class="absolute left-4 top-4 z-20 sm:left-6 lg:left-8">
      <HeaderDropdown align="left" label="obiad — menu">
        {#snippet trigger()}
          <span class="text-[30px] font-bold tracking-[-0.07em]">obiad</span>
        {/snippet}
        <nav aria-label={dictionary.navigationLabel()}>
          <a
            class="header-menu-item"
            href="/"
            aria-current={searchPage ? "page" : undefined}
            >{dictionary.searchLabel()}</a
          >
          <a
            class="header-menu-item"
            href="/sources"
            aria-current={sourcesPage ? "page" : undefined}
            >{dictionary.dataSourcesHeading()}</a
          >
        </nav>
      </HeaderDropdown>
    </div>
    {#if sourcesPage}
      <DataSources {dataCommit} />
    {:else if mealPage}
      <MealPage id={mealId} />
    {:else}
      <div class="relative mx-auto w-full max-w-[640px]">
        {#if $interactionState.name === "empty"}
          <div class={editingDraft ? "max-sm:hidden" : undefined}>
            <LandingDialogue />
          </div>
        {/if}
        <Search />
      </div>
      <SubstitutionResults {restored} />
    {/if}
    <InterfaceLanguage />
  </main>
</QueryClientProvider>
