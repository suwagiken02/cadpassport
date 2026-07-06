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

/** 帯を守れる（honored=true）最寄りの拡張帯を探索して 1 個返す。守れる帯が上限内に無ければ null。
 *  元帯中心保存・lo 固定で hi 拡大・hi 固定で lo 拡大 の3軸で幅を STEP 刻みに広げ、
 *  各候補で computeCascadeLayout を再実行して honored を確認、元帯からの距離(|Δlo|+|Δhi|)最小を採る。
 *  center 以外(lower/非band)は探索対象外＝null（lower は現状で帯内に収まる／非band は帯概念なし）。 */
export function proposeClosingBand(
  buildingsByFloor: Record<number, BuildingShape>,
  distancesByFloor: Record<number, Record<number, number>>,
  scaffoldStartTop: ScaffoldStartConfig,
  enabledSizes: HandrailLengthMm[] | undefined,
  priorityConfig: PriorityConfig | undefined,
  userSelectionsByFloor: Record<number, Record<string, number>> | undefined,
  userAdjustmentsByFloor: Record<number, Record<string, EdgeAdjustment>> | undefined,
  band: BandRange,
): { lo: number; hi: number } | null {
  if (band.mode === 'lower') return null;
  const lo = Math.min(band.lo, band.hi);
  const hi = Math.max(band.lo, band.hi);
  const center = (lo + hi) / 2;

  // 元帯が既に honored なら提案不要（＝null）。UI は !honored のときだけ呼ぶが、pure 関数として自足させる。
  const baseR = computeCascadeLayout(
    buildingsByFloor, distancesByFloor, scaffoldStartTop, enabledSizes, priorityConfig,
    userSelectionsByFloor, userAdjustmentsByFloor, { lo, hi, mode: 'center' },
  );
  if (isBandHonored(baseR, { lo, hi }).honored) return null;

  // 候補帯を生成（重複排除・クランプ）。幅は元帯幅〜MAX_WIDTH を STEP 刻み、3軸で拡張。
  const seen = new Set<string>();
  const cands: { lo: number; hi: number }[] = [];
  const push = (l: number, h: number) => {
    const cl = Math.round(Math.max(MIN_DIST, l));
    const ch = Math.round(Math.min(MAX_DIST, h));
    if (ch <= cl) return;
    const k = `${cl},${ch}`;
    if (seen.has(k)) return;
    seen.add(k);
    cands.push({ lo: cl, hi: ch });
  };
  const startW = Math.max(hi - lo, STEP);
  for (let w = startW; w <= MAX_WIDTH; w += STEP) {
    push(center - w / 2, center + w / 2); // 中心保存
    push(lo, lo + w);                      // lo 固定・hi 拡大
    push(hi - w, hi);                      // hi 固定・lo 拡大
  }

  let best: { lo: number; hi: number; d: number } | null = null;
  for (const c of cands) {
    // 元帯と同一(=既に非 honored と分かっている)はスキップ。
    if (c.lo === lo && c.hi === hi) continue;
    const r = computeCascadeLayout(
      buildingsByFloor, distancesByFloor, scaffoldStartTop, enabledSizes, priorityConfig,
      userSelectionsByFloor, userAdjustmentsByFloor, { lo: c.lo, hi: c.hi, mode: 'center' },
    );
    if (!isBandHonored(r, { lo: c.lo, hi: c.hi }).honored) continue;
    const d = Math.abs(c.lo - lo) + Math.abs(c.hi - hi);
    if (!best || d < best.d || (d === best.d && (c.hi - c.lo) < (best.hi - best.lo))) {
      best = { lo: c.lo, hi: c.hi, d };
    }
  }
  return best ? { lo: best.lo, hi: best.hi } : null;
}
