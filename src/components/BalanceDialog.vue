<script setup lang="ts">
import report from '../../tests/balance-report.json';
import ModalFrame from './ModalFrame.vue';

// Bundle the verified report so the same figures are available offline in the PWA.
const { result, rules } = report;
const standings = [...result.stats].sort((a, b) => b.rate - a.rate);
const number = (value: number) => value.toLocaleString('en-US');
</script>

<template>
  <ModalFrame id="balance-dialog" class="balance-dialog" wide close-label="关闭对战胜率" aria-labelledby="balance-title" aria-describedby="balance-method">
    <template #head>
      <p class="kicker">MATCHUPS · {{ report.aiLabel }} 模拟</p>
      <h2 id="balance-title" class="headline">对战胜率</h2>
    </template>

    <div class="balance-summary">
      <span><b>{{ result.matrix.length }}</b> 组对阵</span>
      <span><b>{{ number(result.matches) }}</b> 场模拟</span>
    </div>
    <p id="balance-method" class="balance-method">双方均由{{ report.aiLabel }}操作；每组 {{ number(result.rounds * 2) }} 场，交换左右各 {{ number(result.rounds) }} 场，每局上限 {{ result.duration }} 秒。平局计 {{ rules.drawScore }} 胜。</p>

    <table class="balance-table">
      <caption class="sr-only">十组角色之间的模拟胜率，已交换左右位置</caption>
      <thead><tr><th scope="col">角色 A · 胜率</th><th scope="col">角色 B · 胜率</th></tr></thead>
      <tbody>
        <tr v-for="pair in result.matrix" :key="pair.pairId" :data-pair="`${pair.a}-${pair.b}`">
          <td><span>{{ pair.aName }}</span><b :class="{ leading: pair.aRate > pair.bRate }">{{ pair.aRate.toFixed(3) }}%</b></td>
          <td><span>{{ pair.bName }}</span><b :class="{ leading: pair.bRate > pair.aRate }">{{ pair.bRate.toFixed(3) }}%</b></td>
        </tr>
      </tbody>
    </table>

    <details class="balance-overall">
      <summary>总体胜率 <span>最大差 {{ result.gap.toFixed(5) }} 个百分点</span></summary>
      <dl>
        <div v-for="role in standings" :key="role.id" :data-role="role.id"><dt>{{ role.name }}</dt><dd>{{ role.rate.toFixed(5) }}%</dd></div>
      </dl>
      <p>每位角色与其余四位等量对战，共 {{ number(result.stats[0].matches) }} 场。</p>
    </details>
    <p class="balance-note">这是原挑战级（现困难级）的历史模拟结果，不代表新版挑战级或玩家实战胜率。总体接近 50%，角色之间仍存在明显克制。</p>
  </ModalFrame>
</template>

<style scoped>
.balance-summary { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; align-items: baseline; }
.balance-summary span { font-size: max(12px, .8rem); color: var(--fog); }
.balance-summary b { margin-right: .25rem; font: 700 1.65rem/1 var(--font-display); color: var(--volt); font-variant-numeric: tabular-nums; }
.balance-method, .balance-note { font-size: max(12px, .8rem); color: var(--fog); }
.balance-table { width: 100%; flex-shrink: 0; border-collapse: collapse; table-layout: fixed; font-size: max(14px, .9rem); }
.balance-table th { padding: .6rem .8rem; text-align: left; font-size: max(11px, .7rem); font-weight: 500; letter-spacing: .08em; color: var(--fog); border-bottom: 1px solid rgb(255 255 255 / .2); }
.balance-table td { padding: .65rem .8rem; border-bottom: 1px solid rgb(255 255 255 / .08); }
.balance-table td + td, .balance-table th + th { border-left: 1px solid rgb(255 255 255 / .1); }
.balance-table tbody tr:nth-child(odd) { background: rgb(255 255 255 / .035); }
.balance-table td span { display: inline-block; }
.balance-table b { float: right; font: 500 max(12px, .85rem)/1.5 var(--font-mono); font-variant-numeric: tabular-nums; }
.balance-table .leading { color: var(--volt); }
.balance-overall { padding: .8rem; border: 1px solid rgb(255 255 255 / .12); font-size: max(12px, .8rem); }
.balance-overall summary { cursor: pointer; color: var(--bone); line-height: 1.6; }
.balance-overall summary span { display: inline-block; margin-left: .5rem; color: var(--fog); }
.balance-overall dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .5rem 1.5rem; margin: .8rem 0; }
.balance-overall dl div { display: flex; justify-content: space-between; gap: .5rem; }
.balance-overall dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.balance-overall p { color: var(--fog); }
@media (max-width: 480px) {
  .balance-dialog :deep(.modal-head) { padding: 1rem; }
  .balance-dialog :deep(.modal-body) { padding: .9rem 1rem 1.1rem; }
  .balance-table td, .balance-table th { padding: .65rem .45rem; }
  .balance-overall summary span { display: block; margin-left: 0; }
}
</style>
