import { describe, it, expect } from 'vitest';
import type { BuildingShape, Roof } from '@/types';
import { fullPerimeterEdgeRange, toggleEdgeInRange, upsertRoof } from '../roofDraw';

const RECT: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000',
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }],
};
const roof = (id: string, edgeRange: number[], uniformMm = 600): Roof =>
  ({ id, buildingId: 'B', edgeRange, roofShape: 'gable', uniformMm });

describe('fullPerimeterEdgeRange', () => {
  it('全辺 index を返す（ワンタップ外周一周）', () => {
    expect(fullPerimeterEdgeRange(RECT)).toEqual([0, 1, 2, 3]);
  });
});

describe('toggleEdgeInRange', () => {
  it('無い辺は追加（昇順）', () => {
    expect(toggleEdgeInRange([0, 2], 1)).toEqual([0, 1, 2]);
  });
  it('ある辺は除去', () => {
    expect(toggleEdgeInRange([0, 1, 2], 1)).toEqual([0, 2]);
  });
  it('空から追加', () => {
    expect(toggleEdgeInRange([], 3)).toEqual([3]);
  });
});

describe('upsertRoof（重複置換）', () => {
  it('同一 edgeRange の屋根は置換（id は既存維持）', () => {
    const roofs = [roof('r1', [0, 1, 2, 3], 600)];
    const next = upsertRoof(roofs, roof('rNEW', [3, 2, 1, 0], 900)); // 順不同で同集合
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('r1');       // 既存 id 維持
    expect(next[0].uniformMm).toBe(900); // 内容は更新
  });

  it('異なる edgeRange は追加（複数屋根）', () => {
    const roofs = [roof('big', [0, 1, 2, 3])];
    const next = upsertRoof(roofs, roof('shed', [0]));
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.id)).toEqual(['big', 'shed']);
  });

  it('別建物の同一 edgeRange は別物として追加', () => {
    const roofs = [roof('r1', [0])];
    const other: Roof = { id: 'r2', buildingId: 'C', edgeRange: [0], roofShape: 'gable', uniformMm: 600 };
    expect(upsertRoof(roofs, other)).toHaveLength(2);
  });
});
