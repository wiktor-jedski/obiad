<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  let { dataCommit }: { dataCommit: string } = $props();
  const dictionary = $derived(getDictionary($interfaceLanguage));
</script>

<footer
  aria-labelledby="data-sources-heading"
  class="mx-auto w-full max-w-[1280px] space-y-2 border-t border-dark-secondary/25 px-4 py-6 text-sm text-dark-text-muted sm:px-6 lg:px-8 [&_a]:text-dark-secondary [&_a]:underline [&_a]:underline-offset-2 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-dark-primary"
>
  <h2
    id="data-sources-heading"
    class="text-base font-bold text-dark-text-primary"
  >
    {dictionary.dataSourcesHeading()}
  </h2>
  <p>
    <a href="https://world.openfoodfacts.org/data">
      {dictionary.openFoodFactsCredit()}
    </a>
    —
    <a href="https://opendatacommons.org/licenses/odbl/1-0/">
      Open Database License (ODbL)
    </a>
  </p>
  <p><a href="https://fdc.nal.usda.gov/">USDA FoodData Central</a></p>
  <p>
    {dictionary.dataVersionLabel()}
    <a href="/release.json" class="wrap-anywhere font-data font-medium">
      {dataCommit}
    </a>
  </p>
  <p>
    <a href="/catalog.json" download>{dictionary.downloadCatalogLabel()}</a>
  </p>
</footer>
