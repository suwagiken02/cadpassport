// lib/konva/autolayout/scoring.ts
// autoLayoutUtils.ts から分割（優先度スコア系・挙動変更なし）
import { HandrailLengthMm, PriorityConfig } from '@/types';

// ============================================================
// 優先度評価ヘルパー（Phase 5-B 以降でアルゴリズム本体に組み込み）
// ============================================================

/** スコアリング用定数（Phase 5-B/D で使用） */
export const SCORING_CONFIG = {
  RANK_MAIN: 10.0,
  RANK_SUB: 6.0,
  RANK_ADJUST: 2.0,
  RANK_INNER_STEP: 0.1, // ランク内の部材間差
  PENALTY_PER_RAIL: 0.5, // 本数ペナルティ係数（Phase 5-D で使用）
  PENALTY_PER_MM: 0.01, // remainder ペナルティ係数（Phase 5-D で使用）
} as const;

/** 指定サイズが優先リストのどのセクションに属するかを返す */
export function getSectionOfSize(
  size: HandrailLengthMm,
  priorityConfig: PriorityConfig,
): 'main' | 'sub' | 'adjust' | 'excluded' {
  const idx = priorityConfig.order.indexOf(size);
  if (idx < 0) return 'excluded';
  const mainEnd = priorityConfig.mainCount;
  const subEnd = priorityConfig.mainCount + priorityConfig.subCount;
  const adjustEnd =
    priorityConfig.mainCount + priorityConfig.subCount + priorityConfig.adjustCount;
  if (idx < mainEnd) return 'main';
  if (idx < subEnd) return 'sub';
  if (idx < adjustEnd) return 'adjust';
  return 'excluded';
}

/** 指定サイズのスコアを返す
 *  - main: 基準 10.0、ランク内 -0.1 ずつ
 *  - sub:  基準 6.0、ランク内 -0.1 ずつ
 *  - adjust: 基準 2.0、ランク内 -0.1 ずつ
 *  - excluded: -Infinity（使用禁止）
 */
export function getScoreOfSize(
  size: HandrailLengthMm,
  priorityConfig: PriorityConfig,
): number {
  const section = getSectionOfSize(size, priorityConfig);
  if (section === 'excluded') return -Infinity;

  const idx = priorityConfig.order.indexOf(size);
  const mainEnd = priorityConfig.mainCount;
  const subEnd = priorityConfig.mainCount + priorityConfig.subCount;

  let base: number;
  let innerIndex: number;
  if (section === 'main') {
    base = SCORING_CONFIG.RANK_MAIN;
    innerIndex = idx; // main 先頭からの位置
  } else if (section === 'sub') {
    base = SCORING_CONFIG.RANK_SUB;
    innerIndex = idx - mainEnd;
  } else {
    base = SCORING_CONFIG.RANK_ADJUST;
    innerIndex = idx - subEnd;
  }
  return base - innerIndex * SCORING_CONFIG.RANK_INNER_STEP;
}

/** 複数部材の構成に対する平均スコア（空配列は 0） */
export function scoreCombination(
  rails: HandrailLengthMm[],
  priorityConfig: PriorityConfig,
): number {
  if (rails.length === 0) return 0;
  let total = 0;
  for (const r of rails) {
    total += getScoreOfSize(r, priorityConfig);
  }
  return total / rails.length;
}

