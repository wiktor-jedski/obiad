<script lang="ts">
  /**
   * Empty-state Search control (task 24; ARCH-001, ARCH-020, REQ-060,
   * ISSUE-006).
   *
   * Renders the only empty-state control: an `<input type="search">` with a
   * visually hidden `Search` label and the `Search foods` placeholder, with
   * no icon and no autofocus. The pill-shaped field is `56px` high and
   * `min(100%, 640px)` wide; its text starts `0.5em` beyond the end radius.
   * The field is horizontally centered; its vertical placement at `45%` of
   * `100dvh` is owned by the primary column in App.svelte (ISSUE-006).
   * Styling follows docs/requirements/style.md:
   * Surface background, 1px Secondary border, Text-Primary text, and a
   * Primary border on focus without an outer highlight. The control makes no
   * application API request.
   */
</script>

<label for="food-search" class="sr-only">Search</label>
<input
  id="food-search"
  type="search"
  placeholder="Search foods"
  class="mx-auto block h-14 w-full max-w-[640px] appearance-none rounded-full border border-solid border-dark-secondary bg-dark-surface pl-[calc(1.75rem+0.5em)] pr-4 text-base text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden"
/>
