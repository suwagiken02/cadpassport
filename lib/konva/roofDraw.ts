// ============================================================
// 屋根なぞり入力の pure ロジック (R-1e)。
//  ・fullPerimeterEdgeRange: 建物の全辺 index（建物タップ＝外周一周のワンタップ用）。
//  ・toggleEdgeInRange: 壁辺のタップで edgeRange にトグル追加/除去（昇順維持）。
//  ・upsertRoof: 同一建物・同一 edgeRange の屋根は置換、無ければ追加（重複置換）。
// ============================================================
import type { BuildingShape, Roof } from '@/types';

/** 建物の全辺 index（0..n-1）。ワンタップ「外周一周」屋根用。 */
export function fullPerimeterEdgeRange(building: BuildingShape): number[] {
  return Array.from({ length: building.points.length }, (_, i) => i);
}

/** edgeIndex を edgeRange にトグル（含めば除去・無ければ追加）。昇順を維持。 */
export function toggleEdgeInRange(range: number[], edgeIndex: number): number[] {
  if (range.includes(edgeIndex)) return range.filter((e) => e !== edgeIndex);
  return [...range, edgeIndex].sort((a, b) => a - b);
}

/** 2 つの edgeRange が集合として等しいか（順不同）。 */
function sameEdgeSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * 屋根を追加または置換する。同一 buildingId かつ同一 edgeRange（順不同）の既存屋根があれば
 * それを新しい内容で置換（重複置換）、無ければ末尾に追加。
 */
export function upsertRoof(roofs: Roof[], roof: Roof): Roof[] {
  const idx = roofs.findIndex(
    (r) => r.buildingId === roof.buildingId && sameEdgeSet(r.edgeRange, roof.edgeRange),
  );
  if (idx >= 0) {
    const next = roofs.slice();
    next[idx] = { ...roof, id: roofs[idx].id }; // id は既存を維持（履歴/参照の安定）
    return next;
  }
  return [...roofs, roof];
}
