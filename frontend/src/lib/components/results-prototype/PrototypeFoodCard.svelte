<script lang="ts">
  import type { Snippet } from "svelte";
  import type { FoodQuantity } from "../../../client/types.gen";
  import type { ProjectedSubstituteItem } from "../../substituteProjection";
  import { foodPlaceholderUrl, resolveFoodImage } from "../../assets";
  import { formatFoodQuantityValue, formatMacronutrientValue, getDictionary, type InterfaceLanguage } from "../../i18n";

  let { food, language, variant, rank, editor, nutritionEditor }: {
    food: Omit<ProjectedSubstituteItem, "matchedQuantity" | "similarityPercent"> & { quantity: FoodQuantity; similarityPercent?: number };
    language: InterfaceLanguage;
    variant: string;
    rank?: number;
    editor?: Snippet;
    nutritionEditor?: Snippet<["calories" | "protein" | "carbohydrate" | "fat", number]>;
  } = $props();
  const dictionary = $derived(getDictionary(language));
  const macros = $derived([
    { field: "protein" as const, label: dictionary.proteinLabel(), value: food.macronutrients.protein },
    { field: "carbohydrate" as const, label: dictionary.carbohydratesLabel(), value: food.macronutrients.carbohydrate },
    { field: "fat" as const, label: dictionary.fatLabel(), value: food.macronutrients.fat },
  ]);
</script>

<article data-prototype-card data-food-id={food.foodObjectId} data-selected={editor ? "true" : undefined} class="prototype-card overflow-hidden border border-dark-secondary/25 bg-dark-surface {variant === 'C' ? 'rounded-[28px]' : 'rounded-2xl'}">
  <img
    data-prototype-image
    src={resolveFoodImage(food.imageKey)}
    alt={food.names[language]}
    loading={editor ? "eager" : "lazy"}
    onerror={(event) => { if (event.currentTarget.getAttribute("src") !== foodPlaceholderUrl) event.currentTarget.setAttribute("src", foodPlaceholderUrl); }}
    class="aspect-square w-full object-cover"
  />
  <div data-prototype-details class="flex min-w-0 flex-col justify-center p-5 {variant === 'C' ? 'lg:self-stretch lg:justify-start' : ''}">
    {#if variant !== "C"}
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span class="font-semibold text-dark-secondary">{editor ? dictionary.selectedFoodLabel() : `${String(rank).padStart(2, "0")} / ${language === "pl" ? "Zamiennik" : "Substitute"}`}</span>
        {#if food.similarityPercent !== undefined}
          <span class="text-dark-text-muted">{food.similarityPercent}% {dictionary.similarityLabel()}</span>
        {/if}
      </div>
    {/if}
    <h3 class="mb-3 text-lg leading-snug font-semibold tracking-tight {variant === 'C' ? 'lg:text-3xl' : ''}">{food.names[language]}</h3>
    <div data-prototype-summary class="prototype-numbers mb-4 flex min-h-11 items-center text-lg {variant === 'C' ? 'gap-1 whitespace-nowrap font-normal lg:text-2xl' : ''}">
      {#if editor}
        {@render editor()}
      {:else}
        <span>{formatFoodQuantityValue(food.quantity, language)}</span>
      {/if}
      {#if variant === "C"}
        <span aria-hidden="true" class="text-dark-text-muted">|</span>
        <span data-prototype-calories class="inline-flex items-baseline gap-1">
          {#if nutritionEditor}
            {@render nutritionEditor("calories", food.calories)}
          {:else}
            {food.calories}
          {/if}
          <span>kcal</span>
        </span>
        {#if food.similarityPercent !== undefined}
          <span data-prototype-similarity aria-label={`${dictionary.similarityLabel()}: ${food.similarityPercent}%`} class="ml-auto pl-2 text-right">{food.similarityPercent}%</span>
        {/if}
      {/if}
    </div>
    {#if variant !== "C"}
      <p class="prototype-numbers mb-3 text-dark-secondary"><strong class={variant === "B" ? "text-3xl font-semibold" : "text-2xl font-bold"}>{food.calories}</strong> <span class="text-sm">kcal</span></p>
    {/if}
    <dl class={variant === "B" ? "prototype-numbers grid gap-1.5 border-t border-dark-secondary/25 pt-3" : `prototype-numbers grid grid-cols-3 gap-2 border-t border-dark-secondary/25 pt-3 ${variant === "C" ? "lg:mt-auto" : ""}`}>
      {#each macros as macro (macro.label)}
        <div class={variant === "B" ? "flex items-baseline justify-between gap-2" : "flex min-w-0 flex-col gap-1"}>
          <dt class="text-xs text-dark-text-muted">{macro.label}</dt>
          <dd class={variant === "B" ? "text-xl leading-tight" : "flex items-baseline gap-1 text-lg leading-tight"}>
            {#if nutritionEditor}
              {@render nutritionEditor(macro.field, macro.value)}<span>g</span>
            {:else if variant === "C"}
              {macro.value.toLocaleString(language, { useGrouping: false, maximumFractionDigits: 1 })} g
            {:else}
              {formatMacronutrientValue(macro.value, language)}
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  </div>
</article>
