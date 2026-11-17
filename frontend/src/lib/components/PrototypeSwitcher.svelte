<script lang="ts">
  import { SvelteURL } from "svelte/reactivity";

  let { variant, onchange, state }: {
    variant: string;
    onchange: (variant: string) => void;
    state: string;
  } = $props();

  const variants = ["F", "G", "H", "I"];
  const names: Record<string, string> = {
    A: "Gallery · Lato",
    B: "Comparison · Barlow",
    C: "Original unit placement",
    D: "Fixed quantity width",
    E: "Toggle before quantity",
    F: "Ready · no animation",
    G: "Responsive card flip",
    H: "Opening shutters",
    I: "Slide up",
  };

  function cycle(direction: number): void {
    const current = Math.max(0, variants.indexOf(variant));
    const next = variants[(current + direction + variants.length) % variants.length];
    const url = new SvelteURL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    onchange(next);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    cycle(event.key === "ArrowLeft" ? -1 : 1);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if import.meta.env.DEV}
  <aside aria-label="Prototype variants" class="fixed bottom-4 left-1/2 z-50 w-[min(94vw,420px)] -translate-x-1/2 rounded-2xl border border-dark-secondary bg-dark-background p-2 text-dark-text-primary shadow-2xl">
    <div class="flex items-center justify-between gap-2">
      <button aria-label="Previous variant" onclick={() => cycle(-1)} class="size-11 shrink-0 rounded-full text-xl hover:bg-dark-surface focus-visible:outline-2 focus-visible:outline-dark-primary">←</button>
      <div class="min-w-0 text-center">
        <p class="text-[10px] font-bold tracking-[0.2em] text-dark-primary">THROWAWAY PROTOTYPE</p>
        <p class="text-sm font-semibold">{variant} — {names[variant]}</p>
      </div>
      <button aria-label="Next variant" onclick={() => cycle(1)} class="size-11 shrink-0 rounded-full text-xl hover:bg-dark-surface focus-visible:outline-2 focus-visible:outline-dark-primary">→</button>
    </div>
    <p data-prototype-state class="px-2 pb-1 text-center text-[11px] text-dark-text-muted">{state}</p>
  </aside>
{/if}
