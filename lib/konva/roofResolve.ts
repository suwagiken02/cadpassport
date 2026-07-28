// ============================================================
// 屋根の独立オブジェクト化・互換レイヤー (R-1d / R-1e-fix7)。
//  ・resolveBuildingOverhangsGrid: 建物の辺別出幅(グリッド)を roofs[] 優先で解決（polygon の壁重なり辺）。
//    roofs[] にその建物の屋根が無ければ 旧 building.roof(RoofConfig) + roofOverhangs[] へフォールバック。
//  ・liftLegacyRoof(s): 旧 building.roof / roofOverhangs[] を Roof（建物外周 polygon）へ変換（読み込み時 lift）。
//  消費側（平面の出幅点線・立面の出幅）はこの1経路を通す。
// ============================================================
import type { BuildingShape, Roof, RoofOverhang } from '@/types';
import { mmToGrid } from './gridUtils';
import { getEdgeOverhangs } from './roofUtils';
import { buildingEdgeOverhangsFromRoofs } from './roofRegion';

/** 旧経路（building.roof + roofOverhangs[]）の辺別出幅(グリッド)。従来の mergedRoofOverhangsGrid と同一。 */
function legacyOverhangsGrid(building: BuildingShape, legacyRoofOverhangs: RoofOverhang[]): number[] {
  const n = building.points.length;
  const base = (building.roof && building.roof.roofType !== 'none')
    ? getEdgeOverhangs(building, building.roof)
    : new Array(n).fill(0);
  const result = base.slice(0, n);
  while (result.length < n) result.push(0);
  // RoofConfig が 0 の辺のみ旧式 roofOverhangs[] で補完（RoofConfig 優先）。
  for (const ro of legacyRoofOverhangs) {
    if (ro.buildingId !== building.id) continue;
    if (ro.faceIndex < 0 || ro.faceIndex >= n) continue;
    if (result[ro.faceIndex] === 0 && ro.overhangMm > 0) result[ro.faceIndex] = mmToGrid(ro.overhangMm);
  }
  return result;
}

/**
 * 建物の辺別出幅(グリッド)を解決する。roofs[] にその建物の屋根があれば polygon の壁重なり辺から辺別 max、
 * 無ければ旧 building.roof + roofOverhangs[] へフォールバック。長さ = building.points.length。
 */
export function resolveBuildingOverhangsGrid(
  building: BuildingShape,
  roofs: Roof[] | undefined,
): number[] {
  // R-1g: 旧 building.roof / roofOverhangs[] の直読みフォールバックは撤去。互換は読み込み時の
  //   lift（liftLegacyRoofs → roofs[]）の一点に集約する。lift 後は必ず roofs[] に現れるため、
  //   ここでフォールバックしても結果は「屋根なし＝全辺 0」と同じで、二重経路を持つ意味がない。
  return buildingEdgeOverhangsFromRoofs(building, (roofs ?? []).filter((r) => r.buildingId === building.id));
}

/**
 * 旧 building.roof / roofOverhangs[] を Roof（建物外周 polygon の全周屋根）へ lift する。読み込み時の1回変換用。
 * 出幅は旧経路の最大出幅を uniformMm に採用（per-face の細部は単純化）。
 * building.roof も roofOverhangs[] も無ければ null（屋根なし建物）。
 */
export function liftLegacyRoof(building: BuildingShape, legacyRoofOverhangs: RoofOverhang[]): Roof | null {
  const hasRoofConfig = !!building.roof;
  const hasLegacyOverhang = legacyRoofOverhangs.some((ro) => ro.buildingId === building.id);
  if (!hasRoofConfig && !hasLegacyOverhang) return null;

  const grid = legacyOverhangsGrid(building, legacyRoofOverhangs);
  const maxGrid = grid.reduce((m, v) => Math.max(m, v), 0);
  const uniformMm = building.roof?.uniformMm && building.roof.uniformMm > 0
    ? building.roof.uniformMm
    : Math.round(maxGrid * 10); // grid→mm（1grid=10mm）
  return {
    id: `roof-lift-${building.id}`,
    buildingId: building.id,
    polygon: building.points.map((p) => ({ x: p.x, y: p.y })), // 全周屋根として lift（R-1e-fix7）
    roofShape: building.roof?.roofShape ?? 'gable',
    uniformMm,
    katanagareDirection: building.roof?.katanagareDirection,
    kirizumaGableFace: building.roof?.kirizumaGableFace,
  };
}

/** 全建物分の lift。roofs 未定義の旧データを読み込むときに normalize から呼ぶ。 */
export function liftLegacyRoofs(buildings: BuildingShape[], legacyRoofOverhangs: RoofOverhang[]): Roof[] {
  const out: Roof[] = [];
  for (const b of buildings) {
    const r = liftLegacyRoof(b, legacyRoofOverhangs);
    if (r) out.push(r);
  }
  return out;
}
