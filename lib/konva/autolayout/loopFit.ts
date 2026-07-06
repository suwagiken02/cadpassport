// ============================================================
// S-2f-d: 範囲離れの「帯履行(band-honored)」判定と「閉じる帯」提案（pure・node 安全・テスト可能）。
//   狭帯では帯探索が「帯内に割れ位置(100mm刻み)が無い→帯を無視して帯外の最寄り clean へ
//   フォールバック」するため、closed=true でも採用離れが帯外に出る（帯不履行）。これを検出し、
//   帯を守れる最寄りの拡張帯を提案する。UI(AutoLayoutModal)は f-d-2 で配線。
// ============================================================
import type { BuildingShape, HandrailLengthMm, ScaffoldStartConfig, PriorityConfig } from '@/types';
import type { EdgeAdjustment } from '../autoLayoutUtils';
import { computeCascadeLayout, type FloorLayoutResult } from './cascade';

const TOL = 0.01;

export type BandRange = { lo: number; hi: number; mode?: 'center' | 'lower' };

export type BandHonorInfo = {
  /** 帯を守れているか＝全辺の採用離れが帯内 かつ 全辺 total==eff（一周が割れている）。 */
  honored: boolean;
  /** 帯外に出た採用離れ(startD/actualEnd)の件数。 */
  oobCount: number;
  /** 全floor全辺 |railsTotal − effectiveMm| 合計（0＝一周整合）。 */
  residual: number;
  /** 実際に採用された離れの範囲 [min,max]（辺が無ければ [NaN,NaN]）。 */
  distRange: [number, number];
};

/** 割付結果が帯[lo,hi]を守れているか判定。採用離れ(startDistanceMm/actualEndDistanceMm)が
 *  全て帯内に収まり、かつ全辺 total==eff のとき honored=true。 */
export function isBandHonored(
  results: Record<number, FloorLayoutResult>,
  band: BandRange,
): BandHonorInfo {
  const lo = Math.min(band.lo, band.hi);
  const hi = Math.max(band.lo, band.hi);
  let oobCount = 0;
  let residual = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const f of Object.keys(results).map(Number)) {
    for (const s of results[f].edgeSegments) {
      const sel = s.candidates[s.selectedIndex];
      if (!sel) continue;
      const d = Math.abs(sel.totalMm - s.effectiveMm);
      if (d > TOL) residual += d;
      for (const dist of [s.startDistanceMm, sel.actualEndDistanceMm]) {
        if (dist < min) min = dist;
        if (dist > max) max = dist;
        if (dist < lo - TOL || dist > hi + TOL) oobCount++;
      }
    }
  }
  const honored = oobCount === 0 && residual <= TOL;
  return {
    honored,
    oobCount,
    residual,
    distRange: [Number.isFinite(min) ? min : NaN, Number.isFinite(max) ? max : NaN],
  };
}

// 提案帯探索のクランプ（離れの現実的な範囲・帯幅上限）。
const MIN_DIST = 200;
const MAX_DIST = 2000;
const MAX_WIDTH = 300;
const STEP = 10;

export type ClosingBandProposals = {
  /** 下限固定・上へ拡張（→） */
  expandUp: { lo: number; hi: number } | null;
  /** 上限固定・下へ拡張（←） */
  expandDown: { lo: number; hi: number } | null;
  /** 中心保存・両側拡張（↕） */
  expandBoth: { lo: number; hi: number } | null;
};

/** 帯を守れる（honored=true）拡張帯を「方向別」に探索して返す。各方向はその方向だけの最小拡張。
 *  center 以外(lower/非band)や 元帯が既に honored なら全方向 null。同一帯になった方向は重複排除。
 *  → expandUp(lo固定でhi拡大) / ← expandDown(hi固定でlo拡大) / ↕ expandBoth(中心保存両側)。 */
export function proposeClosingBands(
  buildingsByFloor: Record<number, BuildingShape>,
  distancesByFloor: Record<number, Record<number, number>>,
  scaffoldStartTop: ScaffoldStartConfig,
  enabledSizes: HandrailLengthMm[] | undefined,
  priorityConfig: PriorityConfig | undefined,
  userSelectionsByFloor: Record<number, Record<string, number>> | undefined,
  userAdjustmentsByFloor: Record<number, Record<string, EdgeAdjustment>> | undefined,
  band: BandRange,
): ClosingBandProposals {
  const none: ClosingBandProposals = { expandUp: null, expandDown: null, expandBoth: null };
  if (band.mode === 'lower') return none;
  const lo = Math.min(band.lo, band.hi);
  const hi = Math.max(band.lo, band.hi);
  const center = (lo + hi) / 2;

  const run = (l: number, h: number) => computeCascadeLayout(
    buildingsByFloor, distancesByFloor, scaffoldStartTop, enabledSizes, priorityConfig,
    userSelectionsByFloor, userAdjustmentsByFloor, { lo: l, hi: h, mode: 'center' },
  );
  // 元帯が既に honored なら提案不要。UI は !honored のときだけ呼ぶが pure 関数として自足させる。
  if (isBandHonored(run(lo, hi), { lo, hi }).honored) return none;

  // ある方向 makeBand(w) で幅を STEP 刻みに広げ、最初に honored になった帯を返す。
  const searchDir = (makeBand: (w: number) => { lo: number; hi: number }): { lo: number; hi: number } | null => {
    for (let w = Math.max(hi - lo, STEP); w <= MAX_WIDTH; w += STEP) {
      const raw = makeBand(w);
      const cl = Math.round(Math.max(MIN_DIST, raw.lo));
      const ch = Math.round(Math.min(MAX_DIST, raw.hi));
      if (ch <= cl) continue;
      if (cl === lo && ch === hi) continue; // 元帯（非 honored 確定）はスキップ
      if (isBandHonored(run(cl, ch), { lo: cl, hi: ch }).honored) return { lo: cl, hi: ch };
    }
    return null;
  };

  const expandUp = searchDir((w) => ({ lo, hi: lo + w }));           // → 下限固定・上へ
  let expandDown = searchDir((w) => ({ lo: hi - w, hi }));           // ← 上限固定・下へ
  let expandBoth = searchDir((w) => ({ lo: center - w / 2, hi: center + w / 2 })); // ↕ 中心保存

  // 重複排除（先勝ち: expandUp → expandDown → expandBoth）。
  const eq = (a: { lo: number; hi: number } | null, b: { lo: number; hi: number } | null) =>
    !!a && !!b && a.lo === b.lo && a.hi === b.hi;
  if (eq(expandDown, expandUp)) expandDown = null;
  if (eq(expandBoth, expandUp) || eq(expandBoth, expandDown)) expandBoth = null;

  return { expandUp, expandDown, expandBoth };
}
