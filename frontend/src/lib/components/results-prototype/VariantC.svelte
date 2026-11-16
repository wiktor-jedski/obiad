<script lang="ts">
  import type { Snippet } from "svelte";
  let { selected, results, title, subtitle }: {
    selected: Snippet; results: Snippet; title: string; subtitle: string;
  } = $props();
</script>

<div class="mx-auto max-w-[920px]">
  <header class="mb-8 border-b border-dark-secondary/30 pb-6">
    <p class="mb-2 text-sm text-dark-text-muted">{subtitle}</p>
    <h2 class="font-['Source_Serif_4',serif] text-4xl leading-tight sm:text-5xl">{title}</h2>
  </header>
  <div class="grid gap-8">
    {@render selected()}
    {@render results()}
  </div>
</div>
