<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import type { SubstituteSearchResponse } from "../../client/types.gen";
  import type {
    InteractionState,
    EmptyInteractionState,
    QuantityUnit,
  } from "../interactionState";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { getDictionary } from "../i18n";
  import { projectSubstitutePage } from "../substituteProjection";
  import {
    formatNutritionError,
    nutritionFieldLabel,
    type NutritionEditError,
    type NutritionField,
  } from "../nutritionEditing";
  import CardReveal from "./CardReveal.svelte";
  import FoodCard from "./FoodCard.svelte";
  import NutritionValueEditor from "./NutritionValueEditor.svelte";
  import type { SearchReturn } from "../searchReturn";

  let {
    interaction,
    restored,
    response,
    locked,
    onmore,
    onretry,
  }: {
    interaction: Exclude<InteractionState, EmptyInteractionState>;
    restored?: SearchReturn;
    response: SubstituteSearchResponse | undefined;
    locked: boolean;
    onmore: () => void;
    onretry: () => void;
  } = $props();

  const initial = untrack(() => restored);
  let pages = $state.raw<SubstituteSearchResponse[]>(initial?.pages ?? []);
  let enteredBaseQuantity = $state(initial?.enteredBaseQuantity);
  let chosenUnit: QuantityUnit | undefined = $state(initial?.chosenUnit);
  let editorError: NutritionEditError | undefined = $state();
  let pageSpinner = $state(false);
  let spinnerMinimumDone = $state(false);
  let spinnerFrame = 0;
  let spinnerTimer = 0;
  let destroyed = false;
  let sentinel: HTMLDivElement | undefined = $state();
  let selectedHeading: HTMLHeadingElement | undefined = $state();
  let zeroMessage: HTMLParagraphElement | undefined = $state();

  const dictionary = $derived(getDictionary($interfaceLanguage));
  const errorMessage = $derived(
    formatNutritionError(editorError, $interfaceLanguage),
  );
  const selectedFood = $derived(pages[0]?.selectedFood);
  const latest = $derived(pages.at(-1));
  const items = $derived(pages.flatMap((page) => page.items));
  const baseOption = $derived(
    interaction.selected.allowedQuantities.find(
      (option) => option.unit !== "serving",
    )!,
  );
  const availableUnits = $derived(
    interaction.selected.allowedQuantities.toSorted(
      (a, b) => Number(a.unit === "serving") - Number(b.unit === "serving"),
    ),
  );
  const baseQuantity = $derived(
    enteredBaseQuantity ??
      interaction.selected.quantity.value *
        (interaction.selected.quantity.unit === "serving"
          ? (selectedFood?.serving ?? 1)
          : 1),
  );
  const displayUnit = $derived(
    chosenUnit ?? interaction.selected.quantity.unit,
  );
  const quantity = $derived({
    value:
      displayUnit === "serving"
        ? baseQuantity / (selectedFood?.serving ?? 1)
        : baseQuantity,
    unit: displayUnit,
  });
  const projection = $derived(
    selectedFood
      ? projectSubstitutePage(selectedFood, items, {
          value: baseQuantity,
          unit: selectedFood.baseUnit,
        })
      : undefined,
  );
  const selectedCard = $derived(
    selectedFood && projection
      ? {
          ...selectedFood,
          quantity,
          calories: projection.inputCalories,
          macronutrients: projection.inputMacronutrients,
        }
      : undefined,
  );

  $effect(() => {
    if (
      !response ||
      response.selectedFood.foodObjectId !== interaction.selected.foodObjectId
    )
      return;
    const previous = untrack(() => pages);
    if (previous[response.pageIndex] === response) return;
    if (response.pageIndex > 0 && pageSpinner && !spinnerMinimumDone) return;
    pages = [...previous.slice(0, response.pageIndex), response];
    pageSpinner = false;
    if (response.pageIndex === 0) {
      const empty = response.items.length === 0;
      void tick().then(() => {
        if (destroyed) return;
        if (empty) zeroMessage?.focus();
        else selectedHeading?.focus();
      });
    }
  });

  $effect(() => {
    if (pageSpinner && spinnerMinimumDone && interaction.name === "moreFailure")
      pageSpinner = false;
  });

  $effect(() => {
    if (
      !sentinel ||
      !latest?.hasMore ||
      locked ||
      pageSpinner ||
      interaction.name !== "results"
    )
      return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) requestMore();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  onMount(() => {
    if (!initial) return;
    const frame = requestAnimationFrame(() =>
      window.scrollTo(0, initial.scrollY),
    );
    return () => cancelAnimationFrame(frame);
  });

  function saveSearchReturn(): void {
    const last = pages.at(-1);
    if (!last) return;
    const searchReturn: SearchReturn = {
      interaction: {
        ...interaction,
        name:
          interaction.name === "moreFailure"
            ? "moreFailure"
            : last.totalEligibleCount === 0
              ? "zeroResults"
              : "results",
        pageIndex: last.pageIndex,
        focused: false,
      },
      pages,
      enteredBaseQuantity,
      chosenUnit,
      scrollY: window.scrollY,
    };
    history.replaceState(
      { ...history.state, searchReturn: $state.snapshot(searchReturn) },
      "",
    );
    history.scrollRestoration = "manual";
  }
  onDestroy(() => {
    destroyed = true;
    cancelAnimationFrame(spinnerFrame);
    clearTimeout(spinnerTimer);
  });

  function requestMore(): void {
    if (
      pageSpinner ||
      locked ||
      (interaction.name !== "results" && interaction.name !== "moreFailure")
    )
      return;
    pageSpinner = true;
    spinnerMinimumDone = false;
    // Measure the minimum from a painted spinner, not from request dispatch.
    spinnerFrame = requestAnimationFrame(() => {
      spinnerFrame = requestAnimationFrame(() => {
        spinnerTimer = window.setTimeout(() => {
          spinnerMinimumDone = true;
        }, 1000);
      });
    });
    onmore();
  }

  function fieldBasis(field: NutritionField): number {
    if (!selectedFood) return 0;
    if (field === "quantity")
      return 100 / (displayUnit === "serving" ? selectedFood.serving! : 1);
    const profile = selectedFood.macroProfile;
    return field === "calories"
      ? 4 * profile.protein + 4 * profile.carbohydrate + 9 * profile.fat
      : profile[field];
  }

  function commitField(
    field: NutritionField,
    value: number,
  ): NutritionEditError | undefined {
    const maximum =
      field === "quantity"
        ? availableUnits.find((option) => option.unit === displayUnit)!
            .maximumValue
        : (baseOption.maximumValue * fieldBasis(field)) / 100;
    const nextBaseQuantity =
      field === "quantity"
        ? value * (displayUnit === "serving" ? selectedFood!.serving! : 1)
        : (value * 100) / fieldBasis(field);
    if (
      !Number.isFinite(nextBaseQuantity) ||
      nextBaseQuantity <= 0 ||
      value > maximum
    ) {
      return { field, reason: "limit", maximum };
    }
    enteredBaseQuantity = nextBaseQuantity;
  }

  function switchUnit(): void {
    chosenUnit = displayUnit === "serving" ? baseOption.unit : "serving";
    editorError = undefined;
  }
</script>

{#snippet numberEditor(field: NutritionField, value: number)}
  <NutritionValueEditor
    {field}
    label={nutritionFieldLabel(field, $interfaceLanguage)}
    {value}
    precision={field === "quantity"
      ? displayUnit === "serving"
        ? 2
        : 0
      : field === "calories"
        ? 0
        : 1}
    language={$interfaceLanguage}
    readonly={fieldBasis(field) === 0}
    oncommit={(next) => commitField(field, next)}
    onerror={(error) => {
      editorError = error;
    }}
  />
{/snippet}

{#snippet portionEditor()}
  <div class="flex min-w-0 items-center gap-1">
    {@render numberEditor("quantity", quantity.value)}
    <span>{displayUnit === "serving" ? "ea" : displayUnit}</span>
  </div>
{/snippet}

{#snippet unitToggle()}
  <button
    type="button"
    data-unit-toggle
    aria-label={dictionary.servingsLabel()}
    aria-pressed={displayUnit === "serving"}
    onclick={switchUnit}
    class="group/unit relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-dark-secondary/40 bg-dark-background p-0.5 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-dark-primary"
  >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-0.5 left-0.5 size-8 rounded-full bg-dark-primary motion-safe:transition-transform motion-safe:duration-200 lg:size-9 {displayUnit ===
      'serving'
        ? 'translate-x-8 lg:translate-x-9'
        : ''}"
    ></span>
    {#each availableUnits as option (option.unit)}
      <span
        aria-hidden="true"
        data-unit={option.unit}
        class="relative z-10 flex size-8 items-center justify-center rounded-full lg:size-9 {displayUnit ===
        option.unit
          ? 'text-dark-text-on-bright group-hover/unit:text-dark-surface'
          : 'text-dark-text-muted group-hover/unit:text-dark-secondary'}"
        >{option.unit === "serving" ? "ea" : option.unit}</span
      >
    {/each}
  </button>
{/snippet}

<div class="mx-auto mt-10 max-w-[920px] pb-12 text-dark-text-primary">
  <section aria-labelledby="selected-food-heading">
    <h2
      id="selected-food-heading"
      bind:this={selectedHeading}
      data-selected-food-heading
      tabindex="-1"
      class="mb-5 text-center text-xl font-semibold focus:outline-none"
    >
      {dictionary.selectedFoodLabel()}
    </h2>
    {#if selectedCard}
      <FoodCard
        food={selectedCard}
        onopenrecipe={saveSearchReturn}
        language={$interfaceLanguage}
        editor={portionEditor}
        nutritionEditor={numberEditor}
        titleControl={availableUnits.length > 1 ? unitToggle : undefined}
      />
      {#if editorError}
        <p
          id="nutrition-edit-error"
          data-validation-error
          role="status"
          class="mt-3 text-sm text-dark-error"
        >
          {errorMessage}
        </p>
      {/if}
    {:else if interaction.name !== "newSearchFailure"}
      <CardReveal ready={false} label={dictionary.loadingNutritionValues()} />
    {:else}
      <h3 class="text-center text-lg font-semibold">
        {interaction.selected.names[$interfaceLanguage]}
      </h3>
    {/if}
  </section>

  {#if projection}
    <section
      data-result-region
      aria-labelledby="substitutions-heading"
      class="mt-10"
    >
      <h2
        id="substitutions-heading"
        data-substitutions-heading
        class="mb-5 text-center text-xl font-semibold"
      >
        {dictionary.foundSubstitutionsHeading()}
      </h2>
      {#if projection.items.length > 0}
        <div data-result-grid class="grid gap-8">
          {#each projection.items as item, index (item.foodObjectId)}
            <FoodCard
              food={{ ...item, quantity: item.matchedQuantity }}
              onopenrecipe={saveSearchReturn}
              language={$interfaceLanguage}
              rank={index}
            />
          {/each}
        </div>
      {:else}
        <p
          bind:this={zeroMessage}
          data-zero-result-message
          tabindex="-1"
          class="text-center text-base text-dark-text-muted focus:outline-none"
        >
          {dictionary.zeroResultsMessage()}
        </p>
      {/if}
    </section>
  {/if}

  <div
    bind:this={sentinel}
    data-pagination-sentinel
    class="mt-8 flex min-h-16 flex-col items-center justify-center gap-3"
  >
    {#if pageSpinner || interaction.name === "loadingMore"}
      <span role="status" class="flex justify-center">
        <span
          data-pagination-spinner
          class="size-6 rounded-full border-2 border-dark-secondary/25 border-t-dark-primary motion-safe:animate-spin"
        ></span>
        <span class="sr-only">{dictionary.loadingNutritionValues()}</span>
      </span>
    {:else if interaction.name === "moreFailure" || interaction.name === "newSearchFailure"}
      <div data-failure-region>
        <p
          data-retry-message
          role="status"
          class="text-center text-sm text-dark-error"
        >
          {dictionary.retryMessage()}
        </p>
      </div>
      <button
        type="button"
        aria-disabled={locked}
        onclick={() => {
          if (!locked) {
            if (interaction.name === "moreFailure") requestMore();
            else onretry();
          }
        }}
        class="min-h-11 rounded border border-dark-secondary px-4 text-sm transition-colors duration-200 hover:text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {dictionary.retryButtonLabel()}
      </button>
    {:else if latest && !latest.hasMore && projection && projection.items.length > 0}
      <p class="text-sm text-dark-text-muted">
        {dictionary.endOfResultsMessage()}
      </p>
    {/if}
  </div>
</div>
