import { describe, it, expect } from 'vitest';
import type { BuildingShape, Roof } from '@/types';
import { resolveBuildingOverhangsGrid, roofToEdgeOverhangsGrid, liftLegacyRoof } from '../roofResolve';

// RECT: 4辺。yosemune uniform 600mm → 全辺 60grid。
const RECT: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000',
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }],
  roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null, roofShape: 'hip' },
};
const bare = (): BuildingShape => ({ ...RECT, roof: undefined });

describe('liftLegacyRoof (R-1d)', () => {
  it('building.roof を全周 Roof へ lift（出幅を忠実に mm で保持）', () => {
    const roof = liftLegacyRoof(RECT, [])!;
    expect(roof.buildingId).toBe('B');
    expect(roof.span?.full).toBe(true); // 全周屋根として lift
    expect(roof.roofShape).toBe('hip'); // building.roof.roofShape を継承
    expect(roof.edgeOverhangsMm).toEqual({ 0: 600, 1: 600, 2: 600, 3: 600 });
  });

  it('roof も roofOverhangs も無い建物は null', () => {
    expect(liftLegacyRoof(bare(), [])).toBeNull();
  });

  it('roofOverhangs[](旧式)を畳み込む', () => {
    const b = bare();
    const roof = liftLegacyRoof(b, [{ id: 'o', buildingId: 'B', faceIndex: 0, overhangMm: 500 }])!;
    expect(roof.edgeOverhangsMm?.[0]).toBe(500);
    expect(roof.edgeOverhangsMm?.[1]).toBe(0);
  });
});

describe('resolveBuildingOverhangsGrid (R-1d 互換レイヤー)', () => {
  it('roofs 無し → 旧 building.roof へフォールバック（従来と一致）', () => {
    expect(resolveBuildingOverhangsGrid(RECT, [], [])).toEqual([60, 60, 60, 60]);
    expect(resolveBuildingOverhangsGrid(RECT, undefined, [])).toEqual([60, 60, 60, 60]);
  });

  it('lift した Roof を渡すと旧経路と同値', () => {
    const roof = liftLegacyRoof(RECT, [])!;
    expect(resolveBuildingOverhangsGrid(RECT, [roof], [])).toEqual([60, 60, 60, 60]);
  });

  it('roofs[] があれば building.roof より優先（部分 edgeRange）', () => {
    const roof: Roof = { id: 'r', buildingId: 'B', edgeRange: [0], roofShape: 'gable', uniformMm: 1000 };
    // 辺0のみ 100grid、他は 0（building.roof の 600 は無視）。
    expect(resolveBuildingOverhangsGrid(RECT, [roof], [])).toEqual([100, 0, 0, 0]);
  });

  it('複数屋根は辺別 max で合成', () => {
    const big: Roof = { id: 'a', buildingId: 'B', edgeRange: [0], roofShape: 'gable', uniformMm: 600 };   // 60
    const shed: Roof = { id: 'b', buildingId: 'B', edgeRange: [0, 1], roofShape: 'shed', uniformMm: 1000 }; // 100
    expect(resolveBuildingOverhangsGrid(RECT, [big, shed], [])).toEqual([100, 100, 0, 0]);
  });

  it('roofToEdgeOverhangsGrid: 被覆辺は edgeOverhangsMm 優先・uniform 補完、範囲外は 0', () => {
    // span=辺0..辺1（連続）。辺0は edgeOverhangsMm 300、辺1は uniform 600、辺2/3 は範囲外=0。
    const roof: Roof = { id: 'r', buildingId: 'B', edgeRange: [0, 1], roofShape: 'gable', uniformMm: 600, edgeOverhangsMm: { 0: 300 } };
    expect(roofToEdgeOverhangsGrid(RECT, roof)).toEqual([30, 60, 0, 0]);
  });
});
