import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point, RidgeLine, Roof } from '@/types';
import {
  polygonEdgeFace,
  polygonArea,
  variableCoord,
  mergeIntervals,
  roofWallCoverages,
  roofFaceWallIntervals,
  markerOnRoof,
  roofMarkerMaxMm,
  roofEaveMm,
  roofExtXRange,
  roofFaceOverhangGrid,
  roofFrontness,
  assignRidgeLinesToRoofs,
  clipSegmentsToIntervals,
} from '../roofBandSource';

// ============================================================
// R-1f-1: 屋根単位バンドの素材（pure）。
// 建物 RECT(360×540) に 大屋根(北 2/3・y0..360) と 下屋(南 1/3・y360..540) の 2 屋根。
//   建物の辺: 0=北(y=0) / 1=東(x=360) / 2=南(y=540) / 3=西(x=0)
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const BLD: BuildingShape = { id: 'B', type: 'polygon', points: RECT, fill: '#000', floor: 1 };

const MAIN: Roof = {
  id: 'roof-main', buildingId: 'B', roofShape: 'gable', uniformMm: 600,
  polygon: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 360 }, { x: 0, y: 360 }],
};
const LOWER: Roof = {
  id: 'roof-lower', buildingId: 'B', roofShape: 'shed', uniformMm: 600,
  polygon: [{ x: 0, y: 360 }, { x: 360, y: 360 }, { x: 360, y: 540 }, { x: 0, y: 540 }],
};

// 大屋根の壁(北・東前半・西後半)に軒5000、下屋の壁(南)に軒3000。
const MARKERS: HeightMarker[] = [
  { id: 'a', buildingId: 'B', edgeIndex: 3, t: 0.5, heightMm: 5000 },  // 西 y=270（大屋根側）
  { id: 'b', buildingId: 'B', edgeIndex: 1, t: 0.5, heightMm: 5000 },  // 東 y=270（大屋根側）
  { id: 'c', buildingId: 'B', edgeIndex: 2, t: 0.25, heightMm: 3000 }, // 南（下屋側）
  { id: 'd', buildingId: 'B', edgeIndex: 2, t: 0.75, heightMm: 3000 }, // 南（下屋側）
];

describe('R-1f-1: 面と軸の基本', () => {
  it('polygonEdgeFace: RECT の辺 0..3 が 北/東/南/西', () => {
    expect([0, 1, 2, 3].map((i) => polygonEdgeFace(RECT, i))).toEqual(['north', 'east', 'south', 'west']);
  });

  it('variableCoord: N/S 面は x、E/W 面は y', () => {
    const p = { x: 12, y: 34 };
    expect(variableCoord(p, 'north')).toBe(12);
    expect(variableCoord(p, 'south')).toBe(12);
    expect(variableCoord(p, 'east')).toBe(34);
    expect(variableCoord(p, 'west')).toBe(34);
  });

  it('polygonArea: 矩形の面積', () => {
    expect(polygonArea(RECT)).toBe(360 * 540);
    expect(polygonArea(MAIN.polygon!)).toBe(360 * 360);
  });

  it('mergeIntervals: 重なり・接触を統合し昇順・退化は捨てる', () => {
    expect(mergeIntervals([[10, 20], [15, 30], [50, 60], [5, 5]])).toEqual([[10, 30], [50, 60]]);
    expect(mergeIntervals([[30, 10]])).toEqual([[10, 30]]); // 逆順入力も正規化
  });
});

describe('R-1f-1: 屋根が覆う壁区間 roofWallCoverages', () => {
  it('大屋根: 北辺全部＋東辺前 2/3＋西辺後 2/3（内部の境界辺は含まない）', () => {
    const cov = roofWallCoverages(BLD, MAIN);
    expect(cov.length).toBe(3);
    const byEdge = new Map(cov.map((c) => [c.edgeIndex, c]));
    expect(byEdge.get(0)).toMatchObject({ t0: 0, t1: 1 });
    expect(byEdge.get(1)!.t0).toBeCloseTo(0, 9);
    expect(byEdge.get(1)!.t1).toBeCloseTo(2 / 3, 9);
    expect(byEdge.get(3)!.t0).toBeCloseTo(1 / 3, 9);
    expect(byEdge.get(3)!.t1).toBeCloseTo(1, 9);
    expect(byEdge.has(2)).toBe(false); // 南辺は下屋の担当
  });

  it('下屋: 南辺全部＋東辺後 1/3＋西辺前 1/3', () => {
    const cov = roofWallCoverages(BLD, LOWER);
    expect(cov.length).toBe(3);
    const byEdge = new Map(cov.map((c) => [c.edgeIndex, c]));
    expect(byEdge.get(2)).toMatchObject({ t0: 0, t1: 1 });
    expect(byEdge.get(1)!.t0).toBeCloseTo(2 / 3, 9);
    expect(byEdge.get(3)!.t1).toBeCloseTo(1 / 3, 9);
    expect(byEdge.has(0)).toBe(false); // 北辺は大屋根の担当
  });

  it('全周屋根(lift 相当・polygon=建物外周)は全辺を覆う', () => {
    const full: Roof = { id: 'r', buildingId: 'B', roofShape: 'hip', uniformMm: 600, polygon: RECT };
    const cov = roofWallCoverages(BLD, full);
    expect(cov.length).toBe(4);
    expect(cov.every((c) => c.t0 === 0 && c.t1 === 1)).toBe(true);
  });
});

describe('R-1f-1: 面別の壁区間 roofFaceWallIntervals', () => {
  it('北面: 大屋根は壁全幅[0,360]・下屋は空（北に壁を持たない）', () => {
    expect(roofFaceWallIntervals(BLD, MAIN, 'north')).toEqual([[0, 360]]);
    expect(roofFaceWallIntervals(BLD, LOWER, 'north')).toEqual([]);
  });

  it('南面: 下屋が壁全幅[0,360]・大屋根は空', () => {
    expect(roofFaceWallIntervals(BLD, LOWER, 'south')).toEqual([[0, 360]]);
    expect(roofFaceWallIntervals(BLD, MAIN, 'south')).toEqual([]);
  });

  it('東面: 変軸=y で大屋根[0,360]・下屋[360,540] に分かれる', () => {
    const main = roofFaceWallIntervals(BLD, MAIN, 'east');
    const lower = roofFaceWallIntervals(BLD, LOWER, 'east');
    expect(main.length).toBe(1);
    expect(main[0][0]).toBeCloseTo(0, 6);
    expect(main[0][1]).toBeCloseTo(360, 6);
    expect(lower[0][0]).toBeCloseTo(360, 6);
    expect(lower[0][1]).toBeCloseTo(540, 6);
  });
});

describe('R-1f-1: 屋根別の高さ', () => {
  const covMain = roofWallCoverages(BLD, MAIN);
  const covLower = roofWallCoverages(BLD, LOWER);

  it('markerOnRoof: 南マーカーは下屋のみ・西中央マーカーは大屋根のみ', () => {
    expect(markerOnRoof(covLower, MARKERS[2])).toBe(true);
    expect(markerOnRoof(covMain, MARKERS[2])).toBe(false);
    expect(markerOnRoof(covMain, MARKERS[0])).toBe(true);
    expect(markerOnRoof(covLower, MARKERS[0])).toBe(false);
  });

  it('roofMarkerMaxMm: 大屋根=5000・下屋=3000（大屋根の高さが下屋に漏れない）', () => {
    expect(roofMarkerMaxMm(BLD, covMain, MARKERS)).toBe(5000);
    expect(roofMarkerMaxMm(BLD, covLower, MARKERS)).toBe(3000);
  });

  it('roofEaveMm: 屋根ごとの軒高（水下基準）= 大屋根5000・下屋3000', () => {
    expect(roofEaveMm(BLD, covMain, MARKERS)).toBe(5000);
    expect(roofEaveMm(BLD, covLower, MARKERS)).toBe(3000);
  });

  it('roofEaveMm: マーカー 0 個 → null', () => {
    expect(roofEaveMm(BLD, covMain, [])).toBeNull();
    expect(roofMarkerMaxMm(BLD, covMain, [])).toBeNull();
  });

  it('別建物のマーカーは拾わない', () => {
    const other: HeightMarker[] = [{ id: 'x', buildingId: 'OTHER', edgeIndex: 0, t: 0.5, heightMm: 9000 }];
    expect(roofMarkerMaxMm(BLD, covMain, [...MARKERS, ...other])).toBe(5000);
  });
});

describe('R-1f-1: x 範囲・出幅・奥行き', () => {
  it('roofExtXRange(北面): 大屋根は壁±出幅[-60,420]（出幅600mm=60grid）', () => {
    expect(roofExtXRange(BLD, MAIN, 'north')).toEqual({ xStart: -60, xEnd: 420 });
  });

  it('roofExtXRange(東面): 変軸=y。大屋根は[-60,360]（北の軒だけ外へ出て境界辺は出ない）', () => {
    const r = roofExtXRange(BLD, MAIN, 'east')!;
    expect(r.xStart).toBeCloseTo(-60, 6);
    expect(r.xEnd).toBeCloseTo(360, 6);
    const l = roofExtXRange(BLD, LOWER, 'east')!;
    expect(l.xStart).toBeCloseTo(360, 6); // 境界辺(y=360)は出幅なし＝壁位置のまま
    expect(l.xEnd).toBeCloseTo(600, 6);   // 南の軒 540+60
  });

  it('roofExtXRange: 出幅 0 なら壁範囲と一致', () => {
    const flat: Roof = { ...MAIN, uniformMm: 0 };
    expect(roofExtXRange(BLD, flat, 'north')).toEqual({ xStart: 0, xEnd: 360 });
  });

  it('roofFaceOverhangGrid: 大屋根は北60・南0、下屋は南60・北0', () => {
    expect(roofFaceOverhangGrid(BLD, MAIN, 'north')).toBe(60);
    expect(roofFaceOverhangGrid(BLD, MAIN, 'south')).toBe(0);
    expect(roofFaceOverhangGrid(BLD, LOWER, 'south')).toBe(60);
    expect(roofFaceOverhangGrid(BLD, LOWER, 'north')).toBe(0);
  });

  it('roofFrontness: 南から見ると下屋が手前・北から見ると大屋根が手前', () => {
    expect(roofFrontness(BLD, LOWER, 'south')).toBeGreaterThan(roofFrontness(BLD, MAIN, 'south'));
    expect(roofFrontness(BLD, MAIN, 'north')).toBeGreaterThan(roofFrontness(BLD, LOWER, 'north'));
  });
});

describe('R-1f-1: 棟ラインの屋根への対応付け', () => {
  const rl = (id: string, p1: Point, p2: Point): RidgeLine => ({ id, buildingId: 'B', p1, p2, heightMm: 7000 });

  it('棟の中点が入る屋根へ割り当てる', () => {
    const inMain = rl('r1', { x: 90, y: 180 }, { x: 270, y: 180 });
    const inLower = rl('r2', { x: 90, y: 450 }, { x: 270, y: 450 });
    const map = assignRidgeLinesToRoofs([inMain, inLower], BLD, [MAIN, LOWER]);
    expect(map.get('roof-main')!.map((r) => r.id)).toEqual(['r1']);
    expect(map.get('roof-lower')!.map((r) => r.id)).toEqual(['r2']);
  });

  it('どの領域にも入らない棟は面積最大の屋根（大屋根）へ寄せる', () => {
    const outside = rl('r3', { x: 900, y: 900 }, { x: 1000, y: 900 });
    const map = assignRidgeLinesToRoofs([outside], BLD, [MAIN, LOWER]);
    expect(map.get('roof-main')!.map((r) => r.id)).toEqual(['r3']);
    expect(map.get('roof-lower')).toEqual([]);
  });

  it('入れ子の領域は面積最小の屋根が勝つ', () => {
    const outer: Roof = { id: 'outer', buildingId: 'B', roofShape: 'hip', uniformMm: 600, polygon: RECT };
    const inner: Roof = {
      id: 'inner', buildingId: 'B', roofShape: 'shed', uniformMm: 600,
      polygon: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }],
    };
    const map = assignRidgeLinesToRoofs([rl('r', { x: 140, y: 150 }, { x: 160, y: 150 })], BLD, [outer, inner]);
    expect(map.get('inner')!.length).toBe(1);
    expect(map.get('outer')).toEqual([]);
  });

  it('別建物の棟は割り当てない', () => {
    const foreign: RidgeLine = { id: 'f', buildingId: 'OTHER', p1: { x: 90, y: 180 }, p2: { x: 270, y: 180 }, heightMm: 7000 };
    const map = assignRidgeLinesToRoofs([foreign], BLD, [MAIN, LOWER]);
    expect(map.get('roof-main')).toEqual([]);
    expect(map.get('roof-lower')).toEqual([]);
  });
});

describe('R-1f-1: 軒プロファイルの切り出し clipSegmentsToIntervals', () => {
  const segs = [{ xStart: 0, xEnd: 360, heightStartMm: 5000, heightEndMm: 7000 }];

  it('区間で切り、切断点の高さを線形補間する', () => {
    expect(clipSegmentsToIntervals(segs, [[90, 270]])).toEqual([
      { xStart: 90, xEnd: 270, heightStartMm: 5500, heightEndMm: 6500 },
    ]);
  });

  it('全域を覆う区間なら元のまま', () => {
    expect(clipSegmentsToIntervals(segs, [[0, 360]])).toEqual(segs);
  });

  it('区間が空 → 空配列（その面に壁を持たない屋根）', () => {
    expect(clipSegmentsToIntervals(segs, [])).toEqual([]);
  });

  it('重ならない区間は落とす・複数区間は昇順で返る', () => {
    expect(clipSegmentsToIntervals(segs, [[400, 500]])).toEqual([]);
    const two = clipSegmentsToIntervals(segs, [[270, 360], [0, 90]]);
    expect(two.map((s) => s.xStart)).toEqual([0, 270]);
  });
});
