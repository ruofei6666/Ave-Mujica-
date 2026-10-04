<script setup lang="ts">
import { computed } from 'vue';
import { characters } from '../../shared/combat';
import Art from '../game/art';
import { useTheatreState } from '../game/theatre-state';
import Backdrop from './Backdrop.vue';
import CharacterRoster from './CharacterRoster.vue';

const ui = useTheatreState();
// The selected performer drives the hero panel; client.ts also re-colors --accent* on <html>.
const picked = computed(() => {
  const id = ui.rosters['character-roster']?.selected;
  if (!id) return null;
  return { ...Art.CHARS[id], no: String(characters.findIndex((c) => c.id === id) + 1).padStart(2, '0') };
});
</script>

<template>
  <section id="menu" class="screen menu">
    <Backdrop :with-scene="false" />

    <header class="menu-top">
      <a class="brand" href="#" aria-label="Ave Mujica 乱斗剧场" @click.prevent>
        <span class="brand-mark"><svg class="ui-ic" aria-hidden="true"><use href="#ui-emblem" /></svg></span>
        <span class="brand-text"><b>AVE <i>MUJICA</i></b><small>乱斗剧场 · BRAWL THEATRE</small></span>
      </a>
      <div class="menu-tools">
        <span class="rec" aria-hidden="true"><i></i>LIVE</span>
        <button id="help-btn" class="icon-btn frame frame-sm" aria-label="操作说明"><svg class="ui-ic" aria-hidden="true"><use href="#ui-help" /></svg><small>操作</small></button>
        <button id="settings-btn" class="icon-btn frame frame-sm" aria-label="声音设置"><svg class="ui-ic" aria-hidden="true"><use href="#ui-sliders" /></svg><small>设置</small></button>
      </div>
    </header>

    <div class="menu-body">
      <section class="hero" aria-label="角色立绘">
        <h1 class="sr-only">Ave Mujica 乱斗剧场</h1>
        <div class="hero-glow" aria-hidden="true"></div>
        <div class="hero-slab" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="22,0 100,0 78,100 0,100" /><polygon points="30,-2 106,-2 84,102 8,102" /></svg>
        </div>
        <div class="hero-shard" aria-hidden="true"></div>
        <p class="hero-code" aria-hidden="true">{{ picked?.code }}</p>
        <p class="hero-rail" aria-hidden="true">PERFORMER / ON STAGE</p>
        <canvas id="portrait" width="420" height="560" aria-label="选中角色的立绘"></canvas>
        <div v-if="picked" class="hero-plate">
          <p class="hero-no"><b>{{ picked.no }}</b><span>/ 05</span></p>
          <h2 class="hero-name">{{ picked.full }}</h2>
          <p class="hero-meta"><span class="tag">{{ picked.code }}</span><span>{{ picked.role }}</span><span>{{ picked.flowerCN }} · {{ picked.meaning }}</span></p>
        </div>
        <div class="hero-marks" aria-hidden="true"><i class="barcode"></i></div>
      </section>

      <section class="deploy frame frame-lg frame-brackets" aria-label="出战设置">
        <div class="deploy-head">
          <div><p class="kicker">LINEUP · 05</p><h2 class="headline">选择出演者</h2></div>
          <span class="deploy-no" aria-hidden="true">{{ picked?.no }}</span>
        </div>
        <CharacterRoster roster-id="character-roster" />

        <div class="deploy-modes" role="group" aria-label="对战模式">
          <button id="mode-pve" class="mode-tab active" aria-pressed="true"><b>人机对战</b><span>选择对手，随时练习</span></button>
          <button id="mode-pvp" class="mode-tab" aria-pressed="false"><b>人人对战</b><span>房间码邀请朋友</span></button>
        </div>

        <div id="pve-options" class="deploy-body">
          <div class="opt-head"><span class="kicker">OPPONENT · 对手</span><span id="opponent-name" class="opt-value">初华</span></div>
          <CharacterRoster roster-id="opponent-roster" compact />
          <div class="opt-head"><span class="kicker">DIFFICULTY · 难度</span></div>
          <div id="difficulty" class="segmented">
            <button data-difficulty="easy" class="active">普通</button>
            <button data-difficulty="normal" title="原挑战级：快速反应、追击与闪避">困难</button>
            <button data-difficulty="hard" title="进阶人机：预判命中、抓后摇、选择反击与连招">挑战</button>
          </div>
          <button id="start-btn" class="btn btn-primary btn-block">开始对战<svg class="ui-ic ui-chev" aria-hidden="true"><use href="#ui-chevrons" /></svg></button>
        </div>

        <div id="pvp-options" class="deploy-body" hidden>
          <p class="room-hint">每人一台设备。建房后，将邀请链接或六位房间码发给朋友。</p>
          <button id="create-btn" class="btn btn-primary btn-block">创建房间<svg class="ui-ic" aria-hidden="true"><use href="#ui-plus" /></svg></button>
          <form id="join-form" class="join-form">
            <label class="sr-only" for="room-code">六位房间码</label>
            <input id="room-code" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="六位房间码" required>
            <button type="submit" class="btn btn-line btn-sm">加入</button>
          </form>
          <p id="online-status" class="subtle">双方选好角色并准备后开始。</p>
        </div>

        <div class="deploy-foot">
          <div class="deploy-links">
            <button id="skill-info-btn" class="text-btn">查看角色招式<svg class="ui-ic" aria-hidden="true"><use href="#ui-arrow" /></svg></button>
            <button id="balance-btn" class="text-btn" aria-haspopup="dialog" aria-controls="balance-dialog">对战胜率<svg class="ui-ic" aria-hidden="true"><use href="#ui-arrow" /></svg></button>
          </div>
          <p id="menu-status" class="status" role="status" aria-live="polite"></p>
        </div>
      </section>
    </div>

    <footer class="menu-foot">
      <span class="foot-hint"><svg class="ui-ic" aria-hidden="true"><use href="#ui-rotate" /></svg>手机横屏，展开舞台。</span>
      <span id="record-line" class="foot-record">今晚，从第一场开始。</span>
      <span class="foot-actions">
        <span id="pwa-status" class="subtle" role="status">{{ ui.pwaStatus }}</span>
        <button v-if="ui.pwaUpdateAvailable" id="update-app-btn" class="text-btn" @click="ui.updatePwa">更新版本</button>
        <button id="install-btn" class="text-btn" hidden>安装到桌面</button>
        <button id="credits-btn" class="text-btn">作品与素材</button>
      </span>
    </footer>
  </section>
</template>

<style scoped>
.deploy-foot { flex-wrap: wrap; }
.deploy-links { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem 1.2rem; }
.deploy-links .text-btn { min-height: 2.75rem; }
</style>
