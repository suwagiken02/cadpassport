// ============================================================
// 敷地境界線の自動生成 (= S-3)・pure
//
// 建物の外周を指定距離だけ外側へ広げた多角形を作る。「外壁から 1m」が代表的な使い方。
//
// ■ 何を作るか
// 求めるのは「建物の集合を距離 d だけ太らせた領域の外周」。角は丸めず直角のままなので、
// これは**正方形（一辺 2d）でのミンコフスキー和**にあたる。丸い形で太らせると角が
// 丸くなるが、正方形なら角が直角のまま外へ出る。
//
// ■ どう作るか（自己交差を「起こさない」作り）
// 多角形を直接オフセットすると、L 字の凹角で辺どうしが行き過ぎて自己交差する。
// 交差した部分を後から取り除く処理は、実装も検証も難しい。
// そこで**そもそも交差が生まれない道順**を通す:
//   1. 各建物を軸に平行な矩形の集まりに分解する（座標圧縮 + 内外判定）
//   2. 矩形をそれぞれ d だけ外へ広げる（矩形は広げても矩形）
//   3. 広げた矩形群の**和集合の輪郭**をたどる
// 和集合の輪郭は定義上つねに単純な閉曲線なので、凹角でも交差しようがない。
// 太らせる操作は和で分配できる（(A∪B)⊕S = (A⊕S)∪(B⊕S)）ので、結果は正しい。
//
// ■ 複数棟
// 2 で全棟の矩形をひとつの集合にしてから 3 を行うので、重なる棟・接する棟は
// 自動的にひとつの外形にまとまる（棟ごとに別々の敷地は作らない）。
// 離れていて広げても繋がらない棟は、繋がらないまま別の輪郭として返す
// （飛び地。無いものを繋いで嘘の外形を作らない）。
//
// ■ 斜めの辺を持つ建物
// 建物は原則として軸に平行だが、方向入力の「交点タップ」で斜めの辺を作れてしまう。
// 1 の分解では、斜めの辺が横切るマスも**内側として取り込む**（安全側）。
// 軸に平行な建物では取り込みが起きず、結果は厳密に一致する。斜め辺のまわりだけ
// 階段状になるが、敷地が建物へ近づきすぎることはない。
// ============================================================
import { isPointInPolygon } from './autoLayoutUtils';
import { GRID_UNIT_MM } from './gridUtils';
import type { Point } from '@/types';

/** 既定の離れ（外壁から 1m）。 */
export const SITE_AUTO_DEFAULT_MM = 1000;
/** よく使う離れ。 */
export const SITE_AUTO_PRESET_MM: readonly number[] = [500, 1000, 1500, 2000];
export const SITE_AUTO_MIN_MM = 1;
export const SITE_AUTO_MAX_MM = 100000;

export const clampSiteAutoMm = (mm: number): number => {
  if (!Number.isFinite(mm)) return SITE_AUTO_DEFAULT_MM;
  return Math.min(SITE_AUTO_MAX_MM, Math.max(SITE_AUTO_MIN_MM, mm));
};

type Rect = { x0: number; y0: number; x1: number; y1: number };

const EPS = 1e-9;
const uniqSorted = (vs: number[]): number[] =>
  Array.from(new Set(vs.map((v) => Math.round(v * 1e6) / 1e6))).sort((a, b) => a - b);

/**
 * 線分が矩形の**内部**を横切るか（境界に重なるだけは含まない）。
 * 軸に平行な辺はマスの境界に乗るので false になり、余計な取り込みが起きない。
 */
function segmentCrossesRectInterior(a: Point, b: Point, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  if (t1 - t0 <= EPS) return false;
  const tm = (t0 + t1) / 2;
  const mx = a.x + tm * dx;
  const my = a.y + tm * dy;
  return mx > r.x0 + EPS && mx < r.x1 - EPS && my > r.y0 + EPS && my < r.y1 - EPS;
}

/**
 * 多角形を軸に平行な矩形の集まりへ分解する。
 * 頂点の x / y で切ったマスのうち、中心が内側にあるもの（＝軸に平行な建物では厳密）と、
 * 斜めの辺が内部を横切るもの（＝安全側の取り込み）を採る。
 */
export function decomposeToRects(poly: Point[]): Rect[] {
  if (poly.length < 3) return [];
  const xs = uniqSorted(poly.map((p) => p.x));
  const ys = uniqSorted(poly.map((p) => p.y));
  if (xs.length < 2 || ys.length < 2) return [];

  const out: Rect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cell: Rect = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1] };
      const cx = (cell.x0 + cell.x1) / 2;
      const cy = (cell.y0 + cell.y1) / 2;
      let inside = isPointInPolygon(cx, cy, poly);
      if (!inside) {
        for (let k = 0; k < poly.length && !inside; k++) {
          if (segmentCrossesRectInterior(poly[k], poly[(k + 1) % poly.length], cell)) inside = true;
        }
      }
      if (inside) out.push(cell);
    }
  }
  return out;
}

/** 矩形を四方へ d だけ広げる。 */
const growRect = (r: Rect, d: number): Rect => ({
  x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d,
});

/** 面積（符号つき・y は下向き）。この向きの取り決めでは外周が正、穴が負になる。 */
export function signedArea(ring: Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 一直線に並ぶ点を間引く（角だけ残す）。 */
function dropCollinear(ring: Point[]): Point[] {
  const out: Point[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (Math.abs(cross) > EPS) out.push(cur);
  }
  return out.length >= 3 ? out : ring;
}

/** いつも同じ頂点から始める（出力を一意にする）。 */
function rotateToCanonicalStart(ring: Point[]): Point[] {
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[best];
    if (a.y < b.y || (a.y === b.y && a.x < b.x)) best = i;
  }
  return [...ring.slice(best), ...ring.slice(0, best)];
}

type DirIdx = { dx: number; dy: number };
const dirOf = (from: [number, number], to: [number, number]): DirIdx =>
  ({ dx: Math.sign(to[0] - from[0]), dy: Math.sign(to[1] - from[1]) });

/**
 * 進行方向に対する曲がり方の優先順。
 * 角どうしが 1 点で触れているとき、右へ曲がる方を選ぶと 2 つの領域が
 * 別々の輪郭に分かれる（1 本に繋いでしまうと 8 の字になる）。
 * 画面座標（y が下向き）なので、右折は (dx,dy) → (-dy, dx)。
 */
function turnRank(inDir: DirIdx, outDir: DirIdx): number {
  const right = { dx: -inDir.dy, dy: inDir.dx };
  const left = { dx: inDir.dy, dy: -inDir.dx };
  if (outDir.dx === right.dx && outDir.dy === right.dy) return 0;
  if (outDir.dx === inDir.dx && outDir.dy === inDir.dy) return 1;
  if (outDir.dx === left.dx && outDir.dy === left.dy) return 2;
  return 3;   // U ターン
}

/**
 * 軸に平行な矩形の和集合の**外周**をたどる。穴（内側の輪）は返さない。
 * 座標を圧縮した格子の上で「覆われているマス／いないマス」の境目を辿るので、
 * 自己交差した図形が生まれる余地がない。
 */
export function rectUnionOuterRings(rects: Rect[]): Point[][] {
  if (rects.length === 0) return [];
  const xs = uniqSorted(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = uniqSorted(rects.flatMap((r) => [r.y0, r.y1]));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];

  // マスが覆われているか（中心が矩形のどれかに入っているか）
  const covered: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    covered[i] = [];
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ny; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      covered[i][j] = rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1);
    }
  }
  const isCovered = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && covered[i][j];

  // 覆われたマスを右手に見る向きで、境目の辺を集める（格子の添字のまま扱う）
  type Edge = { from: [number, number]; to: [number, number] };
  const edges: Edge[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!covered[i][j]) continue;
      if (!isCovered(i - 1, j)) edges.push({ from: [i, j + 1], to: [i, j] });         // 左辺・上へ
      if (!isCovered(i + 1, j)) edges.push({ from: [i + 1, j], to: [i + 1, j + 1] }); // 右辺・下へ
      if (!isCovered(i, j - 1)) edges.push({ from: [i, j], to: [i + 1, j] });         // 上辺・右へ
      if (!isCovered(i, j + 1)) edges.push({ from: [i + 1, j + 1], to: [i, j + 1] }); // 下辺・左へ
    }
  }
  if (edges.length === 0) return [];

  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const outgoing = new Map<string, number[]>();
  edges.forEach((e, idx) => {
    const k = key(e.from);
    const list = outgoing.get(k);
    if (list) list.push(idx);
    else outgoing.set(k, [idx]);
  });

  const used = new Array(edges.length).fill(false);
  const rings: Point[][] = [];

  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    const loop: [number, number][] = [];
    let cur = start;
    let guard = edges.length + 1;
    while (!used[cur] && guard-- > 0) {
      used[cur] = true;
      loop.push(edges[cur].from);
      const inDir = dirOf(edges[cur].from, edges[cur].to);
      const cands = (outgoing.get(key(edges[cur].to)) ?? []).filter((k) => !used[k]);
      if (cands.length === 0) break;
      let next = cands[0];
      let bestRank = 9;
      for (const c of cands) {
        const rank = turnRank(inDir, dirOf(edges[c].from, edges[c].to));
        if (rank < bestRank) { bestRank = rank; next = c; }
      }
      cur = next;
    }
    if (loop.length < 4) continue;
    const ring = loop.map(([ix, iy]) => ({ x: xs[ix], y: ys[iy] }));
    // 外周だけを採る（穴は逆向きになるので符号で分かれる）
    if (signedArea(ring) > 0) rings.push(rotateToCanonicalStart(dropCollinear(ring)));
  }

  // 大きい外形から順に（1 棟だけのときの見た目の安定用）
  return rings.sort((a, b) => signedArea(b) - signedArea(a));
}

/**
 * 建物の外周を distanceMm だけ外へ広げた敷地境界線（グリッド座標）。
 * 建物が無い／距離が 0 以下なら空配列。
 */
export function buildingsSitePolygons(
  buildings: { points: Point[] }[],
  distanceMm: number,
): Point[][] {
  const d = clampSiteAutoMm(distanceMm) / GRID_UNIT_MM;
  const rects: Rect[] = [];
  for (const b of buildings) {
    for (const r of decomposeToRects(b.points)) rects.push(growRect(r, d));
  }
  return rectUnionOuterRings(rects);
}
