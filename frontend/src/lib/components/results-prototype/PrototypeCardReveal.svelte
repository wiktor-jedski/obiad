<script lang="ts">
  import type { Snippet } from "svelte";

  let { mode, ready, label, children }: {
    mode: "instant" | "flip" | "shutter" | "rise";
    ready: boolean;
    label: string;
    children?: Snippet;
  } = $props();

  let painted = $state(false);
  let finished = $state(false);
  let reducedMotion = $state(false);
  const started = $derived(ready && (painted || reducedMotion));
  const shown = $derived(started && (finished || reducedMotion || mode === "instant"));

  // Paint the reverse before starting even when the image is cached.
  $effect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => painted = true);
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = media.matches;
    const update = () => { reducedMotion = media.matches; };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });

  $effect(() => {
    if (started && reducedMotion) finished = true;
  });

  function finish(event: TransitionEvent): void {
    if (event.target === event.currentTarget && event.propertyName === "transform" && started) finished = true;
  }
</script>

<div
  data-prototype-reveal
  data-reveal-mode={mode}
  data-reveal-state={shown ? "shown" : started ? "revealing" : "waiting"}
  data-started={started}
  data-shown={shown}
  aria-busy={!shown}
  class="reveal"
>
  <div class="surface" ontransitionend={finish}>
    <div class="front" inert={!shown} aria-hidden={!shown} ontransitionend={finish}>
      {#if children}
        {@render children()}
      {:else}
        <div class="empty-front"></div>
      {/if}
    </div>
    {#if mode === "shutter"}
      <div aria-hidden="true" class="panel left reverse-art" ontransitionend={finish}></div>
      <div aria-hidden="true" class="panel right reverse-art"></div>
      <div aria-hidden="true" class="waiting-label">
        <span class="loader motion-safe:animate-spin"></span>
        <span>{label}</span>
      </div>
    {:else}
      <div aria-hidden="true" class="back reverse-art">
        <span class="loader motion-safe:animate-spin"></span>
        <span>{label}</span>
      </div>
    {/if}
  </div>
  {#if !shown}<span class="sr-only">{label}</span>{/if}
</div>

<style>
  .reveal { --flip-axis: 0, 1, 0; position: relative; min-width: 0; border-radius: 28px; perspective: 4000px; }
  .surface { position: relative; border-radius: inherit; }
  .front { position: relative; z-index: 0; border-radius: inherit; }
  .empty-front { aspect-ratio: 1; padding-bottom: 210px; box-sizing: content-box; }
  .back, .waiting-label {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
    color: var(--color-dark-text-muted); font-size: 12px; border-radius: inherit;
  }
  .reverse-art {
    border: 1px solid color-mix(in srgb, var(--color-dark-secondary) 25%, transparent);
    background-color: var(--color-dark-surface);
    background-image: repeating-linear-gradient(45deg, transparent 0 12px, color-mix(in srgb, var(--color-dark-secondary) 8%, transparent) 12px 14px);
  }
  .loader {
    width: 24px; height: 24px; border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--color-dark-secondary) 25%, transparent);
    border-top-color: var(--color-dark-primary);
  }
  [data-reveal-mode="instant"] .front { visibility: hidden; }
  [data-reveal-mode="instant"][data-started="true"] .front { visibility: visible; }
  [data-shown="true"] .back, [data-shown="true"] .panel { display: none; }

  [data-reveal-mode="flip"] .surface {
    transform-style: preserve-3d;
    transform: rotate3d(var(--flip-axis), 180deg);
    transition: transform 800ms cubic-bezier(0.22, 0.7, 0.2, 1);
  }
  [data-reveal-mode="flip"] .front, [data-reveal-mode="flip"] .back { backface-visibility: hidden; }
  [data-reveal-mode="flip"] .back { transform: rotate3d(var(--flip-axis), 180deg); }
  [data-reveal-mode="flip"][data-started="true"] .surface { transform: rotate3d(var(--flip-axis), 0deg); }

  [data-reveal-mode="shutter"], [data-reveal-mode="rise"] { overflow: hidden; }
  .panel { position: absolute; top: 0; bottom: 0; width: 50%; z-index: 2; transition: transform 700ms cubic-bezier(0.22, 0.7, 0.2, 1); }
  .left { left: 0; border-radius: 28px 0 0 28px; }
  .right { right: 0; border-radius: 0 28px 28px 0; }
  [data-reveal-mode="shutter"][data-started="true"] .left { transform: translateX(-100%); }
  [data-reveal-mode="shutter"][data-started="true"] .right { transform: translateX(100%); }
  .waiting-label { z-index: 3; }
  [data-reveal-mode="shutter"][data-started="true"] .waiting-label { display: none; }

  [data-reveal-mode="rise"] .front { z-index: 1; transform: translateY(105%); transition: transform 700ms cubic-bezier(0.22, 0.7, 0.2, 1); }
  [data-reveal-mode="rise"][data-started="true"] .front { transform: translateY(0); }

  @media (min-width: 640px) {
    .reveal { --flip-axis: 1, 0, 0; }
    .empty-front { aspect-ratio: 50 / 19; padding-bottom: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .surface, .front, .panel { transition: none !important; }
  }
</style>
