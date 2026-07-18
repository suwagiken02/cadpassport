import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point, Roof } from '@/types';
import { edgeOnWall, roofEdgeToBuildingEdge, roofPolygonOffsetsGrid, buildingEdgeOverhangsFromRoofs, getRoofPolygon, buildingForRoofPolygon } from '../roofRegion';

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

describe('roofPolygonOffsetsGrid（壁重なり辺だけ出幅）', () => {
  it('全周屋根は全辺に出幅', () => {
    expect(roofPolygonOffsetsGrid(RECT, roof(P, 600))).toEqual([60, 60, 60, 60]);
  });
  it('三角屋根は上辺のみ出幅、内部2辺は0', () => {
    const tri = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 180, y: 270 }];
    expect(roofPolygonOffsetsGrid(RECT, roof(tri, 1000))).toEqual([100, 0, 0]);
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
