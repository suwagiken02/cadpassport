// ============================================================
// 屋根の独立オブジェクト化・互換レイヤー (R-1d)。
//  ・resolveBuildingOverhangsGrid: 建物の辺別出幅(グリッド)を roofs[] 優先で解決。
//    roofs[] にその建物の屋根が無ければ 旧 building.roof(RoofConfig) + roofOverhangs[] へフォールバック。
//  ・liftLegacyRoof(s): 旧 building.roof / roofOverhangs[] を Roof オブジェクトへ変換（読み込み時 lift）。
//  消費側（平面の出幅点線・立面の出幅）はこの1経路を通す。
// ============================================================
import type { BuildingShape, Roof, RoofOverhang } from '@/types';
import { mmToGrid } from './gridUtils';
import { getEdgeOverhangs } from './roofUtils';
import { roofSpanEdgeOverhangsGrid, fullSpan } from './roofSpan';

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

/** 1 つの Roof の辺別出幅(グリッド)。span の被覆辺のみ、edgeOverhangsMm 優先・無ければ uniformMm。 */
export function roofToEdgeOverhangsGrid(building: BuildingShape, roof: Roof): number[] {
  return roofSpanEdgeOverhangsGrid(building, roof);
}

/**
 * 建物の辺別出幅(グリッド)を解決する。roofs[] にその建物の屋根があればそれらの max を採用（複数屋根対応）、
 * 無ければ旧 building.roof + roofOverhangs[] へフォールバック。長さ = building.points.length。
 */
export function resolveBuildingOverhangsGrid(
  building: BuildingShape,
  roofs: Roof[] | undefined,
  legacyRoofOverhangs: RoofOverhang[],
): number[] {
  const n = building.points.length;
  const mine = (roofs ?? []).filter((r) => r.buildingId === building.id);
  if (mine.length === 0) return legacyOverhangsGrid(building, legacyRoofOverhangs);
  const out = new Array(n).fill(0);
  for (const roof of mine) {
    const eo = roofSpanEdgeOverhangsGrid(building, roof);
    for (let i = 0; i < n; i++) out[i] = Math.max(out[i], eo[i]);
  }
  return out;
}

/**
 * 旧 building.roof / roofOverhangs[] を Roof（全周 edgeRange）へ lift する。読み込み時の1回変換用。
 * 辺別出幅は旧経路の解決結果（grid→mm）を edgeOverhangsMm に畳み込む（roofOverhangs[] も取り込む）。
 * building.roof も roofOverhangs[] も無ければ null（屋根なし建物）。
 */
export function liftLegacyRoof(building: BuildingShape, legacyRoofOverhangs: RoofOverhang[]): Roof | null {
  const hasRoofConfig = !!building.roof;
  const hasLegacyOverhang = legacyRoofOverhangs.some((ro) => ro.buildingId === building.id);
  if (!hasRoofConfig && !hasLegacyOverhang) return null;

  const n = building.points.length;
  const grid = legacyOverhangsGrid(building, legacyRoofOverhangs);
  const edgeOverhangsMm: Record<number, number> = {};
  for (let i = 0; i < n; i++) edgeOverhangsMm[i] = Math.round(grid[i] * 10); // grid→mm（1grid=10mm）
  return {
    id: `roof-lift-${building.id}`,
    buildingId: building.id,
    span: fullSpan(), // 旧 building.roof は全周屋根として lift（R-1e-fix）
    roofShape: building.roof?.roofShape ?? 'gable',
    uniformMm: building.roof?.uniformMm ?? 0,
    edgeOverhangsMm,
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
