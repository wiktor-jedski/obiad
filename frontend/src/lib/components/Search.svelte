<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState } from "../interactionState";
  import { queryClient } from "../queryClient";
  import {
    SUGGESTIONS_LISTBOX_ID,
    SUGGESTIONS_QUERY_KEY_PREFIX,
    createSuggestionsQuery,
    suggestionOptionId,
  } from "../suggestions";
  import { createSubstitutionSearchQuery } from "../substitutionSearch";
  import SelectedInput from "./SelectedInput.svelte";
  import SuggestionList from "./SuggestionList.svelte";
  import type { FoodSuggestion } from "../../client/types.gen";

  /**
   * Search control with the live Food Object suggestion slice and the
   * pointer-selection and new-search transition (task 24, task 25,
   * task 27, task 28; ARCH-001, ARCH-002, ARCH-003, ARCH-008, ARCH-010,
   * ARCH-011, ARCH-012, ARCH-019, ARCH-020, REQ-012, REQ-013, REQ-018,
   * REQ-020, REQ-022, REQ-023, REQ-024, REQ-046, REQ-060, REQ-064,
   * ISSUE-006, ISSUE-007, ISSUE-008).
   *
   * The control renders an `<input type="search">` with a visually hidden
   * label and the placeholder from the active Interface Language
   * dictionary, with no icon and no autofocus. The pill-shaped field is
   * `56px` high and `min(100%, 640px)` wide; its text starts `0.5em`
   * beyond the end radius. The field is horizontally centered; its
   * vertical placement at `45%` of `100dvh` is owned by the primary column
   * in App.svelte (ISSUE-006). Styling follows docs/requirements/style.md:
   * Surface background, 1px Secondary border, Text-Primary text, and a
   * Primary border on focus without an outer highlight.
   *
   * Task 27 adds the suggestion slice: Search Query text and focus live in
   * the discriminated interaction state (ARCH-002), and the suggestion
   * request runs through the generated TypeScript client and TanStack Query
   * only while the field is focused and contains nonempty text (ARCH-010,
   * ARCH-019). The input follows the combobox/listbox pattern with the
   * listbox `aria-controls`, `aria-expanded`, and the first option's stable
   * id as `aria-activedescendant` (REQ-018).
   *
   * Task 28 adds the pointer-selection and new-search transition: a click
   * or tap on any option selects that exact returned Food Object without
   * moving focus from Search, closes the suggestion list, retains the
   * selected localized names and returned default Food Quantity as the
   * read-only Substitution Input, and starts exactly one generated-client
   * `POST /api/v1/substitutes/search` operation with that `foodObjectId`,
   * the unchanged default quantity, and `pageIndex: 0` (REQ-020, REQ-022,
   * REQ-023, REQ-024). The interaction-state union gains only the required
   * `loadingNew`, `results`, and `zeroResults` transitions; TanStack Query
   * continues to own response data and pending state, and the new-search
   * spinner shows `12px` below the Search field for the complete pending
   * interval (REQ-046), after which Search keeps focus (REQ-064). No Food
   * Quantity edit, MORE!, failure state, motion, or active-content
   * language-change behavior belongs to this task.
   */

  /** The current discriminated interaction state. */
  const state = $derived($interactionState);
  /** The current Search Query text from the interaction state. */
  const query = $derived(state.query);
  /** Whether the Search field currently has focus. */
  const focused = $derived(state.focused);
  /** The active Interface Language for the placeholder and names. */
  const language = $derived($interfaceLanguage);
  /** The active dictionary for the accessible label and placeholder. */
  const dictionary = $derived(getDictionary(language));

  /** The TanStack Query owning the live suggestion list (ARCH-019). */
  const suggestions = createSuggestionsQuery({
    query: () => query,
    focused: () => focused,
    language: () => language,
    stateName: () => state.name,
  });

  /**
   * The returned five suggestions of the latest response, or undefined
   * while no response is present for the current query.
   */
  const suggestionItems = $derived(
    suggestions.data !== undefined ? suggestions.data.items : undefined,
  );

  /**
   * Whether the suggestion panel is open: the interaction state is `empty`
   * (a selection has closed the list for the whole search transition), the
   * field is focused and contains nonempty text, and the latest response
   * has arrived. No loading or failure surface belongs to this task, so the
   * panel renders exactly the returned five options.
   */
  const open = $derived(
    state.name === "empty" &&
      focused &&
      query.length > 0 &&
      suggestionItems !== undefined,
  );

  /**
   * The stable id of the first (active) option for `aria-activedescendant`.
   * It exists only for a current open list: whenever the list is closed or
   * the field loses focus, the attribute is absent, so it can never point to
   * a removed option (ARCH-020, REQ-018).
   */
  const activeOptionId = $derived(
    open && suggestionItems !== undefined
      ? suggestionOptionId(suggestionItems[0].foodObjectId)
      : undefined,
  );

  /**
   * The selected Food Object captured by the latest selection, or undefined
   * while the interaction state is still empty (task 28).
   */
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
   * Fresh-visible-query boundary (ARCH-019): when the Search field loses
   * focus the suggestion query becomes inactive, and because the disabled
   * observer stays mounted, `gcTime: 0` alone does not evict it. Removing
   * every inactive suggestion query on blur guarantees that a later
   * identical intent — refocusing with the same Search Query text — starts
   * a real backend request and never reuses a successful response. The
   * panel stays closed until that fresh request returns, so a reused
   * response can never be visible.
   */
  $effect(() => {
    if (!focused) {
      queryClient.removeQueries({
        queryKey: SUGGESTIONS_QUERY_KEY_PREFIX,
      });
    }
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

  /** Applies typed Search Query text to the interaction state. */
  function onInput(event: Event): void {
    interactionState.setQuery((event.currentTarget as HTMLInputElement).value);
  }

  /**
   * Pointer activation of one suggestion (task 28, REQ-020): captures the
   * exact returned Food Object — stable ID, both localized names, the
   * returned default Food Quantity, and the active Interface Language — and
   * transitions the interaction state to `loadingNew`, which closes the
   * suggestion list while Search keeps focus and starts exactly one page-0
   * Substitution Search with the unchanged default quantity.
   */
  function selectSuggestion(item: FoodSuggestion): void {
    interactionState.selectSuggestion({
      foodObjectId: item.foodObjectId,
      names: item.names,
      quantity: item.defaultQuantity,
      capturedLanguage: language,
    });
  }
</script>

<label for="food-search" class="sr-only">{dictionary.searchLabel()}</label>
<div class="mx-auto w-full max-w-[640px]">
  <input
    id="food-search"
    type="search"
    value={query}
    placeholder={dictionary.searchPlaceholder()}
    role="combobox"
    aria-expanded={open}
    aria-controls={SUGGESTIONS_LISTBOX_ID}
    aria-autocomplete="list"
    aria-activedescendant={activeOptionId}
    oninput={onInput}
    onfocus={() => interactionState.setFocused(true)}
    onblur={() => interactionState.setFocused(false)}
    class="block h-14 w-full appearance-none rounded-full border border-solid border-dark-secondary bg-dark-surface pl-[calc(1.75rem+0.5em)] pr-4 text-base text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden"
  />
  {#if open && suggestionItems}
    <SuggestionList items={suggestionItems} onselect={selectSuggestion} />
  {/if}
  {#if state.name === "loadingNew"}
    <div
      data-new-search-spinner
      aria-hidden="true"
      class="mx-auto mt-3 h-6 w-6 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
    ></div>
  {/if}
  {#if state.name !== "empty"}
    <SelectedInput selected={state.selected} />
  {/if}
</div>
