<script lang="ts">
  import ResultCard from "./ResultCard.svelte";
  import SelectedFoodSummary from "./SelectedFoodSummary.svelte";
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState } from "../interactionState";
  import { createSubstitutionSearchQuery } from "../substitutionSearch";

  /**
   * Result-state composition (task 30; ARCH-001, ARCH-002, ARCH-003,
   * ARCH-011, ARCH-019, ARCH-020, ARCH-022, REQ-003, REQ-036, REQ-037,
   * REQ-044, REQ-061, ISSUE-008) with the ISSUE-010 editable selected-food
   * summary and quantity recalculation (task 34, ARCH-018, REQ-027,
   * REQ-028).
   *
   * The root application composes the Phase 7 surfaces; this component —
   * rendered inside the root's QueryClientProvider — owns the Substitution
   * Search query and renders the selected-input, result-card, and
   * zero-result regions after the Search region. It stays mounted from
   * selection onward: from `loadingNew` the initial summary is already
   * visible with disabled controls, the new-search spinner lives in the
   * Search region `12px` below the field (REQ-046), and each region here
   * follows at `24px` intervals (ISSUE-008).
   *
   * TanStack Query owns the HTTP response data and pending state; the
   * interaction state receives only the success outcome through
   * `applySearchResult` (ARCH-002), so no query result is ever copied into
   * a Svelte store. The query reads the committed transport quantity and
   * current page index from the interaction state (task 34): a changed
   * valid commit replaces the committed quantity and starts one fresh
   * generated-client request with the same Food Object ID and current page
   * (REQ-027, REQ-028). While that recalculation is pending,
   * `placeholderData: keepPreviousData` retains the previous page so the
   * summary and cards keep names, images, labels, and quantity-independent
   * similarity visible while every quantity-dependent value shows an
   * aria-hidden `16px` spinner and the combined region stays busy with one
   * polite `Updating quantities` announcement (ISSUE-010). The transition
   * effect fires only for the current response — never for retained
   * placeholder data — so the union reaches `results`/`zeroResults` exactly
   * once per new selection.
   *
   * A successful three-item page renders exactly the three result cards in
   * ranked order. The cards use one column from 320px through 1023px and
   * three equal columns from 1024px (REQ-062). A successful empty page
   * renders no cards and exactly the localized zero-result message `No
   * substitutes found` or `Nie znaleziono zamienników` (REQ-044). The
   * message, selected-food summary, and cards follow the active Interface
   * Language dictionary and localized Food Object names (ARCH-003,
   * REQ-058). There is no MORE!, failure state, result announcement, or card
   * motion here; Phase 12 owns request-failure presentation.
   */

  /** The current discriminated interaction state (ARCH-002). */
  const state = $derived($interactionState);
  /** The active dictionary for the localized zero-result message (ARCH-003). */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /**
   * The primitive pieces of the committed Substitution Search input
   * (task 34, ISSUE-010). They are derived separately so the committed
   * input object below stays identity-stable across unrelated interaction
   * state updates (for example the Search field focus intent): Svelte
   * invalidates a `$derived` reader only when the derived VALUE changes,
   * and these are primitives. An identity-stable committed input keeps the
   * Substitution Search query options stable, so an unrelated store update
   * never re-subscribes the query observer and never starts a second
   * request (ARCH-019, REQ-022).
   */
  const searchState = $derived(state.name === "empty" ? undefined : state);
  const committedFoodObjectId = $derived(searchState?.selected.foodObjectId);
  const committedQuantityValue = $derived(searchState?.committedValue);
  const committedQuantityUnit = $derived(searchState?.committedUnit);
  const committedPageIndex = $derived(searchState?.pageIndex);
  /**
   * The committed Substitution Search input (task 34, ISSUE-010): the
   * selected Food Object ID, the committed transport Food Quantity, and
   * the current page index, or undefined while the state is empty. The
   * query is keyed by exactly this committed input, so each changed valid
   * commit starts one fresh request. The explicit `undefined` guards
   * narrow every piece to its concrete type and keep the object rebuilt
   * only when one of the primitive pieces actually changes.
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
   * The TanStack Query owning the Substitution Search (ARCH-011,
   * ARCH-019). It is disabled until a committed input exists, so mounting
   * the application performs no request and no duplicate intent, queue,
   * automatic retry, or second submit action can start an extra request.
   * While a recalculation is pending, `keepPreviousData` retains the
   * previous page as placeholder rows that `isPlaceholderData` identifies.
   */
  const substitutionSearch = createSubstitutionSearchQuery({
    committed: () => committed,
  });

  /**
   * Whether a valid quantity recalculation is pending (task 34,
   * ISSUE-010): a completed result transition is visible while TanStack
   * Query holds the retained previous page as placeholder data for the
   * fresh committed-quantity key. Controls stay enabled, the combined
   * region stays busy, and quantity-dependent values show spinners.
   */
  const recalculating = $derived(
    state.name === "results" && substitutionSearch.isPlaceholderData,
  );

  /**
   * Result transition (task 28, task 37; ARCH-002): the first page-0
   * response data arriving while the state is `loadingNew` transitions the
   * union to `results` when the page contains items and to `zeroResults`
   * when it is empty. A subsequent page response arriving while the state
   * is `loadingMore` transitions the union back to `results` (REQ-041). The
   * response data itself stays in TanStack Query; the store receives only
   * the outcome.
   */
  $effect(() => {
    const data = substitutionSearch.data;
    if (
      (state.name === "loadingNew" || state.name === "loadingMore") &&
      data !== undefined &&
      !substitutionSearch.isPlaceholderData
    ) {
      interactionState.applySearchResult(data.items.length > 0);
    }
  });

  /**
   * Next-page request handler (task 37, REQ-041): activates MORE! from a
   * completed result state, committing `pageIndex + 1`.
   */
  function onMoreClick(): void {
    if (state.name === "results") {
      interactionState.loadNextPage();
    }
  }
</script>

{#if state.name !== "empty"}
  <div
    data-selected-input-region
    aria-busy={recalculating}
    class="mt-6 flex justify-center"
  >
    <SelectedFoodSummary
      interaction={state}
      data={substitutionSearch.data}
      {recalculating}
    />
  </div>
{/if}
{#if (state.name === "results" || state.name === "loadingMore") && substitutionSearch.data !== undefined}
  <!--
    Result-card region (task 30, task 37; ARCH-001, ARCH-002, ARCH-003,
    ARCH-011, ARCH-018, ARCH-020, ARCH-022, REQ-036, REQ-037, REQ-041,
    REQ-042, REQ-047, REQ-058, REQ-061, REQ-062, REQ-065, ISSUE-008,
    ISSUE-011): the successful page response renders exactly its
    zero-to-three display-ready Substitutes in ranked order at `24px` below
    the selected-input region. The layout has one card column below 1024px
    and three equal columns from 1024px. Each card uses the active
    Interface Language, so current names, labels, and localized numeric
    values update locally without another request. While a valid quantity
    recalculation is pending (task 34), the retained previous page stays
    rendered with every quantity-dependent card value replaced by an
    aria-hidden `16px` spinner (`pending`), while names, images, labels, and
    quantity-independent similarity stay visible (ISSUE-010).

    Task 37 renders one visible and accessibly named `MORE!` button after
    the result grid whenever a later page exists (`hasMore: true`). While a
    next-page request is pending (`loadingMore`), the current cards remain
    visible and an aria-hidden spinner replaces the visible button label
    inside the control (REQ-047). On intermediate success, the requested
    page's cards replace the previous cards and focus stays on the MORE!
    button (REQ-041, REQ-065).
  -->
  <div data-result-region aria-busy={recalculating} class="mt-6">
    <h2
      data-substitutions-heading
      class="text-center text-lg font-bold text-dark-text-primary"
    >
      {dictionary.foundSubstitutionsHeading()}
    </h2>
    <div data-result-grid class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
      {#each substitutionSearch.data.items as item (item.foodObjectId)}
        <ResultCard
          {item}
          language={$interfaceLanguage}
          pending={recalculating}
        />
      {/each}
    </div>
    {#if substitutionSearch.data.hasMore || state.name === "loadingMore"}
      <div class="mt-6 flex justify-center">
        <button
          type="button"
          data-more-button
          aria-label={dictionary.moreButtonLabel()}
          onclick={onMoreClick}
          class="inline-flex min-h-11 min-w-28 items-center justify-center rounded bg-dark-primary px-6 py-2.5 font-ui text-sm font-semibold text-dark-text-on-bright transition-colors duration-200 hover:bg-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary"
        >
          {#if state.name === "loadingMore"}
            <span
              data-more-spinner
              aria-hidden="true"
              class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-dark-text-on-bright/30 border-t-dark-text-on-bright"
            ></span>
          {:else}
            {dictionary.moreButtonLabel()}
          {/if}
        </button>
      </div>
    {/if}
  </div>
{/if}
{#if state.name === "zeroResults"}
  <!--
    Zero-result region (task 30; REQ-044, ISSUE-008): a successful empty
    page-0 response replaces the result area with exactly the localized
    result message and no cards.
  -->
  <div data-zero-result-region class="mt-6">
    <p class="text-base text-dark-text-primary">
      {dictionary.zeroResultsMessage()}
    </p>
  </div>
{/if}
