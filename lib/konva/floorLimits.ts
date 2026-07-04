// ============================================================
// S-5e-1: N 階解禁の上限定数 + 連続階/上限判定（純関数）。
//   作成上限(MAX_BUILDING_FLOOR)と自動割付上限(MAX_SCAFFOLD_FLOOR)を別定数にし、
//   段階解禁（割付は当面 3 階まで）を 1 定数で制御できるようにする。
// ============================================================

/** 建物作成の上限階（下階をなぞって積める最大階）。現行ハードコード値と同値の 8。 */
export const MAX_BUILDING_FLOOR = 8;

/** 自動割付(cascade)の解禁上限階。段階解禁用。実機検証後にここを上げる。 */
export const MAX_SCAFFOLD_FLOOR = 3;

/** present-floors が連続積層（飛びなし）か。
 *  cascade エンジンは非連続（例 {1,3}）で throw するため、割付前の事前判定に使う。
 *  空配列・単一階・連続集合は true。 */
export function isContiguousFloors(floors: number[]): boolean {
  if (floors.length === 0) return true;
  const uniq = new Set(floors);
  const min = Math.min(...floors);
  const max = Math.max(...floors);
  return uniq.size === floors.length && max - min + 1 === floors.length;
}

/** MAX_SCAFFOLD_FLOOR を超える階を含むか（割付抑止ガード用）。 */
export function hasFloorAboveScaffoldLimit(floors: number[], limit: number = MAX_SCAFFOLD_FLOOR): boolean {
  return floors.some(f => f > limit);
}

/** 建物作成時に割り当てる階番号。
 *  isUpper=false(地上階): 常に 1。
 *  isUpper=true(「上の階を追加」): 既存最上階+1（上限 MAX_BUILDING_FLOOR にクランプ・建物ゼロでも最低 2）。
 *  なぞり/テンプレ経路(GridCanvas)の Math.min(MAX_BUILDING_FLOOR, Math.max(existingMaxFloor,1)+1) と対称。 */
export function nextBuildingFloor(existingMaxFloor: number, isUpper: boolean): number {
  if (!isUpper) return 1;
  return Math.min(MAX_BUILDING_FLOOR, Math.max(existingMaxFloor, 1) + 1);
}
