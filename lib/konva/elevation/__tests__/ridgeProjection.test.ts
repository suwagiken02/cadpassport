import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point, RidgeLine } from '@/types';
import { projectRidgeLinesToFace, generateCenterRidgeLine, computeRidgeGuides, snapRidgeInput } from '../ridgeProjection';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#eee', floor: 1 });
const ridge = (id: string, bid: string, p1: Point, p2: Point, h: number): RidgeLine =>
  ({ id, buildingId: bid, p1, p2, heightMm: h });

describe('projectRidgeLinesToFace: 棟ラインの面軸投影', () => {
  const b = bld('B');
  const horiz = ridge('r1', 'B', { x: 90, y: 270 }, { x: 270, y: 270 }, 7000); // 平面で横(x方向)
  const vert = ridge('r2', 'B', { x: 180, y: 90 }, { x: 180, y: 450 }, 7000);  // 平面で縦(y方向)

  it('北面(x軸): 面平行(横)の棟 → 区間[90,270]', () => {
    expect(projectRidgeLinesToFace([horiz], b, 'north')).toEqual([{ a: 90, b: 270, heightMm: 7000 }]);
  });

  it('北面(x軸): 面直交(縦)の棟 → 1点[180,180](妻側)', () => {
    expect(projectRidgeLinesToFace([vert], b, 'north')).toEqual([{ a: 180, b: 180, heightMm: 7000 }]);
  });

  it('東面(y軸): 面平行(縦)の棟 → 区間[90,450]', () => {
    expect(projectRidgeLinesToFace([vert], b, 'east')).toEqual([{ a: 90, b: 450, heightMm: 7000 }]);
  });

  it('東面(y軸): 面直交(横)の棟 → 1点[270,270](妻側)', () => {
    expect(projectRidgeLinesToFace([horiz], b, 'east')).toEqual([{ a: 270, b: 270, heightMm: 7000 }]);
  });

  it('斜めの棟ライン → 両端の射影(min/max)', () => {
    const diag = ridge('r3', 'B', { x: 60, y: 100 }, { x: 300, y: 400 }, 6800);
    expect(projectRidgeLinesToFace([diag], b, 'north')).toEqual([{ a: 60, b: 300, heightMm: 6800 }]);
    expect(projectRidgeLinesToFace([diag], b, 'south')).toEqual([{ a: 60, b: 300, heightMm: 6800 }]);
    expect(projectRidgeLinesToFace([diag], b, 'west')).toEqual([{ a: 100, b: 400, heightMm: 6800 }]);
  });

  it('別建物の棟ラインは除外', () => {
    const other = ridge('r4', 'OTHER', { x: 90, y: 270 }, { x: 270, y: 270 }, 7000);
    expect(projectRidgeLinesToFace([other], b, 'north')).toEqual([]);
  });

  it('複数棟ライン → 入力順で複数投影', () => {
    expect(projectRidgeLinesToFace([horiz, vert], b, 'north')).toEqual([
      { a: 90, b: 270, heightMm: 7000 },
      { a: 180, b: 180, heightMm: 7000 },
    ]);
  });

  it('heightMm は丸める', () => {
    const r = ridge('r5', 'B', { x: 90, y: 270 }, { x: 270, y: 270 }, 6999.6);
    expect(projectRidgeLinesToFace([r], b, 'north')[0].heightMm).toBe(7000);
  });
});

describe('generateCenterRidgeLine: 寄棟の中央棟線(E-3.12)', () => {
  it('横長矩形 → 水平棟(長さ=W−H・中央)', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }];
    expect(generateCenterRidgeLine(pts)).toEqual({ p1: { x: 100, y: 100 }, p2: { x: 300, y: 100 } });
  });

  it('縦長矩形 → 垂直棟(長さ=H−W・中央)', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }, { x: 0, y: 400 }];
    expect(generateCenterRidgeLine(pts)).toEqual({ p1: { x: 100, y: 100 }, p2: { x: 100, y: 300 } });
  });

  it('正方形 → p1==p2(中央1点・点潰れ)', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
    expect(generateCenterRidgeLine(pts)).toEqual({ p1: { x: 150, y: 150 }, p2: { x: 150, y: 150 } });
  });

  it('原点以外にオフセットした矩形も中央基準', () => {
    const pts: Point[] = [{ x: 100, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 250 }, { x: 100, y: 250 }];
    // W=400,H=200,cx=300,cy=150,half=100
    expect(generateCenterRidgeLine(pts)).toEqual({ p1: { x: 200, y: 150 }, p2: { x: 400, y: 150 } });
  });
});

describe('computeRidgeGuides: 中心ガイド＋隅棟(E-3.13)', () => {
  const HW: Point[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }]; // 横長

  it('横長: 中央棟線・短辺中央線(縦)・四隅→最寄り棟端', () => {
    const g = computeRidgeGuides(HW);
    expect(g.centerLine).toEqual({ p1: { x: 100, y: 100 }, p2: { x: 300, y: 100 } });
    expect(g.crossLine).toEqual({ p1: { x: 200, y: 0 }, p2: { x: 200, y: 200 } });
    expect(g.hipLines).toEqual([
      { p1: { x: 0, y: 0 }, p2: { x: 100, y: 100 } },
      { p1: { x: 400, y: 0 }, p2: { x: 300, y: 100 } },
      { p1: { x: 400, y: 200 }, p2: { x: 300, y: 100 } },
      { p1: { x: 0, y: 200 }, p2: { x: 100, y: 100 } },
    ]);
  });

  it('縦長: 中央棟線(縦)・短辺中央線(横)', () => {
    const VH: Point[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }, { x: 0, y: 400 }];
    const g = computeRidgeGuides(VH);
    expect(g.centerLine).toEqual({ p1: { x: 100, y: 100 }, p2: { x: 100, y: 300 } });
    expect(g.crossLine).toEqual({ p1: { x: 0, y: 200 }, p2: { x: 200, y: 200 } });
  });

  it('正方形: 棟は中心1点・隅棟は四隅→中心', () => {
    const SQ: Point[] = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
    const g = computeRidgeGuides(SQ);
    expect(g.centerLine).toEqual({ p1: { x: 150, y: 150 }, p2: { x: 150, y: 150 } });
    expect(g.hipLines.every((h) => h.p2.x === 150 && h.p2.y === 150)).toBe(true);
  });
});

describe('snapRidgeInput: 中心ガイド/端点スナップの境界(E-3.13)', () => {
  const HW: Point[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }];

  it('中央棟線への線スナップ: しきい値内は吸着、外は生値', () => {
    // 中央棟線 y=100(x=100..300)。x=150 で近傍。
    expect(snapRidgeInput({ x: 150, y: 115 }, HW, 20)).toEqual({ point: { x: 150, y: 100 }, snapped: true });
    expect(snapRidgeInput({ x: 150, y: 125 }, HW, 20)).toEqual({ point: { x: 150, y: 125 }, snapped: false });
  });

  it('棟端点への点スナップ', () => {
    expect(snapRidgeInput({ x: 105, y: 105 }, HW, 20)).toEqual({ point: { x: 100, y: 100 }, snapped: true });
  });

  it('bbox 中心(ガイド交点)への点スナップ', () => {
    expect(snapRidgeInput({ x: 195, y: 105 }, HW, 20)).toEqual({ point: { x: 200, y: 100 }, snapped: true });
  });

  it('どこにも近くない → 生値(snapped=false)', () => {
    expect(snapRidgeInput({ x: 60, y: 60 }, HW, 20)).toEqual({ point: { x: 60, y: 60 }, snapped: false });
  });
});
