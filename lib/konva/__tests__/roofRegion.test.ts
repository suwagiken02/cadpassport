import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point, Roof } from '@/types';
import { edgeOnWall, roofEdgeToBuildingEdge, roofPolygonOffsetsGrid, roofEdgeOverhangsMm, buildingEdgeOverhangsFromRoofs, getRoofPolygon, buildingForRoofPolygon } from '../roofRegion';

// RECT: e0=上辺(0,0)-(360,0), e1=右(360,0)-(360,540), e2=下(360,540)-(0,540), e3=左(0,540)-(0,0)。
const P: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const RECT: BuildingShape = { id: 'B', type: 'polygon', fill: '#000', points: P };
const roof = (polygon: Point[], uniformMm = 600): Roof => ({ id: 'r', buildingId: 'B', polygon, roofShape: 'gable', uniformMm });

describe('edgeOnWall / roofEdgeToBuildingEdge (R-1e-fix7)', () => {
  it('上辺に沿う屋根辺は壁上（辺0）', () => {
    expect(roofEdgeToBuildingEdge({ x: 0, y: 0 }, { x: 360, y: 0 }, P)).toBe(0);
    expect(edgeOnWall({ x: 0, y: 0 }, { x: 360, y: 0 }, P)).toBe(true);
  });
  it('上辺の一部（途中→途中）も壁上（辺0）', () => {
    expect(roofEdgeToBuildingEdge({ x: 90, y: 0 }, { x: 270, y: 0 }, P)).toBe(0);
  });
  it('建物内部を横切る辺は壁上でない', () => {
    expect(edgeOnWall({ x: 0, y: 0 }, { x: 180, y: 270 }, P)).toBe(false);
    expect(roofEdgeToBuildingEdge({ x: 180, y: 0 }, { x: 180, y: 540 }, P)).toBe(-1);
  });
});

// R-1j: 「壁重なり辺だけ出幅・内部辺は自動 0」の判定は撤廃（鮎澤氏指示）。
//   屋根 polygon の全辺がユーザー設定の出幅対象で、0 にしたい辺はユーザーが 0 を入力する。
describe('roofPolygonOffsetsGrid（全辺がユーザー設定の出幅・R-1j）', () => {
  it('全周屋根は全辺に出幅', () => {
    expect(roofPolygonOffsetsGrid(RECT, roof(P, 600))).toEqual([60, 60, 60, 60]);
  });
  it('三角屋根も内部辺を含む全辺に出幅（旧仕様は [100,0,0] と自動 0 にしていた）', () => {
    const tri = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 180, y: 270 }];
    expect(roofPolygonOffsetsGrid(RECT, roof(tri, 1000))).toEqual([100, 100, 100]);
  });
  it('edgeOverhangsMm が uniformMm より優先（辺ごとに 0 も指定できる）', () => {
    const tri = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 180, y: 270 }];
    const r = { ...roof(tri, 1000), edgeOverhangsMm: { 1: 0, 2: 500 } };
    expect(roofPolygonOffsetsGrid(RECT, r)).toEqual([100, 0, 50]);
  });
});

describe('roofEdgeOverhangsMm（辺別出幅の解決・R-1j）', () => {
  it('個別指定なしは全辺 uniformMm', () => {
    expect(roofEdgeOverhangsMm(roof(P, 600), 4)).toEqual([600, 600, 600, 600]);
  });
  it('混在: 指定辺は個別値、未指定辺は uniformMm', () => {
    const r = { ...roof(P, 600), edgeOverhangsMm: { 0: 900, 2: 0 } };
    expect(roofEdgeOverhangsMm(r, 4)).toEqual([900, 600, 0, 600]);
  });
  it('負値は 0 に丸める', () => {
    const r = { ...roof(P, 600), edgeOverhangsMm: { 1: -100 } };
    expect(roofEdgeOverhangsMm(r, 2)).toEqual([600, 0]);
  });
});

describe('buildingEdgeOverhangsFromRoofs', () => {
  it('複数屋根の壁重なり辺を建物辺ごとに max', () => {
    const a = roof([{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 180, y: 270 }], 600); // e0=60
    const b = { ...roof([{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 180, y: 270 }], 1000), id: 'b' }; // e0,e1=100
    expect(buildingEdgeOverhangsFromRoofs(RECT, [a, b])).toEqual([100, 100, 0, 0]);
  });
});

describe('buildingForRoofPolygon（領域が乗る建物・R-1e-fix7b）', () => {
  it('重心を含む建物 id を返す', () => {
    const tri = [{ x: 10, y: 10 }, { x: 350, y: 10 }, { x: 180, y: 300 }];
    expect(buildingForRoofPolygon(tri, [RECT])).toBe('B');
  });
  it('どの建物にも乗らなければ null', () => {
    const far = [{ x: 1000, y: 1000 }, { x: 1100, y: 1000 }, { x: 1050, y: 1100 }];
    expect(buildingForRoofPolygon(far, [RECT])).toBeNull();
  });
});

describe('getRoofPolygon（互換）', () => {
  it('polygon 未設定は建物外周', () => {
    const r: Roof = { id: 'r', buildingId: 'B', roofShape: 'gable', uniformMm: 600 };
    expect(getRoofPolygon(RECT, r)).toEqual(P);
  });
});
