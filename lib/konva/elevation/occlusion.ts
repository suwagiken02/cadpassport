// ============================================================
// 建物同士の遮蔽 (E-9・pure・node 安全)
//
// 建築立面図では、視点方向に対して手前の建物が奥の建物を隠す。E-5 の遮蔽は足場列どうしの
// x 区間切断だけで高さを見ていないため、「奥が高い → 上だけ見える」を表現できなかった。
// ここでは面ごとに「手前のシルエット（壁＋屋根）の上端」を作り、
//   ある高さ h の要素は、手前の上端が h 以上の x 区間では隠れる
// という **x 区間 × 高さしきい値** で遮蔽する（鮎澤氏承認の方式）。
//
// 座標系は buildFaceElevation の途中と同じ「変軸 x（グリッド）× 高さ mm（GL 基準）」。
// mirrorVariableAxis の前に適用する（＝ E-5 の applyOcclusionCut と同じ土俵）。
//
// 斜め（妻・勾配）の上端は、細かい x 刻みの階段（StepSpan[]）へ落としてから使う。
// こうすると以降はすべて区間演算だけで済み、判定が単純で壊れにくい。
// ============================================================
import type { BuildingShape, Point } from '@/types';
import type { BuildingOutline, RoofBand } from './elevationEngine';
import type { Face } from './faceReconstruction';
import { depthCoordOf } from './roofBandSource';

/** 上端プロファイルの素材（線形に変化する区間）。 */
export type ProfileSpan = { x0: number; x1: number; mm0: number; mm1: number };

/** 階段化した上端プロファイル（x 区間ごとに 1 つのしきい値高さ）。 */
export type StepSpan = { x0: number; x1: number; mm: number };

/** 斜面を階段に落とすときの x 刻み（グリッド＝10mm）。30 = 300mm。 */
export const OCCLUSION_STEP_GRID = 30;

/** 同一深度とみなす許容差（グリッド）。総二階など壁面が揃う建物は前後を作らない。 */
export const SAME_DEPTH_EPS = 1e-6;

const EPS = 1e-6;

/**
 * 視点への近さ（大きいほど手前）(= E-9)。roofFrontness と同じ規約を建物へ広げたもの。
 * south/east は奥行き最大が手前、north/west は最小が手前。
 * 建物の「最も視点に近い頂点」で代表する（面に向いた壁の位置）。
 */
export function buildingFrontness(building: BuildingShape, face: Face): number {
  return pointsFrontness(building.points, face);
}

/** 点列の frontness（大きいほど手前）。 */
export function pointsFrontness(points: Point[], face: Face): number {
  if (points.length === 0) return 0;
  const ds = points.map((p) => depthCoordOf(p, face));
  if (face === 'north' || face === 'west') {
    const v = -Math.min(...ds);
    return v === 0 ? 0 : v;   // -0 を +0 に正規化
  }
  return Math.max(...ds);
}

/** 足場列など「深さ 1 点」の frontness（applyOcclusionCut と同じ符号規約）。 */
export function depthFrontness(depthCoord: number, face: Face): number {
  return face === 'north' || face === 'west' ? -depthCoord : depthCoord;
}

/** 建物シルエットの上端（壁）。 */
export function outlineSpans(o: BuildingOutline): ProfileSpan[] {
  return o.segments
    .filter((s) => Math.abs(s.xEnd - s.xStart) > EPS)
    .map((s) => ({
      x0: Math.min(s.xStart, s.xEnd), x1: Math.max(s.xStart, s.xEnd),
      mm0: s.xStart <= s.xEnd ? s.heightStartMm : s.heightEndMm,
      mm1: s.xStart <= s.xEnd ? s.heightEndMm : s.heightStartMm,
    }));
}

/**
 * 屋根バンドの上端。塗るバンド（軒→棟の台形）は棟まで、線のみ（けらば・フラット軒）は
 * プロファイルそのものが上端。どちらも「そこに屋根が見えている高さ」を表す。
 */
export function roofBandSpans(b: RoofBand): ProfileSpan[] {
  const pts = b.profile;
  if (pts.length < 2) {
    // プロファイルが無い（あり得ないが安全側）: 棟高の矩形として扱う。
    return Math.abs(b.xEnd - b.xStart) > EPS
      ? [{ x0: Math.min(b.xStart, b.xEnd), x1: Math.max(b.xStart, b.xEnd), mm0: b.ridgeMm, mm1: b.ridgeMm }]
      : [];
  }
  const out: ProfileSpan[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    if (Math.abs(c.x - a.x) <= EPS) continue;
    const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
    const mm0 = a.x <= c.x ? a.mm : c.mm;
    const mm1 = a.x <= c.x ? c.mm : a.mm;
    // 塗るバンドは棟まで面がある＝その高さまで隠す側になる。
    out.push(b.filledToRidge && b.baseMm == null
      ? { x0, x1, mm0: Math.max(mm0, b.ridgeMm), mm1: Math.max(mm1, b.ridgeMm) }
      : { x0, x1, mm0, mm1 });
  }
  return out;
}

/** span の x における高さ（区間外は -Infinity）。 */
function spanAt(s: ProfileSpan, x: number): number {
  if (x < s.x0 - EPS || x > s.x1 + EPS) return -Infinity;
  const w = s.x1 - s.x0;
  if (w <= EPS) return Math.max(s.mm0, s.mm1);
  const t = (x - s.x0) / w;
  return s.mm0 + t * (s.mm1 - s.mm0);
}

/**
 * 上端プロファイルを階段化する (= E-9a)。
 * 区間ごとに「その区間で最も高い値」を採る（安全側＝隠す方向に丸める）ので、
 * 斜面でも取りこぼし（見えてはいけない部分が残る）が起きない。刻みは stepGrid。
 */
export function toStepProfile(
  spans: ProfileSpan[], stepGrid = OCCLUSION_STEP_GRID,
): StepSpan[] {
  const use = spans.filter((s) => s.x1 - s.x0 > EPS);
  if (use.length === 0) return [];
  const bounds = new Set<number>();
  for (const s of use) {
    bounds.add(s.x0);
    bounds.add(s.x1);
    if (stepGrid > 0 && Math.abs(s.mm1 - s.mm0) > EPS) {
      for (let x = s.x0 + stepGrid; x < s.x1 - EPS; x += stepGrid) bounds.add(x);
    }
  }
  const xs = Array.from(bounds).sort((a, b) => a - b);
  const out: StepSpan[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a <= EPS) continue;
    let mm = -Infinity;
    for (const s of use) {
      if (s.x1 <= a + EPS || s.x0 >= b - EPS) continue;   // この区間に掛かっていない
      mm = Math.max(mm, spanAt(s, Math.max(a, s.x0)), spanAt(s, Math.min(b, s.x1)));
    }
    if (!Number.isFinite(mm)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x1 - a) <= EPS && Math.abs(last.mm - mm) <= EPS) last.x1 = b;
    else out.push({ x0: a, x1: b, mm });
  }
  return out;
}

/** その x での遮蔽上端(mm)。どの区間にも入らなければ 0（＝何も隠さない）。 */
export function stepTopAt(steps: StepSpan[], x: number): number {
  let mm = 0;
  for (const s of steps) {
    if (x >= s.x0 - EPS && x <= s.x1 + EPS) mm = Math.max(mm, s.mm);
  }
  return mm;
}

/** 区間[]を昇順にマージ（接触も統合）。 */
function mergeIntervals(iv: [number, number][]): [number, number][] {
  const s = iv.filter(([a, b]) => b - a > EPS).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * 高さ hMm の要素が隠れる x 区間[] (= E-9a・x 区間 × 高さしきい値)。
 * 「手前の上端が h 以上」の区間＝その高さの線・面は見えない。
 */
export function hiddenIntervalsAt(steps: StepSpan[], hMm: number): [number, number][] {
  return mergeIntervals(
    steps.filter((s) => s.mm >= hMm - EPS).map((s) => [s.x0, s.x1] as [number, number]),
  );
}

/** 区間 [x0,x1] から穴[]を引いた残り（applyOcclusionCut の subtractIntervals と同じ意味）。 */
export function subtractIntervals(
  x0: number, x1: number, holes: [number, number][],
): [number, number][] {
  let parts: [number, number][] = [[Math.min(x0, x1), Math.max(x0, x1)]];
  for (const [h0, h1] of holes) {
    const next: [number, number][] = [];
    for (const [a, b] of parts) {
      if (h1 <= a + EPS || h0 >= b - EPS) { next.push([a, b]); continue; }   // 重ならない
      if (h0 > a + EPS) next.push([a, h0]);
      if (h1 < b - EPS) next.push([h1, b]);
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a > EPS);
}

/** 高さ hMm の水平要素が見える x 区間[]（= [x0,x1] − 隠れる区間）。 */
export function visibleIntervalsAt(
  x0: number, x1: number, steps: StepSpan[], hMm: number,
): [number, number][] {
  return subtractIntervals(x0, x1, hiddenIntervalsAt(steps, hMm));
}

/**
 * 建物シルエットのセグメントを手前プロファイルで切る (= E-9b の素材)。
 *   ・完全に隠れる区間 → 落とす
 *   ・一部だけ出る区間 → 下端を手前の上端まで持ち上げて残す（はみ出しだけ描く）
 * 戻り値は「上端(mm) と 下端(mm) を持つ区間[]」。下端 0 は従来どおり GL 立ち上がり。
 */
export type ClippedSpan = {
  x0: number; x1: number;
  topStartMm: number; topEndMm: number;
  baseStartMm: number; baseEndMm: number;
};

export function clipSpanByProfile(span: ProfileSpan, steps: StepSpan[]): ClippedSpan[] {
  const out: ClippedSpan[] = [];
  // 手前の区間境界で割ってから、区間ごとにしきい値 1 つで判定する。
  const bounds = new Set<number>([span.x0, span.x1]);
  for (const s of steps) {
    if (s.x0 > span.x0 + EPS && s.x0 < span.x1 - EPS) bounds.add(s.x0);
    if (s.x1 > span.x0 + EPS && s.x1 < span.x1 - EPS) bounds.add(s.x1);
  }
  const xs = Array.from(bounds).sort((a, b) => a - b);
  const topAt = (x: number) => spanAt(span, x);

  for (let i = 0; i < xs.length - 1; i++) {
    let a = xs[i], b = xs[i + 1];
    if (b - a <= EPS) continue;
    const h = stepTopAt(steps, (a + b) / 2);
    let ta = topAt(a), tb = topAt(b);
    if (h <= EPS) { out.push(seg(a, b, ta, tb, 0, 0)); continue; }      // 手前に何も無い
    const upA = ta > h + EPS, upB = tb > h + EPS;
    if (!upA && !upB) continue;                                        // 完全に隠れる
    if (upA && upB) { out.push(seg(a, b, ta, tb, h, h)); continue; }    // 全区間で上に出る
    // 片側だけ出る: 交点で割る（上端は線形なので厳密に求まる）
    const t = (h - ta) / (tb - ta);
    const xc = a + t * (b - a);
    if (upA) { b = xc; tb = h; } else { a = xc; ta = h; }
    if (b - a > EPS) out.push(seg(a, b, ta, tb, h, h));
  }
  return out;

  function seg(
    x0: number, x1: number, t0: number, t1: number, b0: number, b1: number,
  ): ClippedSpan {
    return { x0, x1, topStartMm: t0, topEndMm: t1, baseStartMm: b0, baseEndMm: b1 };
  }
}
