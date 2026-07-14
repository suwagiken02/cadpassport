// ============================================================
// 立面図 E-3.8a: 棟ラインの面軸投影（pure・node 安全）
//
// 棟ライン（建物内部の水平な棟線分）を、表示面の変軸（N/S→x、E/W→y）へ射影する。
// 立面の屋根バンド上端（隅棟・寄棟）生成の下地。座標は既存エンジンと統一（グリッド／mm）。
// ============================================================
import type { BuildingShape, RidgeLine } from '@/types';
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
