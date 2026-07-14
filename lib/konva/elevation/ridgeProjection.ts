// ============================================================
// 立面図 E-3.8a: 棟ラインの面軸投影（pure・node 安全）
//
// 棟ライン（建物内部の水平な棟線分）を、表示面の変軸（N/S→x、E/W→y）へ射影する。
// 立面の屋根バンド上端（隅棟・寄棟）生成の下地。座標は既存エンジンと統一（グリッド／mm）。
// ============================================================
import type { BuildingShape, Point, RidgeLine } from '@/types';
import type { Face } from './faceReconstruction';

/** 面軸へ射影した棟。a<=b の変軸区間（グリッド）＋棟高(mm)。
 *  a==b は妻側（棟が面と直交し1点に潰れる）。 */
export type ProjectedRidge = {
  a: number;
  b: number;
  heightMm: number;
};

/**
 * 棟ライン群を、指定建物・指定面の変軸へ射影する。
 * N/S 面は x 軸、E/W 面は y 軸へ端点を射影し、[min,max] を区間 [a,b] とする。
 * 棟が面と平行 → a≠b（寄棟の水平棟）、面と直交 → a==b（妻側の点潰れ）。
 * buildingId が一致する棟ラインのみ対象。入力順を保持。
 */
export function projectRidgeLinesToFace(
  ridgeLines: RidgeLine[],
  building: BuildingShape,
  face: Face,
): ProjectedRidge[] {
  const isHorizontal = face === 'north' || face === 'south';
  const out: ProjectedRidge[] = [];
  for (const r of ridgeLines) {
    if (r.buildingId !== building.id) continue;
    const c1 = isHorizontal ? r.p1.x : r.p1.y;
    const c2 = isHorizontal ? r.p2.x : r.p2.y;
    out.push({ a: Math.min(c1, c2), b: Math.max(c1, c2), heightMm: Math.round(r.heightMm) });
  }
  return out;
}

/**
 * 寄棟の標準形の中央棟線を生成（E-3.12）。bbox の長辺方向に、長さ=長辺−短辺で中央に置く。
 * 正方形(長辺==短辺)は長さ0 → p1==p2（点。エンジンは点潰れ対応済み）。
 * L字等の非矩形は bbox の長辺方向で近似（将来改善）。座標はグリッド（整数丸め）。
 */
export function generateCenterRidgeLine(points: Point[]): { p1: Point; p2: Point } {
  if (points.length === 0) return { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);
  if (w >= h) {
    const half = Math.round((w - h) / 2);
    return { p1: { x: cx - half, y: cy }, p2: { x: cx + half, y: cy } };
  }
  const half = Math.round((h - w) / 2);
  return { p1: { x: cx, y: cy - half }, p2: { x: cx, y: cy + half } };
}

export type RidgeGuides = {
  /** 長辺方向の中央棟線候補（= generateCenterRidgeLine）。 */
  centerLine: { p1: Point; p2: Point };
  /** 短辺方向の中央線（中心で棟線と直交・bbox 全幅）。十字ガイドの片側。 */
  crossLine: { p1: Point; p2: Point };
  /** 隅棟の目安線（bbox 四隅 → 最寄りの棟端点）。 */
  hipLines: { p1: Point; p2: Point }[];
};

/**
 * 手動棟入力の中心ガイド（E-3.13）。中央棟線＋短辺方向中央線の十字＋四隅からの隅棟目安線。
 * 座標はグリッド（整数）。L字等の非矩形は bbox 近似（generateCenterRidgeLine と同基準）。
 */
export function computeRidgeGuides(points: Point[]): RidgeGuides {
  const centerLine = generateCenterRidgeLine(points);
  if (points.length === 0) {
    return { centerLine, crossLine: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } }, hipLines: [] };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);
  // 棟線が長辺(w>=h→横)なら crossLine は縦(全高)、そうでなければ横(全幅)。
  const crossLine = w >= h
    ? { p1: { x: cx, y: minY }, p2: { x: cx, y: maxY } }
    : { p1: { x: minX, y: cy }, p2: { x: maxX, y: cy } };
  const corners: Point[] = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ];
  const c1 = centerLine.p1, c2 = centerLine.p2;
  const hipLines = corners.map((corner) => {
    const d1 = Math.hypot(corner.x - c1.x, corner.y - c1.y);
    const d2 = Math.hypot(corner.x - c2.x, corner.y - c2.y);
    const end = d1 <= d2 ? c1 : c2;
    return { p1: corner, p2: { x: end.x, y: end.y } };
  });
  return { centerLine, crossLine, hipLines };
}

/** 点 pt を線分 seg に射影（区間内クランプ）した点と距離。 */
function projectToSegment(pt: Point, seg: { p1: Point; p2: Point }): { point: Point; dist: number } {
  const { p1, p2 } = seg;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { point: { x: p1.x, y: p1.y }, dist: Math.hypot(pt.x - p1.x, pt.y - p1.y) };
  let t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: p1.x + t * dx, y: p1.y + t * dy };
  return { point: proj, dist: Math.hypot(proj.x - pt.x, proj.y - pt.y) };
}

/**
 * 手動棟入力のスナップ（E-3.13・pure）。しきい値 thr(グリッド) 内で優先度順に吸着:
 *   1) 点スナップ: 棟端点・bbox 中心（ガイド交点）・建物頂点・辺中点
 *   2) 線スナップ: 中央棟線・短辺中央線への射影
 *   いずれも外れれば grid 丸めの生値（snapped=false）。
 */
export function snapRidgeInput(pt: Point, points: Point[], thr: number): { point: Point; snapped: boolean } {
  const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const guides = computeRidgeGuides(points);

  const cands: Point[] = [
    guides.centerLine.p1, guides.centerLine.p2,
    { x: (guides.crossLine.p1.x + guides.crossLine.p2.x) / 2, y: (guides.crossLine.p1.y + guides.crossLine.p2.y) / 2 },
  ];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    cands.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  let bestP: Point | null = null, bd = Infinity;
  for (const c of cands) { const d = Math.hypot(c.x - pt.x, c.y - pt.y); if (d < thr && d < bd) { bd = d; bestP = c; } }
  if (bestP) return { point: round(bestP), snapped: true };

  let bestL: Point | null = null, bld = Infinity;
  for (const seg of [guides.centerLine, guides.crossLine]) {
    const pr = projectToSegment(pt, seg);
    if (pr.dist < thr && pr.dist < bld) { bld = pr.dist; bestL = pr.point; }
  }
  if (bestL) return { point: round(bestL), snapped: true };

  return { point: round(pt), snapped: false };
}
