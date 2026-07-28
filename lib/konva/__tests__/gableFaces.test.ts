import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point, RidgeLine, Roof } from '@/types';
import {
  detectGableFaces, detectGableFacesByBuilding, gableFacesByRidge, gableFacesByWallShape,
  isRectangularOutline,
} from '../gableFaces';

// ============================================================
// M-1b: 妻面判定。妻割を当てる面だけを特定する。
// 矩形 (0,0)-(360,0)-(360,540)-(0,540): 辺0=北 / 辺1=東 / 辺2=南 / 辺3=西
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const BLD: BuildingShape = { id: 'B', type: 'polygon', points: RECT, fill: '#000' };

/** 南北が妻（南辺の中央が高いへの字）。 */
const GABLE_NS: HeightMarker[] = [
  { id: 's0', buildingId: 'B', edgeIndex: 2, t: 0, heightMm: 5000 },
  { id: 'sm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 7000 },
  { id: 's1', buildingId: 'B', edgeIndex: 2, t: 1, heightMm: 5000 },
];
/** 全周フラット（軒高一定）。 */
const FLAT: HeightMarker[] = [
  { id: 'a', buildingId: 'B', edgeIndex: 0, t: 0.5, heightMm: 5000 },
  { id: 'b', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 5000 },
];

const gableRoof = (): Roof => ({ id: 'r', buildingId: 'B', polygon: RECT, roofShape: 'gable', uniformMm: 600 });
const hipRoof = (): Roof => ({ id: 'r', buildingId: 'B', polygon: RECT, roofShape: 'hip', uniformMm: 600 });
/** 東西方向の棟（x 軸に平行）→ 南北面が樋面、東西面が妻。 */
const RIDGE_EW: RidgeLine = { id: 'ridge', buildingId: 'B', p1: { x: 90, y: 270 }, p2: { x: 270, y: 270 }, heightMm: 7000 };

describe('isRectangularOutline', () => {
  it('4辺・軸並行の矩形だけ true', () => {
    expect(isRectangularOutline(BLD)).toBe(true);
    const L: Point[] = [
      { x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 300 },
      { x: 180, y: 300 }, { x: 180, y: 540 }, { x: 0, y: 540 },
    ];
    expect(isRectangularOutline({ ...BLD, points: L })).toBe(false);
  });
  it('斜め辺は false', () => {
    const skew: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 20 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
    expect(isRectangularOutline({ ...BLD, points: skew })).toBe(false);
  });
});

describe('gableFacesByWallShape（壁の形＝への字）', () => {
  it('南辺中央が高ければ南が妻面', () => {
    expect(Array.from(gableFacesByWallShape(BLD, GABLE_NS))).toEqual(['south']);
  });
  it('全周フラットなら妻面なし', () => {
    expect(gableFacesByWallShape(BLD, FLAT).size).toBe(0);
  });
  it('マーカー1個以下は判定しない（面内の変化が作れない）', () => {
    expect(gableFacesByWallShape(BLD, [FLAT[0]]).size).toBe(0);
    expect(gableFacesByWallShape(BLD, []).size).toBe(0);
  });
  it('わずかな差(50mm以下)は立ち上がりとみなさない', () => {
    const almostFlat: HeightMarker[] = [
      { id: 'x0', buildingId: 'B', edgeIndex: 2, t: 0, heightMm: 5000 },
      { id: 'xm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 5030 },
      { id: 'x1', buildingId: 'B', edgeIndex: 2, t: 1, heightMm: 5000 },
    ];
    expect(gableFacesByWallShape(BLD, almostFlat).size).toBe(0);
  });
  it('別建物のマーカーは無視', () => {
    const other = GABLE_NS.map((m) => ({ ...m, buildingId: 'OTHER' }));
    expect(gableFacesByWallShape(BLD, other).size).toBe(0);
  });
});

describe('gableFacesByRidge（棟の向き）', () => {
  it('東西方向の棟なら東西面が妻（棟が点に潰れる面）', () => {
    const faces = gableFacesByRidge(BLD, [gableRoof()], [RIDGE_EW]);
    expect(Array.from(faces).sort()).toEqual(['east', 'west']);
  });
  it('寄棟(hip)は妻面を持たない', () => {
    expect(gableFacesByRidge(BLD, [hipRoof()], [RIDGE_EW]).size).toBe(0);
  });
  it('棟ラインが無ければ判定しない', () => {
    expect(gableFacesByRidge(BLD, [gableRoof()], []).size).toBe(0);
  });
});

describe('detectGableFaces（統合）', () => {
  it('壁の形だけで判定できる（屋根オブジェクト不要）', () => {
    const d = detectGableFaces(BLD, GABLE_NS);
    expect(Array.from(d.faces)).toEqual(['south']);
    expect(d.reason).toBe('wall-shape');
  });

  it('棟だけでも判定できる（壁フラットの切妻）', () => {
    const d = detectGableFaces(BLD, FLAT, [gableRoof()], [RIDGE_EW]);
    expect(Array.from(d.faces).sort()).toEqual(['east', 'west']);
    expect(d.reason).toBe('ridge');
  });

  it('両方あれば和集合（reason=both）', () => {
    const d = detectGableFaces(BLD, GABLE_NS, [gableRoof()], [RIDGE_EW]);
    expect(Array.from(d.faces).sort()).toEqual(['east', 'south', 'west']);
    expect(d.reason).toBe('both');
  });

  it('フラット・棟なしは妻面なし＝全面通常割り', () => {
    const d = detectGableFaces(BLD, FLAT);
    expect(d.faces.size).toBe(0);
    expect(d.reason).toBe('none');
  });

  it('入隅のある形(L字)は対象外', () => {
    const L: Point[] = [
      { x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 300 },
      { x: 180, y: 300 }, { x: 180, y: 540 }, { x: 0, y: 540 },
    ];
    const lMarkers = GABLE_NS.map((m) => ({ ...m, edgeIndex: 4 })); // L字の南辺
    const d = detectGableFaces({ ...BLD, points: L }, lMarkers);
    expect(d.faces.size).toBe(0);
    expect(d.reason).toBe('none');
  });
});

describe('detectGableFacesByBuilding', () => {
  it('妻面を持つ建物だけが map に入る', () => {
    const b2: BuildingShape = { ...BLD, id: 'B2' };
    const map = detectGableFacesByBuilding([BLD, b2], GABLE_NS);
    expect(Array.from(map.keys())).toEqual(['B']);
    expect(Array.from(map.get('B')!)).toEqual(['south']);
  });
  it('該当なしは空 map', () => {
    expect(detectGableFacesByBuilding([BLD], FLAT).size).toBe(0);
  });
});
