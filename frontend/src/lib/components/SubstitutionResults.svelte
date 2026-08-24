<script lang="ts">
  import { tick } from "svelte";
  import ResultCard from "./ResultCard.svelte";
  import SelectedFoodSummary from "./SelectedFoodSummary.svelte";
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState } from "../interactionState";
  import {
    createSubstitutionSearchQuery,
    substitutionSearchLock,
  } from "../substitutionSearch";
  /**
   * Result-state composition (task 30, task 37, task 38, task 41;
   * ARCH-001, ARCH-002, ARCH-003, ARCH-011, ARCH-018, ARCH-019,
   * ARCH-020, ARCH-022, REQ-003, REQ-036, REQ-037, REQ-041, REQ-042,
   * REQ-043, REQ-044, REQ-045, REQ-047, REQ-050, REQ-058, REQ-061,
   * REQ-062, REQ-065, REQ-066, ISSUE-008, ISSUE-010, ISSUE-011,
   * ISSUE-013) with the ISSUE-010 editable selected-food summary and
   * quantity recalculation (task 34, ARCH-018, REQ-027, REQ-028).
   *
   * The root application composes the Phase 7 surfaces; this component —
   * rendered inside the root's QueryClientProvider — owns the Substitution
   * Search query and renders the selected-input, result-card, and
   * zero-result regions after the Search region. It stays mounted from
   * selection onward: from `loadingNew`, the initial summary is visible with
   * disabled controls. Each region follows the Search field at `24px`
   * intervals without a separate spinner below Search (REQ-080, ISSUE-008).
   *
   * TanStack Query owns the HTTP response data and pending state; the
   * interaction state receives only the success outcome through
   * `applySearchResult` (ARCH-002), so no query result is ever copied into
   * a Svelte store. The query reads the committed transport quantity and
   * current page index from the interaction state (task 34): a changed
   * valid commit replaces the committed quantity and starts one fresh
   * generated-client request with the same Food Object ID and current page
   * (REQ-027, REQ-028). While that recalculation is pending,
   * `placeholderData: keepPreviousData` retains the previous page. Each
   * selected-food and result card keeps its layout and result image, hides
   * its non-image content, and shows one centered, aria-hidden `16px`
   * spinner while the combined region stays busy with one polite `Updating
   * quantities` announcement (REQ-081, ISSUE-010). The transition
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
   * REQ-058).
   *
   * Task 37 and Task 38 complete MORE! result paging (REQ-041, REQ-043,
   * REQ-045, REQ-065, REQ-066, REQ-082). Whenever a later page exists
   * (`hasMore: true`), one visible and accessibly named `MORE!` button is
   * rendered after the result grid. While a next-page request is pending
   * (`loadingMore`), the focused control keeps its localized label, becomes
   * gray and `aria-disabled`, and its guarded handler accepts no additional
   * activation (REQ-082). On intermediate success (`hasMore: true`), the
   * requested page's cards replace the previous cards and focus stays on
   * the MORE! button (REQ-041, REQ-065). On final-page success
   * (`hasMore: false`), the
   * remaining one to three cards are rendered, MORE! is omitted, and
   * programmatic focus moves to the stable results heading (REQ-043,
   * REQ-066). When the user selects a new Food Object from any page, the
   * interaction state commits page 0 (REQ-045).
   *
   * Task 41 completes the failed new-Search slice (REQ-050, ISSUE-013).
   * When the current `loadingNew` generated-client request reaches its
   * terminal error, the union transitions to `newSearchFailure`: the
   * exact Search Query, selected Substitution Input, committed Food
   * Quantity, and Search focus are retained, result cards and MORE! leave
   * the rendered state, every pending spinner ends, the global request
   * lock releases with the request, and exactly the ISSUE-013 retry
   * message renders in one atomic polite status region at the stable top
   * of the result area. TanStack Query continues to own the terminal
   * error and response data; no automatic or lifecycle retry exists, no
   * successful response is reused, and the visitor retries through the
   * existing suggestion control.
   */

  /**
   * The current discriminated interaction state (ARCH-002). It is named
   * `interaction`, not `state`, so the `$state` runes below are never
   * shadowed by a store-like identifier (svelte-check resolves `$state` as
   * a legacy store subscription when a variable named `state` is in scope).
   */
  const interaction = $derived($interactionState);
  /** The active dictionary for the localized zero-result message (ARCH-003). */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /** Reference to the stable results heading for last-page focus (REQ-066). */
  let headingElement: HTMLHeadingElement | null = $state(null);
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
   * fresh committed-quantity key. The combined region stays busy while each
   * card hides its non-image content behind one centered spinner (REQ-081).
   */
  const recalculating = $derived(
    interaction.name === "results" && substitutionSearch.isPlaceholderData,
  );
  /** Whether the global substitution request lock is active (ARCH-011, ARCH-019, REQ-048). */
  const locked = $derived(
    $substitutionSearchLock || interaction.name === "loadingMore",
  );

  /**
   * Result transition (task 28, task 37, task 38, task 41; ARCH-002):
   * the current response transitions the union to `results` when the page
   * contains items and to `zeroResults` when it is empty. A subsequent
   * page response arriving while the state is `loadingMore` transitions
   * the union back to `results` (REQ-041). When that subsequent page is
   * the last page (`hasMore: false`), focus moves to the stable results
   * heading (REQ-066). From `newSearchFailure` (task 41), a success
   * completes a retry started through a changed valid Food Quantity
   * commit: the pending interval keeps the failure state and its retry
   * message, and the response transitions the union to `results` or
   * `zeroResults`. The response data itself stays in TanStack Query; the
   * store receives only the outcome.
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
      const wasLoadingMore = interaction.name === "loadingMore";
      const isLastPage = !data.hasMore;
      interactionState.applySearchResult(data.items.length > 0);
      if (wasLoadingMore && isLastPage) {
        tick().then(() => {
          headingElement?.focus();
        });
      }
    }
  });

  /**
   * Failed new-search transition (task 41, REQ-050, ARCH-002, ARCH-019):
   * when the current `loadingNew` generated-client request reaches its
   * terminal error, TanStack Query owns that error and the union
   * transitions to `newSearchFailure`. The exact Search Query, selected
   * Substitution Input, committed Food Quantity, and Search focus are
   * retained; result cards and MORE! leave the rendered state, every
   * pending spinner ends, and the global request lock releases with the
   * request. No automatic or lifecycle retry exists and no successful
   * response is reused, so the visitor retries through the existing
   * suggestion control.
   */
  $effect(() => {
    if (
      interaction.name === "loadingNew" &&
      substitutionSearch.error !== null
    ) {
      interactionState.applyNewSearchFailure();
    }
  });

  /**
   * Next-page request handler (task 37, REQ-041): activates MORE! from a
   * completed result state, committing `pageIndex + 1`.
   */
  function onMoreClick(): void {
    if (locked) {
      return;
    }
    if (interaction.name === "results") {
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
    <SelectedFoodSummary
      {interaction}
      data={substitutionSearch.data}
      {recalculating}
    />
  </div>
{/if}
{#if interaction.name === "newSearchFailure"}
  <!--
    Failed new-search region (task 41; REQ-050, ISSUE-013): the terminal
    failure of the current new-search request replaces the result area
    with exactly the ISSUE-013 retry message at the stable top of the
    result area, below the selected Substitution Input and above any
    result heading or cards. One atomic polite status region (`role="status"`)
    renders and announces the exact visible message once without
    interrupting current screen-reader speech; no duplicate visually
    hidden message exists and no focus moves, so Search keeps focus.
  -->
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
{#if (interaction.name === "results" || interaction.name === "loadingMore") && substitutionSearch.data !== undefined}
  <!--
    Result-card region (task 30, task 37; ARCH-001, ARCH-002, ARCH-003,
    ARCH-011, ARCH-018, ARCH-020, ARCH-022, REQ-036, REQ-037, REQ-041,
    REQ-042, REQ-047, REQ-058, REQ-061, REQ-062, REQ-065, REQ-081,
    ISSUE-008, ISSUE-011): the successful page response renders exactly its
    zero-to-three display-ready Substitutes in ranked order at `24px` below
    the selected-input region. The layout has one card column below 1024px
    and three equal columns from 1024px. Each card uses the active
    Interface Language, so current names, labels, and localized numeric
    values update locally without another request. While a valid quantity
    recalculation is pending (task 34), the retained previous page keeps
    each result image visible, hides each card's non-image content without
    changing layout, and shows one centered, aria-hidden `16px` spinner in
    that content area (REQ-081, ISSUE-010).

    Task 37 renders one visible and accessibly named `MORE!` button after
    the result grid whenever a later page exists (`hasMore: true`). While a
    next-page request is pending (`loadingMore`), the current cards remain
    visible and the focused control keeps its localized label with a gray,
    `aria-disabled` non-operable presentation (REQ-082). On intermediate
    success, the requested page's cards replace the previous cards and
    focus stays on the MORE! button (REQ-041, REQ-065).
  -->
  <div data-result-region aria-busy={recalculating} class="mt-6">
    <h2
      bind:this={headingElement}
      tabindex="-1"
      data-substitutions-heading
      class="text-center text-lg font-bold text-dark-text-primary focus:outline-none"
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
    {#if substitutionSearch.data.hasMore || interaction.name === "loadingMore"}
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
