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
  import { isNormalizedEmptySearchQuery } from "../searchQuery";
  import { substitutionSearchLock } from "../substitutionSearch";
  import SuggestionList from "./SuggestionList.svelte";
  import type { FoodSuggestion } from "../../client/types.gen";
  /**
   * Search field with live suggestions and keyboard or pointer selection.
   * Drafts stay local until a suggestion is selected.
   */

  /** Current interaction state; the name avoids shadowing Svelte's $state rune. */
  const interaction = $derived($interactionState);
  /** The current Search Query text from the interaction state. */
  const query = $derived(interaction.query);
  /** Whether the Search field currently has focus. */
  const focused = $derived(interaction.focused);
  /** The active Interface Language for the placeholder and names. */
  const language = $derived($interfaceLanguage);
  /** The active dictionary for the accessible label and placeholder. */
  const dictionary = $derived(getDictionary(language));

  /** Whether the current text opens an uncommitted suggestion intent. */
  let suggestionIntent = $state(false);

  /** TanStack Query that owns the live suggestion list. */
  const suggestions = createSuggestionsQuery({
    query: () => query,
    focused: () => focused,
    language: () => language,
    active: () => suggestionIntent,
  });

  const suggestionItems = $derived(
    suggestions.data !== undefined ? suggestions.data.items : undefined,
  );

  /** Latest returned suggestions, or undefined before a response arrives. */

  /**
   * Keyboard-active option index; it resets when typing or refocusing.
   * It never stores HTTP data.
   */
  let activeIndex = $state(0);

  /** Whether Escape dismissed the list until typing or refocusing. */
  let dismissed = $state(false);

  /**
   * The panel opens for a focused, nonempty intent with fresh data unless dismissed.
   * Completed results remain visible until a new suggestion is selected.
   */
  const open = $derived(
    suggestionIntent &&
      focused &&
      !isNormalizedEmptySearchQuery(query) &&
      suggestionItems !== undefined &&
      !dismissed,
  );

  /** Stable active-option id, present only while the list is open. */
  const activeOptionId = $derived(
    open && suggestionItems !== undefined
      ? suggestionOptionId(suggestionItems[activeIndex].foodObjectId)
      : undefined,
  );

  /** Remove inactive suggestion queries on blur so refocusing makes a fresh request. */
  $effect(() => {
    if (!focused) {
      queryClient.removeQueries({
        queryKey: SUGGESTIONS_QUERY_KEY_PREFIX,
      });
    }
  });

  /** Applies draft text without changing committed results. */
  function onInput(event: Event): void {
    const field = event.currentTarget;
    if (!(field instanceof HTMLInputElement)) {
      return;
    }
    dismissed = false;
    suggestionIntent = true;
    activeIndex = 0;
    interactionState.setQuery(field.value);
  }

  /**
   * Selects the current Search Query after a pointer click so a visitor can
   * replace an existing query with one keystroke, like a browser address bar.
   */
  function onClick(event: MouseEvent): void {
    const field = event.currentTarget;
    if (field instanceof HTMLInputElement && field.value !== "") {
      field.select();
    }
  }

  /**
   * Handles keyboard navigation, selection, dismissal, and normalized-empty no-op.
   * Focus remains on the Search field while the list is open.
   */
  function onKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (!open || suggestionItems === undefined) {
        return;
      }
      event.preventDefault();
      const lastIndex = suggestionItems.length - 1;
      if (key === "ArrowDown") {
        activeIndex = Math.min(activeIndex + 1, lastIndex);
      } else {
        activeIndex = Math.max(activeIndex - 1, 0);
      }
      return;
    }
    if (key === "Enter") {
      if (open && suggestionItems !== undefined) {
        event.preventDefault();
        if ($substitutionSearchLock) {
          return;
        }
        selectSuggestion(suggestionItems[activeIndex]);
        return;
      }
      if (isNormalizedEmptySearchQuery(query)) {
        // Normalized-empty Enter remains a browser no-op.
        event.preventDefault();
      }
      return;
    }
    if (key === "Escape") {
      if (!open) {
        return;
      }
      event.preventDefault();
      dismissed = true;
    }
  }

  /** Re-focuses the field and resets local list state. */
  function onFocus(): void {
    dismissed = false;
    if (interaction.name === "empty") {
      suggestionIntent = true;
    }
    activeIndex = 0;
    interactionState.setFocused(true);
  }

  /**
   * Selects a suggestion, closes the list, and starts the page-0 search.
   * Keyboard and pointer activation share this transition.
   */
  function selectSuggestion(item: FoodSuggestion): void {
    if ($substitutionSearchLock) {
      return;
    }
    suggestionIntent = false;
    interactionState.selectSuggestion({
      foodObjectId: item.foodObjectId,
      names: item.names,
      quantity: item.defaultQuantity,
      allowedQuantities: item.allowedQuantities,
      capturedLanguage: language,
    });
  }
</script>

<label for="food-search" class="sr-only">{dictionary.searchLabel()}</label>
<div data-search-region class="relative mx-auto w-full max-w-[640px]">
  <!-- svelte-ignore a11y_autofocus (Search is the page's primary action.) -->
  <input
    id="food-search"
    type="search"
    autofocus
    value={query}
    placeholder={dictionary.searchPlaceholder()}
    role="combobox"
    aria-expanded={open}
    aria-controls={SUGGESTIONS_LISTBOX_ID}
    aria-autocomplete="list"
    aria-activedescendant={activeOptionId}
    oninput={onInput}
    onclick={onClick}
    onfocus={onFocus}
    onblur={() => interactionState.setFocused(false)}
    onkeydown={onKeydown}
    class="block h-14 w-full appearance-none border border-solid border-dark-secondary bg-dark-surface pl-[calc(1.75rem+0.5em)] pr-4 text-base text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none {open
      ? 'rounded-t-[28px] rounded-b-none'
      : 'rounded-full'} [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden"
  />
  {#if open && suggestionItems}
    <SuggestionList
      items={suggestionItems}
      {activeIndex}
      locked={$substitutionSearchLock}
      onselect={selectSuggestion}
    />
  {/if}
</div>
