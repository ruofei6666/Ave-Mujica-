<script setup lang="ts">
import { useTheatreState } from '../game/theatre-state';
import Backdrop from './Backdrop.vue';
import CharacterRoster from './CharacterRoster.vue';
const ui = useTheatreState();
</script>

<template>
  <section id="room" class="screen room" hidden>
    <Backdrop />

    <header class="menu-top">
      <div class="brand">
        <span class="brand-mark"><svg class="ui-ic" aria-hidden="true"><use href="#ui-emblem" /></svg></span>
        <span class="brand-text"><b>AVE <i>MUJICA</i></b><small>双人剧场 · VERSUS ROOM</small></span>
      </div>
      <div class="menu-tools"><button id="leave-room" class="btn btn-line btn-sm">退出房间</button></div>
    </header>

    <div class="room-body">
      <div class="room-side">
        <div class="room-info">
          <p class="kicker">INVITE · 邀请朋友出演</p>
          <h1 class="room-title"><span>房间</span><b id="room-display">------</b></h1>
          <button id="copy-room" class="text-btn">复制邀请链接<svg class="ui-ic" aria-hidden="true"><use href="#ui-copy" /></svg></button>
        </div>
        <div class="room-pick frame frame-brackets">
          <p class="kicker">YOUR PERFORMER · 你的角色</p>
          <CharacterRoster roster-id="room-roster" />
          <button id="ready-btn" class="btn btn-primary btn-block">准备开场</button>
          <p id="room-status" class="status" role="status" aria-live="polite">等待另一位出演者。</p>
        </div>
      </div>

      <div id="room-seats" class="room-seats">
        <div v-for="(player, index) in ui.roomPlayers" :key="index" :class="['room-seat', { empty: !player }]">
          <span class="seat-tag" aria-hidden="true">P{{ index + 1 }}</span>
          <template v-if="player">
            <canvas class="room-portrait" :data-portrait-id="player.id" data-portrait-mode="bust" width="240" height="280" :aria-label="player.name" />
            <div class="seat-name">
              <h3>{{ player.name }}</h3>
              <p :class="{ prepared: player.ready }">{{ player.ready ? '已准备' : '选择角色中' }}</p>
            </div>
          </template>
          <template v-else>
            <svg class="seat-empty-ic ui-ic" aria-hidden="true"><use href="#ui-emblem" /></svg>
            <div class="seat-name"><p class="waiting">等待朋友加入</p></div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
