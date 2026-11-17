<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    ready,
    label,
    children,
  }: {
    ready: boolean;
    label: string;
    children?: Snippet;
  } = $props();

  let painted = $state(false);
  let finished = $state(false);
  let reducedMotion = $state(false);
  const started = $derived(ready && (painted || reducedMotion));
  const shown = $derived(started && (finished || reducedMotion));

  // Cached images still need a painted reverse before the flip starts.
  $effect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        painted = true;
      });
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = media.matches;
    const update = () => {
      reducedMotion = media.matches;
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });

  $effect(() => {
    if (!ready) finished = false;
    else if (reducedMotion) finished = true;
  });

  function finish(event: TransitionEvent): void {
    if (
      event.target === event.currentTarget &&
      event.propertyName === "transform" &&
      started
    ) {
      finished = true;
    }
  }
</script>

<div
  data-card-reveal
  data-card-reveal-state={shown ? "shown" : started ? "revealing" : "waiting"}
  data-started={started}
  data-shown={shown}
  aria-busy={!shown}
  class="card-reveal"
>
  <div data-card-flip class="surface" ontransitionend={finish}>
    <div class="front" inert={!shown} aria-hidden={!shown}>
      {#if children}
        {@render children()}
      {:else}
        <div class="empty-front"></div>
      {/if}
    </div>
    <div aria-hidden="true" class="back">
      <span>{label}</span>
    </div>
  </div>
  {#if !shown}<span class="sr-only">{label}</span>{/if}
</div>

<style>
  .card-reveal {
    --flip-axis: 0, 1, 0;
    position: relative;
    min-width: 0;
    border-radius: 28px;
    perspective: 4000px;
  }
  .surface {
    position: relative;
    border-radius: inherit;
    transform-style: preserve-3d;
    transform: rotate3d(var(--flip-axis), 180deg);
  }
  .front {
    position: relative;
    z-index: 0;
    border-radius: inherit;
    backface-visibility: hidden;
  }
  .empty-front {
    aspect-ratio: 1;
    padding-bottom: 210px;
    box-sizing: content-box;
  }
  .back {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid
      color-mix(in srgb, var(--color-dark-secondary) 25%, transparent);
    border-radius: inherit;
    background-color: var(--color-dark-surface);
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0 12px,
      color-mix(in srgb, var(--color-dark-secondary) 8%, transparent) 12px 14px
    );
    color: var(--color-dark-text-muted);
    font-size: 12px;
    transform: rotate3d(var(--flip-axis), 180deg);
    backface-visibility: hidden;
  }
  [data-started="true"] .surface {
    transform: rotate3d(var(--flip-axis), 0deg);
    transition: transform 800ms cubic-bezier(0.22, 0.7, 0.2, 1);
  }
  [data-shown="true"] .back {
    display: none;
  }
  @media (min-width: 640px) {
    .card-reveal {
      --flip-axis: 1, 0, 0;
    }
    .empty-front {
      aspect-ratio: 50 / 19;
      padding-bottom: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-started="true"] .surface {
      transition: none;
    }
  }
</style>
