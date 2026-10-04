import { AI_DIFFICULTIES } from './ai';
import type { AiProfile, DifficultyConfig } from './types';

export const CHALLENGE_LEVEL = 20;
const START: DifficultyConfig = { label: '第 1 级', miss: .34, skill: .34, ult: .3, aggro: .55, jump: .02, think: 26, precision: .45 };
export const normalizeLadderLevel = (level: number) => Number.isFinite(level)
  ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(level))) : 1;

export function getLadderStage(requested: number) {
  const level = normalizeLadderLevel(requested);
  const progress = Math.min(1, (level - 1) / (CHALLENGE_LEVEL - 1));
  // Close most of the reaction/accuracy gap in the middle levels, so reaching
  // the exact challenge controller does not cause a sudden final-level jump.
  const strength = 1 - (1 - progress) ** 2;
  const target = AI_DIFFICULTIES.hard;
  const mix = (key: Exclude<keyof DifficultyConfig, 'label'>) => strength === 1 ? target[key] : START[key] + (target[key] - START[key]) * strength;
  const ai: AiProfile = {
    config: { label: `第 ${level} 级`, miss: mix('miss'), skill: mix('skill'), ult: mix('ult'),
      aggro: mix('aggro'), jump: mix('jump'), think: mix('think'), precision: mix('precision') },
    rank: 2 * strength,
    tactics: strength,
  };
  const extra = Math.max(0, level - CHALLENGE_LEVEL);
  return {
    level, ai,
    healthMultiplier: 1 + extra * .05,
    damageMultiplier: 1 + extra * .03,
    description: extra ? `挑战 AI · 生命 +${extra * 5}% · 伤害 +${extra * 3}%`
      : level === CHALLENGE_LEVEL ? '挑战 AI · 完整预判、反击与连招'
        : level <= 5 ? '初登舞台 · 反应较慢，练习走位与出招'
          : level <= 10 ? '渐入佳境 · 追击更紧，开始预判与闪避'
            : level <= 15 ? '攻势渐强 · 更快反应，抓住破绽反击'
              : '逼近挑战 · 更准预判，更连贯的反击与连招',
  };
}
