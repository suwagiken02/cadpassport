// lib/konva/autolayout/combinations.ts
// autoLayoutUtils.ts から分割（DFS 探索系・挙動変更なし）
import { HandrailLengthMm, PriorityConfig } from '@/types';
import { getSectionOfSize } from './scoring';

// === 使用可能な手摺長さ（mm・メートル規格フォールバック既定） ===
// 実呼出は常に store の enabledSizes を渡すため、これは引数省略時のフォールバックのみ。
// 規格切替は enabledSizes 経由で行われ、baseSize=最大有効サイズの計算ロジックは不変。
export const HANDRAIL_SIZES: HandrailLengthMm[] = [1800, 1200, 900, 600, 400, 300, 200];

// === インチ規格フォールバック既定（全 8 種） ===
export const INCH_HANDRAIL_SIZES: HandrailLengthMm[] = [1829, 1524, 1219, 914, 610, 410, 305, 200];

/** CAD パスポート: 1辺(1面)の自動割付ルール用定数 */
// 離れ(終点離れ)をぴったりに合わせられないとき、動かしてよい上限 (mm)
export const END_DISTANCE_TOLERANCE_MM = 50;
// 1辺で使える非メイン(サブ+調整)部材の最大本数。メイン部材は無制限。
export const MAX_NON_MAIN_PER_EDGE = 3;

/** サイズが priorityConfig のメイン帯に属するか */
function isMainSize(size: HandrailLengthMm, priorityConfig: PriorityConfig): boolean {
  return getSectionOfSize(size, priorityConfig) === 'main';
}

/**
 * 指定された targetEndDistanceMm をぴったり実現する手摺の組み合わせを全て見つける。
 * DFS で列挙、結果100件で打ち切り。
 *
 * priorityConfig を渡すと「1面の部材数ルール」を適用する:
 *   - 非メイン(サブ+調整)部材は合計 MAX_NON_MAIN_PER_EDGE 本まで(超える枝は枝刈り)
 *   - メイン部材は無制限(総本数上限はメイン本数で頭打ちにしない)
 *   - 除外(excluded)サイズは使用しない
 * priorityConfig 省略時は従来動作(総本数 MAX_DEPTH=20・制約なし)で完全後方互換。
 */
export function findAllCombinationsForEnd(
  edgeLengthMm: number,
  startContribution: number,
  targetEndDistanceMm: number,
  isNextConvex: boolean,
  enabledSizes: HandrailLengthMm[],
  priorityConfig?: PriorityConfig,
): HandrailLengthMm[][] {
  const endContribution = isNextConvex ? targetEndDistanceMm : -targetEndDistanceMm;
  const requiredRailsTotal = startContribution + edgeLengthMm + endContribution;

  if (requiredRailsTotal <= 0) return [];
  if (enabledSizes.length === 0) return [];

  // priorityConfig あり: 除外(excluded)サイズは使用不可なので外す
  const usableSizes: HandrailLengthMm[] = priorityConfig
    ? enabledSizes.filter(s => getSectionOfSize(s, priorityConfig) !== 'excluded')
    : [...enabledSizes];
  if (usableSizes.length === 0) return [];

  const sortedSizes: HandrailLengthMm[] = [...usableSizes].sort((a, b) => b - a);

  // 早期枝刈り: requiredRailsTotal が GCD の倍数でなければ達成不可能
  const computeGcd = (a: number, b: number): number => {
    while (b) { const t = b; b = a % b; a = t; }
    return a;
  };
  let stepGcd: number = sortedSizes[0];
  for (const s of sortedSizes) stepGcd = computeGcd(stepGcd, s);
  if (requiredRailsTotal % stepGcd !== 0) return [];

  const results: HandrailLengthMm[][] = [];
  const MAX_RESULTS = 100;
  // メイン無制限のため、総本数上限はメイン本数で頭打ちにならない大きめの値にする。
  // 非メイン本数は maxNonMain で別途制限する(priorityConfig あり時のみ)。
  const MAX_DEPTH = priorityConfig ? 200 : 20;
  const maxNonMain = priorityConfig ? MAX_NON_MAIN_PER_EDGE : Infinity;

  const dfs = (remaining: number, current: HandrailLengthMm[], maxIndex: number, nonMainCount: number): void => {
    if (results.length >= MAX_RESULTS) return;
    if (remaining === 0) {
      results.push([...current]);
      return;
    }
    if (current.length >= MAX_DEPTH) return;
    for (let i = maxIndex; i < sortedSizes.length; i++) {
      const size = sortedSizes[i];
      if (size > remaining) continue;
      const nonMain = priorityConfig ? !isMainSize(size, priorityConfig) : false;
      if (nonMain && nonMainCount >= maxNonMain) continue;
      current.push(size);
      dfs(remaining - size, current, i, nonMainCount + (nonMain ? 1 : 0));
      current.pop();
      if (results.length >= MAX_RESULTS) return;
    }
  };

  dfs(requiredRailsTotal, [], 0, 0);
  return results;
}

