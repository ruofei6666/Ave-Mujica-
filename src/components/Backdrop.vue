<script setup lang="ts">
// Layered backdrop shared by the menu and the room. Each layer is drawn in CSS and gets richer
// when generated art arrives (see game/ui-art.ts): bg-menu fills .bd-art, fx-grunge fills .bd-grunge.
withDefaults(defineProps<{ withScene?: boolean }>(), { withScene: true });
</script>

<template>
  <div class="bd" aria-hidden="true">
    <div class="bd-base"></div>
    <div v-if="withScene" class="bd-art"></div>
    <div class="bd-grid"></div>
    <div class="bd-shade"></div>
    <div class="bd-grunge"></div>
    <div class="bd-scan"></div>
  </div>
</template>
