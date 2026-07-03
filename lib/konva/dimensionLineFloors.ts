import type { DimensionLineKey } from '@/types';

// ============================================================
// S-4: 寸法線の N 階一般化 (pure 部分)。
//   DimensionLineLayer の「存在階生成・offset 式・キー/色/visibility 既定」を
//   React/konva 非依存の純関数に抽出し、回帰テスト可能にする。
//   N=2 ({1,2}) では従来リテラル(色/キー/offset)と完全一致する。
// ============================================================

export type DimCategory = 'scaffold' | 'wall' | 'roof';

/** 寸法線の階色パレット (1F→#444, 2F→#378ADD, 3F 以降→視認性の高い追加色、以降は循環)。
 *  index = (floor − 1) mod length。1F/2F は従来色 COLOR_1F/COLOR_2F と一致。 */
export const FLOOR_DIM_COLORS = ['#444', '#378ADD', '#E8643C', '#2FA84F', '#B14FC5'] as const;

export function floorDimColor(floor: number): string {
  const n = FLOOR_DIM_COLORS.length;
  const i = (((floor - 1) % n) + n) % n; // 負値保護
  return FLOOR_DIM_COLORS[i];
}

/** 存在階の昇順ユニーク (floor 未指定は 1F 扱い)。dedup(seenDim) の処理順に直結するため昇順固定。 */
export function getPresentFloors(buildings: { floor?: number }[]): number[] {
  const s = new Set<number>();
  for (const b of buildings) s.add(b.floor ?? 1);
  return Array.from(s).sort((a, b) => a - b);
}

// 複数階 offset(mm): base + (maxFloor − floor)·step。
//   N=2 で 現行 6 定数と一致: scaffold2F=50/1F=100, wall2F=200/1F=500, roof2F=350/1F=700。
const OFF_BASE_MM: Record<DimCategory, number> = { scaffold: 50, wall: 200, roof: 350 };
const OFF_STEP_MM: Record<DimCategory, number> = { scaffold: 50, wall: 300, roof: 350 };
// 単独階 offset(mm): 現行 SOLO 定数(挙動維持)。
const OFF_SOLO_MM: Record<DimCategory, number> = { scaffold: 75, wall: 150, roof: 300 };

/** 種別・階・存在階集合から寸法線の基準 offset(mm) を算出。
 *  複数階(length>=2)は式 base+(maxFloor−floor)·step、単独階は SOLO 定数。 */
export function dimBaseOffsetMm(cat: DimCategory, floor: number, floorsPresent: number[]): number {
  if (floorsPresent.length >= 2) {
    const maxFloor = Math.max(...floorsPresent);
    return OFF_BASE_MM[cat] + (maxFloor - floor) * OFF_STEP_MM[cat];
  }
  return OFF_SOLO_MM[cat];
}

/** 寸法線キー生成 (`${cat}${floor}F`)。 */
export function dimKey(cat: DimCategory, floor: number): DimensionLineKey {
  return `${cat}${floor}F` as DimensionLineKey;
}

/** visibility 種別デフォルト (wall/roof=表示, scaffold=非表示)。 */
export const DIM_VIS_DEFAULT: Record<DimCategory, boolean> = { scaffold: false, wall: true, roof: true };

/** visibility 読取: 明示値(6 キー)優先、無ければ(3F+ 等)種別デフォルト。 */
export function readDimVisibility(
  vis: Record<string, boolean | undefined>, cat: DimCategory, floor: number,
): boolean {
  return vis[dimKey(cat, floor)] ?? DIM_VIS_DEFAULT[cat];
}

/** 1 floor 分の寸法線記述子 (offset は px 換算前の mm、色・キーを内包)。 */
export type FloorDimDescriptor = {
  floor: number;
  color: string;
  scaffoldKey: DimensionLineKey;
  wallKey: DimensionLineKey;
  roofKey: DimensionLineKey;
  offScaffoldMm: number;
  offWallMm: number;
  offRoofMm: number;
};

/** 存在階(昇順)から floor 記述子配列を生成。順序=昇順=dedup 処理順。 */
export function buildFloorDimDescriptors(floorsPresent: number[]): FloorDimDescriptor[] {
  return floorsPresent.map((floor) => ({
    floor,
    color: floorDimColor(floor),
    scaffoldKey: dimKey('scaffold', floor),
    wallKey: dimKey('wall', floor),
    roofKey: dimKey('roof', floor),
    offScaffoldMm: dimBaseOffsetMm('scaffold', floor, floorsPresent),
    offWallMm: dimBaseOffsetMm('wall', floor, floorsPresent),
    offRoofMm: dimBaseOffsetMm('roof', floor, floorsPresent),
  }));
}
