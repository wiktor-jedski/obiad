<script lang="ts">
  import type { Snippet } from "svelte";
  import type { FoodQuantity } from "../../../client/types.gen";
  import type { ProjectedSubstituteItem } from "../../substituteProjection";
  import { foodPlaceholderUrl, resolveFoodImage } from "../../assets";
  import { formatFoodQuantityValue, formatMacronutrientValue, getDictionary, type InterfaceLanguage } from "../../i18n";
  import PrototypeCardReveal from "./PrototypeCardReveal.svelte";

  let { food, language, variant, rank, editor, nutritionEditor, titleControl, reveal }: {
    food: Omit<ProjectedSubstituteItem, "matchedQuantity" | "similarityPercent"> & { quantity: FoodQuantity; similarityPercent?: number };
    language: InterfaceLanguage;
    variant: string;
    rank?: number;
    editor?: Snippet;
    nutritionEditor?: Snippet<["calories" | "protein" | "carbohydrate" | "fat", number]>;
    titleControl?: Snippet;
    reveal?: "instant" | "flip" | "shutter" | "rise";
  } = $props();
  const dictionary = $derived(getDictionary(language));
  const macros = $derived([
    { field: "protein" as const, label: dictionary.proteinLabel(), value: food.macronutrients.protein },
    { field: "carbohydrate" as const, label: dictionary.carbohydratesLabel(), value: food.macronutrients.carbohydrate },
    { field: "fat" as const, label: dictionary.fatLabel(), value: food.macronutrients.fat },
  ]);
  const imageSource = $derived(resolveFoodImage(food.imageKey));
  let imageElement: HTMLImageElement | undefined = $state();
  let imageReady = $state(false);
  let imageFailed = $state(false);

  $effect(() => {
    const image = imageElement;
    const source = imageSource;
    if (!image) return;
    let cancelled = false;
    imageReady = false;
    imageFailed = false;
    if (image.getAttribute("src") !== source) image.src = source;

    function fail(): void {
      if (cancelled || !image) return;
      if (image.getAttribute("src") !== foodPlaceholderUrl) image.src = foodPlaceholderUrl;
      else {
        imageFailed = true;
        imageReady = true;
      }
    }

    async function decode(): Promise<void> {
      if (!image) return;
      const decodingSource = image.src;
      try {
        await image.decode();
        if (!cancelled && image.src === decodingSource) imageReady = true;
      } catch {
        if (!cancelled && image.src === decodingSource) fail();
      }
    }

    image.addEventListener("load", decode);
    image.addEventListener("error", fail);
    if (image.complete) {
      if (image.naturalWidth > 0) void decode();
      else fail();
    }
    return () => {
      cancelled = true;
      image.removeEventListener("load", decode);
      image.removeEventListener("error", fail);
    };
  });
</script>

{#snippet card()}
<article data-prototype-card data-food-id={food.foodObjectId} data-selected={editor ? "true" : undefined} class="prototype-card overflow-hidden border border-dark-secondary/25 bg-dark-surface {variant === 'C' ? 'rounded-[28px]' : 'rounded-2xl'}">
  <img
    bind:this={imageElement}
    data-prototype-image
    src={imageSource}
    alt={food.names[language]}
    loading={editor || reveal ? "eager" : "lazy"}
    aria-hidden={imageFailed}
    class="aspect-square w-full object-cover {imageFailed ? 'hidden' : ''}"
  />
  {#if imageFailed}
    <div data-prototype-image-error role="img" aria-label={language === "pl" ? "Obraz niedostępny" : "Image unavailable"} class="flex aspect-square w-full items-center justify-center self-start bg-dark-background text-sm text-dark-text-muted">
      {language === "pl" ? "Obraz niedostępny" : "Image unavailable"}
    </div>
  {/if}
  <div data-prototype-details class="flex min-w-0 flex-col justify-center p-5 {variant === 'C' ? 'lg:self-stretch lg:justify-start' : ''}">
    {#if variant !== "C"}
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span class="font-semibold text-dark-secondary">{editor ? dictionary.selectedFoodLabel() : `${String(rank).padStart(2, "0")} / ${language === "pl" ? "Zamiennik" : "Substitute"}`}</span>
        {#if food.similarityPercent !== undefined}
          <span class="text-dark-text-muted">{food.similarityPercent}% {dictionary.similarityLabel()}</span>
        {/if}
      </div>
    {/if}
    <div class="mb-3 flex items-start justify-between gap-3">
      <h3 class="min-w-0 text-lg leading-snug font-semibold tracking-tight {variant === 'C' ? 'lg:text-3xl' : ''}">{food.names[language]}</h3>
      {#if titleControl}
        <div data-prototype-title-control class="prototype-numbers shrink-0 text-lg lg:text-2xl">{@render titleControl()}</div>
      {/if}
    </div>
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
{/snippet}

{#if reveal}
  {#key reveal}
    <PrototypeCardReveal mode={reveal} ready={imageReady} label={dictionary.loadingNutritionValues()}>
      {@render card()}
    </PrototypeCardReveal>
  {/key}
{:else}
  {@render card()}
{/if}
