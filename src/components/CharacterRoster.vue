<script setup lang="ts">
import { characters } from '../../shared/combat';
import Art from '../game/art';
import { useTheatreState } from '../game/theatre-state';
defineProps<{ rosterId: string; compact?: boolean }>();
const ui = useTheatreState();
</script>

<template>
  <!-- client.ts keys sound cues and selection off .character-card / .opponent-card, [data-character], aria-pressed -->
  <div :id="rosterId" :class="compact ? 'opponents' : 'roster'" :aria-label="compact ? '电脑对手' : '你的角色'">
    <button v-for="(c, index) in ui.rosters[rosterId] ? characters : []" :key="c.id" type="button"
      :data-character="c.id" :aria-label="ui.rosters[rosterId]?.levels ? `${c.name}，第 ${ui.rosters[rosterId].levels?.[c.id]} 级` : `${c.name} ${c.tag}`"
      :aria-pressed="ui.rosters[rosterId]?.selected === c.id"
      :class="[compact ? 'opponent-card' : 'character-card', { selected: ui.rosters[rosterId]?.selected === c.id }]"
      :style="{ '--c': Art.CHARS[c.id].accent, '--c-bg': Art.CHARS[c.id].dark, '--c-glow': Art.rgba(Art.CHARS[c.id].glow, .7) }"
      @click="ui.rosters[rosterId]?.onSelect(c.id)">
      <template v-if="compact">
        <i class="chip-dot" aria-hidden="true"></i><span>{{ c.name }}</span>
        <small v-if="ui.rosters[rosterId]?.levels" class="opponent-level">{{ ui.rosters[rosterId].levels?.[c.id] }}级</small>
      </template>
      <template v-else>
        <span class="card-no" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="card-photo"><img class="card-face" :src="Art.assetUrl(c.id)" alt="" decoding="async"></span>
        <strong>{{ c.name }}</strong>
        <span class="card-alias">{{ c.tag }}</span>
      </template>
    </button>
  </div>
</template>
