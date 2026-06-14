import { describe, it, expect } from 'vitest';
import { getStartVertexPoint, resolveScaffoldStartOnNormalized } from '../labelUtils';
import { getBuildingEdgesClockwise } from '../autoLayoutUtils';
import type { BuildingShape, Point } from '@/types';

// ============================================================
// ⭐(足場開始) マーカー表示バグ:
//   startVertexIndex は getBuildingEdgesClockwise(CW辺order) の index 規約。
//   表示消費側が building.points[idx](生polygon順) で読むと、CCW 格納の建物で
//   別頂点(SE 等)に⭐を誤描画する。表示も CW辺order 読みに統一する。
// ============================================================

const coordEq = (a: Point, b: Point, eps = 0.001): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

const mk = (points: Point[]): BuildingShape => ({
  id: 't', type: 'polygon', points, fill: '#000',
});

// 実データの 2F: CCW 格納。NE=(750,-150) NW=(450,-150) SW=(450,250) SE=(750,250)
const NE: Point = { x: 750, y: -150 };
const NW: Point = { x: 450, y: -150 };
const SW: Point = { x: 450, y: 250 };
const SE: Point = { x: 750, y: 250 };
const b2CCW = mk([NE, NW, SW, SE]);

describe('getStartVertexPoint — ⭐表示を CW辺order 読みに統一', () => {
  it('(a) CCW格納2F + startVertexIndex=3 は NE=(750,-150) を返す(生points[3]=SE ではない)', () => {
    // 前提確認: 生points[3] は SE、CW辺[3].p1 は NE
    expect(coordEq(b2CCW.points[3], SE)).toBe(true);
    expect(coordEq(getBuildingEdgesClockwise(b2CCW)[3].p1, NE)).toBe(true);

    const pt = getStartVertexPoint(b2CCW, 3);
    expect(pt).not.toBeNull();
    expect(coordEq(pt!, NE)).toBe(true);   // 旧(生points)では SE を返して失敗
    expect(coordEq(pt!, SE)).toBe(false);
  });

  it('(b) 回帰: CW格納の矩形は 表示起点 == CW辺[idx].p1 == 割付起点(両windingで一致)', () => {
    // CW 格納: NW->NE->SE->SW (画面y下向きで時計回り)
    const nw: Point = { x: 0, y: 0 }, ne: Point = { x: 60, y: 0 };
    const se: Point = { x: 60, y: 40 }, sw: Point = { x: 0, y: 40 };
    const bCW = mk([nw, ne, se, sw]);
    const cw = getBuildingEdgesClockwise(bCW);
    for (let idx = 0; idx < 4; idx++) {
      const pt = getStartVertexPoint(bCW, idx);
      expect(pt).not.toBeNull();
      expect(coordEq(pt!, cw[idx].p1)).toBe(true);
    }
  });

  it('(c) 不変条件: 任意windingで getStartVertexPoint(b,idx) == resolveScaffoldStartOnNormalized(b,b,idx).point', () => {
    for (const b of [b2CCW, mk([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }])]) {
      const n = b.points.length;
      for (let idx = 0; idx < n; idx++) {
        const disp = getStartVertexPoint(b, idx);
        const calc = resolveScaffoldStartOnNormalized(b, b, idx).point;
        expect(disp).not.toBeNull();
        expect(coordEq(disp!, calc)).toBe(true);
      }
    }
  });
});
