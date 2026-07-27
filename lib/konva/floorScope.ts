// ============================================================
// 階スコープ (R-1h-1): 「いま編集している階の建物だけを対象にする」ための pure 関数群。
//
// 総二階＋下屋の物件では 1F と 2F の外壁が平面上で重なる。高さマーカー・棟ライン・屋根領域の
// 入力はいずれも「全建物の中から最寄り/最初の1件」を選ぶ実装だったため、重なった壁のどちらに
// 付いたかが不定になり、立面で 1F 屋根(下屋)と 2F 屋根の高さが混ざっていた（実機症状）。
// 対象を activeFloor の建物に絞る判断をここ1箇所に集約する。
//
// フォールバック規約（BuildingLayer の薄表示と同一・安全側）:
//   その階に建物が 1 つも無い（階切替直後・stale・単一階物件で activeFloor がずれている等）
//   → 絞り込まず全建物を返す＝従来挙動。これにより単一階の物件では一切挙動が変わらない。
// ============================================================
import type { BuildingShape, Point } from '@/types';
import { getFloor } from '@/types';
import { isPointInPolygon } from './autoLayoutUtils';
import { buildingForRoofPolygon } from './roofRegion';

/** 非 active 階の建物の不透明度（通常時）。従来の BuildingLayer の値。 */
export const OTHER_FLOOR_OPACITY = 0.6;
/**
 * 非 active 階の建物の不透明度（高さ/棟/屋根の入力ツール中）。
 * 「どの階の壁に置いているか」を一目で分かるよう大幅に減光する（鮎澤氏指示）。
 * 完全非表示にしないのは、下階との位置関係が見えないと 2F の壁位置を掴めないため。
 */
export const OTHER_FLOOR_OPACITY_TOOL = 0.18;

/** 指定階の建物[]（素の絞り込み・フォールバックなし）。floor 未設定は 1F 扱い。 */
export function buildingsOnFloor(buildings: BuildingShape[], floor: number): BuildingShape[] {
  return buildings.filter((b) => getFloor(b) === floor);
}

/** その階に建物があるか（＝階限定・薄表示を有効にしてよいか）。 */
export function hasFloorBuildings(buildings: BuildingShape[], floor: number): boolean {
  return buildings.some((b) => getFloor(b) === floor);
}

/** 建物の最上階（建物なしは 0）。階セレクタ・ガイド文言の出し分け用。 */
export function maxBuildingFloor(buildings: BuildingShape[]): number {
  return buildings.reduce((m, b) => Math.max(m, getFloor(b)), 0);
}

/** 建物が 2 階以上に跨るか。false なら階の概念をユーザーに見せない（従来どおりの単層 UI）。 */
export function isMultiFloor(buildings: BuildingShape[]): boolean {
  return maxBuildingFloor(buildings) >= 2;
}

/**
 * 入力の対象にする建物[]。指定階に建物があればその階だけ、無ければ全建物（安全側フォールバック）。
 * 高さマーカーのスナップ・中点ガイド・棟/屋根の建物特定はすべてこの1経路を通す。
 */
export function resolveFloorScope(buildings: BuildingShape[], floor: number): BuildingShape[] {
  const scoped = buildingsOnFloor(buildings, floor);
  return scoped.length > 0 ? scoped : buildings;
}

/** buildingId の建物が属する階。該当建物なし（削除済みを指す孤児）は null。 */
export function floorOfBuildingId(buildings: BuildingShape[], buildingId: string): number | null {
  const b = buildings.find((bb) => bb.id === buildingId);
  return b ? getFloor(b) : null;
}

/** 点を含む建物を対象階優先で返す（棟ラインの始点判定）。該当なしは undefined。 */
export function buildingAtPointOnFloor(
  pt: Point, buildings: BuildingShape[], floor: number,
): BuildingShape | undefined {
  return resolveFloorScope(buildings, floor).find((b) => isPointInPolygon(pt.x, pt.y, b.points));
}

/** 屋根領域 polygon が乗る建物 id を対象階優先で返す（屋根描き確定時）。該当なしは null。 */
export function buildingIdForPolygonOnFloor(
  polygon: Point[], buildings: BuildingShape[], floor: number,
): string | null {
  return buildingForRoofPolygon(polygon, resolveFloorScope(buildings, floor));
}
