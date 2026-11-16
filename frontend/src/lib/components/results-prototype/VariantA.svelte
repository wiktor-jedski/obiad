<script lang="ts">
  import type { Snippet } from "svelte";
  let { selected, results, title, subtitle }: {
    selected: Snippet; results: Snippet; title: string; subtitle: string;
  } = $props();
</script>

<header class="mb-6 flex flex-wrap items-end justify-between gap-2">
  <h2 class="text-2xl font-bold tracking-tight">{title}</h2>
  <p class="text-sm text-dark-text-muted">{subtitle}</p>
</header>
<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
  {@render selected()}
  {@render results()}
</div>
