<script lang="ts">
  import rage from "../assets/rage-faces/rage.png";
  import boss from "../assets/rage-faces/boss.png";
  import gusta from "../assets/rage-faces/me-gusta.png";

  // Original artwork: https://github.com/dlew/android-ragefaces/tree/main/faces
  // Face crops; the red caption is removed from rage_original.
  let { expression }: { expression: "rage" | "boss" | "gusta" } = $props();
  const faces = {
    rage: { src: rage, alt: "Rage Guy" },
    boss: { src: boss, alt: "Like a boss — Fuck Yea face" },
    gusta: { src: gusta, alt: "Me Gusta" },
  };
</script>

<div
  data-dialogue-avatar
  class="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-dark-primary/60 bg-white p-1.5"
>
  <img
    src={faces[expression].src}
    alt={faces[expression].alt}
    class="h-full w-full rounded-full object-contain"
  />
</div>
