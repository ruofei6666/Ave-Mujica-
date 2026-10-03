<script setup lang="ts">
import { useTheatreState } from '../game/theatre-state';
const ui = useTheatreState();
</script>

<template>
  <!-- Every id, data-* hook and state class below is driven by client.ts; change looks in battle.css, not names here. -->
  <section id="battle" class="screen battle" hidden>
    <canvas id="arena" width="1280" height="720" aria-label="对战舞台"></canvas>
    <div class="battle-shade" aria-hidden="true"></div>
    <div v-if="ui.offscreenOpponent" class="opponent-direction" :class="ui.offscreenOpponent" aria-hidden="true">
      {{ ui.offscreenOpponent === 'left' ? '← 对手' : '对手 →' }}
    </div>

    <div class="battle-hud">
      <div class="fighter-hud left-hud">
        <div class="fh-face"><img id="left-face" alt="" decoding="async"></div>
        <div class="fh-body">
          <div class="fighter-label"><span id="left-name"></span><small id="left-seat"></small><em id="left-skill" class="skill-flash"></em></div>
          <div class="health-track"><div id="left-lag" class="lag"></div><div id="left-hp"></div></div>
          <div class="energy-track"><div id="left-mp"></div><b class="ult-tag">ULT</b></div>
        </div>
      </div>

      <div class="match-clock"><span id="clock">90</span><small id="connection-label">人机对战</small></div>

      <div class="fighter-hud right-hud">
        <div class="fh-face"><img id="right-face" alt="" decoding="async"></div>
        <div class="fh-body">
          <div class="fighter-label"><span id="right-name"></span><small id="right-seat"></small><em id="right-skill" class="skill-flash"></em></div>
          <div class="health-track"><div id="right-lag" class="lag"></div><div id="right-hp"></div></div>
          <div class="energy-track"><div id="right-mp"></div><b class="ult-tag">ULT</b></div>
        </div>
      </div>
    </div>

    <div id="combo" class="combo" hidden aria-hidden="true"><b id="combo-n">0</b><span>HITS</span></div>
    <button id="pause-btn" class="battle-pause icon-btn frame frame-sm" aria-label="暂停或退出对战"><svg class="ui-ic" aria-hidden="true"><use href="#ui-pause" /></svg></button>
    <div id="battle-callout" class="battle-callout" aria-live="polite"></div>
    <div id="ko-banner" class="ko-banner" hidden aria-hidden="true"><span>K.O.</span></div>

    <div id="versus" class="versus" hidden aria-hidden="true">
      <div class="vs-speed"></div>
      <div id="vs-left" class="vs-band vs-left"><canvas id="vs-art-left" width="360" height="360"></canvas><div class="vs-name"><small id="vs-role-left"></small><b id="vs-name-left"></b></div></div>
      <div id="vs-right" class="vs-band vs-right"><canvas id="vs-art-right" width="360" height="360"></canvas><div class="vs-name"><small id="vs-role-right"></small><b id="vs-name-right"></b></div></div>
      <div class="vs-mark">VS</div>
    </div>

    <!-- ultimate call-out: a slim strip under the HUD, never over the fight (see battle.css) -->
    <div id="cutin" class="cutin" hidden aria-hidden="true" data-side="left">
      <div class="cutin-strip">
        <div class="cutin-face"><img id="cutin-art" alt="" decoding="async"></div>
        <div class="cutin-text"><small id="cutin-role">ULTIMATE</small><strong id="cutin-skill"></strong><span id="cutin-name"></span></div>
      </div>
    </div>

    <div id="touch-controls" class="touch-controls">
      <div id="joystick" class="joystick" aria-label="拖动摇杆移动，向上跳跃"><div class="stick-guide">移动 · 上推跳跃</div><div id="stick-knob" class="stick-knob"></div></div>
      <div class="attack-controls">
        <button data-action="special" class="action-btn skill-btn"><svg class="ic" aria-hidden="true"><use href="#ic-note" /></svg><span class="action-key">K</span><span class="action-name">技能一</span><span class="cooldown"></span></button>
        <button data-action="skill1" class="action-btn skill-btn"><svg class="ic" aria-hidden="true"><use href="#ic-note" /></svg><span class="action-key">U</span><span class="action-name">技能二</span><span class="cooldown"></span></button>
        <button data-action="skill2" class="action-btn skill-btn"><svg class="ic" aria-hidden="true"><use href="#ic-note" /></svg><span class="action-key">I</span><span class="action-name">技能三</span><span class="cooldown"></span></button>
        <button data-action="ult" class="action-btn ult-btn"><svg class="ic" aria-hidden="true"><use href="#ic-bolt" /></svg><span class="action-key">L</span><span class="action-name">大招</span><span class="cooldown"></span></button>
        <button data-action="punch" class="action-btn punch-btn"><svg class="ic" aria-hidden="true"><use href="#ic-fist" /></svg><span class="action-key">J</span><span class="action-name">普攻</span></button>
      </div>
    </div>
    <p class="keyboard-guide">
      <span><kbd>A</kbd><kbd>D</kbd>移动</span><span><kbd>W</kbd><kbd>空格</kbd>跳跃</span><span><kbd>J</kbd>普攻</span><span><kbd>K</kbd><kbd>U</kbd><kbd>I</kbd>技能</span><span><kbd>L</kbd>大招</span><span><kbd>Esc</kbd>暂停</span>
    </p>

    <div id="rotate-hint" class="rotate-hint"><svg class="ui-ic" aria-hidden="true"><use href="#ui-rotate" /></svg><p>横过手机，展开舞台</p><button id="portrait-play" class="btn btn-line btn-sm">继续竖屏游玩</button></div>

    <div id="pause-overlay" class="overlay" hidden>
      <div class="overlay-card frame frame-lg frame-brackets">
        <p class="kicker">INTERMISSION · 幕间</p>
        <h2 id="pause-title" class="headline">已暂停</h2>
        <p id="pause-description">准备好了就继续。</p>
        <button id="resume-btn" class="btn btn-primary btn-block">继续对战</button>
        <button id="quit-btn" class="btn btn-line btn-block">结束本场</button>
      </div>
    </div>

    <div id="result-overlay" class="overlay result-overlay" hidden>
      <div class="overlay-card result-card frame frame-lg frame-brackets">
        <p id="result-reason" class="kicker">K.O.</p>
        <h2 id="result-title" class="headline">谢幕</h2>
        <p id="result-description"></p>
        <div id="result-stats" class="result-stats"><span v-for="stat in ui.resultStats" :key="stat.label"><b>{{ stat.value }}</b>{{ stat.label }}</span></div>
        <button id="rematch-btn" class="btn btn-primary btn-block">再来一场</button>
        <button id="result-menu" class="btn btn-line btn-block">返回选人</button>
        <p id="rematch-status" class="subtle" role="status"></p>
      </div>
    </div>
  </section>
</template>
