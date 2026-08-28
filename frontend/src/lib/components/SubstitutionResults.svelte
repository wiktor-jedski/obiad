<script lang="ts">
  import { tick } from "svelte";
  import ResultCard from "./ResultCard.svelte";
  import SelectedFoodSummary from "./SelectedFoodSummary.svelte";
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState } from "../interactionState";
  import { resultCardTransition } from "../resultCardMotion";
  import { projectSubstitutePage } from "../substituteProjection";
  import {
    createRetainedPageQuery,
    createSubstitutionSearchQuery,
    substitutionSearchLock,
  } from "../substitutionSearch";
  /**
   * Composes selected-food, result, paging, and failure surfaces.
   * Query data stays in TanStack Query; state stores only transitions.
   */

  /** Current interaction state; the name avoids shadowing Svelte's $state rune. */
  const interaction = $derived($interactionState);
  /** The active dictionary for the localized zero-result message. */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /** Stable heading reference for successful-result focus. */
  let headingElement: HTMLHeadingElement | null = $state(null);
  /** Stable focus target for the localized zero-result message. */
  let zeroResultMessageElement: HTMLParagraphElement | null = $state(null);
  /**
   * Primitive committed-input pieces keep query options identity-stable.
   * Unrelated interaction updates therefore do not resubscribe the query.
   */
  const committedFoodObjectId = $derived(
    interaction.name === "empty"
      ? undefined
      : interaction.selected.foodObjectId,
  );
  const committedQuantityValue = $derived(
    interaction.name === "empty" ? undefined : interaction.committedValue,
  );
  const committedQuantityUnit = $derived(
    interaction.name === "empty" ? undefined : interaction.committedUnit,
  );
  const committedPageIndex = $derived(
    interaction.name === "empty" ? undefined : interaction.pageIndex,
  );
  /**
   * Committed input for the selected food, quantity, and page.
   * It is undefined before selection.
   */
  const committed = $derived(
    committedFoodObjectId === undefined ||
      committedQuantityValue === undefined ||
      committedQuantityUnit === undefined ||
      committedPageIndex === undefined
      ? undefined
      : {
          foodObjectId: committedFoodObjectId,
          quantity: {
            value: committedQuantityValue,
            unit: committedQuantityUnit,
          },
          pageIndex: committedPageIndex,
        },
  );
  /**
   * Query for the committed Substitution Search input.
   * Previous data remains visible while a recalculation loads.
   */
  const substitutionSearch = createSubstitutionSearchQuery({
    committed: () => committed,
  });
  /**
   * Page index whose cards are currently displayed.
   * During next-page loading, this is one page behind the committed index.
   */
  const displayedPageIndex = $derived(
    interaction.name === "empty"
      ? undefined
      : interaction.name === "loadingMore"
        ? interaction.pageIndex - 1
        : interaction.pageIndex,
  );
  /**
   * Retains the displayed page while a next-page request is active.
   * It never fetches.
   */
  const retainedPageSearch = createRetainedPageQuery({
    committed: () => committed,
    displayedPageIndex: () => displayedPageIndex,
  });
  /**
   * Whether a valid quantity recalculation is pending.
   * Previous cards remain visible with busy presentation.
   */
  const recalculating = $derived(
    interaction.name === "results" && substitutionSearch.isPlaceholderData,
  );
  /** Whether a substitution request currently locks the controls. */
  const locked = $derived(
    $substitutionSearchLock || interaction.name === "loadingMore",
  );

  /**
   * Projected display-ready values for the selected input and result cards.
   */
  const projection = $derived(
    substitutionSearch.data !== undefined &&
      committed !== undefined &&
      substitutionSearch.data.selectedFood.foodObjectId ===
        committed.foodObjectId
      ? projectSubstitutePage(
          substitutionSearch.data.selectedFood,
          substitutionSearch.data.items,
          committed.quantity,
        )
      : undefined,
  );

  /**
   * Applies fresh response outcomes and moves focus to the appropriate result target.
   * Placeholder data does not trigger a transition.
   */
  $effect(() => {
    const data = substitutionSearch.data;
    if (
      (interaction.name === "loadingNew" ||
        interaction.name === "loadingMore" ||
        interaction.name === "newSearchFailure") &&
      data !== undefined &&
      !substitutionSearch.isPlaceholderData
    ) {
      const hasItems = data.items.length > 0;
      interactionState.applySearchResult(hasItems);
      if (hasItems) {
        tick().then(() => {
          headingElement?.focus();
        });
      }
      if (!hasItems) {
        // Empty results focus the stable message without a live-region announcement.
        tick().then(() => {
          zeroResultMessageElement?.focus();
        });
      }
    }
  });

  /** Transitions failed new searches to their retry state while retaining input. */
  $effect(() => {
    if (
      interaction.name === "loadingNew" &&
      substitutionSearch.error !== null
    ) {
      interactionState.applyNewSearchFailure();
    }
  });

  /** Restores the displayed page after a failed next-page request. */
  $effect(() => {
    if (
      interaction.name === "loadingMore" &&
      substitutionSearch.error !== null
    ) {
      interactionState.applyMoreFailure();
    }
  });

  /** Requests the next page from results or a retryable paging failure. */
  function onMoreClick(): void {
    if (locked) {
      return;
    }
    if (interaction.name === "results" || interaction.name === "moreFailure") {
      interactionState.loadNextPage();
    }
  }
</script>

{#if interaction.name !== "empty"}
  <div
    data-selected-input-region
    aria-busy={recalculating}
    class="mt-6 flex justify-center"
  >
    <SelectedFoodSummary {interaction} {projection} {recalculating} />
  </div>
{/if}
{#if interaction.name === "newSearchFailure" || interaction.name === "moreFailure"}
  <!-- Failed requests expose one polite retry message above the result surface. -->
  <div data-failure-region class="mt-6">
    <p
      role="status"
      data-retry-message
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {dictionary.retryMessage()}
    </p>
  </div>
{/if}
{#if interaction.name === "results" || interaction.name === "loadingMore" || interaction.name === "moreFailure"}
  <!-- Result cards use projected values and stable slots for page replacement. -->
  <div data-result-region aria-busy={recalculating} class="mt-6">
    <h2
      bind:this={headingElement}
      tabindex="-1"
      data-substitutions-heading
      class="text-center text-lg font-bold text-dark-text-primary focus:outline-none"
    >
      {dictionary.foundSubstitutionsHeading()}
    </h2>
    {#if projection !== undefined}
      <div data-result-grid class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {#each projection.items as item, index}
          <div data-result-card-slot class="grid">
            {#key item.foodObjectId}
              <div
                data-result-card-motion
                class="col-start-1 row-start-1 grid"
                out:resultCardTransition={{
                  rank: index,
                  firstPage: interaction.pageIndex === 0,
                }}
              >
                <ResultCard
                  {item}
                  language={$interfaceLanguage}
                  pending={recalculating}
                  rank={index}
                  firstPage={interaction.pageIndex === 0}
                />
              </div>
            {/key}
          </div>
        {/each}
      </div>
    {/if}
    {#if (substitutionSearch.data !== undefined && substitutionSearch.data.hasMore) || interaction.name === "loadingMore" || interaction.name === "moreFailure"}
      <div class="mt-6 flex justify-center">
        <button
          type="button"
          data-more-button
          aria-label={dictionary.moreButtonLabel()}
          aria-disabled={locked}
          onclick={onMoreClick}
          class="inline-flex min-h-11 min-w-28 items-center justify-center rounded px-6 py-2.5 font-ui text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary {locked
            ? 'cursor-not-allowed bg-gray-600 text-gray-300'
            : 'bg-dark-primary text-dark-text-on-bright hover:bg-dark-secondary'}"
        >
          {dictionary.moreButtonLabel()}
        </button>
      </div>
    {/if}
  </div>
{/if}
{#if interaction.name === "zeroResults"}
  <!-- Empty responses render a focusable localized message and no cards. -->
  <div data-zero-result-region class="mt-6">
    <p
      bind:this={zeroResultMessageElement}
      tabindex="-1"
      data-zero-result-message
      class="text-base text-dark-text-primary focus:outline-none"
    >
      {dictionary.zeroResultsMessage()}
    </p>
  </div>
{/if}
