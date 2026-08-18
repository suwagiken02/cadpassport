// ============================================================
// 建物と敷地のすき間の距離表示 (= S-6)・pure
//
// S-5 は「いま引っ張っている頂点」1 点だけの案内だった。調整中に本当に見たいのは
// 建物と敷地のすき間**全体**なので、敷地を選んでいる間はずっと次を出す:
//
//   1. 建物の各**出隅**（外に凸の角）から、外向きに水平・垂直へ伸ばして
//      最初にぶつかる敷地の辺までの距離
//   2. 敷地の**入隅**（凹んだ頂点）から、水平に伸ばして最初にぶつかる
//      建物の壁までの距離
//
// ぶつからない方向は出さない（敷地の外へ出てしまう向きなど）。
//
// ■ 「外向き」の決め方
// 角に接する 2 辺のうち、水平な辺の**反対側**が外向きの水平、垂直な辺の
// 反対側が外向きの垂直。建物は原則 軸に平行なのでこれで決まる。
// 斜めの辺しか持たない角（交点タップで作れてしまう形）はその向きを出さない
// ＝表示が減るだけで、嘘の向きは出さない。
//
// ■ 重さ
// ここは「形が変わったときだけ」呼ぶ想定（呼び出し側が useMemo で止める）。
// 角の数 × 辺の数の総当たりだが、現場の図面ではどちらも数十なので軽い。
// ============================================================
import { GRID_UNIT_MM } from './gridUtils';
import type { Point } from '@/types';

export type GapGuide = {
  /** 'building' = 建物の出隅から敷地へ / 'site' = 敷地の入隅から建物へ。 */
  kind: 'building' | 'site';
  /** 'x' = 水平に伸ばした / 'y' = 垂直に伸ばした。 */
  axis: 'x' | 'y';
  /** 伸ばし始めた角（グリッド）。 */
  from: Point;
  /** ぶつかった点（グリッド）。 */
  to: Point;
  /** 距離(mm・整数)。 */
  mm: number;
};

export type Segment = [Point, Point];

const EPS = 1e-9;

/** 符号つき面積（y は下向き）。向きの判定に使う。 */
export function polygonSignedArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 閉じた外形の辺。 */
export function polygonSegments(poly: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
  return out;
}

/**
 * 各頂点が出隅（外に凸）かどうか。多角形の向き（時計回り／反時計回り）に依らない。
 * 一直線に並んだ点（角ではない）は false。
 */
export function convexFlags(poly: Point[]): boolean[] {
  const n = poly.length;
  if (n < 3) return poly.map(() => false);
  const orient = Math.sign(polygonSignedArea(poly));
  if (orient === 0) return poly.map(() => false);
  return poly.map((v, i) => {
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];
    const cross = (v.x - prev.x) * (next.y - v.y) - (v.y - prev.y) * (next.x - v.x);
    if (Math.abs(cross) <= EPS) return false;
    return Math.sign(cross) === orient;
  });
}

/**
 * 水平（axis='x'）または垂直（axis='y'）に伸ばしたレイが、最初にぶつかる点。
 * sign は伸ばす向き（+1 / -1）。ぶつからなければ null。
 * レイと平行な辺（重なっている辺）は「ぶつかった」とみなさない。
 */
export function rayFirstHit(
  from: Point, axis: 'x' | 'y', sign: 1 | -1, segments: Segment[],
): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const [a, b] of segments) {
    // 横に伸ばすなら y の線をまたぐ辺、縦なら x の線をまたぐ辺を見る
    const a0 = axis === 'x' ? a.y : a.x;
    const b0 = axis === 'x' ? b.y : b.x;
    const line = axis === 'x' ? from.y : from.x;
    if (Math.abs(b0 - a0) <= EPS) continue;                 // 平行な辺
    const t = (line - a0) / (b0 - a0);
    if (t < -EPS || t > 1 + EPS) continue;                  // 辺の外
    const a1 = axis === 'x' ? a.x : a.y;
    const b1 = axis === 'x' ? b.x : b.y;
    const hit = a1 + t * (b1 - a1);
    const d = (hit - (axis === 'x' ? from.x : from.y)) * sign;
    if (d <= EPS || d >= bestD) continue;
    bestD = d;
    best = axis === 'x' ? { x: hit, y: from.y } : { x: from.x, y: hit };
  }
  return best;
}

/**
 * その角の「外向き」の水平・垂直（軸に平行な辺を持つ角だけ決まる）。
 * 水平な辺の反対側が外向きの水平、垂直な辺の反対側が外向きの垂直。
 */
export function outwardDirs(poly: Point[], i: number): { x?: 1 | -1; y?: 1 | -1 } {
  const n = poly.length;
  const v = poly[i];
  const out: { x?: 1 | -1; y?: 1 | -1 } = {};
  for (const other of [poly[(i - 1 + n) % n], poly[(i + 1) % n]]) {
    if (Math.abs(other.y - v.y) <= EPS && Math.abs(other.x - v.x) > EPS) {
      out.x = v.x > other.x ? 1 : -1;      // 水平な辺 → その反対側が外
    } else if (Math.abs(other.x - v.x) <= EPS && Math.abs(other.y - v.y) > EPS) {
      out.y = v.y > other.y ? 1 : -1;      // 垂直な辺 → その反対側が外
    }
  }
  return out;
}

const mmOf = (from: Point, to: Point): number =>
  Math.round(Math.hypot(to.x - from.x, to.y - from.y) * GRID_UNIT_MM);

/** 建物の出隅 → 敷地の辺（外向きの水平・垂直）。 */
export function buildingCornerGuides(
  buildings: { points: Point[] }[], siteSegments: Segment[],
): GapGuide[] {
  if (siteSegments.length === 0) return [];
  const out: GapGuide[] = [];
  for (const b of buildings) {
    if (b.points.length < 3) continue;
    const convex = convexFlags(b.points);
    b.points.forEach((v, i) => {
      if (!convex[i]) return;                      // 出隅だけ
      const dirs = outwardDirs(b.points, i);
      if (dirs.x) {
        const hit = rayFirstHit(v, 'x', dirs.x, siteSegments);
        if (hit) out.push({ kind: 'building', axis: 'x', from: v, to: hit, mm: mmOf(v, hit) });
      }
      if (dirs.y) {
        const hit = rayFirstHit(v, 'y', dirs.y, siteSegments);
        if (hit) out.push({ kind: 'building', axis: 'y', from: v, to: hit, mm: mmOf(v, hit) });
      }
    });
  }
  return out;
}

/**
 * 敷地の入隅 → 建物の壁（水平）。
 * どちら向きに伸ばすかは決め打ちにせず、左右どちらも見て**近い方**を採る
 * （建物が右にある入隅も左にある入隅もあるため。無い側は当たらないので出ない）。
 */
export function siteConcaveGuides(
  sites: { points: Point[] }[], buildingSegments: Segment[],
): GapGuide[] {
  if (buildingSegments.length === 0) return [];
  const out: GapGuide[] = [];
  for (const s of sites) {
    if (s.points.length < 3) continue;
    const convex = convexFlags(s.points);
    s.points.forEach((v, i) => {
      if (convex[i]) return;                       // 入隅（凹）だけ
      let best: Point | null = null;
      for (const sign of [1, -1] as const) {
        const hit = rayFirstHit(v, 'x', sign, buildingSegments);
        if (!hit) continue;
        if (!best || Math.abs(hit.x - v.x) < Math.abs(best.x - v.x)) best = hit;
      }
      if (best) out.push({ kind: 'site', axis: 'x', from: v, to: best, mm: mmOf(v, best) });
    });
  }
  return out;
}

/** 表示する距離ぜんぶ。建物か敷地が無ければ空（何も出さない）。 */
export function gapGuides(
  buildings: { points: Point[] }[], sites: { points: Point[] }[],
): GapGuide[] {
  const siteSegments = sites.flatMap((s) => (s.points.length >= 3 ? polygonSegments(s.points) : []));
  const buildingSegments = buildings.flatMap((b) => (b.points.length >= 3 ? polygonSegments(b.points) : []));
  return [
    ...buildingCornerGuides(buildings, siteSegments),
    ...siteConcaveGuides(sites, buildingSegments),
  ];
}
