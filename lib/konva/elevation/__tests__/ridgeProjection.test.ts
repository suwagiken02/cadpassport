import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point, RidgeLine } from '@/types';
import { projectRidgeLinesToFace } from '../ridgeProjection';

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
