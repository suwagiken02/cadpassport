// ============================================================
// 壁外周区間（WallSpan）の pure 幾何 (R-1e-fix)。
//  「キャラが壁の上を歩く」屋根入力の結果を、辺の途中も表せる周方向の連続区間として扱う。
//  ・arc-length パラメータ化（周方向 forward = 辺 index 増加）。
//  ・span → 辺別の被覆区間 [t0,t1]（辺の途中で切れる）。
//  ・span → 壁上の折れ線点列 / 出幅ぶん外へオフセットした軒の折れ線（平面の点線用）。
//  立面は辺単位（被覆辺→出幅）の近似で resolveBuildingOverhangsGrid が読む。
// ============================================================
import type { BuildingShape, Point, Roof, WallSpan } from '@/types';
import { mmToGrid } from './gridUtils';

const EPS = 1e-6;

/** ポリゴンの巻き方向（roofUtils.isClockwise と同一規約・画面座標 Y 下向き）。 */
function isClockwise(pts: Point[]): boolean {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum > 0;
}

/** 辺 i の外向き単位法線（getEdgeOverhangs と同一規約）。 */
function outwardNormal(pts: Point[], i: number, cw: boolean): { nx: number; ny: number } {
  const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  return cw ? { nx: dy / len, ny: -dx / len } : { nx: -dy / len, ny: dx / len };
}

/** 各辺長（グリッド）。 */
export function edgeLengthsGrid(building: BuildingShape): number[] {
  const p = building.points, n = p.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.hypot(p[(i + 1) % n].x - p[i].x, p[(i + 1) % n].y - p[i].y));
  return out;
}

/** 全周長（グリッド）。 */
export function perimeterGrid(building: BuildingShape): number {
  return edgeLengthsGrid(building).reduce((a, b) => a + b, 0);
}

/** 各辺の開始 arc（累積長）と全周長。 */
function arcTable(building: BuildingShape): { cum: number[]; perim: number } {
  const len = edgeLengthsGrid(building);
  const cum: number[] = [];
  let s = 0;
  for (let i = 0; i < len.length; i++) { cum.push(s); s += len[i]; }
  return { cum, perim: s };
}

const mod = (a: number, m: number) => ((a % m) + m) % m;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** 辺位置(edge,t) → arc-length。 */
export function posToArc(building: BuildingShape, edge: number, t: number): number {
  const { cum } = arcTable(building);
  const len = edgeLengthsGrid(building);
  return cum[edge] + t * len[edge];
}

/** arc-length → 辺位置(edge,t)。境界は次辺 t=0 に寄せる。 */
export function arcToPos(building: BuildingShape, arc: number): { edge: number; t: number } {
  const { cum, perim } = arcTable(building);
  const len = edgeLengthsGrid(building);
  const a = mod(arc, perim);
  for (let i = 0; i < len.length; i++) {
    if (a >= cum[i] - EPS && a < cum[i] + len[i] - EPS) return { edge: i, t: len[i] ? (a - cum[i]) / len[i] : 0 };
  }
  return { edge: len.length - 1, t: 1 };
}

export type Compass = 'up' | 'down' | 'left' | 'right';

/** 画面座標（y 下向き）のベクトル → 上下左右。 */
function toCompass(vx: number, vy: number): Compass {
  return Math.abs(vx) >= Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up');
}

/** arc-length 位置の壁上の点。 */
export function pointAtArc(building: BuildingShape, arc: number): Point {
  const { edge, t } = arcToPos(building, arc);
  const n = building.points.length;
  return lerp(building.points[edge], building.points[(edge + 1) % n], t);
}

/** 現在位置から dir 方向（+1=周方向 forward / -1=backward）の、次の頂点までの距離（グリッド）。 */
export function stepToVertex(building: BuildingShape, arc: number, dir: 1 | -1): number {
  const len = edgeLengthsGrid(building);
  const n = len.length;
  const { edge, t } = arcToPos(building, arc);
  if (dir > 0) return t < 1 - EPS ? len[edge] * (1 - t) : len[(edge + 1) % n];
  return t > EPS ? len[edge] * t : len[(edge - 1 + n) % n];
}

/**
 * 現在位置(arc)から壁沿いに進める2方向を上下左右へ写像（R-1e-fix2）。
 * forward(周方向 arc 増加, arcDir=+1) と backward(arcDir=-1)。角では2辺の向き＝別方向に曲がる。
 * 外周ループなので行き止まりは無く常に2方向。
 */
export function walkDirectionsAt(building: BuildingShape, arc: number): { compass: Compass; arcDir: 1 | -1 }[] {
  const p = building.points, n = p.length;
  const { edge, t } = arcToPos(building, arc);
  const edgeDir = (e: number) => {
    const a = p[e], b = p[(e + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  };
  const fwd = edgeDir(edge);
  // 辺の途中は逆向き＝-fwd、頂点(t~0)は前の辺に沿って戻る。
  const back = t > EPS ? { x: -fwd.x, y: -fwd.y } : (() => { const d = edgeDir((edge - 1 + n) % n); return { x: -d.x, y: -d.y }; })();
  return [
    { compass: toCompass(fwd.x, fwd.y), arcDir: 1 },
    { compass: toCompass(back.x, back.y), arcDir: -1 },
  ];
}

/** 全周 span。 */
export function fullSpan(): WallSpan {
  return { startEdge: 0, startT: 0, endEdge: 0, endT: 0, full: true };
}

/** 辺 index 列（旧 edgeRange）→ span。全辺=full、連続部分=その区間、非連続は最小-最大で近似。 */
export function edgeRangeToSpan(building: BuildingShape, edgeRange: number[]): WallSpan {
  const n = building.points.length;
  if (edgeRange.length === 0) return { startEdge: 0, startT: 0, endEdge: 0, endT: 0 };
  if (edgeRange.length >= n) return fullSpan();
  const sorted = [...edgeRange].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  // 連続（lo..hi が隙間なし）ならその区間、そうでなければ lo..hi で近似。
  return { startEdge: lo, startT: 0, endEdge: hi, endT: 1 };
}

/** Roof から WallSpan を解決（span 優先・無ければ edgeRange 変換・どちらも無ければ full）。 */
export function getRoofSpan(building: BuildingShape, roof: Roof): WallSpan {
  if (roof.span) return roof.span;
  if (roof.edgeRange) return edgeRangeToSpan(building, roof.edgeRange);
  return fullSpan();
}

/** span の arc 区間 { startArc, len }（len は [0, perim]）。 */
export function spanArcInterval(building: BuildingShape, span: WallSpan): { startArc: number; len: number } {
  const { perim } = arcTable(building);
  if (span.full) return { startArc: 0, len: perim };
  const startArc = posToArc(building, span.startEdge, span.startT);
  const endArc = posToArc(building, span.endEdge, span.endT);
  const len = mod(endArc - startArc, perim);
  return { startArc, len };
}

/** span を辺別の被覆区間へ分解（周方向 forward 順・{edge,t0,t1}）。 */
export function spanSegments(building: BuildingShape, span: WallSpan): { edge: number; t0: number; t1: number }[] {
  const { perim } = arcTable(building);
  const len = edgeLengthsGrid(building);
  const { cum } = arcTable(building);
  const { startArc, len: total } = spanArcInterval(building, span);
  const out: { edge: number; t0: number; t1: number }[] = [];
  if (total <= EPS) return out;
  let cur = startArc, remaining = total;
  const maxIter = building.points.length * 2 + 2;
  for (let iter = 0; iter < maxIter && remaining > EPS; iter++) {
    const { edge } = arcToPos(building, cur);
    const edgeEndArc = cum[edge] + len[edge];
    const distToEnd = mod(edgeEndArc - cur, perim) || len[edge]; // 端ちょうどは次辺頭に寄るので len[edge]
    const step = Math.min(remaining, distToEnd);
    const t0 = len[edge] ? mod(cur - cum[edge], perim) / len[edge] : 0;
    const t1 = t0 + (len[edge] ? step / len[edge] : 0);
    if (step > EPS) out.push({ edge, t0: Math.min(t0, 1), t1: Math.min(t1, 1) });
    cur = mod(cur + step, perim);
    remaining -= step;
  }
  return out;
}

/** span が被覆する辺 index の集合（辺の一部でも被覆していれば含む）。立面の辺単位近似用。 */
export function spanCoveredEdges(building: BuildingShape, span: WallSpan): number[] {
  return Array.from(new Set(spanSegments(building, span).map((s) => s.edge))).sort((a, b) => a - b);
}

/** span の壁上の折れ線点列（始点・途中の頂点・終点）。 */
export function spanPolylinePoints(building: BuildingShape, span: WallSpan): Point[] {
  const p = building.points, n = p.length;
  const segs = spanSegments(building, span);
  if (segs.length === 0) return [];
  const pts: Point[] = [lerp(p[segs[0].edge], p[(segs[0].edge + 1) % n], segs[0].t0)];
  for (const s of segs) pts.push(lerp(p[s.edge], p[(s.edge + 1) % n], s.t1));
  return pts;
}

/** 2 直線 (a+s·da) と (b+u·db) の交点。平行なら null。 */
function intersect(a: Point, da: Point, b: Point, db: Point): Point | null {
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-9) return null;
  const s = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den;
  return { x: a.x + s * da.x, y: a.y + s * da.y };
}

/**
 * span の軒（出幅ぶん外へオフセットした折れ線）。被覆辺ごとに外向き法線で出幅分オフセットし、
 * 途中の角は隣接オフセット辺の交点で継ぐ。端（辺の途中で切れる箇所）はオフセット端点で止める。
 * overhangGridByEdge = 辺別出幅(グリッド)。closed=true は全周（閉じたポリゴン）。
 */
export function offsetSpanPolyline(
  building: BuildingShape, span: WallSpan, overhangGridByEdge: number[],
): { points: Point[]; closed: boolean } {
  const p = building.points, n = p.length;
  const cw = isClockwise(p);
  const segs = spanSegments(building, span);
  if (segs.length === 0) return { points: [], closed: false };

  // 各セグメントのオフセット始点・終点・方向。
  const off = segs.map((s) => {
    const A = lerp(p[s.edge], p[(s.edge + 1) % n], s.t0);
    const B = lerp(p[s.edge], p[(s.edge + 1) % n], s.t1);
    const nrm = outwardNormal(p, s.edge, cw);
    const oh = overhangGridByEdge[s.edge] ?? 0;
    const dir = { x: B.x - A.x, y: B.y - A.y };
    return {
      A: { x: A.x + nrm.nx * oh, y: A.y + nrm.ny * oh },
      B: { x: B.x + nrm.nx * oh, y: B.y + nrm.ny * oh },
      dir,
    };
  });

  const closed = !!span.full;
  const points: Point[] = [];
  const m = off.length;

  if (!closed) points.push(off[0].A);
  for (let k = 0; k < m; k++) {
    const cur = off[k];
    const isLastJoint = k === m - 1;
    if (isLastJoint && !closed) { points.push(cur.B); break; }
    const nxt = off[(k + 1) % m];
    const j = intersect(cur.A, cur.dir, nxt.A, nxt.dir);
    points.push(j ?? cur.B); // 平行（一直線）なら継ぎ目不要でオフセット端点
  }
  return { points, closed };
}

/** 2 つの WallSpan が実質同じ被覆か（arc 区間で比較・full も対応）。 */
export function spanEquals(building: BuildingShape, a: WallSpan, b: WallSpan): boolean {
  if (a.full || b.full) return !!a.full && !!b.full;
  const ia = spanArcInterval(building, a), ib = spanArcInterval(building, b);
  return Math.abs(ia.startArc - ib.startArc) < 1e-3 && Math.abs(ia.len - ib.len) < 1e-3;
}

/** span の辺別出幅(グリッド)を Roof から作る（uniformMm / edgeOverhangsMm・被覆辺のみ）。 */
export function roofSpanEdgeOverhangsGrid(building: BuildingShape, roof: Roof): number[] {
  const n = building.points.length;
  const out = new Array(n).fill(0);
  const span = getRoofSpan(building, roof);
  for (const e of spanCoveredEdges(building, span)) {
    const mm = roof.edgeOverhangsMm?.[e] ?? roof.uniformMm;
    out[e] = mm > 0 ? mmToGrid(mm) : 0;
  }
  return out;
}
