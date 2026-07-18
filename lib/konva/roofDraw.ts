// ============================================================
// 屋根「キャラ歩き」入力の pure ロジック (R-1e-fix)。
//  ・walkToSpan: 壁の上を歩いた弧 [startArc, endArc] を WallSpan へ変換（全周は full）。
//  ・upsertRoof: 同一建物・同一 span の屋根は置換、無ければ追加（重複置換）。
// 歩行の幾何（arc↔位置・被覆・オフセット）は roofSpan.ts。
// ============================================================
import type { BuildingShape, Roof, WallSpan } from '@/types';
import { arcToPos, perimeterGrid, fullSpan, spanEquals } from './roofSpan';

/**
 * 歩いた弧 [startArc, endArc]（endArc = startArc + 被覆長, 周方向 forward）を WallSpan へ。
 * 被覆長が全周以上なら full。ゼロ長は start==end の縮退 span（呼び出し側で作成抑止）。
 */
export function walkToSpan(building: BuildingShape, startArc: number, endArc: number): WallSpan {
  const perim = perimeterGrid(building);
  const len = endArc - startArc;
  if (len >= perim - 1e-6) return fullSpan();
  const s = arcToPos(building, startArc);
  const e = arcToPos(building, endArc);
  return { startEdge: s.edge, startT: s.t, endEdge: e.edge, endT: e.t };
}

/**
 * 歩行中に壁上の点（targetArcMod = mod perim の arc）をタップしたときの新しい endArc（R-1e-fix5）。
 * 現在位置 endArc からの最短 arc でタップ点へ移動（始点は維持・延長/短縮が自然）。±全周にクランプ。
 */
export function retargetWalkEnd(
  building: BuildingShape, walk: { startArc: number; endArc: number }, targetArcMod: number,
): number {
  const perim = perimeterGrid(building);
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  const delta = mod(targetArcMod - walk.endArc, perim);
  const signed = delta > perim / 2 ? delta - perim : delta; // 最短（近い方）へ
  const t = walk.endArc + signed;
  return Math.max(walk.startArc - perim, Math.min(walk.startArc + perim, t));
}

/**
 * 屋根を追加または置換する。同一 buildingId かつ同一 span（arc 区間一致）の既存屋根があれば
 * その内容を置換（id は既存維持）、無ければ末尾に追加。
 */
export function upsertRoof(building: BuildingShape, roofs: Roof[], roof: Roof): Roof[] {
  const span = roof.span ?? fullSpan();
  const idx = roofs.findIndex(
    (r) => r.buildingId === roof.buildingId && r.span != null && spanEquals(building, r.span, span),
  );
  if (idx >= 0) {
    const next = roofs.slice();
    next[idx] = { ...roof, id: roofs[idx].id };
    return next;
  }
  return [...roofs, roof];
}
