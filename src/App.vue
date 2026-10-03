<script setup lang="ts">
import { onMounted, onBeforeUnmount, provide } from 'vue';
import { createTheatreState, theatreKey } from './game/theatre-state';
import { createGameClient } from './game/client';
import IconSprite from './components/IconSprite.vue';
import MenuScreen from './components/MenuScreen.vue';
import RoomScreen from './components/RoomScreen.vue';
import BattleScreen from './components/BattleScreen.vue';
import TheatreDialogs from './components/TheatreDialogs.vue';

const ui = createTheatreState();
provide(theatreKey, ui);
let client: ReturnType<typeof createGameClient> | undefined;
onMounted(() => { client = createGameClient(ui); });
onBeforeUnmount(() => client?.dispose());
</script>

<template>
  <div class="min-h-screen bg-ink text-bone font-body">
    <IconSprite />
    <main id="theatre-app"><MenuScreen /><RoomScreen /><BattleScreen /><TheatreDialogs /></main>
  </div>
</template>
