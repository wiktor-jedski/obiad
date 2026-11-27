<script lang="ts">
  import { recipeSiteName } from "../recipeSources";
  import { getDictionary, type InterfaceLanguage } from "../i18n";
  import {
    formatNutritionError,
    nutritionFieldLabel,
    type NutritionEditError,
    type NutritionField,
  } from "../nutritionEditing";
  import type { MealRecipe } from "../recipes";
  import { projectSubstitutePage } from "../substituteProjection";
  import FoodCard from "./FoodCard.svelte";
  import NutritionValueEditor from "./NutritionValueEditor.svelte";

  let {
    recipe,
    language,
  }: { recipe: MealRecipe; language: InterfaceLanguage } = $props();
  let editedQuantity: number | undefined = $state();
  let editorError: NutritionEditError | undefined = $state();
  const dictionary = $derived(getDictionary(language));
  const ingredientFormat = $derived(
    new Intl.NumberFormat(language, {
      useGrouping: false,
      maximumSignificantDigits: 6,
    }),
  );
  const source = $derived(URL.parse(recipe.source));
  const basis = $derived({
    foodObjectId: recipe.id,
    names: recipe.names,
    imageKey: recipe.imageKey,
    baseUnit: recipe.quantity.unit,
    macroProfile: recipe.macroProfile,
  });
  const perHundred = $derived({
    quantity: 100,
    calories:
      4 * recipe.macroProfile.protein +
      4 * recipe.macroProfile.carbohydrate +
      9 * recipe.macroProfile.fat,
    ...recipe.macroProfile,
  });
  const quantity = $derived({
    value: editedQuantity ?? recipe.quantity.value,
    unit: recipe.quantity.unit,
  });
  const scale = $derived(quantity.value / recipe.quantity.value);
  const projection = $derived(projectSubstitutePage(basis, [], quantity));
  const food = $derived({
    ...basis,
    quantity,
    calories: projection.inputCalories,
    macronutrients: projection.inputMacronutrients,
  });

  function commitField(
    field: NutritionField,
    value: number,
  ): NutritionEditError | undefined {
    // The catalog permits at most 100,000 base units (g or ml).
    const maximum = (100_000 * perHundred[field]) / 100;
    if (value > maximum) return { field, reason: "limit", maximum };
    editedQuantity = (value * 100) / perHundred[field];
  }
</script>

<svelte:head>
  <title>{recipe.names[language]} · obiad</title>
</svelte:head>

{#snippet numberEditor(field: NutritionField, value: number)}
  <NutritionValueEditor
    {field}
    label={nutritionFieldLabel(field, language)}
    {value}
    precision={field === "quantity" || field === "calories" ? 0 : 1}
    {language}
    readonly={perHundred[field] === 0}
    oncommit={(next) => commitField(field, next)}
    onerror={(error) => (editorError = error)}
  />
{/snippet}

<section aria-label={dictionary.nutritionHeading()}>
  <FoodCard {food} {language} headingTag="h1" nutritionEditor={numberEditor}>
    {#snippet editor()}
      <div class="flex min-w-0 items-center gap-1">
        {@render numberEditor("quantity", quantity.value)}
        <span>{quantity.unit}</span>
      </div>
    {/snippet}
  </FoodCard>
  {#if editorError}
    <p
      id="nutrition-edit-error"
      role="status"
      class="mt-3 text-sm text-dark-error"
    >
      {formatNutritionError(editorError, language)}
    </p>
  {/if}
</section>

<section class="mt-8" aria-labelledby="meal-ingredients-heading">
  <h2 id="meal-ingredients-heading" class="mb-3 text-xl font-semibold">
    {dictionary.ingredientsHeading()}
  </h2>
  <ul class="list-disc space-y-2 pl-6 marker:text-dark-text-muted">
    {#each recipe.ingredients as ingredient (ingredient)}
      <li>
        {ingredient.names[language]} —
        <span class="whitespace-nowrap"
          >{ingredientFormat.format(ingredient.grams * scale)} g</span
        >
      </li>
    {/each}
  </ul>
</section>

<section class="mt-8" aria-labelledby="meal-recipe-heading">
  <h2 id="meal-recipe-heading" class="mb-3 text-xl font-semibold">
    {dictionary.recipeHeading()}
  </h2>
  {#if Math.abs(scale - 1) > Number.EPSILON}
    <p class="mb-3 text-dark-secondary">{dictionary.scaledRecipeNote()}</p>
  {/if}
  <ol class="list-decimal space-y-3 pl-6">
    {#each recipe.steps as step}
      <li class="whitespace-pre-wrap">{step}</li>
    {/each}
  </ol>
</section>

{#if source && (source.protocol === "https:" || source.protocol === "http:") && !source.username && !source.password}
  <section class="mt-8" aria-labelledby="meal-source-heading">
    <h2 id="meal-source-heading" class="mb-3 text-xl font-semibold">
      {dictionary.recipeSourceLabel()}
    </h2>
    <a
      href={source.href}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-block py-2 text-dark-secondary underline decoration-dark-secondary/45 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary"
      >{recipeSiteName(source)}</a
    >
  </section>
{/if}
