<script setup lang="ts">
import { useTheatreState } from '../game/theatre-state';
import ModalFrame from './ModalFrame.vue';
import BalanceDialog from './BalanceDialog.vue';
const ui = useTheatreState();
</script>

<template>
  <ModalFrame id="settings-dialog" close-label="关闭设置">
    <template #head><p class="kicker">SETTINGS · 剧场设置</p><h2 class="headline">听见舞台</h2></template>
    <label class="vol-row"><span class="vol-name">背景配乐<small>MUSIC</small></span><input id="music-volume" type="range" min="0" max="100" value="100"><output id="music-value">100%</output></label>
    <label class="vol-row"><span class="vol-name">打击音效<small>SFX</small></span><input id="sfx-volume" type="range" min="0" max="100" value="100"><output id="sfx-value">100%</output></label>
    <label class="vol-row"><span class="vol-name">角色语音<small>VOICE</small></span><input id="voice-volume" type="range" min="0" max="100" value="100"><output id="voice-value">100%</output></label>
    <p id="voice-status" class="subtle"></p>
    <p class="voice-rule">角色台词在选人、大招和 K.O. 时播放；K.O. 使用获胜角色的台词。语音播放时配乐与打击声自动降低。</p>
    <div class="voice-box">
      <p id="voice-preview-role" class="kicker"></p>
      <div class="voice-previews">
        <button type="button" class="voice-preview" data-voice-cue="select">选人</button>
        <button type="button" class="voice-preview" data-voice-cue="ult">大招</button>
        <button type="button" class="voice-preview" data-voice-cue="ko">K.O.</button>
      </div>
    </div>
    <label class="check-row"><input id="low-motion" type="checkbox"><span class="check-box" aria-hidden="true"></span>减少动态效果</label>
    <p class="subtle">设置与战绩保存在这台设备的浏览器中。</p>
  </ModalFrame>

  <ModalFrame id="help-dialog" wide close-label="关闭说明">
    <template #head><p class="kicker">FIRST SHOW · 第一次出演</p><h2 class="headline">三步开场</h2></template>
    <ol class="help-steps">
      <li><b>选择角色与模式</b><p>人机立即开始；人人对战由一人建房，另一人输入房间码。双方准备后开场。</p></li>
      <li><b>移动、跳跃、抓住空隙</b><p>左侧摇杆移动，向上推跳跃；右侧五个按钮攻击。电脑用 A / D 移动，W / 空格跳跃。</p></li>
      <li><b>技能冷却，蓄能放大招</b><p>命中可以积蓄能量，大招需要满能量。按钮显示剩余冷却。出招期间提前按下的动作会短暂保留。</p></li>
    </ol>
    <p class="subtle">每场 90 秒，时间到按剩余生命判胜，双方同时倒下则平局。没有防御操作。</p>
    <button id="help-done" class="btn btn-primary btn-block">知道了，开始选人<svg class="ui-ic ui-chev" aria-hidden="true"><use href="#ui-chevrons" /></svg></button>
  </ModalFrame>

  <ModalFrame id="skills-dialog" wide close-label="关闭招式">
    <template #head><p id="skill-role" class="kicker"></p><h2 id="skill-title" class="headline"></h2></template>
    <div id="skill-list" class="skill-list">
      <div v-for="skill in ui.skills" :key="skill.slot" :class="['skill-row', { ult: skill.slot === 'ult' }]">
        <div class="skill-topline">
          <span class="skill-key" aria-hidden="true">{{ skill.key }}</span>
          <h3>{{ skill.move.name }}<small>{{ skill.slot === 'ult' ? '满能量' : skill.move.cd ? `冷却 ${(skill.move.cd / 60).toFixed(1)}s` : '普攻' }}</small></h3>
          <button v-if="skill.slot === 'ult'" type="button" class="voice-preview" aria-label="试听大招语音" @click="ui.previewUltimate">试听大招语音</button>
        </div>
        <p>{{ skill.move.hint || '靠近对手，在空隙中出拳。' }}</p>
        <details v-if="skill.move.detail"><summary>详细数值</summary><p>{{ skill.move.detail }}</p></details>
      </div>
    </div>
  </ModalFrame>

  <ModalFrame id="credits-dialog" close-label="关闭作品说明">
    <template #head><p class="kicker">CREDITS · 作品与素材</p><h2 class="headline">乱斗剧场</h2></template>
    <p>娱乐用途的同人小游戏。角色名称与形象来自 Ave Mujica / BanG Dream!，相关权利归原权利方。</p>
    <p>角色立绘、头像和对战动作参照官方舞台形象重新制作；每位出演者以自己的乐器作战。日语语音来自联动游戏的真实配音，具体短句与来源已记录。</p>
    <a class="text-btn" href="CREDITS.md" target="_blank" rel="noopener">查看素材来源记录<svg class="ui-ic" aria-hidden="true"><use href="#ui-arrow" /></svg></a>
  </ModalFrame>

  <BalanceDialog />

  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
</template>
