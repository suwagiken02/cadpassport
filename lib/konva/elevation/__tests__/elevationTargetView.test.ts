// ============================================================
// E-8-v3c-fix: 立面の枠の外に置いた部材を、どのビューに入れるか。
//
// v3 の「どこにでも置ける」は枠の外も含む。枠外に置いた部材も保存のために
// どこかのビューが持つ必要があるので、帰属だけは決める:
//   枠の中 → そのビュー / 枠の外 → いちばん近いビュー / 決められない → 操作中のビュー
// ============================================================
import { describe, it, expect } from 'vitest';
import { distanceToBox, pickTargetView, type ViewBox } from '../elevationTargetView';

/** 南(左上) / 北(右上) / 東(左下) の 3 面を離して置いた配置。 */
const boxes: ViewBox[] = [
  { id: 'south', x: 0, y: 0, w: 200, h: 100 },
  { id: 'north', x: 400, y: 0, w: 200, h: 100 },
  { id: 'east', x: 0, y: 300, w: 200, h: 100 },
];

describe('点と枠の距離', () => {
  it('枠の中なら 0', () => {
    expect(distanceToBox({ x: 100, y: 50 }, boxes[0])).toBe(0);
    expect(distanceToBox({ x: 0, y: 0 }, boxes[0])).toBe(0);      // 縁も中
  });
  it('外は最短距離（真横・真上・斜め）', () => {
    expect(distanceToBox({ x: 250, y: 50 }, boxes[0])).toBe(50);   // 右へ 50
    expect(distanceToBox({ x: 100, y: -30 }, boxes[0])).toBe(30);  // 上へ 30
    expect(distanceToBox({ x: 203, y: 104 }, boxes[0])).toBeCloseTo(5); // 斜め 3-4-5
  });
});

describe('帰属の決定', () => {
  it('枠の中に置いたらそのビュー', () => {
    expect(pickTargetView(boxes, { x: 100, y: 50 }, 'north')).toBe('south');
    expect(pickTargetView(boxes, { x: 500, y: 20 }, 'south')).toBe('north');
  });

  it('枠の外でも、いちばん近いビューに入る（隣に張り出して組む）', () => {
    // 南面のすぐ右外 → 南面の続き
    expect(pickTargetView(boxes, { x: 260, y: 50 }, 'east')).toBe('south');
    // 北面のすぐ左外 → 北面の続き
    expect(pickTargetView(boxes, { x: 380, y: 50 }, 'south')).toBe('north');
    // 東面の下 → 東面
    expect(pickTargetView(boxes, { x: 100, y: 500 }, 'south')).toBe('east');
  });

  it('遠く離れた所でも、いちばん近いビューに入る（どこにでも置ける）', () => {
    expect(pickTargetView(boxes, { x: 5000, y: 5000 }, 'south')).toBe('north');
    expect(pickTargetView(boxes, { x: -5000, y: 5000 }, 'north')).toBe('east');
  });

  it('同距離で決められないときは操作中のビュー', () => {
    // 南(右端200)と北(左端400)のちょうど中間 → どちらも 100
    expect(pickTargetView(boxes, { x: 300, y: 50 }, 'north')).toBe('north');
    expect(pickTargetView(boxes, { x: 300, y: 50 }, 'south')).toBe('south');
  });

  it('ビューが 1 つならそこへ、0 なら操作中のビュー', () => {
    expect(pickTargetView([boxes[0]], { x: 9999, y: 9999 }, 'x')).toBe('south');
    expect(pickTargetView([], { x: 0, y: 0 }, 'active')).toBe('active');
    expect(pickTargetView([], { x: 0, y: 0 })).toBeNull();
  });
});
