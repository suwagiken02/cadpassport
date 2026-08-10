// ============================================================
// E-8-v5a: キャンバス直下の手動部材（freeParts）。
//
// 「自動は構造を持つ、手動は自由」。立面ビューにも足場にも所属せず、
// キャンバスの絶対座標に実寸で住む。ここで押さえるのは:
//   ・置いた場所がそのまま描かれる（キャンバスのグリッド＝描画座標）
//   ・足場が 1 つも無くても描ける
//   ・実寸（立面ビューの scale に追従しない）
//   ・立面で置いた部材と絵が完全に一致する（描画の実装を共有している）
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  FREE_GEOM, freePartAnchorGrid, freePartsBoundsGrid, freePartsToPrimitives,
  gridToPartMm, moveFreePart, newFreePart, nextFreePartId, partMmToGrid,
} from '../freeParts';
import { partsToPrimitives, type ElevationPartKind } from '../elevation/elevationParts';
import { PALETTE_KINDS } from '../elevation/elevationSlots';

/** プリミティブが占める範囲（グリッド）。 */
const span = (parts: Parameters<typeof freePartsToPrimitives>[0]) =>
  freePartsBoundsGrid(parts)!;

describe('座標: キャンバスのグリッドがそのまま描画座標になる', () => {
  it('グリッド ⇔ mm の往復で戻る', () => {
    const g = { x: 12.5, y: -33 };
    expect(partMmToGrid(gridToPartMm(g))).toEqual(g);
    expect(gridToPartMm({ x: 10, y: 20 })).toEqual({ xMm: 100, yMm: -200 });
  });

  it('置いた位置が基準点になる（指した場所に出る）', () => {
    for (const kind of PALETTE_KINDS) {
      const p = newFreePart(kind, 'a', { x: 40, y: -25 });
      const anchor = freePartAnchorGrid(p)!;
      expect(anchor.x, kind).toBeCloseTo(40);
      expect(anchor.y, kind).toBeCloseTo(-25);
    }
  });

  it('手摺は指した位置を中心に、選んだ長さで出る', () => {
    const b = span([newFreePart('rail', 'r', { x: 100, y: 50 }, { sizeMm: 1800 })]);
    // 1800mm = 180 グリッド。中心 100 の左右に 90 ずつ。
    expect(b.minX).toBeCloseTo(100 - 90);
    expect(b.maxX).toBeCloseTo(100 + 90);
  });
});

describe('実寸で描く（立面ビューの縮尺に追従しない）', () => {
  it('1800mm の手摺は 180 グリッド＝1800mm ぴったり', () => {
    const b = span([newFreePart('rail', 'r', { x: 0, y: 0 }, { sizeMm: 1800 })]);
    expect((b.maxX - b.minX) * 10).toBeCloseTo(1800);
  });

  it('長さを変えれば実寸どおりの差で変わる', () => {
    // 踏板は「1 枚ずつ並んで見える」ように両端を少し詰めて描く（boardInsetGrid）ので、
    // 描画長そのものは公称より短い。縮尺が掛かっていないことは**差**で見る。
    const drawn = (mm: number) => {
      const b = span([newFreePart('board', 'b', { x: 0, y: 0 }, { sizeMm: mm })]);
      return (b.maxX - b.minX) * 10;
    };
    const base = drawn(600);
    for (const mm of [900, 1200, 1500, 1800]) {
      expect(drawn(mm) - base, `${mm}`).toBeCloseTo(mm - 600);
    }
  });

  it('支柱はコマ数どおりの高さ（1 コマ 450mm）', () => {
    for (const koma of [1, 2, 4, 6, 8]) {
      const b = span([newFreePart('post', 'p', { x: 0, y: 0 }, { komaCount: koma })]);
      expect((b.maxY - b.minY) * 10, `${koma}`).toBeGreaterThanOrEqual(450 * koma);
    }
  });
});

describe('足場が無くても描ける', () => {
  it('geom は空（足場ゼロ）', () => {
    expect(FREE_GEOM.scaffolds).toEqual([]);
  });

  it('パレットの全種が描かれる（プリミティブが出る）', () => {
    for (const kind of PALETTE_KINDS) {
      const prims = freePartsToPrimitives([newFreePart(kind, 'x', { x: 5, y: 5 })]);
      expect(prims.length, kind).toBeGreaterThan(0);
    }
  });

  it('1 本目でも描ける（隣に何も無い状態）', () => {
    expect(freePartsToPrimitives([newFreePart('post', 'p1', { x: 0, y: 0 })]).length)
      .toBeGreaterThan(0);
  });
});

describe('立面で置いた部材と絵が一致する', () => {
  it('同じ部材・同じ座標なら、出るプリミティブが完全に同じ', () => {
    for (const kind of PALETTE_KINDS) {
      const p = newFreePart(kind, 'same', { x: 30, y: -12 }, { sizeMm: 1800, komaCount: 4 });
      expect(freePartsToPrimitives([p]), kind)
        .toEqual(partsToPrimitives({ parts: [p], geom: FREE_GEOM }));
    }
  });

  it('角度もそのまま効く（斜めに置ける）', () => {
    const flat = span([newFreePart('rail', 'r', { x: 0, y: 0 }, { sizeMm: 1800 })]);
    const tilted = span([newFreePart('rail', 'r', { x: 0, y: 0 }, { sizeMm: 1800, angleDeg: 30 })]);
    expect(tilted.maxY - tilted.minY).toBeGreaterThan(flat.maxY - flat.minY);
  });
});

describe('動かす: 自由座標を書き換えるだけ', () => {
  it('基準点が移動量ぶんだけ動く', () => {
    for (const kind of PALETTE_KINDS) {
      const p = newFreePart(kind, 'm', { x: 10, y: 10 });
      const moved = moveFreePart(p, 7, -3);
      const a = freePartAnchorGrid(moved)!;
      expect(a.x, kind).toBeCloseTo(17);
      expect(a.y, kind).toBeCloseTo(7);
    }
  });

  it('絵の形は変わらない（平行移動だけ）', () => {
    const p = newFreePart('board', 'b', { x: 0, y: 0 }, { sizeMm: 1200 });
    const before = span([p]), after = span([moveFreePart(p, 5, 5)]);
    expect(after.maxX - after.minX).toBeCloseTo(before.maxX - before.minX);
    expect(after.maxY - after.minY).toBeCloseTo(before.maxY - before.minY);
  });

  it('置ける場所の制限は無い（どんな座標でも動かせる）', () => {
    const p = newFreePart('rail', 'r', { x: 0, y: 0 });
    const far = moveFreePart(p, -12345.6, 9876.5);
    expect(freePartAnchorGrid(far)!.x).toBeCloseTo(-12345.6);
  });
});

describe('範囲と id', () => {
  it('部材が無ければ範囲は null（何も無いページ）', () => {
    expect(freePartsBoundsGrid([])).toBeNull();
    expect(freePartsBoundsGrid(undefined)).toBeNull();
  });

  it('複数本を囲む範囲になる', () => {
    const a = newFreePart('rail', 'a', { x: 0, y: 0 }, { sizeMm: 1800 });
    const b = newFreePart('rail', 'b', { x: 500, y: 200 }, { sizeMm: 1800 });
    const both = span([a, b]);
    expect(both.minX).toBeLessThanOrEqual(span([a]).minX);
    expect(both.maxX).toBeGreaterThanOrEqual(span([b]).maxX);
    expect(both.maxY).toBeGreaterThanOrEqual(span([b]).maxY);
  });

  it('id は既存とぶつからない', () => {
    const kinds: ElevationPartKind[] = ['rail', 'post'];
    let parts: ReturnType<typeof newFreePart>[] = [];
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      for (const k of kinds) {
        const id = nextFreePartId(parts, k);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        parts = [...parts, newFreePart(k, id, { x: 0, y: 0 })];
      }
    }
    expect(ids.size).toBe(10);
  });

  it('立面の手動部材とは id の書式が違う（取り違えない）', () => {
    expect(nextFreePartId([], 'rail')).toBe('free:rail:1');
  });
});
