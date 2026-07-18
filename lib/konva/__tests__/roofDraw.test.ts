import { describe, it, expect } from 'vitest';
import type { BuildingShape, Roof, WallSpan } from '@/types';
import { walkToSpan, upsertRoof, retargetWalkEnd } from '../roofDraw';

// RECT: e0 len360, e1 len540, e2 len360, e3 len540, perim 1800。
const RECT: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000',
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }],
};
const roof = (id: string, span: WallSpan, uniformMm = 600): Roof =>
  ({ id, buildingId: 'B', span, roofShape: 'gable', uniformMm });

describe('walkToSpan (R-1e-fix)', () => {
  it('被覆長が全周以上 → full', () => {
    expect(walkToSpan(RECT, 0, 1800).full).toBe(true);
    expect(walkToSpan(RECT, 100, 100 + 1800).full).toBe(true);
  });
  it('辺ちょうどで止まる（0→360 = 辺0一周ぶん）', () => {
    const s = walkToSpan(RECT, 0, 360);
    expect(s.full).toBeUndefined();
    expect(s.startEdge).toBe(0); expect(s.startT).toBeCloseTo(0, 6);
    expect(s.endEdge).toBe(1); expect(s.endT).toBeCloseTo(0, 6);
  });
  it('辺の途中で止まれる（0→180 = 辺0の中央）', () => {
    const s = walkToSpan(RECT, 0, 180);
    expect(s.endEdge).toBe(0);
    expect(s.endT).toBeCloseTo(0.5, 6);
  });
});

describe('upsertRoof（span 単位の重複置換）', () => {
  it('同一 span は置換（id は既存維持・内容更新）', () => {
    const roofs = [roof('r1', walkToSpan(RECT, 0, 360), 600)];
    const next = upsertRoof(RECT, roofs, roof('rNEW', walkToSpan(RECT, 0, 360), 900));
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('r1');
    expect(next[0].uniformMm).toBe(900);
  });
  it('異なる span は追加', () => {
    const roofs = [roof('a', walkToSpan(RECT, 0, 360))];
    const next = upsertRoof(RECT, roofs, roof('b', walkToSpan(RECT, 360, 900)));
    expect(next.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('full 同士は同一とみなす', () => {
    const roofs = [roof('full1', walkToSpan(RECT, 0, 1800))];
    const next = upsertRoof(RECT, roofs, roof('full2', walkToSpan(RECT, 0, 1800), 700));
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('full1');
    expect(next[0].uniformMm).toBe(700);
  });
});

describe('retargetWalkEnd（壁上タップでキャラ移動・R-1e-fix5）', () => {
  // RECT perim=1800。walk={start,end}。タップ点は mod perim の arc。
  const walk = (s: number, e: number) => ({ startArc: s, endArc: e });
  it('歩行方向へ延長（右下角900→下辺1080）', () => {
    expect(retargetWalkEnd(RECT, walk(360, 900), 1080)).toBeCloseTo(1080, 6);
  });
  it('手前タップで短縮（900→720）', () => {
    expect(retargetWalkEnd(RECT, walk(360, 900), 720)).toBeCloseTo(720, 6);
  });
  it('最短経路で逆回りにも移動（end0から arc1700 は -100＝backward）', () => {
    expect(retargetWalkEnd(RECT, walk(0, 0), 1700)).toBeCloseTo(-100, 6);
  });
  it('±全周にクランプ（half=900 は +900 側）', () => {
    expect(retargetWalkEnd(RECT, walk(0, 0), 900)).toBeCloseTo(900, 6);
  });
});
