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
  /** 下端の折れ線 (= E-9-fix・mergeClipped が付ける)。直線なら undefined。 */
  basePath?: { x: number; mm: number }[];
};

/**
 * 連続して見える範囲を 1 枚にまとめる (= E-9-fix)。
 *
 * 遮蔽の判定は細かい x 区間で行うが、そのまま描くと短冊の左右の縦辺が全部線になり
 * 「シマシマ」に見える（実機症状）。隣り合う可視区間（x が接し、下端も連続）は
 * 1 つの ClippedSpan にまとめ、下端は折れ線 basePath で表す＝内部に線が出ない。
 */
export function mergeClipped(pieces: ClippedSpan[]): ClippedSpan[] {
  const out: ClippedSpan[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    const joins = last
      && Math.abs(last.x1 - p.x0) <= EPS
      && Math.abs(last.baseEndMm - p.baseStartMm) <= 1e-6;
    if (!joins) {
      out.push({ ...p, basePath: [{ x: p.x0, mm: p.baseStartMm }, { x: p.x1, mm: p.baseEndMm }] });
      continue;
    }
    last.x1 = p.x1;
    last.topEndMm = p.topEndMm;
    last.baseEndMm = p.baseEndMm;
    last.basePath!.push({ x: p.x1, mm: p.baseEndMm });
  }
  // 下端が 1 直線なら折れ線は不要（従来どおりの台形）。
  return out.map((c) => (c.basePath && isStraight(c.basePath) ? { ...c, basePath: undefined } : c));
}

/** 折れ線が 1 直線か（両端を結ぶ直線から外れる点が無いか）。 */
function isStraight(path: { x: number; mm: number }[]): boolean {
  if (path.length <= 2) return true;
  const a = path[0], b = path[path.length - 1];
  const w = b.x - a.x;
  for (const p of path) {
    const expect = Math.abs(w) <= EPS ? a.mm : a.mm + ((p.x - a.x) / w) * (b.mm - a.mm);
    if (Math.abs(p.mm - expect) > 1e-6) return false;
  }
  return true;
}

/** span[] の x における上端（重なりは高い方）。どれにも掛からなければ -Infinity。 */
export function spansTopAt(spans: ProfileSpan[], x: number): number {
  let mm = -Infinity;
  for (const s of spans) mm = Math.max(mm, spanAt(s, x));
  return mm;
}

export function clipSpanByProfile(
  span: ProfileSpan, steps: StepSpan[], exact?: ProfileSpan[],
): ClippedSpan[] {
  const out: ClippedSpan[] = [];
  // 手前の区間境界で割ってから、区間ごとにしきい値 1 つで判定する。
  const bounds = new Set<number>([span.x0, span.x1]);
  for (const s of steps) {
    if (s.x0 > span.x0 + EPS && s.x0 < span.x1 - EPS) bounds.add(s.x0);
    if (s.x1 > span.x0 + EPS && s.x1 < span.x1 - EPS) bounds.add(s.x1);
  }
  // E-9-fix: 手前の実輪郭の折れ点も割り位置に入れる。階段はここで平らに丸められている
  //   ことがあり（隣り合う段が同じ高さだと統合される）、棟の頂点などを取りこぼすため。
  for (const s of exact ?? []) {
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
    // 下端は「階段化した値」ではなく**手前の実際の輪郭**を使う (= E-9-fix)。
    //   階段は見える/見えないの判定にだけ使い、線は元の勾配なりに引く（ギザギザ防止）。
    const baseAt = (x: number, top: number) => {
      if (!exact) return h;
      const e = spansTopAt(exact, x);
      return Number.isFinite(e) ? Math.min(Math.max(e, 0), top) : h;
    };
    if (upA && upB) { out.push(seg(a, b, ta, tb, baseAt(a, ta), baseAt(b, tb))); continue; }
    // 片側だけ出る: 交点で割る（上端は線形なので厳密に求まる）
    const t = (h - ta) / (tb - ta);
    const xc = a + t * (b - a);
    if (upA) { b = xc; tb = h; } else { a = xc; ta = h; }
    if (b - a > EPS) out.push(seg(a, b, ta, tb, baseAt(a, ta), baseAt(b, tb)));
  }
  return out;

  function seg(
    x0: number, x1: number, t0: number, t1: number, b0: number, b1: number,
  ): ClippedSpan {
    return { x0, x1, topStartMm: t0, topEndMm: t1, baseStartMm: b0, baseEndMm: b1 };
  }
}

/** プロファイル点列を [a,b] に切り出す（端は線形補間）。 */
function profileBetween(
  pts: { x: number; mm: number }[], a: number, b: number,
): { x: number; mm: number }[] {
  const at = (x: number): number => {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const lo = Math.min(p.x, q.x), hi = Math.max(p.x, q.x);
      if (x >= lo - EPS && x <= hi + EPS) {
        const w = q.x - p.x;
        return Math.abs(w) <= EPS ? Math.max(p.mm, q.mm) : p.mm + ((x - p.x) / w) * (q.mm - p.mm);
      }
    }
    return x <= pts[0].x ? pts[0].mm : pts[pts.length - 1].mm;
  };
  const out: { x: number; mm: number }[] = [{ x: a, mm: at(a) }];
  for (const p of pts) {
    if (p.x > a + EPS && p.x < b - EPS) out.push({ x: p.x, mm: p.mm });
  }
  out.push({ x: b, mm: at(b) });
  return out;
}

/**
 * 屋根バンドを手前プロファイルで切る (= E-9b)。塗り方の 3 形態それぞれで扱いが違う。
 *   ・軒→棟の台形(filledToRidge && baseMm==null): 面は「プロファイル〜棟」。手前の上端まで
 *     プロファイルを持ち上げる（下から隠れる）。棟まで隠れたらそのバンドは消える。
 *   ・包絡線＋軒基準(baseMm あり): 面は「baseMm 〜 プロファイル」。baseMm を持ち上げる。
 *   ・線のみ(けらば・フラット軒): 折れ線を交点で割り、上に出た部分だけ残す。
 * 手前が無ければそのまま 1 本返す（単棟は不変）。
 */
export function clipRoofBand(
  band: RoofBand, steps: StepSpan[], wallRanges?: [number, number][],
): RoofBand[] {
  // 手前に何も無ければ従来どおり素通し（単棟・R-1f の見え方は一切変えない）。
  if (steps.length === 0 || band.profile.length < 2) return [band];
  const xLo = Math.min(band.xStart, band.xEnd);
  const xHi = Math.max(band.xStart, band.xEnd);
  if (xHi - xLo <= EPS) return [band];

  // 線のみ: 折れ線の各区間を clipSpanByProfile に通し、残った部分をバンドとして出し直す。
  if (!band.filledToRidge) {
    const out: RoofBand[] = [];
    for (let i = 0; i < band.profile.length - 1; i++) {
      const p = band.profile[i], q = band.profile[i + 1];
      if (Math.abs(q.x - p.x) <= EPS) continue;
      const span: ProfileSpan = {
        x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x),
        mm0: p.x <= q.x ? p.mm : q.mm, mm1: p.x <= q.x ? q.mm : p.mm,
      };
      for (const c of clipSpanByProfile(span, steps)) {
        out.push({
          ...band,
          xStart: c.x0, xEnd: c.x1,
          ridgeMm: Math.max(c.topStartMm, c.topEndMm),
          profile: [{ x: c.x0, mm: c.topStartMm }, { x: c.x1, mm: c.topEndMm }],
        });
      }
    }
    return out;
  }

  // 塗るバンド: 手前の区間境界で割り、区間ごとに 1 つのしきい値で判定する。
  const bounds = new Set<number>([xLo, xHi]);
  for (const s of steps) {
    if (s.x0 > xLo + EPS && s.x0 < xHi - EPS) bounds.add(s.x0);
    if (s.x1 > xLo + EPS && s.x1 < xHi - EPS) bounds.add(s.x1);
  }
  // E-9-fix4: 壁の端でも割る。壁の外（＝軒の出）は屋根面ではなく板の小口なので、
  //   棟まで塗ってはいけない（実機: 2F の脇に 1F の壁のような矩形が出る症状）。
  for (const [wa, wb] of wallRanges ?? []) {
    if (wa > xLo + EPS && wa < xHi - EPS) bounds.add(wa);
    if (wb > xLo + EPS && wb < xHi - EPS) bounds.add(wb);
  }
  /** その区間が「その建物の壁の上」か。壁範囲が未指定なら常に true（従来どおり）。 */
  //   その面に壁を持たない屋根（例: 東壁だけの下屋を北から見る）は判定材料が無いので従来どおり。
  const onWall = (a2: number, b2: number) => !wallRanges || wallRanges.length === 0
    || wallRanges.some(([wa, wb]) => a2 >= wa - EPS && b2 <= wb + EPS);
  const xs = Array.from(bounds).sort((a, b) => a - b);
  const out: RoofBand[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a <= EPS) continue;
    const h = stepTopAt(steps, (a + b) / 2);
    const prof = profileBetween(band.profile, a, b);
    if (!onWall(a, b)) {
      // 壁の外＝軒の出。屋根の面ではなく「けらば/軒の線」だけを描く（塗り・棟線・棟ラベル無し）。
      const top = Math.max(...prof.map((p) => p.mm));
      if (h >= top - EPS) continue;
      out.push({ ...band, xStart: a, xEnd: b, profile: prof, ridgeMm: top,
        filledToRidge: false, baseMm: undefined });
      continue;
    }
    if (band.baseMm != null) {
      // 面は baseMm 〜 プロファイル。プロファイルまで隠れたら消える。
      const top = Math.max(...prof.map((p) => p.mm));
      if (h >= top - EPS) continue;
      out.push({ ...band, xStart: a, xEnd: b, profile: prof, baseMm: Math.max(band.baseMm, h) });
    } else {
      // 面はプロファイル 〜 棟。棟まで隠れたら消える。
      if (h >= band.ridgeMm - EPS) continue;
      out.push({
        ...band, xStart: a, xEnd: b,
        profile: prof.map((p) => ({ x: p.x, mm: Math.min(Math.max(p.mm, h), band.ridgeMm) })),
      });
    }
  }
  return out;
}

/**
 * 遮蔽する側（建物 1 棟）(= E-9c)。足場の切断は建物 id を知らなくてよく、
 * 「自分より手前か」だけで決まるので frontness と上端素材だけを渡す。
 */
export type Occluder = { frontness: number; spans: ProfileSpan[]; buildingId?: string };

/** 建物ごとの遮蔽素材[]（足場の遮蔽に渡す）。 */
export function buildingOccluders(
  outlines: BuildingOutline[], bands: RoofBand[], buildings: BuildingShape[], face: Face,
): Occluder[] {
  return occludersOf(outlines, bands, buildings, face);
}

/** その手前度より手前にある遮蔽物をまとめた階段プロファイル。 */
export function frontStepsForFrontness(
  occluders: Occluder[] | undefined, myFrontness: number, exceptBuildingId?: string,
): StepSpan[] {
  if (!occluders || occluders.length === 0) return [];
  const spans: ProfileSpan[] = [];
  for (const o of occluders) {
    // E-9: 同じ建物どうしは遮蔽しない（大屋根と下屋の重ね順は R-1f の描画順が担当）。
    if (exceptBuildingId != null && o.buildingId === exceptBuildingId) continue;
    if (o.frontness > myFrontness + SAME_DEPTH_EPS) spans.push(...o.spans);
  }
  return spans.length > 0 ? toStepProfile(spans) : [];
}

/**
 * 遮蔽の素材を「要素ごとの手前度つき」で集める (= E-9b)。
 *
 * 手前度は**壁 1 枚・屋根 1 枚ごと**に持つ（建物単位ではない）。L 字の建物では手前の翼と
 * 奥の翼で深さが違い、建物単位で代表させると「奥の翼が自分の前にある」と誤判定するため。
 * 壁は BuildingOutlineSegment.depthCoord、屋根は RoofBand.frontness を使い、
 * どちらも無い古い呼び出しでは建物の代表値へフォールバックする。
 */
/** span[] を許可 x 区間[]の中だけに切り出す。 */
function clipSpansToRanges(spans: ProfileSpan[], ranges: [number, number][]): ProfileSpan[] {
  if (ranges.length === 0) return [];
  const out: ProfileSpan[] = [];
  for (const s of spans) {
    for (const [a, b] of ranges) {
      const x0 = Math.max(s.x0, a), x1 = Math.min(s.x1, b);
      if (x1 - x0 <= EPS) continue;
      out.push({ x0, x1, mm0: spanAt(s, x0), mm1: spanAt(s, x1) });
    }
  }
  return out;
}

/** その建物がこの面に持つ壁の x 区間[]（マージ済み）。 */
function wallRangesOf(outlines: BuildingOutline[], buildingId: string): [number, number][] {
  return mergeIntervals(
    outlines
      .filter((o) => o.buildingId === buildingId)
      .flatMap((o) => o.segments.map((s) =>
        [Math.min(s.xStart, s.xEnd), Math.max(s.xStart, s.xEnd)] as [number, number])),
  );
}

function occludersOf(
  outlines: BuildingOutline[], bands: RoofBand[], buildings: BuildingShape[], face: Face,
): Occluder[] {
  const byId = new Map(buildings.map((b) => [b.id, buildingFrontness(b, face)]));
  const out: Occluder[] = [];
  for (const o of outlines) {
    for (const s of o.segments) {
      if (Math.abs(s.xEnd - s.xStart) <= EPS) continue;
      const f = s.depthCoord != null ? depthFrontness(s.depthCoord, face) : byId.get(o.buildingId);
      if (f == null) continue;
      out.push({ frontness: f, spans: outlineSpans({ ...o, segments: [s] }), buildingId: o.buildingId });
    }
  }
  for (const b of bands) {
    const f = b.frontness ?? byId.get(b.buildingId);
    if (f == null) continue;
    // E-9-fix2: 屋根バンドが遮るのは「その建物が実際に建っている x 範囲」だけ。
    //   バンドの x 範囲は軒の出(出幅)ぶん壁より外へ広がっており、そこを壁と同じ
    //   「GL から立つ塊」として扱うと、隣に接している建物の壁が軒の出ぶん消えて
    //   立面に隙間が空く（実機症状: 北面で接しているはずの 2 棟の間に 500mm の隙間）。
    //   軒の下は透けて見えるのが正しい。壁の範囲内では壁自身が GL から遮るので、
    //   バンドはその上に足りない分（屋根の三角）を足すだけでよい。
    const spans = clipSpansToRanges(roofBandSpans(b), wallRangesOf(outlines, b.buildingId));
    if (spans.length > 0) out.push({ frontness: f, spans, buildingId: b.buildingId });
  }
  return out;
}

/**
 * 建物同士の遮蔽を適用する (= E-9b)。
 *
 * 面ごとに、各建物より**手前**にある建物のシルエット（壁＋屋根）を上端プロファイルにまとめ、
 * その建物の外形セグメントと屋根バンドを切る。完全に隠れる部分は描かず、部分的に隠れる
 * ところは「はみ出した部分だけ」を描く（下端を手前の上端まで持ち上げる）。
 *
 * 深度が同じ建物どうし（総二階の 1F/2F など壁面が揃うもの）は前後を作らない＝従来どおり。
 * 単棟では手前が存在しないので結果は完全に不変。
 */
export function applyBuildingOcclusion(
  outlines: BuildingOutline[], bands: RoofBand[], buildings: BuildingShape[], face: Face,
): { buildingOutlines: BuildingOutline[]; roofBands: RoofBand[] } {
  const occ = occludersOf(outlines, bands, buildings, face);
  if (occ.length < 2) return { buildingOutlines: outlines, roofBands: bands };
  const byId = new Map(buildings.map((b) => [b.id, buildingFrontness(b, face)]));
  const cache = new Map<string, StepSpan[]>();
  const exactCache = new Map<string, ProfileSpan[]>();
  /** 手前の実輪郭（階段化していない素材）。下端の線を勾配なりに引くために使う。 */
  const exactFor = (myFront: number, buildingId: string): ProfileSpan[] => {
    const key = buildingId + '@' + myFront;
    const hit = exactCache.get(key);
    if (hit) return hit;
    const spans: ProfileSpan[] = [];
    for (const oc of occ) {
      if (oc.buildingId === buildingId) continue;
      if (oc.frontness > myFront + SAME_DEPTH_EPS) spans.push(...oc.spans);
    }
    exactCache.set(key, spans);
    return spans;
  };
  /** その手前度より手前にある「他の建物」の要素をまとめた階段プロファイル。 */
  const stepsFor = (myFront: number, buildingId: string): StepSpan[] => {
    const key = buildingId + '@' + myFront;
    const hit = cache.get(key);
    if (hit) return hit;
    const steps = frontStepsForFrontness(occ, myFront, buildingId);
    cache.set(key, steps);
    return steps;
  };

  const buildingOutlines = outlines.map((o) => {
    const fallback = byId.get(o.buildingId);
    let changed = false;
    const segments = o.segments.flatMap((s) => {
      const f = s.depthCoord != null ? depthFrontness(s.depthCoord, face) : fallback;
      const steps = f == null ? [] : stepsFor(f, o.buildingId);
      if (steps.length === 0) return [s];
      const exact = exactFor(f!, o.buildingId);
      const clipped = outlineSpans({ ...o, segments: [s] }).flatMap((sp) =>
        // E-9-fix: 連続して見える範囲は 1 枚にまとめる（短冊に割ると縦線が並ぶ）。
        mergeClipped(clipSpanByProfile(sp, steps, exact)).map((c) => ({
          xStart: c.x0, xEnd: c.x1,
          heightStartMm: c.topStartMm, heightEndMm: c.topEndMm,
          ...(c.baseStartMm > EPS || c.baseEndMm > EPS
            ? { baseStartMm: c.baseStartMm, baseEndMm: c.baseEndMm } : {}),
          ...(c.basePath && c.basePath.length > 2 ? { basePath: c.basePath } : {}),
          // E-9-fix4: 元の壁の端でない側＝遮蔽で切れた境目。縦の輪郭線を描かせない。
          ...(c.x0 > sp.x0 + EPS ? { clippedStart: true } : {}),
          ...(c.x1 < sp.x1 - EPS ? { clippedEnd: true } : {}),
          ...(s.depthCoord != null ? { depthCoord: s.depthCoord } : {}),
        })));
      changed = true;
      return clipped;
    });
    return changed ? { ...o, segments: segments.sort((a, b) => a.xStart - b.xStart) } : o;
  });

  const roofBands = bands.flatMap((b) => {
    const f = b.frontness ?? byId.get(b.buildingId);
    const steps = f == null ? [] : stepsFor(f, b.buildingId);
    return clipRoofBand(b, steps, wallRangesOf(outlines, b.buildingId));
  });

  return { buildingOutlines, roofBands };
}
