<script lang="ts">
  import ResultsView from "./ResultsView.svelte";
  import { interactionState } from "../interactionState";
  import {
    createRetainedPageQuery,
    createSubstitutionSearchQuery,
    substitutionSearchLock,
  } from "../substitutionSearch";

  const interaction = $derived($interactionState);
  const foodObjectId = $derived(
    interaction.name === "empty"
      ? undefined
      : interaction.selected.foodObjectId,
  );
  const pageIndex = $derived(
    interaction.name === "empty" ? undefined : interaction.pageIndex,
  );
  const committed = $derived(
    foodObjectId === undefined || pageIndex === undefined
      ? undefined
      : { foodObjectId, pageIndex },
  );
  const substitutionSearch = createSubstitutionSearchQuery({
    committed: () => committed,
  });
  const displayedPageIndex = $derived(
    interaction.name === "empty"
      ? undefined
      : interaction.name === "loadingMore"
        ? interaction.pageIndex - 1
        : interaction.pageIndex,
  );

  // Keep the prior query alive so failed pagination rolls back without a refetch.
  createRetainedPageQuery({
    committed: () => committed,
    displayedPageIndex: () => displayedPageIndex,
  });
  const locked = $derived(
    $substitutionSearchLock || interaction.name === "loadingMore",
  );

  $effect(() => {
    const data = substitutionSearch.data;
    if (
      (interaction.name === "loadingNew" ||
        interaction.name === "loadingMore" ||
        interaction.name === "newSearchFailure") &&
      data !== undefined &&
      !substitutionSearch.isPlaceholderData &&
      data.selectedFood.foodObjectId === foodObjectId &&
      data.pageIndex === pageIndex
    ) {
      interactionState.applySearchResult(data.items.length > 0);
    }
  });

  $effect(() => {
    if (
      interaction.name === "loadingNew" &&
      substitutionSearch.error !== null
    ) {
      interactionState.applyNewSearchFailure();
    }
  });

  $effect(() => {
    if (
      interaction.name === "loadingMore" &&
      substitutionSearch.error !== null
    ) {
      interactionState.applyMoreFailure();
    }
  });

  function loadMore(): void {
    if (!locked) interactionState.loadNextPage();
  }

  function retrySearch(): void {
    if (!locked) void substitutionSearch.refetch();
  }
</script>

{#if interaction.name !== "empty"}
  {#key interaction.selected}
    <ResultsView
      {interaction}
      response={substitutionSearch.isPlaceholderData
        ? undefined
        : substitutionSearch.data}
      {locked}
      onmore={loadMore}
      onretry={retrySearch}
    />
  {/key}
{/if}
