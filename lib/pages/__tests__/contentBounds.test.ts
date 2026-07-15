import { describe, it, expect } from 'vitest';
import type { CanvasData, Point, ElevationView } from '@/types';
import { computeContentBounds } from '../contentBounds';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];

function base(): CanvasData {
  return {
    version: '1.0', grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
    memos: [], compass: { angle: 0 },
  };
}

const evView = (): ElevationView => ({
  id: 'ev', face: 'north', originGrid: { x: 200, y: 100 }, scale: 2,
  primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: -50, stroke: '#000', width: 1 }],
});

describe('computeContentBounds (E-6f)', () => {
  it('建物 bbox', () => {
    const cv = { ...base(), buildings: [{ id: 'B', type: 'polygon' as const, points: RECT, fill: '#000', floor: 1 }] };
    expect(computeContentBounds(cv)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 80 });
  });

  it('立面のみのページ: originGrid + primitives×scale で bbox', () => {
    const cv = { ...base(), elevationViews: [evView()] };
    // prim bbox local: x[0,10] y[-50,0]、scale2 → origin(200,100)+ {x[0,20], y[-100,0]}
    expect(computeContentBounds(cv)).toEqual({ minX: 200, minY: 0, maxX: 220, maxY: 100 });
  });

  it('混在(建物＋メモ＋立面)は全部を包含', () => {
    const cv = {
      ...base(),
      buildings: [{ id: 'B', type: 'polygon' as const, points: RECT, fill: '#000', floor: 1 }],
      memos: [{ id: 'M', x: -30, y: 200, text: 'm', style: 'default' }],
      elevationViews: [evView()],
    };
    const b = computeContentBounds(cv)!;
    expect(b.minX).toBe(-30); // メモが最左
    expect(b.minY).toBe(0);   // 立面上端
    expect(b.maxX).toBe(220); // 立面右端
    expect(b.maxY).toBe(200); // メモ
  });

  it('空ページは null', () => {
    expect(computeContentBounds(base())).toBeNull();
  });
});
