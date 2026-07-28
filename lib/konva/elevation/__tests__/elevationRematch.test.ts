import { describe, it, expect } from 'vitest';
import type { ElevationEdit, ElevationPrimitive } from '@/types';
import { describeEdit, rematchElevationEdits } from '../elevationRematch';

// ============================================================
// E-8d: 平面を変えて立面を作り直したときの編集引き継ぎ。
// kind＋ヒント(高さ/添字/面軸座標)で新 id へ移し、移せない編集は孤立として残す（勝手に消さない）。
// ============================================================
const post = (id: string, index: number, x: number, heightMm = 6500): ElevationPrimitive =>
  ({ kind: 'line', x1: x, y1: 0, x2: x, y2: -65, stroke: '#FFD700', width: 1.6,
    meta: { kind: 'post', id, index, x, heightMm } });
const board = (id: string, heightMm: number, x: number): ElevationPrimitive =>
  ({ kind: 'line', x1: x, y1: -heightMm / 10, x2: x + 50, y2: -heightMm / 10, stroke: '#4ECDC4', width: 3,
    meta: { kind: 'board', id, heightMm, x } });

describe('rematchElevationEdits', () => {
  it('同じ id が残っていればそのまま引き継ぐ', () => {
    const prev = [post('post:0:1', 1, 18)];
    const next = [post('post:0:1', 1, 18)];
    const r = rematchElevationEdits(prev, next, [{ op: 'hide', targetId: 'post:0:1' }]);
    expect(r.edits).toEqual([{ op: 'hide', targetId: 'post:0:1' }]);
    expect(r.orphans).toEqual([]);
  });

  it('id が変わってもヒント（高さ）が一致すれば新 id へ移す', () => {
    const prev = [board('board:0:1100:0', 1100, 0)];
    const next = [board('board:0:1100:12', 1100, 12)]; // 面が動いて x/id が変わった
    const r = rematchElevationEdits(prev, next, [{ op: 'move', targetId: 'board:0:1100:0', dx: 1, dy: 2 }]);
    expect(r.edits).toEqual([{ op: 'move', targetId: 'board:0:1100:12', dx: 1, dy: 2 }]);
    expect(r.orphans).toEqual([]);
  });

  it('高さが食い違う相手には移さない（別部材へ勝手に付けない）', () => {
    const prev = [board('board:0:1100:0', 1100, 0)];
    const next = [board('board:0:2900:0', 2900, 0)];
    const r = rematchElevationEdits(prev, next, [{ op: 'hide', targetId: 'board:0:1100:0' }]);
    expect(r.edits).toEqual([]);
    expect(r.orphans).toEqual([{ op: 'hide', targetId: 'board:0:1100:0' }]);
  });

  it('支柱は添字＋面軸座標で引き継ぐ', () => {
    const prev = [post('post:0:2', 2, 36)];
    const next = [post('post:0:2', 2, 36.3)]; // わずかにズレても添字が一致
    const r = rematchElevationEdits(prev, next, [{ op: 'text', targetId: 'post:0:2', text: 'X' }]);
    expect(r.edits).toEqual([{ op: 'text', targetId: 'post:0:2', text: 'X' }]);
  });

  it('相手が消えた（スパンが減った等）編集は孤立として残る', () => {
    const prev = [post('post:0:3', 3, 54)];
    const next = [post('post:0:0', 0, 0), post('post:0:1', 1, 18)];
    const r = rematchElevationEdits(prev, next, [{ op: 'hide', targetId: 'post:0:3' }]);
    expect(r.edits).toEqual([]);
    expect(r.orphans).toHaveLength(1);
  });

  it('追加(add)は常に残る（生成 id に紐づかないユーザー資産）', () => {
    const added: ElevationPrimitive = { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0, stroke: '#fff', width: 1, meta: { kind: 'rail', id: 'add:rail:1' } };
    const r = rematchElevationEdits([], [], [{ op: 'add', primitive: added }]);
    expect(r.edits).toEqual([{ op: 'add', primitive: added }]);
    expect(r.orphans).toEqual([]);
  });

  it('追加プリミティブへの移動も引き継がれる', () => {
    const added: ElevationPrimitive = { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0, stroke: '#fff', width: 1, meta: { kind: 'rail', id: 'add:rail:1' } };
    const edits: ElevationEdit[] = [
      { op: 'add', primitive: added },
      { op: 'move', targetId: 'add:rail:1', dx: 2, dy: 0 },
    ];
    const r = rematchElevationEdits([], [], edits);
    expect(r.edits).toHaveLength(2);
    expect(r.orphans).toEqual([]);
  });

  it('編集が無ければ何も起きない', () => {
    expect(rematchElevationEdits([], [], undefined)).toEqual({ edits: [], orphans: [] });
  });

  it('kind が違う相手には移さない', () => {
    const prev = [board('board:0:1100:0', 1100, 0)];
    const next = [post('post:0:0', 0, 0, 1100)]; // 高さは同じだが支柱
    const r = rematchElevationEdits(prev, next, [{ op: 'hide', targetId: 'board:0:1100:0' }]);
    expect(r.orphans).toHaveLength(1);
  });
});

describe('describeEdit', () => {
  it('孤立一覧に出す1行を作る', () => {
    expect(describeEdit({ op: 'hide', targetId: 'post:0:1' })).toContain('削除');
    expect(describeEdit({ op: 'move', targetId: 'a', dx: 1, dy: -2 })).toContain('移動');
    expect(describeEdit({ op: 'text', targetId: 'd', text: 'X' })).toContain('「X」');
  });
});
