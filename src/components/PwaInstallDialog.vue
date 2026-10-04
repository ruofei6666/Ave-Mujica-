<script setup lang="ts">
import { ref } from 'vue';
import ModalFrame from './ModalFrame.vue';

const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = /MicroMessenger|\bQQ\//i.test(navigator.userAgent);
const platform = ref<'android' | 'ios'>(ios ? 'ios' : 'android');
</script>

<template>
  <ModalFrame id="install-dialog" class="install-dialog" close-label="关闭安装指引" aria-labelledby="install-title" aria-describedby="install-description">
    <template #head>
      <p class="kicker">FULLSCREEN · 全屏开场</p>
      <h2 id="install-title" class="headline">从桌面进入完整舞台</h2>
    </template>

    <p id="install-description" class="install-description">当前以普通网页打开。要使用本游戏的全屏模式，请先安装为 <strong>PWA（添加到主屏幕）</strong>，再从桌面「乱斗剧场」图标进入。</p>
    <p v-if="inAppBrowser" class="install-notice">你正在微信或 QQ 内打开。请点右上角「···」，选择在浏览器中打开：安卓使用 Chrome，苹果使用 Safari。</p>

    <div class="segmented install-platforms" role="group" aria-label="选择设备安装教程">
      <button id="install-android-tab" type="button" :aria-pressed="platform === 'android'" aria-controls="install-android-guide" @click="platform = 'android'">安卓 Android</button>
      <button id="install-ios-tab" type="button" :aria-pressed="platform === 'ios'" aria-controls="install-ios-guide" @click="platform = 'ios'">苹果 iPhone / iPad</button>
    </div>

    <section v-show="platform === 'android'" id="install-android-guide" aria-labelledby="install-android-tab">
      <ol class="help-steps install-steps">
        <li><b>用 Chrome 打开游戏</b><p>复制当前网址，在安卓手机的 Chrome 浏览器中打开。</p></li>
        <li><b>在菜单中安装</b><p>点右上角「⋮」，选择「安装应用」或「添加到主屏幕」。部分版本在「安装和创建快捷方式」中，继续选择「安装」并确认。</p></li>
        <li><b>回到桌面，再打开</b><p>点击「乱斗剧场」图标进入游戏，横屏即可展开舞台。</p></li>
      </ol>
      <p class="install-note">若图标仍打开带地址栏的网页，请在 Chrome 中选择「安装」应用。电脑也可通过 Chrome / Edge 地址栏的安装图标进入。</p>
      <a class="text-btn install-source" href="https://support.google.com/chrome/answer/9658361?hl=zh-Hans&amp;co=GENIE.Platform%3DAndroid" target="_blank" rel="noopener">查看 Chrome 官方指引 ↗</a>
    </section>

    <section v-show="platform === 'ios'" id="install-ios-guide" aria-labelledby="install-ios-tab">
      <ol class="help-steps install-steps">
        <li><b>用 Safari 打开游戏</b><p>复制当前网址，在 iPhone 或 iPad 的 Safari 浏览器中打开。</p></li>
        <li><b>共享 → 添加到主屏幕</b><p>点工具栏的共享按钮（方框向上箭头）；部分布局需先打开页面菜单，再点「共享」。向下找到「添加到主屏幕」。</p></li>
        <li><b>添加为网页 App，再从桌面进入</b><p>如果出现「作为网页 App 打开」，请保持开启，再点「添加」。回到主屏幕，点「乱斗剧场」图标。</p></li>
      </ol>
      <p class="install-note">找不到「添加到主屏幕」时，在共享菜单底部点「编辑操作」添加。PWA 会隐藏浏览器工具栏；系统状态栏和底部手势条可能仍保留。</p>
      <a class="text-btn install-source" href="https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener">查看 Apple 官方指引 ↗</a>
    </section>

    <p id="install-status" class="install-notice" role="status" aria-live="polite" hidden></p>
    <template #footer>
      <button id="install-now-btn" type="button" class="btn btn-primary" hidden><svg class="ui-ic" aria-hidden="true"><use href="#ui-install" /></svg>安装到桌面</button>
      <form method="dialog" class="install-dismiss"><button id="install-later-btn" class="btn btn-line btn-block">暂时用浏览器玩</button></form>
    </template>
  </ModalFrame>
</template>

<style scoped>
.install-dialog :deep(.modal-inner) { max-height: 90vh; max-height: 90dvh; }
.install-dialog :deep(.modal-head) { flex-shrink: 0; }
.install-dialog :deep(.dialog-close) { width: 44px; height: 44px; flex-shrink: 0; }
.install-dialog :deep(.headline) { font-size: 1.8rem; line-height: 1.2; }
.install-dialog :deep(.modal-body) > * { flex-shrink: 0; }
.install-dialog :deep(.modal-foot) { display: flex; flex-shrink: 0; gap: .75rem; padding: .8rem 1.5rem 1rem; border-top: 1px solid rgb(255 255 255 / .1); }
.install-description { font-size: max(14px, .95rem); }
.install-description strong { color: var(--volt); font-weight: 600; }
.install-platforms { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.install-platforms button { min-height: 44px; font-size: max(13px, .95rem); letter-spacing: .02em; }
.install-steps { gap: 1rem; }
.install-steps b { font-size: max(15px, 1.05rem); line-height: 1.4; letter-spacing: 0; }
.install-steps p { font-size: max(13px, .88rem); }
.install-note { margin-top: 1rem !important; font-size: max(12px, .8rem); color: var(--fog); }
.install-notice { padding: .7rem .9rem; border-left: 2px solid var(--volt); background: rgb(255 232 26 / .07); font-size: max(13px, .85rem); }
.install-source { margin-top: .4rem; font-size: max(12px, .8rem); }
.install-dismiss, #install-now-btn { flex: 1; min-width: 0; margin: 0; }
.install-dialog .btn { min-height: 44px; padding: 0 .65rem; font-size: max(14px, 1rem); letter-spacing: .02em; }
@media (max-width: 480px) {
  .install-dialog :deep(.modal-head) { padding: 1rem; gap: .5rem; }
  .install-dialog :deep(.modal-body) { padding: .9rem 1rem 1.1rem; }
  .install-dialog :deep(.modal-foot) { padding: .7rem 1rem 1rem; }
  .install-dialog :deep(.headline) { font-size: 1.55rem; }
}
</style>
