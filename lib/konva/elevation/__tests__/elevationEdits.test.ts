import { describe, it, expect } from 'vitest';
import type { ElevationPrimitive, ElevationView } from '@/types';
import {
  applyElevationEdits, hasEditFor, nextAddId, primitiveBounds, translatePrimitive,
  withAdd, withHide, withMove, withText, withoutEditsFor,
} from '../elevationEdits';

// ============================================================
// E-8b: 差分編集。生成された primitives は書き換えず ElevationEdit[] を積んで適用する。
// ============================================================
const post = (id: string): ElevationPrimitive =>
  ({ kind: 'line', x1: 10, y1: 0, x2: 10, y2: -50, stroke: '#FFD700', width: 1.6, meta: { kind: 'post', id } });
const dimText = (id: string, t = '天端 6500'): ElevationPrimitive =>
  ({ kind: 'text', x: 5, y: -65, text: t, size: 9, fill: '#c9c9c6', anchor: 'end', meta: { kind: 'dimText', id } });

const view = (prims: ElevationPrimitive[], edits?: ElevationView['edits']): ElevationView => ({
  id: 'v1', face: 'north', originGrid: { x: 0, y: 0 }, scale: 1, primitives: prims, edits,
});

describe('translatePrimitive', () => {
  it('line/rect/polygon/text をローカル座標で平行移動', () => {
    expect(translatePrimitive(post('p'), 2, -3)).toMatchObject({ x1: 12, y1: -3, x2: 12, y2: -53 });
    const r: ElevationPrimitive = { kind: 'rect', x: 1, y: 2, w: 3, h: 4 };
    expect(translatePrimitive(r, 1, 1)).toMatchObject({ x: 2, y: 3, w: 3, h: 4 });
    const g: ElevationPrimitive = { kind: 'polygon', points: [0, 0, 10, 0, 10, 10] };
    expect(translatePrimitive(g, 1, 2)).toMatchObject({ points: [1, 2, 11, 2, 11, 12] });
    expect(translatePrimitive(dimText('d'), -1, 5)).toMatchObject({ x: 4, y: -60 });
  });
  it('移動量 0 は同一参照（無駄な再生成をしない）', () => {
    const p = post('p');
    expect(translatePrimitive(p, 0, 0)).toBe(p);
  });
});

describe('primitiveBounds', () => {
  it('線・矩形・多角形の bbox', () => {
    expect(primitiveBounds(post('p'))).toEqual({ minX: 10, minY: -50, maxX: 10, maxY: 0 });
    expect(primitiveBounds({ kind: 'rect', x: 1, y: 2, w: 3, h: 4 })).toEqual({ minX: 1, minY: 2, maxX: 4, maxY: 6 });
    expect(primitiveBounds({ kind: 'polygon', points: [0, 0, 10, 0, 10, 10] })).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
  it('文字は概算 bbox（anchor を考慮）', () => {
    const b = primitiveBounds(dimText('d'));
    expect(b.maxX).toBeCloseTo(5, 6);       // anchor='end' なので右端が x
    expect(b.minX).toBeLessThan(b.maxX);
  });
});

describe('applyElevationEdits', () => {
  it('未編集は元の配列をそのまま返す（同一参照）', () => {
    const prims = [post('a'), post('b')];
    const v = view(prims);
    expect(applyElevationEdits(v)).toBe(prims);
    expect(applyElevationEdits(view(prims, []))).toBe(prims);
  });

  it('hide は除外される', () => {
    const v = view([post('a'), post('b')], [{ op: 'hide', targetId: 'a' }]);
    expect(applyElevationEdits(v).map((p) => p.meta!.id)).toEqual(['b']);
  });

  it('move は平行移動される（複数 move は合成）', () => {
    const v = view([post('a')], [
      { op: 'move', targetId: 'a', dx: 2, dy: 0 },
      { op: 'move', targetId: 'a', dx: 3, dy: -1 },
    ]);
    expect(applyElevationEdits(v)[0]).toMatchObject({ x1: 15, y1: -1 });
  });

  it('text は文字だけ差し替わる（座標・書式は不変）', () => {
    const v = view([dimText('d')], [{ op: 'text', targetId: 'd', text: '天端 6600' }]);
    const out = applyElevationEdits(v)[0];
    expect(out.kind === 'text' && out.text).toBe('天端 6600');
    expect(out).toMatchObject({ x: 5, y: -65, size: 9 });
  });

  it('add は末尾に足され、追加分にも hide/move が効く', () => {
    const added = post('add:rail:1');
    const v = view([post('a')], [
      { op: 'add', primitive: added },
      { op: 'move', targetId: 'add:rail:1', dx: 5, dy: 0 },
    ]);
    const out = applyElevationEdits(v);
    expect(out.map((p) => p.meta!.id)).toEqual(['a', 'add:rail:1']);
    expect(out[1]).toMatchObject({ x1: 15 });

    const hidden = view([post('a')], [{ op: 'add', primitive: added }, { op: 'hide', targetId: 'add:rail:1' }]);
    expect(applyElevationEdits(hidden).map((p) => p.meta!.id)).toEqual(['a']);
  });

  it('元の primitives は書き換えない（非破壊）', () => {
    const prims = [post('a')];
    const snapshot = JSON.parse(JSON.stringify(prims));
    applyElevationEdits(view(prims, [{ op: 'move', targetId: 'a', dx: 9, dy: 9 }]));
    expect(prims).toEqual(snapshot);
  });
});

describe('差分配列の組み立て', () => {
  it('withHide は重複しない', () => {
    const e1 = withHide(undefined, 'a');
    expect(e1).toEqual([{ op: 'hide', targetId: 'a' }]);
    expect(withHide(e1, 'a')).toBe(e1);
  });

  it('withMove は加算し、0 に戻ったら取り除く', () => {
    let e = withMove(undefined, 'a', 2, 3);
    e = withMove(e, 'a', 1, -1);
    expect(e).toEqual([{ op: 'move', targetId: 'a', dx: 3, dy: 2 }]);
    e = withMove(e, 'a', -3, -2);
    expect(e).toEqual([]);
  });

  it('withText は同じ id の上書きを置換', () => {
    let e = withText(undefined, 'd', 'A');
    e = withText(e, 'd', 'B');
    expect(e).toEqual([{ op: 'text', targetId: 'd', text: 'B' }]);
  });

  it('withoutEditsFor はその id の編集をすべて外す（追加そのものも消える）', () => {
    const e = [
      ...withMove(undefined, 'a', 1, 1),
      ...withHide(undefined, 'a'),
      ...withAdd(undefined, post('add:x:1')),
    ];
    expect(withoutEditsFor(e, 'a').map((x) => x.op)).toEqual(['add']);
    expect(withoutEditsFor(e, 'add:x:1').map((x) => x.op)).toEqual(['move', 'hide']);
  });

  it('hasEditFor は編集の有無を返す', () => {
    const e = withHide(undefined, 'a');
    expect(hasEditFor(e, 'a')).toBe(true);
    expect(hasEditFor(e, 'b')).toBe(false);
    expect(hasEditFor(withAdd(undefined, post('add:x:1')), 'add:x:1')).toBe(true);
  });

  it('nextAddId は既存 id と衝突しない連番', () => {
    const v = view([post('a')], withAdd(undefined, post('add:rail:1')));
    expect(nextAddId(v, 'rail')).toBe('add:rail:2');
    expect(nextAddId(view([post('a')]), 'post')).toBe('add:post:1');
  });
});
