<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  const foods = [
    ["USDA FoodData Central", "https://fdc.nal.usda.gov/"],
    ["Carb Manager", "https://www.carbmanager.com/"],
    ["Caterite", "https://www.caterite.co.uk/"],
    ["Dragonfly", "https://dragonflyfoods.com/"],
    ["Görans", "https://gorans.fi/"],
    ["Kefalonia Fisheries", "https://www.kefish.gr/"],
    ["Kikkoman", "https://kikkomanindia.com/"],
    ["Medycyna Praktyczna", "https://www.mp.pl/"],
    ["Meurens", "https://sirop-de-liege.com/"],
    ["Młynpol", "https://mlynpol.com.pl/"],
    ["Piątnica", "https://piatnica.com.pl/"],
    ["Sokołów", "https://sokolow.com/"],
    ["T.O Foods", "https://www.to-foods.com/"],
    ["Tracklements", "https://www.tracklements.co.uk/"],
    ["Wilton Wholefoods", "https://wiltonwholefoods.com/"],
    ["Zaffaran", "https://zaffaran.de/"],
  ] as const;
  const recipes = [
    ["Kuchnia Domowa", "https://kuchnia-domowa.pl/"],
    ["TheMealDB", "https://www.themealdb.com/"],
    [
      "Wikibooks Cookbook",
      "https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents",
    ],
  ] as const;

  let { dataCommit }: { dataCommit?: string } = $props();
  const dictionary = $derived(getDictionary($interfaceLanguage));
</script>

<svelte:head
  ><title>{dictionary.dataSourcesHeading()} · obiad</title></svelte:head
>

{#snippet section(
  heading: string,
  links: readonly (readonly [string, string])[],
)}
  <section>
    <h2 class="mb-3 text-3xl font-semibold tracking-tight sm:text-4xl">
      {heading}
    </h2>
    <ul class="list-disc pl-5 marker:text-dark-text-muted">
      {#each links as [name, url] (url)}
        <li><a class="inline-block py-2" href={url}>{name}</a></li>
      {/each}
    </ul>
  </section>
{/snippet}

<article
  class="mx-auto max-w-4xl pb-24 pt-8 text-dark-text-primary sm:pt-14 [&_a]:text-dark-secondary [&_a]:underline [&_a]:decoration-dark-secondary/45 [&_a]:underline-offset-4 [&_a:hover]:decoration-current"
>
  <h1
    class="mb-8 text-5xl leading-none font-bold tracking-tight sm:mb-12 sm:text-7xl"
  >
    {dictionary.dataSourcesHeading()}
  </h1>
  <div class="space-y-10 sm:space-y-14">
    {@render section(dictionary.foodsHeading(), foods)}
    {@render section(dictionary.recipesHeading(), recipes)}
    {#if dataCommit}
      <p class="text-sm text-dark-text-muted">
        {dictionary.dataVersionLabel()}
        <a href="/release.json" class="wrap-anywhere font-data">{dataCommit}</a>
      </p>
    {/if}
  </div>
</article>
