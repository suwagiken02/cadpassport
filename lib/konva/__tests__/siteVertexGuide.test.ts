// ============================================================
// S-5: 敷地の頂点を動かしている間の距離ガイド。
//
// S-4 で形は直せるようになったが、建物との距離が目分量になる。
// ドラッグ中だけ「いちばん近い建物の角までの X / Y 距離」を出す。
// ここは pure なので、最寄りの選び方と距離の値を固定できる。
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildingCornersGrid, nearestBuildingCornerGuide } from '../siteVertexGuide';
import { GRID_UNIT_MM } from '../gridUtils';
import type { Point } from '@/types';

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

// ============================================================
describe('建物の角を集める', () => {
  it('全棟の全頂点が並ぶ', () => {
    const corners = buildingCornersGrid([
      { points: rect(0, 0, 100, 80) },
      { points: rect(500, 500, 50, 50) },
    ]);
    expect(corners).toHaveLength(8);
    expect(corners[0]).toEqual({ x: 0, y: 0 });
    expect(corners[4]).toEqual({ x: 500, y: 500 });
  });

  it('建物が無ければ空', () => {
    expect(buildingCornersGrid([])).toEqual([]);
  });

  it('元の配列を書き換えない（座標をコピーする）', () => {
    const src = [{ points: rect(0, 0, 10, 10) }];
    const corners = buildingCornersGrid(src);
    corners[0].x = 999;
    expect(src[0].points[0].x).toBe(0);
  });
});

// ============================================================
describe('いちばん近い角と、X / Y の距離', () => {
  const corners = buildingCornersGrid([{ points: rect(0, 0, 100, 80) }]);

  it('X / Y の距離が mm で出る', () => {
    // (0,0) の角から右へ 30 グリッド・下へ 20 グリッド
    const g = nearestBuildingCornerGuide({ x: -30, y: -20 }, corners)!;
    expect(g.corner).toEqual({ x: 0, y: 0 });
    expect(g.dxMm).toBe(30 * GRID_UNIT_MM);
    expect(g.dyMm).toBe(20 * GRID_UNIT_MM);
  });

  it('距離は絶対値（どちら側にいても正の数）', () => {
    for (const p of [{ x: -10, y: -10 }, { x: 10, y: 10 }]) {
      const g = nearestBuildingCornerGuide(p, corners)!;
      expect(g.dxMm).toBe(100);
      expect(g.dyMm).toBe(100);
    }
  });

  it('近い角が変われば相手も変わる', () => {
    expect(nearestBuildingCornerGuide({ x: -5, y: -5 }, corners)!.corner).toEqual({ x: 0, y: 0 });
    expect(nearestBuildingCornerGuide({ x: 105, y: -5 }, corners)!.corner).toEqual({ x: 100, y: 0 });
    expect(nearestBuildingCornerGuide({ x: 105, y: 85 }, corners)!.corner).toEqual({ x: 100, y: 80 });
    expect(nearestBuildingCornerGuide({ x: -5, y: 85 }, corners)!.corner).toEqual({ x: 0, y: 80 });
  });

  it('複数棟でも、いちばん近い棟の角を選ぶ', () => {
    const many = buildingCornersGrid([
      { points: rect(0, 0, 100, 80) },
      { points: rect(1000, 0, 100, 80) },
    ]);
    expect(nearestBuildingCornerGuide({ x: 990, y: 5 }, many)!.corner).toEqual({ x: 1000, y: 0 });
  });

  it('角にぴったり重なれば距離は 0（S-4 の吸着と同じ答え）', () => {
    const g = nearestBuildingCornerGuide({ x: 100, y: 80 }, corners)!;
    expect(g.corner).toEqual({ x: 100, y: 80 });
    expect(g.dxMm).toBe(0);
    expect(g.dyMm).toBe(0);
  });

  it('真横に並べば Y は 0、真上に並べば X は 0', () => {
    expect(nearestBuildingCornerGuide({ x: -50, y: 0 }, corners)!).toMatchObject({ dxMm: 500, dyMm: 0 });
    expect(nearestBuildingCornerGuide({ x: 0, y: -50 }, corners)!).toMatchObject({ dxMm: 0, dyMm: 500 });
  });

  it('mm は整数に丸める（小数の座標でも表示が崩れない）', () => {
    const g = nearestBuildingCornerGuide({ x: -3.14159, y: -2.71828 }, corners)!;
    expect(Number.isInteger(g.dxMm)).toBe(true);
    expect(Number.isInteger(g.dyMm)).toBe(true);
    expect(g.dxMm).toBe(31);
    expect(g.dyMm).toBe(27);
  });

  it('建物が無ければ null（落ちない・何も出さない）', () => {
    expect(nearestBuildingCornerGuide({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('同じ距離の角が複数あっても答えが揺れない（先に見つかった方）', () => {
    const sym = [{ x: -10, y: 0 }, { x: 10, y: 0 }];
    for (let i = 0; i < 5; i++) {
      expect(nearestBuildingCornerGuide({ x: 0, y: 0 }, sym)!.corner).toEqual({ x: -10, y: 0 });
    }
  });

  it('斜めの位置でも直線距離で選ぶ（X だけ・Y だけで選ばない）', () => {
    // (0,0) は X が近いが、(100,80) の方が直線距離では近い位置
    const p = { x: 95, y: 78 };
    expect(nearestBuildingCornerGuide(p, corners)!.corner).toEqual({ x: 100, y: 80 });
  });
});
