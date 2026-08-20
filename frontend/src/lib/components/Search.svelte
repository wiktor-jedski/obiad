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
  import SuggestionList from "./SuggestionList.svelte";

  /**
   * Search control with the live Food Object suggestion slice (task 24,
   * task 25, task 27; ARCH-001, ARCH-002, ARCH-003, ARCH-008, ARCH-010,
   * ARCH-012, ARCH-019, ARCH-020, REQ-012, REQ-013, REQ-018, REQ-060,
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
   * id as `aria-activedescendant` (REQ-018). Task 31 completes the phase's
   * key transitions; no normalized-empty validation or suggestion failure
   * UI belongs to this task.
   */

  /** The current Search Query text from the interaction state. */
  const query = $derived($interactionState.query);
  /** Whether the Search field currently has focus. */
  const focused = $derived($interactionState.focused);
  /** The active Interface Language for the placeholder and names. */
  const language = $derived($interfaceLanguage);
  /** The active dictionary for the accessible label and placeholder. */
  const dictionary = $derived(getDictionary(language));

  /** The TanStack Query owning the live suggestion list (ARCH-019). */
  const suggestions = createSuggestionsQuery({
    query: () => query,
    focused: () => focused,
    language: () => language,
  });

  /**
   * The returned five suggestions of the latest response, or undefined
   * while no response is present for the current query.
   */
  const suggestionItems = $derived(
    suggestions.data !== undefined ? suggestions.data.items : undefined,
  );

  /**
   * Whether the suggestion panel is open: the field is focused and contains
   * nonempty text and the latest response has arrived. No loading or failure
   * surface belongs to this task, so the panel renders exactly the returned
   * five options.
   */
  const open = $derived(
    focused && query.length > 0 && suggestionItems !== undefined,
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

  /** Applies typed Search Query text to the interaction state. */
  function onInput(event: Event): void {
    interactionState.setQuery((event.currentTarget as HTMLInputElement).value);
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
    <SuggestionList items={suggestionItems} />
  {/if}
</div>
