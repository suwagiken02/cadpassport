// ============================================================
// 屋根＝閉じた領域（polygon）方式の pure 幾何 (R-1e-fix7)。
//  ・getRoofPolygon: Roof の領域（旧 span/edgeRange の互換は建物外周へ）。
//  ・edgeOnWall / roofEdgeToBuildingEdge: 屋根領域の辺が建物の壁と重なるか（＝出幅を出す辺）。
//  ・roofPolygonOffsetsGrid: 屋根 polygon の辺別出幅(グリッド)。壁重なり辺のみ uniformMm、内部辺は 0。
//    → computeOffsetPolygon(polygon, これ) で平面の出幅点線（軒）を描く。
//  ・buildingEdgeOverhangsFromRoofs: 建物の辺別出幅(グリッド)。立面・resolve 用。
// ============================================================
import type { BuildingShape, Point, Roof } from '@/types';
import { mmToGrid } from './gridUtils';

/** 壁重なり判定の許容差（グリッド）。1grid=10mm。スナップ揺れを見て 1.5grid。 */
const WALL_TOL = 1.5;

/** Roof の領域 polygon（互換: 未設定は建物外周）。 */
export function getRoofPolygon(building: BuildingShape, roof: Roof): Point[] {
  return roof.polygon && roof.polygon.length >= 3 ? roof.polygon : building.points;
}

/** 点 pt と線分 p→q の距離。 */
function distPointSeg(pt: Point, p: Point, q: Point): number {
  const dx = q.x - p.x, dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(pt.x - p.x, pt.y - p.y);
  let t = ((pt.x - p.x) * dx + (pt.y - p.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (p.x + t * dx), pt.y - (p.y + t * dy));
}

/** 屋根辺(a→b)が建物の辺 j に重なっていれば j、無ければ -1（両端＋中点が同一辺の近傍）。 */
export function roofEdgeToBuildingEdge(a: Point, b: Point, buildingPts: Point[], tol = WALL_TOL): number {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n = buildingPts.length;
  for (let j = 0; j < n; j++) {
    const p = buildingPts[j], q = buildingPts[(j + 1) % n];
    if (distPointSeg(a, p, q) <= tol && distPointSeg(b, p, q) <= tol && distPointSeg(mid, p, q) <= tol) {
      return j;
    }
  }
  return -1;
}

/** 屋根辺(a→b)が建物の壁上か。 */
export function edgeOnWall(a: Point, b: Point, buildingPts: Point[], tol = WALL_TOL): boolean {
  return roofEdgeToBuildingEdge(a, b, buildingPts, tol) >= 0;
}

/** 屋根 polygon の辺別出幅(グリッド)。壁重なり辺のみ uniformMm、内部辺は 0（computeOffsetPolygon 用）。 */
export function roofPolygonOffsetsGrid(building: BuildingShape, roof: Roof): number[] {
  const poly = getRoofPolygon(building, roof);
  const n = poly.length;
  const ohGrid = roof.uniformMm > 0 ? mmToGrid(roof.uniformMm) : 0;
  return poly.map((_, i) => (ohGrid > 0 && edgeOnWall(poly[i], poly[(i + 1) % n], building.points) ? ohGrid : 0));
}

/** 建物の辺別出幅(グリッド)。その建物の全屋根の壁重なり辺から辺別 max（立面・resolve 用）。 */
export function buildingEdgeOverhangsFromRoofs(building: BuildingShape, roofs: Roof[]): number[] {
  const out = new Array(building.points.length).fill(0);
  for (const roof of roofs) {
    if (roof.buildingId !== building.id) continue;
    const poly = getRoofPolygon(building, roof);
    const n = poly.length;
    const ohGrid = roof.uniformMm > 0 ? mmToGrid(roof.uniformMm) : 0;
    if (ohGrid <= 0) continue;
    for (let i = 0; i < n; i++) {
      const j = roofEdgeToBuildingEdge(poly[i], poly[(i + 1) % n], building.points);
      if (j >= 0) out[j] = Math.max(out[j], ohGrid);
    }
  }
  return out;
}
