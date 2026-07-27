// ============================================================
// 屋根＝閉じた領域（polygon）方式の pure 幾何 (R-1e-fix7)。
//  ・getRoofPolygon: Roof の領域（旧 span/edgeRange の互換は建物外周へ）。
//  ・edgeOnWall / roofEdgeToBuildingEdge: 屋根領域の辺が建物の壁と重なるか（＝出幅を出す辺）。
//  ・roofEdgeOverhangsMm / roofPolygonOffsetsGrid: 屋根 polygon の辺別出幅。
//    R-1j: 出幅は「屋根 polygon の全辺」がユーザー設定の対象。以前は壁と重なる辺だけに uniformMm を
//    当て内部辺を自動 0 にしていたが、システムが勝手に 0 にする判断は撤廃した（鮎澤氏指示）。
//    既定は全辺 uniformMm、辺ごとに変えたい場合は Roof.edgeOverhangsMm[辺index] が優先（旧 RoofConfig と同じ）。
//    0 にしたい辺はユーザーが 0 を入力する。
//    → computeOffsetPolygon(polygon, これ) で平面の出幅点線（軒）を描く。
//  ・buildingEdgeOverhangsFromRoofs: 建物の辺別出幅(グリッド)。立面・resolve 用。
//    屋根辺→建物辺の対応付け（roofEdgeToBuildingEdge）は「どの建物辺の出幅か」を決めるための
//    対応であって出幅の有無の判定ではない（壁に乗らない屋根辺は対応する建物辺が無いだけ）。
// ============================================================
import type { BuildingShape, Point, Roof } from '@/types';
import { mmToGrid } from './gridUtils';
import { isPointInPolygon } from './autoLayoutUtils';

/** 屋根領域 polygon が乗っている建物 id（polygon 重心を含む建物）。無ければ null。 */
export function buildingForRoofPolygon(polygon: Point[], buildings: BuildingShape[]): string | null {
  if (polygon.length < 3) return null;
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const b = buildings.find((bb) => isPointInPolygon(cx, cy, bb.points));
  return b ? b.id : null;
}

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

/**
 * 屋根の辺別出幅(mm)。長さ = edgeCount。
 * edgeOverhangsMm[辺index] が指定されていればそれ、無ければ uniformMm（旧 RoofConfig と同じ優先関係）。
 * 負値は 0 に丸める。R-1j: 全辺が対象で、システム側で 0 にする辺は無い。
 */
export function roofEdgeOverhangsMm(roof: Roof, edgeCount: number): number[] {
  const per = roof.edgeOverhangsMm;
  const out: number[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const v = per?.[i];
    out.push(Math.max(0, v !== undefined ? v : roof.uniformMm));
  }
  return out;
}

/** 屋根 polygon の辺別出幅(グリッド)。全辺がユーザー設定の出幅（computeOffsetPolygon 用・R-1j）。 */
export function roofPolygonOffsetsGrid(building: BuildingShape, roof: Roof): number[] {
  const poly = getRoofPolygon(building, roof);
  return roofEdgeOverhangsMm(roof, poly.length).map((mm) => (mm > 0 ? mmToGrid(mm) : 0));
}

/** 建物の辺別出幅(グリッド)。その建物の全屋根の辺別出幅を、対応する建物辺ごとに max（立面・resolve 用）。 */
export function buildingEdgeOverhangsFromRoofs(building: BuildingShape, roofs: Roof[]): number[] {
  const out = new Array(building.points.length).fill(0);
  for (const roof of roofs) {
    if (roof.buildingId !== building.id) continue;
    const poly = getRoofPolygon(building, roof);
    const n = poly.length;
    const ohs = roofEdgeOverhangsMm(roof, n);
    for (let i = 0; i < n; i++) {
      const g = ohs[i] > 0 ? mmToGrid(ohs[i]) : 0;
      if (g <= 0) continue;
      // 壁に乗らない屋根辺は対応する建物辺が無い（＝建物の辺別出幅には現れない）。出幅の有無の判定ではない。
      const j = roofEdgeToBuildingEdge(poly[i], poly[(i + 1) % n], building.points);
      if (j >= 0) out[j] = Math.max(out[j], g);
    }
  }
  return out;
}
