// ============================================================
// E-8-v5a commit 1 の達成条件:
//   立面図が 1 つも無いまっさらなキャンバスに、パレットから部材を 1 本置けて、
//   選べて、動かせて、消せて、保存され、次に開いても在る。
//
// 加えて、既存データ（freeParts を持たない保存済み図面）がそのまま読めること、
// 立面ビューの手動部材（elevationViews[].parts）には一切触っていないこと。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { freePartAnchorGrid, newFreePart } from '../freeParts';
import type { CanvasData } from '@/types';

/** 立面図も建物も無い、まっさらなキャンバス。 */
const blankCanvas = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

const rail = (id = 'f1', at = { x: 100, y: 50 }) =>
  newFreePart('rail', id, at, { sizeMm: 1800 });

beforeEach(() => {
  useCanvasStore.getState().setCanvasData(blankCanvas());
  useCanvasStore.setState({ selectedIds: [] });
});

describe('既存データの互換', () => {
  it('freeParts を持たない保存データが読める（[] に正規化）', () => {
    expect(useCanvasStore.getState().canvasData.freeParts).toEqual([]);
  });

  it('既存の配列は失われない', () => {
    const cv = { ...blankCanvas(), handrails: [{ id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' }] } as CanvasData;
    useCanvasStore.getState().setCanvasData(cv);
    expect(useCanvasStore.getState().canvasData.handrails).toHaveLength(1);
    expect(useCanvasStore.getState().canvasData.freeParts).toEqual([]);
  });
});

describe('まっさらなキャンバスに 1 本置ける', () => {
  it('立面ビューが 0 個でも置ける', () => {
    expect(useCanvasStore.getState().canvasData.elevationViews).toEqual([]);
    useCanvasStore.getState().addFreePart(rail());
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.freeParts).toHaveLength(1);
    expect(cv.elevationViews).toEqual([]);   // ビューは作られない
  });

  it('置いた位置に入る', () => {
    useCanvasStore.getState().addFreePart(rail('f1', { x: 33, y: -7 }));
    const p = useCanvasStore.getState().canvasData.freeParts![0];
    const a = freePartAnchorGrid(p)!;
    expect(a.x).toBeCloseTo(33);
    expect(a.y).toBeCloseTo(-7);
  });

  it('何本でも置ける', () => {
    for (let i = 0; i < 3; i++) {
      useCanvasStore.getState().addFreePart(rail(`f${i}`, { x: i * 200, y: 0 }));
    }
    expect(useCanvasStore.getState().canvasData.freeParts).toHaveLength(3);
  });
});

describe('選べる・動かせる・消せる', () => {
  beforeEach(() => {
    useCanvasStore.getState().addFreePart(rail());
  });

  it('既存の選択経路（selectedIds）に乗る', () => {
    useCanvasStore.getState().setSelectedIds(['f1']);
    expect(useCanvasStore.getState().selectedIds).toEqual(['f1']);
  });

  it('既存部材と同じ moveElement で動く', () => {
    useCanvasStore.getState().moveElement('f1', 12, -4);
    const a = freePartAnchorGrid(useCanvasStore.getState().canvasData.freeParts![0])!;
    expect(a.x).toBeCloseTo(112);
    expect(a.y).toBeCloseTo(46);
  });

  it('他の部材を動かしても巻き添えにならない', () => {
    useCanvasStore.getState().addFreePart(rail('f2', { x: 0, y: 0 }));
    useCanvasStore.getState().moveElement('f2', 10, 10);
    const a = freePartAnchorGrid(useCanvasStore.getState().canvasData.freeParts![0])!;
    expect(a.x).toBeCloseTo(100);   // f1 は動いていない
  });

  it('setFreePart で差し替えられる（移動・回転の確定）', () => {
    useCanvasStore.getState().setFreePart('f1', { ...rail(), angleDeg: 30 });
    expect(useCanvasStore.getState().canvasData.freeParts![0].angleDeg).toBe(30);
  });

  it('removeElement で消える（墓標は残らない）', () => {
    useCanvasStore.getState().removeElement('f1');
    expect(useCanvasStore.getState().canvasData.freeParts).toEqual([]);
  });

  it('removeElements（範囲まとめ消し）でも消える', () => {
    useCanvasStore.getState().addFreePart(rail('f2', { x: 0, y: 0 }));
    useCanvasStore.getState().removeElements(['f1', 'f2']);
    expect(useCanvasStore.getState().canvasData.freeParts).toEqual([]);
  });
});

describe('undo / redo が効く', () => {
  it('配置を取り消せる', () => {
    useCanvasStore.getState().addFreePart(rail());
    expect(useCanvasStore.getState().canvasData.freeParts).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().canvasData.freeParts).toEqual([]);
  });

  it('差し替えを取り消せる', () => {
    useCanvasStore.getState().addFreePart(rail());
    useCanvasStore.getState().setFreePart('f1', { ...rail(), angleDeg: 45 });
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().canvasData.freeParts![0].angleDeg).toBeUndefined();
  });

  it('削除を取り消せる', () => {
    useCanvasStore.getState().addFreePart(rail());
    useCanvasStore.getState().removeElement('f1');
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().canvasData.freeParts).toHaveLength(1);
  });
});

describe('保存される・次に開いても在る', () => {
  it('保存対象（canvasData）に入り、isDirty が立つ', () => {
    useCanvasStore.getState().addFreePart(rail());
    expect(useCanvasStore.getState().isDirty).toBe(true);
    expect(useCanvasStore.getState().canvasData.freeParts).toHaveLength(1);
  });

  it('JSON で往復しても失われない（保存 → 再読込）', () => {
    useCanvasStore.getState().addFreePart(rail('f1', { x: 77, y: 13 }));
    const saved = JSON.parse(JSON.stringify(useCanvasStore.getState().canvasData));
    useCanvasStore.getState().setCanvasData(blankCanvas());
    expect(useCanvasStore.getState().canvasData.freeParts).toEqual([]);
    useCanvasStore.getState().setCanvasData(saved);
    const p = useCanvasStore.getState().canvasData.freeParts![0];
    expect(freePartAnchorGrid(p)!.x).toBeCloseTo(77);
  });
});

describe('立面ビューの手動部材には触らない（移行しない）', () => {
  it('elevationViews[].parts はそのまま残る', () => {
    const view = {
      id: 'v1', face: 'north' as const, originGrid: { x: 0, y: 0 }, scale: 0.5,
      primitives: [],
      parts: [{ id: 'manual:rail:1', kind: 'rail' as const, scaffoldIndex: 0, origin: 'manual' as const, x0Mm: 0, x1Mm: 1800, levelMm: 900 }],
      geom: { minXg: 0, scaffolds: [] },
    };
    useCanvasStore.getState().setCanvasData({ ...blankCanvas(), elevationViews: [view] });
    useCanvasStore.getState().addFreePart(rail());
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.elevationViews![0].parts).toHaveLength(1);
    expect(cv.elevationViews![0].parts![0].id).toBe('manual:rail:1');
    expect(cv.freeParts).toHaveLength(1);   // 新しく置いたものだけが freeParts に入る
  });
});
