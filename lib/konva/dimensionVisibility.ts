import { DIM_VIS_DEFAULT, type DimCategory } from '@/lib/konva/dimensionLineFloors';

// ============================================================
// S-5e-4: 寸法線 段別表示設定の pure 部分（N 階対応・node 安全）。
//   型/既定/parse/チェックボックス項目生成を store・UI から分離してテスト可能に。
// ============================================================

/** `${cat}${floor}F`(cat=roof|wall|scaffold) の任意 floor キーを持てる可視性設定。 */
export type DimensionVisibility = Record<string, boolean>;

/** 既定（{1,2} の 6 キー）。3F+ の未設定キーは描画側 readDimVisibility が種別デフォルトを適用。 */
export const DEFAULT_DIMENSION_VISIBILITY: DimensionVisibility = {
  roof1F: true, wall1F: true, scaffold1F: false,
  roof2F: true, wall2F: true, scaffold2F: false,
};

/** DB(jsonb)値を可視性設定へ。既定 6 キーを土台に raw の boolean 値を全て通す（3F+ も保持）。
 *  {1,2}: raw に 6 キーが揃えば従来 pick と同値。欠損は既定維持・非 boolean は無視。 */
export function parseDimensionVisibility(raw: unknown): DimensionVisibility {
  const out: DimensionVisibility = { ...DEFAULT_DIMENSION_VISIBILITY };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

const DIM_VIS_CATS: Array<{ cat: DimCategory; label: string }> = [
  { cat: 'roof', label: '屋根' },
  { cat: 'wall', label: '外壁' },
  { cat: 'scaffold', label: '足場' },
];

export type DimVisItem = { key: string; label: string; cat: DimCategory };

/** 対象階(floors) × 種別のチェックボックス項目。floors 昇順で roof→wall→scaffold の順。
 *  floors 省略/空は [1,2]。{1,2} で従来 6 項目(roof1F,wall1F,scaffold1F,roof2F,wall2F,scaffold2F)を再現。 */
export function dimVisibilityItems(floors?: number[]): DimVisItem[] {
  const fs = floors && floors.length ? floors : [1, 2];
  return fs.flatMap(f => DIM_VIS_CATS.map(c => ({ key: `${c.cat}${f}F`, label: `${f}F ${c.label}`, cat: c.cat })));
}

export { DIM_VIS_DEFAULT };
