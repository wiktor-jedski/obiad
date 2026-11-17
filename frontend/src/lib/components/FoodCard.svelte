<script lang="ts">
  import type { Snippet } from "svelte";
  import type { FoodQuantity } from "../../client/types.gen";
  import type { ProjectedSubstituteItem } from "../substituteProjection";
  import { foodPlaceholderUrl, resolveFoodImage } from "../assets";
  import {
    formatFoodQuantityValue,
    getDictionary,
    type InterfaceLanguage,
  } from "../i18n";
  import CardReveal from "./CardReveal.svelte";

  let {
    food,
    language,
    rank,
    editor,
    nutritionEditor,
    titleControl,
  }: {
    food: Omit<
      ProjectedSubstituteItem,
      "matchedQuantity" | "similarityPercent"
    > & {
      quantity: FoodQuantity;
      similarityPercent?: number;
    };
    language: InterfaceLanguage;
    rank?: number;
    editor?: Snippet;
    nutritionEditor?: Snippet<
      ["calories" | "protein" | "carbohydrate" | "fat", number]
    >;
    titleControl?: Snippet;
  } = $props();

  const dictionary = $derived(getDictionary(language));
  const macros = $derived([
    {
      field: "protein" as const,
      label: dictionary.proteinLabel(),
      value: food.macronutrients.protein,
    },
    {
      field: "carbohydrate" as const,
      label: dictionary.carbohydratesLabel(),
      value: food.macronutrients.carbohydrate,
    },
    {
      field: "fat" as const,
      label: dictionary.fatLabel(),
      value: food.macronutrients.fat,
    },
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
      if (image.getAttribute("src") !== foodPlaceholderUrl)
        image.src = foodPlaceholderUrl;
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

<CardReveal ready={imageReady} label={dictionary.loadingNutritionValues()}>
  <article
    data-selected-food-summary={editor ? "" : undefined}
    data-result-card={editor ? undefined : ""}
    data-food-object-id={food.foodObjectId}
    data-result-card-rank={editor ? undefined : rank}
    class="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[28px] border border-dark-secondary/25 bg-dark-surface lining-nums tabular-nums sm:grid-cols-[38%_minmax(0,1fr)] sm:items-center"
  >
    <img
      bind:this={imageElement}
      data-result-card-image
      src={imageSource}
      alt={food.names[language]}
      loading="eager"
      aria-hidden={imageFailed}
      class="aspect-square w-full self-start object-cover {imageFailed
        ? 'hidden'
        : ''}"
    />
    {#if imageFailed}
      <div
        data-image-unavailable
        role="img"
        aria-label={dictionary.imageUnavailableMessage()}
        class="flex aspect-square w-full items-center justify-center self-start bg-dark-background text-sm text-dark-text-muted"
      >
        {dictionary.imageUnavailableMessage()}
      </div>
    {/if}
    <div
      data-card-content
      class="flex min-w-0 flex-col justify-center p-5 sm:p-7 lg:self-stretch lg:justify-start"
    >
      <div class="mb-3 flex items-start justify-between gap-3">
        <h3
          class="min-w-0 text-lg leading-snug font-semibold tracking-tight lg:text-3xl"
        >
          {food.names[language]}
        </h3>
        {#if titleControl}
          <div class="shrink-0 font-nutrition text-lg lg:text-2xl">
            {@render titleControl()}
          </div>
        {/if}
      </div>
      <div
        data-card-summary
        class="mb-4 flex min-h-11 items-center gap-1 font-nutrition text-lg whitespace-nowrap font-normal lg:text-2xl"
      >
        {#if editor}
          {@render editor()}
        {:else}
          <span data-result-card-matched-quantity
            >{formatFoodQuantityValue(food.quantity, language)}</span
          >
        {/if}
        <span aria-hidden="true" class="text-dark-text-muted">|</span>
        <span
          data-input-calories={editor ? "" : undefined}
          data-result-card-calories={editor ? undefined : ""}
          class="inline-flex items-baseline gap-1"
        >
          {#if nutritionEditor}
            {@render nutritionEditor("calories", food.calories)}
          {:else}
            {food.calories}
          {/if}
          <span>kcal</span>
        </span>
        {#if food.similarityPercent !== undefined}
          <span
            data-result-card-similarity
            aria-label={`${dictionary.similarityLabel()}: ${food.similarityPercent}%`}
            class="ml-auto pl-2 text-right">{food.similarityPercent}%</span
          >
        {/if}
      </div>
      <dl
        class="grid grid-cols-3 gap-x-2 gap-y-1 border-t border-dark-secondary/25 pt-3 font-nutrition lg:mt-auto"
      >
        {#each macros as macro (macro.field)}
          <div class="row-span-2 grid min-w-0 grid-rows-subgrid gap-1">
            <dt class="min-w-0 text-xs wrap-anywhere text-dark-text-muted">
              {macro.label}
            </dt>
            <dd class="flex items-baseline gap-1 text-lg leading-tight">
              {#if nutritionEditor}
                {@render nutritionEditor(macro.field, macro.value)}<span>g</span
                >
              {:else}
                {macro.value.toLocaleString(language, {
                  useGrouping: false,
                  maximumFractionDigits: 1,
                })} g
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    </div>
  </article>
</CardReveal>
