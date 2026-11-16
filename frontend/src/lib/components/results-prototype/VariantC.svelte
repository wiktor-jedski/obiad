<script lang="ts">
  import type { Snippet } from "svelte";
  let { selected, results, selectedHeading, substitutesHeading }: {
    selected: Snippet; results: Snippet; selectedHeading: string; substitutesHeading: string;
  } = $props();
</script>

<div class="mx-auto max-w-[920px]">
  <section aria-labelledby="prototype-selected-heading">
    <h2 id="prototype-selected-heading" class="mb-5 text-center text-xl font-semibold">{selectedHeading}</h2>
    {@render selected()}
  </section>
  <section aria-labelledby="prototype-substitutes-heading" class="mt-10">
    <h2 id="prototype-substitutes-heading" class="mb-5 text-center text-xl font-semibold">{substitutesHeading}</h2>
    <div class="grid gap-8">
      {@render results()}
    </div>
  </section>
</div>
