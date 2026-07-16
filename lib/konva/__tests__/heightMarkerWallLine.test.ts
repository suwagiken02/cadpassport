import { describe, it, expect } from 'vitest';
import type { BuildingShape, RoofConfig } from '@/types';
import { getOutlinePolygon, findClosestOutlineEdge, projectPointToOutline } from '../heightMarkerUtils';

// ============================================================
// R-1b: 高さマーカーは屋根破線ではなく壁外周線 (building.points) 基準になる。
// 屋根+出幅ありでも配置・射影(=ドラッグ)・描画の基準が壁線であることを固定する。
// ============================================================

// 矩形 (0,0)-(360,0)-(360,240)-(0,240)。出幅 600mm(=60grid)の寄棟屋根つき。
const roof: RoofConfig = {
  roofType: 'yosemune', uniformMm: 600,
  northMm: null, southMm: null, eastMm: null, westMm: null,
};
const building: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000', roof,
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 240 }, { x: 0, y: 240 }],
};

describe('getOutlinePolygon (R-1b: 常に壁線)', () => {
  it('屋根+出幅ありでも building.points をそのまま返す(屋根オフセットに膨らまない)', () => {
    expect(getOutlinePolygon(building)).toEqual(building.points);
  });

  it('屋根なしでも building.points', () => {
    const noRoof: BuildingShape = { ...building, roof: undefined };
    expect(getOutlinePolygon(noRoof)).toEqual(noRoof.points);
  });
});

describe('findClosestOutlineEdge (R-1b: 壁線にスナップ)', () => {
  it('壁の上辺(y=0)近くのクリックは壁 edge0 を返す', () => {
    // クリック (180,-5): 壁上辺 y=0 まで距離5 → edge0・t=0.5。旧仕様の屋根破線 y=-60 なら距離55。
    const hit = findClosestOutlineEdge({ x: 180, y: -5 }, [building], 20);
    expect(hit).not.toBeNull();
    expect(hit!.buildingId).toBe('B');
    expect(hit!.edgeIndex).toBe(0);
    expect(hit!.t).toBeCloseTo(0.5, 5);
  });

  it('旧・屋根破線位置(y=-60)は壁(閾値20)から外れてスナップしない', () => {
    // 壁線基準なので、屋根破線があった y=-60 のクリックは壁上辺から距離60 > 20 で null。
    expect(findClosestOutlineEdge({ x: 180, y: -60 }, [building], 20)).toBeNull();
  });
});

describe('projectPointToOutline (R-1b: ドラッグ射影も壁線)', () => {
  it('任意点は壁辺へ射影される(y=0 上辺へ)', () => {
    const proj = projectPointToOutline({ x: 200, y: -30 }, building);
    expect(proj.edgeIndex).toBe(0);      // 壁上辺
    expect(proj.t).toBeCloseTo(200 / 360, 5);
  });
});
