<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    describedBy,
    align,
    trigger,
    children,
  }: {
    label: string;
    describedBy?: string;
    align: "left" | "right";
    trigger: Snippet;
    children: Snippet<[() => void]>;
  } = $props();

  interface DropdownElements {
    menu?: HTMLDetailsElement;
    summary?: HTMLElement;
  }

  const elements: DropdownElements = {};

  function closeAndFocusTrigger(): void {
    if (elements.menu) elements.menu.open = false;
    elements.summary?.focus();
  }

  function dismissOutside(event: Event): void {
    const { menu } = elements;
    if (
      menu?.open &&
      event.target instanceof Node &&
      !menu.contains(event.target)
    ) {
      menu.open = false;
    }
  }
</script>

<svelte:window
  onpointerdown={dismissOutside}
  onfocusin={dismissOutside}
  onkeydown={(event) => {
    if (event.key === "Escape" && elements.menu?.open) closeAndFocusTrigger();
  }}
/>

<details bind:this={elements.menu} name="site-header" class="relative">
  <summary
    bind:this={elements.summary}
    aria-label={label}
    aria-describedby={describedBy}
    class="flex h-11 cursor-pointer list-none items-center gap-2 text-dark-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-dark-primary [&::-webkit-details-marker]:hidden {align ===
    'right'
      ? 'min-w-16 justify-end px-3'
      : ''}"
  >
    {@render trigger()}
    <span
      aria-hidden="true"
      class="pointer-events-none -translate-y-px font-data text-sm">⌄</span
    >
  </summary>
  <div
    class="absolute z-20 min-w-40 overflow-hidden rounded-2xl border border-dark-secondary/40 bg-dark-surface shadow-lg {align ===
    'left'
      ? 'left-0'
      : 'right-0'}"
  >
    {@render children(closeAndFocusTrigger)}
  </div>
</details>
