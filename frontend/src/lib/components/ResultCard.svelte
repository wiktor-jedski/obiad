<script lang="ts">
  import type { ProjectedSubstituteItem } from "../substituteProjection";
  import { foodPlaceholderUrl, resolveFoodImage } from "../assets";
  import {
    formatCaloriesValue,
    formatMacronutrientValue,
    getDictionary,
  } from "../i18n";
  import type { InterfaceLanguage } from "../i18n";
  import { resultCardTransition } from "../resultCardMotion";

  /**
   * Displays one projected substitution with localized labels and motion.
   * It never calculates or rerounds nutrition values in the browser.
   */

  interface Props {
    /** One display-ready substitution item. */
    item: ProjectedSubstituteItem;
    language: InterfaceLanguage;
    /** Whether quantity recalculation is pending; non-image content is hidden. */
    pending?: boolean;
    /** Zero-based rank within the rendered result page. */
    rank?: number;
    /** Whether the card belongs to the first page. */
    firstPage?: boolean;
  }

  let {
    item,
    language,
    pending = false,
    rank = 0,
    firstPage = false,
  }: Props = $props();

  /** The active-language dictionary for the card's visible labels. */
  const dictionary = $derived(getDictionary(language));
  /** Resolved image URL; unsupported keys use the bundled placeholder. */
  const imageSrc = $derived(resolveFoodImage(item.imageKey));

  /**
   * Restores the bundled placeholder when an image load fails.
   * The guard avoids rewriting an already-resolved placeholder.
   */
  function onImageError(event: Event): void {
    const image = event.currentTarget;
    if (
      image instanceof HTMLImageElement &&
      image.getAttribute("src") !== foodPlaceholderUrl
    ) {
      image.setAttribute("src", foodPlaceholderUrl);
    }
  }
</script>

<article
  data-result-card
  data-food-object-id={item.foodObjectId}
  data-result-card-rank={rank}
  in:resultCardTransition|global={{ rank, firstPage }}
  class="relative overflow-hidden rounded-2xl border border-solid border-dark-secondary bg-dark-surface"
>
  <img
    data-result-card-image
    src={imageSrc}
    alt=""
    onerror={onImageError}
    class="h-44 w-full object-cover"
  />
  <div
    data-card-content
    class="flex flex-col gap-2 p-4"
    class:opacity-0={pending}
  >
    <h3 class="text-center text-base font-medium text-dark-text-primary">
      {item.names[language]}
    </h3>
    <p
      data-result-card-matched-quantity
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {`${item.matchedQuantity.value} ${item.matchedQuantity.unit}`}
    </p>
    <!-- Keep calories as a labeled group; paragraph aria-label is not allowed. -->
    <p
      data-result-card-calories
      role="group"
      aria-label={dictionary.caloriesLabel()}
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {formatCaloriesValue(item.calories)}
    </p>
    <dl class="flex flex-col gap-1 font-data text-sm">
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.proteinLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {formatMacronutrientValue(item.macronutrients.protein, language)}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.carbohydratesLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {formatMacronutrientValue(item.macronutrients.carbohydrate, language)}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.fatLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {formatMacronutrientValue(item.macronutrients.fat, language)}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.similarityLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {item.similarityPercent}%
        </dd>
      </div>
    </dl>
  </div>
  {#if pending}
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 top-44 flex items-center justify-center"
    >
      <span
        data-card-spinner
        aria-hidden="true"
        class="h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
      ></span>
    </div>
  {/if}
</article>
