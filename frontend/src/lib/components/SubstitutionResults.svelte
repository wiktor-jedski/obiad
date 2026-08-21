<script lang="ts">
  import ResultCard from "./ResultCard.svelte";
  import SelectedFoodSummary from "./SelectedFoodSummary.svelte";
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState, type QuantityUnit } from "../interactionState";
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
   * message follows the active Interface Language dictionary — it is
   * interface text, not captured active content (ARCH-003) — while every
   * card and the summary's name and macronutrient labels are frozen to the
   * Interface Language captured by the search (ISSUE-008). There is no
   * MORE!, failure state, result announcement, or card motion here; Phase
   * 12 owns request-failure presentation.
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
    state.name !== "loadingNew" && substitutionSearch.isPlaceholderData,
  );

  /**
   * Result transition (task 28, ARCH-002): the first page-0 response data
   * arriving while the state is `loadingNew` transitions the union to
   * `results` when the page contains items and to `zeroResults` when it is
   * empty. The response data itself stays in TanStack Query; the store
   * receives only the outcome, and the spinner covers the complete pending
   * interval. The guard on `isPlaceholderData` (task 34) keeps retained
   * previous-page rows — visible while a fresh selection or recalculation
   * is pending — from ever driving a transition.
   */
  $effect(() => {
    const data = substitutionSearch.data;
    if (
      state.name === "loadingNew" &&
      data !== undefined &&
      !substitutionSearch.isPlaceholderData
    ) {
      interactionState.applySearchResult(data.items.length > 0);
    }
  });
</script>

{#if state.name !== "empty"}
  <div data-selected-input-region aria-busy={recalculating} class="mt-6">
    <SelectedFoodSummary
      interaction={state}
      data={substitutionSearch.data}
      {recalculating}
    />
  </div>
{/if}
{#if state.name === "results" && substitutionSearch.data !== undefined}
  <!--
    Result-card region (task 30; ARCH-001, ARCH-020, ARCH-022, REQ-036,
    REQ-037, REQ-061, REQ-062): the successful page-0 response renders
    exactly its zero-to-three display-ready Substitutes in ranked order at
    `24px` below the selected-input region. The layout has one card column
    below 1024px and three equal columns from 1024px. Each card consumes one
    generated `SubstituteItem` and the Interface Language captured by the
    search (ISSUE-008); TanStack Query continues to own the response data
    and the store receives only the outcome (ARCH-002). While a valid
    quantity recalculation is pending (task 34), the retained previous page
    stays rendered with every quantity-dependent card value replaced by an
    aria-hidden `16px` spinner (`pending`), while names, images, labels,
    and quantity-independent similarity stay visible (ISSUE-010).
  -->
  <div
    data-result-region
    aria-busy={recalculating}
    class="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3"
  >
    {#each substitutionSearch.data.items as item (item.foodObjectId)}
      <ResultCard
        {item}
        language={state.selected.capturedLanguage}
        pending={recalculating}
      />
    {/each}
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
