// ============================================================
// 立面図 R-1f-1: 屋根単位の立面バンド素材（pure・node 安全）
//
// 屋根が閉領域(polygon)の独立オブジェクトになった(R-1e-fix7)ことを受け、立面の屋根バンドを
// 「建物ごと 1 本」から「屋根ごと 1 本」に分けるための素材を出す。ここは幾何のみで、
// バンドの組み立て（プロファイル延長・包絡線・塗り）は elevationEngine 側(R-1f-2)。
//
// 中核は roofWallCoverages: 屋根 polygon の辺のうち建物の壁と重なる辺を、
// 「建物の辺 index + その辺上の t 区間」として取り出す。ここから
//   ・この面で屋根が覆う壁の変軸区間（→ 軒プロファイルの切り出し範囲）
//   ・この屋根に属する高さマーカー（→ 屋根別の軒高・棟マーカー）
//   ・この面の軒の出（→ 軒先下がりの計算）
// がすべて導ける。大屋根と下屋は覆う壁区間が違う＝この 1 経路で自然に分かれる。
//
// 座標系は既存エンジンと統一（変軸=グリッド、高さ=mm・GL 基準）。
// ============================================================
import type { BuildingShape, HeightMarker, Point, RidgeLine, Roof } from '@/types';
import type { Face } from './faceReconstruction';
import { getRoofPolygon, roofEdgeToBuildingEdge, roofPolygonOffsetsGrid } from '../roofRegion';
import { computeOffsetPolygon } from '../roofUtils';
import { isPointInPolygon } from '../autoLayoutUtils';
import { getHeightAtPosition } from '../heightInterpolation';

const EPS = 1e-6;

// ============================================================
// 1. 面と軸の基本
// ============================================================

/** ポリゴンの winding（面法線の向き決定用）。area2>0 → 1。 */
export function polygonWindingSign(pts: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area2 > 0 ? 1 : -1;
}

/** ポリゴンの面積（絶対値）。屋根の入れ子判定（面積最小＝より内側の屋根）用。 */
export function polygonArea(pts: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area2) / 2;
}

/** ポリゴン辺 i が向く面（elevationEngine.outlineEdgeFace / getFaceEdges と同一規約）。 */
export function polygonEdgeFace(pts: Point[], i: number, ws = polygonWindingSign(pts)): Face {
  const p1 = pts[i];
  const p2 = pts[(i + 1) % pts.length];
  const nx = ws * (p2.y - p1.y);
  const ny = -ws * (p2.x - p1.x);
  if (Math.abs(ny) >= Math.abs(nx)) return ny < 0 ? 'north' : 'south';
  return nx > 0 ? 'east' : 'west';
}

/** 変軸（横）座標。N/S 面 → x、E/W 面 → y。 */
export function variableCoord(p: Point, face: Face): number {
  return face === 'north' || face === 'south' ? p.x : p.y;
}

/** 奥行き座標。N/S 面 → y、E/W 面 → x。 */
export function depthCoordOf(p: Point, face: Face): number {
  return face === 'north' || face === 'south' ? p.y : p.x;
}

/** 区間[]を昇順マージ（重なり・接触を統合）。 */
export function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const src = intervals
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
    .filter(([a, b]) => b - a > EPS)
    .sort((s, t) => s[0] - t[0]);
  const out: [number, number][] = [];
  for (const [a, b] of src) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// ============================================================
// 2. 屋根が覆う壁区間（中核）
// ============================================================

/** 屋根 polygon の辺が乗っている壁。建物の辺 index と、その辺上の t 区間 [t0,t1]（t0<t1）。 */
export type WallCoverage = {
  /** 建物 building.points の辺 index（HeightMarker.edgeIndex と同一規約）。 */
  edgeIndex: number;
  t0: number;
  t1: number;
};

/** 点 pt を線分 p→q へ射影した媒介変数 t（0..1 にクランプ）。 */
function paramOnSegment(pt: Point, p: Point, q: Point): number {
  const dx = q.x - p.x, dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  const t = ((pt.x - p.x) * dx + (pt.y - p.y) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

/**
 * 屋根 polygon が建物の壁を覆う区間[]。屋根の各辺を roofEdgeToBuildingEdge で建物の辺へ
 * 対応付け、その辺上の t 区間に落とす。建物内部を横切る境界辺（下屋と大屋根の境目など）は
 * どの壁にも乗らないので含まれない。
 */
export function roofWallCoverages(building: BuildingShape, roof: Roof): WallCoverage[] {
  const poly = getRoofPolygon(building, roof);
  const bpts = building.points;
  const n = poly.length;
  const bn = bpts.length;
  const out: WallCoverage[] = [];
  if (n < 3 || bn < 3) return out;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const j = roofEdgeToBuildingEdge(a, b, bpts);
    if (j < 0) continue;
    const p = bpts[j], q = bpts[(j + 1) % bn];
    const ta = paramOnSegment(a, p, q);
    const tb = paramOnSegment(b, p, q);
    if (Math.abs(ta - tb) < EPS) continue; // 退化
    out.push({ edgeIndex: j, t0: Math.min(ta, tb), t1: Math.max(ta, tb) });
  }
  return out;
}

/**
 * この屋根が指定面の壁を覆う変軸区間[]（グリッド・昇順マージ済み）。
 * 面を向く壁の上に乗っている部分だけ＝軒プロファイルを切り出す範囲。
 * その面に壁を持たない屋根（例: 東壁だけの下屋を北から見る）は空配列。
 */
export function roofFaceWallIntervals(
  building: BuildingShape, roof: Roof, face: Face,
): [number, number][] {
  const bpts = building.points;
  if (bpts.length < 3) return [];
  const ws = polygonWindingSign(bpts);
  const raw: [number, number][] = [];
  for (const cov of roofWallCoverages(building, roof)) {
    if (polygonEdgeFace(bpts, cov.edgeIndex, ws) !== face) continue;
    const p = bpts[cov.edgeIndex], q = bpts[(cov.edgeIndex + 1) % bpts.length];
    const c0 = variableCoord(p, face) + cov.t0 * (variableCoord(q, face) - variableCoord(p, face));
    const c1 = variableCoord(p, face) + cov.t1 * (variableCoord(q, face) - variableCoord(p, face));
    raw.push([c0, c1]);
  }
  return mergeIntervals(raw);
}

// ============================================================
// 3. 屋根別の高さ（軒高・棟マーカー）
// ============================================================

/** マーカーがこの屋根の壁区間上にあるか（辺 index 一致＋t が区間内）。 */
export function markerOnRoof(coverages: WallCoverage[], m: HeightMarker, tol = 1e-6): boolean {
  return coverages.some(
    (c) => c.edgeIndex === m.edgeIndex && m.t >= c.t0 - tol && m.t <= c.t1 + tol,
  );
}

/** この屋根の壁区間上にあるマーカーの最高高さ(mm)。該当なし → null。
 *  屋根別の「棟マーカー」判定用（大屋根の棟マーカーで下屋バンドが持ち上がらないように）。 */
export function roofMarkerMaxMm(
  building: BuildingShape, coverages: WallCoverage[], markers: HeightMarker[],
): number | null {
  let mx = -Infinity;
  for (const m of markers) {
    if (m.buildingId !== building.id) continue;
    if (!markerOnRoof(coverages, m)) continue;
    mx = Math.max(mx, m.heightMm);
  }
  return Number.isFinite(mx) ? mx : null;
}

/**
 * この屋根の軒高(mm)＝壁重なり区間の中点で読んだ高さの最小値（水下基準）。
 * 高さは既存の弧長補間 getHeightAtPosition をそのまま使うので、下屋の壁区間に低いマーカーを
 * 置けばその値が下屋の軒高になる（運用どおり）。マーカー 0 個 / 壁重なりなし → null。
 */
export function roofEaveMm(
  building: BuildingShape, coverages: WallCoverage[], markers: HeightMarker[],
): number | null {
  let mn = Infinity;
  for (const c of coverages) {
    const h = getHeightAtPosition(building, markers, c.edgeIndex, (c.t0 + c.t1) / 2);
    if (h == null) continue;
    mn = Math.min(mn, h);
  }
  return Number.isFinite(mn) ? Math.round(mn) : null;
}

// ============================================================
// 4. 屋根の x 範囲・出幅・奥行き
// ============================================================

/**
 * 出幅込みのこの屋根の変軸範囲（グリッド）。壁重なり辺のみ出幅を出したオフセット polygon の
 * 変軸 bbox＝「この面から見たときの屋根の広がり」。polygon 不正なら null。
 */
export function roofExtXRange(
  building: BuildingShape, roof: Roof, face: Face,
): { xStart: number; xEnd: number } | null {
  const poly = getRoofPolygon(building, roof);
  if (poly.length < 3) return null;
  const offsets = roofPolygonOffsetsGrid(building, roof);
  const ext = offsets.some((v) => v > 0) ? computeOffsetPolygon(poly, offsets) : poly;
  let mn = Infinity, mx = -Infinity;
  for (const p of ext) {
    const c = variableCoord(p, face);
    mn = Math.min(mn, c); mx = Math.max(mx, c);
  }
  return Number.isFinite(mn) ? { xStart: mn, xEnd: mx } : null;
}

/** この面の軒の出(グリッド)＝face を向く壁に乗った屋根辺の出幅 max。その面に軒がなければ 0。 */
export function roofFaceOverhangGrid(building: BuildingShape, roof: Roof, face: Face): number {
  const poly = getRoofPolygon(building, roof);
  const bpts = building.points;
  if (poly.length < 3 || bpts.length < 3) return 0;
  const offsets = roofPolygonOffsetsGrid(building, roof);
  const ws = polygonWindingSign(bpts);
  const n = poly.length;
  let mx = 0;
  for (let i = 0; i < n; i++) {
    if ((offsets[i] ?? 0) <= 0) continue;
    const j = roofEdgeToBuildingEdge(poly[i], poly[(i + 1) % n], bpts);
    if (j < 0) continue;
    if (polygonEdgeFace(bpts, j, ws) !== face) continue;
    mx = Math.max(mx, offsets[i]);
  }
  return mx;
}

/** 視点への近さ（大きいほど手前）。south/east は奥行き最大が手前、north/west は最小が手前。
 *  同一面に複数バンドが重なるときの描画順（奥→手前）に使う。 */
export function roofFrontness(building: BuildingShape, roof: Roof, face: Face): number {
  const poly = getRoofPolygon(building, roof);
  if (poly.length === 0) return 0;
  const ds = poly.map((p) => depthCoordOf(p, face));
  if (face === 'north' || face === 'west') {
    const v = -Math.min(...ds);
    return v === 0 ? 0 : v; // -0 を +0 に正規化
  }
  return Math.max(...ds);
}

// ============================================================
// 5. 棟ラインの屋根への対応付け
// ============================================================

/**
 * 棟ラインを屋根へ割り当てる（棟の中点がどの屋根 polygon の中にあるか）。
 * 複数の屋根に含まれる場合は面積最小＝より内側の屋根（大屋根の中に下屋領域が入れ子のケース）。
 * どの屋根にも入らない棟は捨てず、面積最大の屋根（＝大屋根）へ寄せる。
 * 戻り値は roof.id → RidgeLine[]（該当なしの屋根は空配列でエントリを持つ）。
 */
export function assignRidgeLinesToRoofs(
  ridgeLines: RidgeLine[], building: BuildingShape, roofs: Roof[],
): Map<string, RidgeLine[]> {
  const map = new Map<string, RidgeLine[]>();
  for (const r of roofs) map.set(r.id, []);
  if (roofs.length === 0) return map;

  const polys = roofs.map((r) => getRoofPolygon(building, r));
  const areas = polys.map((p) => polygonArea(p));
  let biggest = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[biggest]) biggest = i;

  for (const line of ridgeLines) {
    if (line.buildingId !== building.id) continue;
    const cx = (line.p1.x + line.p2.x) / 2;
    const cy = (line.p1.y + line.p2.y) / 2;
    let pick = -1;
    for (let i = 0; i < roofs.length; i++) {
      if (polys[i].length < 3 || !isPointInPolygon(cx, cy, polys[i])) continue;
      if (pick < 0 || areas[i] < areas[pick]) pick = i;
    }
    if (pick < 0) pick = biggest; // どの領域にも入らない棟は大屋根へ
    map.get(roofs[pick].id)!.push(line);
  }
  return map;
}

// ============================================================
// 6. 軒プロファイルの切り出し
// ============================================================

/** 上辺セグメント（elevationEngine.BuildingOutlineSegment と構造互換）。 */
export type TopSegment = {
  xStart: number;
  xEnd: number;
  heightStartMm: number;
  heightEndMm: number;
};

/** セグメント上の変軸座標 x における高さ(mm)を線形補間。 */
function heightAtSeg(seg: TopSegment, x: number): number {
  const span = seg.xEnd - seg.xStart;
  if (Math.abs(span) < EPS) return seg.heightStartMm;
  const f = (x - seg.xStart) / span;
  return seg.heightStartMm + f * (seg.heightEndMm - seg.heightStartMm);
}

/**
 * 壁の上辺セグメント列を、屋根が覆う変軸区間[]で切り出す（切断点の高さは線形補間）。
 * 屋根別の軒プロファイルの下地。区間が空なら空配列（＝その面に壁を持たない屋根）。
 */
export function clipSegmentsToIntervals(
  segments: TopSegment[], intervals: [number, number][],
): TopSegment[] {
  const out: TopSegment[] = [];
  for (const [a, b] of mergeIntervals(intervals)) {
    for (const s of segments) {
      const lo = Math.max(a, s.xStart);
      const hi = Math.min(b, s.xEnd);
      if (hi - lo <= EPS) continue;
      out.push({
        xStart: lo,
        xEnd: hi,
        heightStartMm: Math.round(heightAtSeg(s, lo)),
        heightEndMm: Math.round(heightAtSeg(s, hi)),
      });
    }
  }
  return out.sort((s, t) => s.xStart - t.xStart);
}
