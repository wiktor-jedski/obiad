<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { loadMealRecipe } from "../recipes";
  import MealRecipeDetail from "./MealRecipeDetail.svelte";

  let { id }: { id: number } = $props();
  const dictionary = $derived(getDictionary($interfaceLanguage));
  let request = $derived(loadMealRecipe(id));
</script>

<article
  data-meal-page={id}
  class="mx-auto max-w-[920px] pb-12 pt-8 text-dark-text-primary"
>
  {#await request}
    <p role="status" class="text-center text-dark-text-muted">
      {dictionary.loadingRecipeMessage()}
    </p>
  {:then recipe}
    {#if recipe}
      {#key recipe.id}
        <MealRecipeDetail {recipe} language={$interfaceLanguage} />
      {/key}
    {:else}
      <p role="status" class="text-center text-dark-text-muted">
        {dictionary.recipeNotFoundMessage()}
      </p>
    {/if}
  {:catch}
    <div class="flex flex-col items-center gap-3">
      <p role="status" class="text-dark-error">
        {dictionary.recipeFailureMessage()}
      </p>
      <button
        type="button"
        onclick={() => (request = loadMealRecipe(id))}
        class="min-h-11 rounded border border-dark-secondary px-4 text-sm hover:text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary"
      >
        {dictionary.retryButtonLabel()}
      </button>
    </div>
  {/await}
</article>
