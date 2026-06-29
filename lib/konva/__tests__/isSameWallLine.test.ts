import { describe, it, expect } from 'vitest';
import { isSameWallLine, type EdgeInfo } from '../autoLayoutUtils';

// テスト用 EdgeInfo を最小構成で作る。isSameWallLine は p1/p2/nx/ny/handrailDir のみ参照。
function mk(p1: { x: number; y: number }, p2: { x: number; y: number }, nx: number, ny: number, dir: 'horizontal' | 'vertical'): EdgeInfo {
  return {
    index: 0, originalIndex: 0, label: 't',
    p1, p2,
    lengthMm: Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y),
    face: 'west', handrailDir: dir, nx, ny,
  };
}

describe('isSameWallLine: 同一壁線(重なり/接触含む)判定 (S-6-1)', () => {
  // 縦壁 x=0, 外向き法線 (-1,0)
  const v2F = mk({ x: 0, y: 0 }, { x: 0, y: 283 }, -1, 0, 'vertical');     // 2F西 y[0,283]

  it('完全包含(従来collinear相当) → true', () => {
    const v1F = mk({ x: 0, y: 50 }, { x: 0, y: 200 }, -1, 0, 'vertical');  // 2Fに完全包含
    expect(isSameWallLine(v1F, v2F)).toBe(true);
  });

  it('部分重なり → true', () => {
    const v1F = mk({ x: 0, y: 150 }, { x: 0, y: 500 }, -1, 0, 'vertical'); // [150,500] と [0,283] が重なる
    expect(isSameWallLine(v1F, v2F)).toBe(true);
  });

  it('端点接触のみ(延長部ケース: 2F y[0,283]・1F y[283,817]) → true', () => {
    const v1F = mk({ x: 0, y: 817 }, { x: 0, y: 283 }, -1, 0, 'vertical'); // [283,817] と [0,283] は y=283 で接触
    expect(isSameWallLine(v1F, v2F)).toBe(true);
  });

  it('固定軸座標が違う(せり出しで線がズレる) → false', () => {
    const v1F = mk({ x: 100, y: 0 }, { x: 100, y: 283 }, -1, 0, 'vertical'); // x=100 ≠ x=0
    expect(isSameWallLine(v1F, v2F)).toBe(false);
  });

  it('法線が逆 → false', () => {
    const v1F = mk({ x: 0, y: 0 }, { x: 0, y: 283 }, 1, 0, 'vertical');    // nx=+1 ≠ -1
    expect(isSameWallLine(v1F, v2F)).toBe(false);
  });

  it('handrailDir 違い → false', () => {
    const h1F = mk({ x: 0, y: 0 }, { x: 283, y: 0 }, 0, -1, 'horizontal'); // 水平
    expect(isSameWallLine(h1F, v2F)).toBe(false);
  });

  it('完全に離れた同一線上の別壁(gap有り) → false', () => {
    const v1F = mk({ x: 0, y: 500 }, { x: 0, y: 800 }, -1, 0, 'vertical'); // [500,800], [0,283] と gap → max(min)=500 > min(max)=283
    expect(isSameWallLine(v1F, v2F)).toBe(false);
  });

  it('水平壁同士: 端点接触の延長部 → true / gap → false', () => {
    const h2F = mk({ x: 0, y: 0 }, { x: 600, y: 0 }, 0, -1, 'horizontal');   // 2F北 x[0,600]
    const ext = mk({ x: 600, y: 0 }, { x: 900, y: 0 }, 0, -1, 'horizontal'); // x[600,900] 接触
    const gap = mk({ x: 700, y: 0 }, { x: 900, y: 0 }, 0, -1, 'horizontal'); // x[700,900] gap
    expect(isSameWallLine(ext, h2F)).toBe(true);
    expect(isSameWallLine(gap, h2F)).toBe(false);
  });
});
