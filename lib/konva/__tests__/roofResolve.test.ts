import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point, Roof } from '@/types';
import { resolveBuildingOverhangsGrid, liftLegacyRoof } from '../roofResolve';

// RECT: e0=上辺, e1=右辺, e2=下辺, e3=左辺。yosemune uniform 600mm → 60grid。
const P: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const RECT: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000', points: P,
  roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null, roofShape: 'hip' },
};
const bare = (): BuildingShape => ({ ...RECT, roof: undefined });

describe('liftLegacyRoof (R-1e-fix7)', () => {
  it('building.roof を建物外周 polygon の全周屋根へ lift', () => {
    const roof = liftLegacyRoof(RECT, [])!;
    expect(roof.buildingId).toBe('B');
    expect(roof.polygon).toEqual(P);        // 建物外周
    expect(roof.roofShape).toBe('hip');     // 継承
    expect(roof.uniformMm).toBe(600);
  });

  it('roof も roofOverhangs も無い建物は null', () => {
    expect(liftLegacyRoof(bare(), [])).toBeNull();
  });

  it('roofOverhangs[](旧式)を uniformMm に畳み込む（最大出幅）', () => {
    const roof = liftLegacyRoof(bare(), [{ id: 'o', buildingId: 'B', faceIndex: 0, overhangMm: 500 }])!;
    expect(roof.uniformMm).toBe(500);
    expect(roof.polygon).toEqual(P);
  });
});

// R-1g: 旧 building.roof / roofOverhangs[] の直読みフォールバックは撤去。
//   互換は読み込み時の lift 一点に集約したので、消費側は roofs[] だけを見る。
describe('resolveBuildingOverhangsGrid (R-1g: roofs[] のみ)', () => {
  it('roofs 無し → 出幅なし（旧 building.roof は見ない）', () => {
    expect(resolveBuildingOverhangsGrid(RECT, [])).toEqual([0, 0, 0, 0]);
    expect(resolveBuildingOverhangsGrid(RECT, undefined)).toEqual([0, 0, 0, 0]);
  });

  it('旧データも lift を通せば従来どおりの出幅になる（互換の唯一点）', () => {
    const roof = liftLegacyRoof(RECT, [])!;
    expect(resolveBuildingOverhangsGrid(RECT, [roof])).toEqual([60, 60, 60, 60]);
  });

  it('旧 roofOverhangs[] だけの建物も lift 経由で出幅が出る', () => {
    const legacyOnly: BuildingShape = { id: 'B', type: 'polygon', fill: '#000', points: P };
    const roof = liftLegacyRoof(legacyOnly, [{ id: 'ro', buildingId: 'B', faceIndex: 0, overhangMm: 900 }])!;
    expect(resolveBuildingOverhangsGrid(legacyOnly, [roof])).toEqual([90, 90, 90, 90]);
  });

  it('壁重なり辺だけ出幅（三角の屋根は上辺のみ壁と重なる）', () => {
    // polygon = 上辺(e0)＋建物内部を横切る2辺。壁と重なるのは e0 のみ。
    const roof: Roof = { id: 'r', buildingId: 'B', polygon: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 180, y: 270 }], roofShape: 'gable', uniformMm: 1000 };
    expect(resolveBuildingOverhangsGrid(RECT, [roof])).toEqual([100, 0, 0, 0]);
  });

  it('複数屋根は建物辺ごとに max で合成', () => {
    const a: Roof = { id: 'a', buildingId: 'B', polygon: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 180, y: 270 }], roofShape: 'gable', uniformMm: 600 }; // e0=60
    const b: Roof = { id: 'b', buildingId: 'B', polygon: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 180, y: 270 }], roofShape: 'shed', uniformMm: 1000 }; // e0,e1=100
    expect(resolveBuildingOverhangsGrid(RECT, [a, b])).toEqual([100, 100, 0, 0]);
  });

  it('他建物の屋根は無視する', () => {
    const other: Roof = { id: 'x', buildingId: 'OTHER', polygon: P, roofShape: 'gable', uniformMm: 600 };
    expect(resolveBuildingOverhangsGrid(RECT, [other])).toEqual([0, 0, 0, 0]);
  });
});
