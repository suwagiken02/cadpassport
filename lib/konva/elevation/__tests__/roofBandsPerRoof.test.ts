import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point, RidgeLine, Roof } from '@/types';
import { buildFaceElevation, type RoofBand } from '../elevationEngine';

// ============================================================
// R-1f-2: 屋根単位バンド生成への切替。
// roofs[] にその建物の屋根があれば屋根ごと 1 本、無ければ従来どおり建物ごと 1 本。
// ここでは「polygon = 建物外周（旧データの lift 相当）の 1 屋根」が従来経路と数値一致することを固定する。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];

/** 旧経路用: building.roof(RoofConfig) を持つ建物（roofs[] は渡さない）。 */
const legacyBld = (id: string, uniformMm = 600): BuildingShape => ({
  id, type: 'polygon', points: RECT, fill: '#000', floor: 1,
  ...(uniformMm > 0
    ? { roof: { roofType: 'yosemune' as const, uniformMm, northMm: null, southMm: null, eastMm: null, westMm: null } }
    : {}),
});

/** 新経路用: 建物外周と同じ polygon の全周屋根（liftLegacyRoof が作る形）。 */
const liftedRoof = (buildingId: string, uniformMm = 600): Roof => ({
  id: `roof-lift-${buildingId}`, buildingId, polygon: RECT, roofShape: 'gable', uniformMm,
});

/** roofId を落として旧経路の出力と比較できる形にする。 */
const stripRoofId = (bands: RoofBand[]) => bands.map(({ roofId: _roofId, ...rest }) => rest);

/** 同じ入力を「旧経路(roofs 無し)」「新経路(roofs 有り)」で走らせて両方返す。 */
function bothPaths(
  markers: HeightMarker[], face: 'north' | 'south' | 'east' | 'west',
  opts?: { ridgeLines?: RidgeLine[]; uniformMm?: number; defaultHeightMm?: number },
) {
  const uniformMm = opts?.uniformMm ?? 600;
  const common = {
    markers, face, ridgeLines: opts?.ridgeLines ?? [], defaultHeightMm: opts?.defaultHeightMm,
  };
  const legacy = buildFaceElevation([], [legacyBld('B', uniformMm)], common);
  const perRoof = buildFaceElevation([], [legacyBld('B', uniformMm)], {
    ...common, roofs: [liftedRoof('B', uniformMm)],
  });
  return { legacy, perRoof };
}

describe('R-1f-2: 全周屋根(lift 相当)は従来経路と数値一致', () => {
  it('棟マーカー方式(樋面の切妻投影・出幅600)', () => {
    const markers: HeightMarker[] = [
      { id: 'n0', buildingId: 'B', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'n1', buildingId: 'B', edgeIndex: 0, t: 1, heightMm: 5000 },
      { id: 'sm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 7000 },
    ];
    const { legacy, perRoof } = bothPaths(markers, 'north');
    expect(legacy.roofBands.length).toBe(1);
    expect(stripRoofId(perRoof.roofBands)).toEqual(legacy.roofBands);
    expect(perRoof.roofBands[0].filledToRidge).toBe(true);
    expect(perRoof.roofBands[0].ridgeMm).toBe(7000);
    expect(perRoof.roofBands[0].profile.every((p) => p.mm === 4556)).toBe(true); // R-1c 軒先下がり
    expect(perRoof.ridgeMaxMm).toBe(legacy.ridgeMaxMm);
  });

  it('棟ライン方式(寄棟の上側包絡線・baseMm あり)', () => {
    const markers: HeightMarker[] = [{ id: 'e', buildingId: 'B', edgeIndex: 0, t: 0.5, heightMm: 5000 }];
    const ridgeLines: RidgeLine[] = [
      { id: 'r', buildingId: 'B', p1: { x: 90, y: 270 }, p2: { x: 270, y: 270 }, heightMm: 7000 },
    ];
    const { legacy, perRoof } = bothPaths(markers, 'north', { ridgeLines });
    expect(stripRoofId(perRoof.roofBands)).toEqual(legacy.roofBands);
    expect(perRoof.roofBands[0].baseMm).toBe(4556);
    expect(perRoof.roofBands[0].profile).toEqual([
      { x: -420, mm: 4556 }, { x: -360, mm: 5534 }, { x: -270, mm: 7000 },
      { x: -90, mm: 7000 }, { x: 0, mm: 5534 }, { x: 60, mm: 4556 },
    ]);
  });

  it('妻面のけらば(への字マーカー・線バンド)', () => {
    const markers: HeightMarker[] = [
      { id: 'c0', buildingId: 'B', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'cm', buildingId: 'B', edgeIndex: 0, t: 0.5, heightMm: 7000 },
      { id: 'c1', buildingId: 'B', edgeIndex: 0, t: 1, heightMm: 5000 },
    ];
    const { legacy, perRoof } = bothPaths(markers, 'north');
    expect(stripRoofId(perRoof.roofBands)).toEqual(legacy.roofBands);
    expect(perRoof.roofBands[0].filledToRidge).toBe(false);
    expect(perRoof.roofBands[0].profile[0]).toEqual({ x: -420, mm: 4333 });
  });

  it('マーカー無し + 既定高さ(フラット軒バンド)', () => {
    const { legacy, perRoof } = bothPaths([], 'north', { defaultHeightMm: 5000 });
    expect(legacy.roofBands.length).toBe(1);
    expect(stripRoofId(perRoof.roofBands)).toEqual(legacy.roofBands);
    expect(perRoof.roofBands[0].ridgeMm).toBe(5000);
  });

  it('出幅なし・棟なし → 両経路ともバンドなし', () => {
    const { legacy, perRoof } = bothPaths([], 'north', { uniformMm: 0, defaultHeightMm: 5000 });
    expect(legacy.roofBands).toEqual([]);
    expect(perRoof.roofBands).toEqual([]);
  });

  it('4 面すべてで一致する(妻・樋の両方)', () => {
    const markers: HeightMarker[] = [
      { id: 'n0', buildingId: 'B', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'n1', buildingId: 'B', edgeIndex: 0, t: 1, heightMm: 5000 },
      { id: 'sm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 7000 },
    ];
    for (const face of ['north', 'south', 'east', 'west'] as const) {
      const { legacy, perRoof } = bothPaths(markers, face);
      expect(stripRoofId(perRoof.roofBands)).toEqual(legacy.roofBands);
    }
  });
});

describe('R-1f-2: roofId と経路の切り分け', () => {
  const markers: HeightMarker[] = [{ id: 'e', buildingId: 'B', edgeIndex: 0, t: 0.5, heightMm: 5000 }];

  it('roofs[] 由来のバンドには roofId が入る', () => {
    const fe = buildFaceElevation([], [legacyBld('B')], { markers, face: 'north', roofs: [liftedRoof('B')] });
    expect(fe.roofBands[0].roofId).toBe('roof-lift-B');
  });

  it('旧データ(roofs[] 無し)のバンドは roofId undefined', () => {
    const fe = buildFaceElevation([], [legacyBld('B')], { markers, face: 'north' });
    expect(fe.roofBands[0].roofId).toBeUndefined();
  });

  it('他建物の屋根しか無ければ従来経路（roofId undefined）', () => {
    const fe = buildFaceElevation([], [legacyBld('B')], {
      markers, face: 'north', roofs: [liftedRoof('OTHER')],
    });
    expect(fe.roofBands.length).toBe(1);
    expect(fe.roofBands[0].roofId).toBeUndefined();
  });
});
