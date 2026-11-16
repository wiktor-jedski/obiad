<script lang="ts">
  import type { Snippet } from "svelte";
  let { selected, results, title, subtitle }: {
    selected: Snippet; results: Snippet; title: string; subtitle: string;
  } = $props();
</script>

<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
  <aside class="lg:sticky lg:top-6">
    <h2 class="mb-5 text-2xl font-bold tracking-tight">{title}</h2>
    {@render selected()}
    <p class="mt-4 text-sm leading-relaxed text-dark-text-muted">{subtitle}</p>
  </aside>
  <div class="grid gap-3">{@render results()}</div>
</div>
