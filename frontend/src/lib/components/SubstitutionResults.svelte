<script lang="ts">
  import ResultCard from "./ResultCard.svelte";
  import SelectedInput from "./SelectedInput.svelte";
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState } from "../interactionState";
  import { createSubstitutionSearchQuery } from "../substitutionSearch";

  /**
   * Result-state composition (task 30; ARCH-001, ARCH-002, ARCH-003,
   * ARCH-011, ARCH-019, ARCH-020, ARCH-022, REQ-003, REQ-036, REQ-037,
   * REQ-044, REQ-061, ISSUE-008).
   *
   * The root application composes the Phase 7 surfaces; this component —
   * rendered inside the root's QueryClientProvider — owns the page-0
   * Substitution Search query and renders the selected-input, result-card,
   * and zero-result regions after the Search region. It stays mounted from
   * selection onward: from `loadingNew` the read-only Substitution Input
   * is already visible, the new-search spinner lives in the Search region
   * `12px` below the field (REQ-046), and each region here follows at
   * `24px` intervals (ISSUE-008).
   *
   * TanStack Query owns the HTTP response data and pending state; the
   * interaction state receives only the success outcome through
   * `applySearchResult` (ARCH-002), so no query result is ever copied into
   * a Svelte store. The transition effect fires when the first page-0
   * response data arrives while the state is `loadingNew`: the union moves
   * to `results` when the page contains items and to `zeroResults` when it
   * is empty.
   *
   * A successful three-item page renders exactly the three result cards in
   * ranked order. The cards use one column from 320px through 1023px and
   * three equal columns from 1024px (REQ-062). A successful empty page
   * renders no cards and exactly the localized zero-result message `No
   * substitutes found` or `Nie znaleziono zamienników` (REQ-044). The
   * message follows the active Interface Language dictionary — it is
   * interface text, not captured active content (ARCH-003) — while every
   * card is frozen to the Interface Language captured by the search
   * (ISSUE-008). There is no Food Quantity edit, MORE!, failure state,
   * result announcement, or card motion here.
   */

  /** The current discriminated interaction state (ARCH-002). */
  const state = $derived($interactionState);
  /** The active dictionary for the localized zero-result message (ARCH-003). */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /** The selected Food Object, or undefined while the state is empty. */
  const selected = $derived(
    state.name === "empty" ? undefined : state.selected,
  );
  /**
   * The TanStack Query owning the page-0 Substitution Search (ARCH-011,
   * ARCH-019). It is disabled until a selection exists, so mounting the
   * application performs no request and no duplicate intent, queue,
   * automatic retry, or second submit action can start an extra request.
   */
  const substitutionSearch = createSubstitutionSearchQuery({
    selected: () => selected,
  });

  /**
   * Result transition (task 28, ARCH-002): the first page-0 response data
   * arriving while the state is `loadingNew` transitions the union to
   * `results` when the page contains items and to `zeroResults` when it is
   * empty. The response data itself stays in TanStack Query; the store
   * receives only the outcome, and the spinner covers the complete pending
   * interval.
   */
  $effect(() => {
    const data = substitutionSearch.data;
    if (state.name === "loadingNew" && data !== undefined) {
      interactionState.applySearchResult(data.items.length > 0);
    }
  });
</script>

{#if state.name !== "empty"}
  <div data-selected-input-region class="mt-6">
    <SelectedInput selected={state.selected} />
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
    and the store receives only the outcome (ARCH-002).
  -->
  <div data-result-region class="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
    {#each substitutionSearch.data.items as item (item.foodObjectId)}
      <ResultCard {item} language={state.selected.capturedLanguage} />
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
