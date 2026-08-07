// ============================================================
// P-1: 階段・単管が既存の平面部材と同じ仕組みに乗っていること。
//   ・選択 / 移動 / 削除 が既存部材と同じ経路で効く
//   ・既存の保存済みデータ（stairs/pipes が無い）がそのまま読める
//   ・手摺・支柱・アンチの挙動が変わらない
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { collectIdsInRect } from '@/lib/pages/rangeSelect';
import { computeContentBounds } from '@/lib/pages/contentBounds';
import { canvasDataIsEmpty } from '@/lib/pages/saveGuard';
import { buildCrossPagePayload, mergePayloadIntoCanvas } from '@/lib/pages/crossPageCopy';
import type { CanvasData, Handrail, Pipe, Stair } from '@/types';

const handrail: Handrail = {
  id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000',
};
const stair: Stair = { id: 'st1', x: 60, y: 180, angleDeg: 0 };
const pipe: Pipe = { id: 'pp1', x: 20, y: 30, lengthMm: 3000, angleDeg: 45 };

/** 既存の保存済みデータ（P-1 より前＝stairs/pipes を持たない）。 */
const legacySaved = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [handrail], posts: [{ id: 'p1', x: 5, y: 5 }],
  antis: [{ id: 'a1', x: 1, y: 1, width: 400, lengthMm: 1800, direction: 'horizontal' }],
  memos: [], compass: { angle: 0 },
} as CanvasData);

beforeEach(() => {
  useCanvasStore.setState({ canvasData: legacySaved(), selectedIds: [] });
});

describe('既存データの互換', () => {
  it('stairs/pipes を持たない保存データが読める（[] に正規化）', () => {
    useCanvasStore.getState().setCanvasData(legacySaved());
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.stairs).toEqual([]);
    expect(cv.pipes).toEqual([]);
    // 既存部材は失われない
    expect(cv.handrails).toHaveLength(1);
    expect(cv.posts).toHaveLength(1);
    expect(cv.antis).toHaveLength(1);
  });

  it('階段・単管が空でも「空の図面」判定は既存どおり', () => {
    expect(canvasDataIsEmpty(legacySaved())).toBe(false);
    const blank = { ...legacySaved(), handrails: [], posts: [], antis: [] };
    expect(canvasDataIsEmpty(blank)).toBe(true);
    // 階段だけでも「空ではない」
    expect(canvasDataIsEmpty({ ...blank, stairs: [stair] })).toBe(false);
    expect(canvasDataIsEmpty({ ...blank, pipes: [pipe] })).toBe(false);
  });
});

describe('既存の平面部材の挙動は変わらない', () => {
  it('手摺の追加・移動・削除は従来どおり', () => {
    const st = useCanvasStore.getState();
    st.addHandrail({ ...handrail, id: 'h2', x: 10, y: 10 });
    expect(useCanvasStore.getState().canvasData.handrails).toHaveLength(2);
    useCanvasStore.getState().moveElement('h2', 3, 4);
    const moved = useCanvasStore.getState().canvasData.handrails.find((h) => h.id === 'h2');
    expect([moved!.x, moved!.y]).toEqual([13, 14]);
    useCanvasStore.getState().removeElement('h2');
    expect(useCanvasStore.getState().canvasData.handrails.map((h) => h.id)).toEqual(['h1']);
  });

  it('支柱・アンチも従来どおり動く', () => {
    useCanvasStore.getState().moveElement('p1', 1, 1);
    useCanvasStore.getState().moveElement('a1', 2, 2);
    const cv = useCanvasStore.getState().canvasData;
    expect([cv.posts[0].x, cv.posts[0].y]).toEqual([6, 6]);
    expect([cv.antis[0].x, cv.antis[0].y]).toEqual([3, 3]);
  });
});

describe('階段・単管も既存部材と同じように扱える', () => {
  beforeEach(() => {
    useCanvasStore.getState().addStair(stair);
    useCanvasStore.getState().addPipe(pipe);
  });

  it('追加される', () => {
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.stairs).toHaveLength(1);
    expect(cv.pipes).toHaveLength(1);
  });

  it('移動できる（既存部材と同じ moveElement）', () => {
    useCanvasStore.getState().moveElement('st1', 6, 18);
    useCanvasStore.getState().moveElement('pp1', -2, 5);
    const cv = useCanvasStore.getState().canvasData;
    expect([cv.stairs![0].x, cv.stairs![0].y]).toEqual([66, 198]);
    expect([cv.pipes![0].x, cv.pipes![0].y]).toEqual([18, 35]);
  });

  it('削除できる（単体・複数とも）', () => {
    useCanvasStore.getState().removeElement('st1');
    expect(useCanvasStore.getState().canvasData.stairs).toEqual([]);
    useCanvasStore.getState().removeElements(['pp1', 'h1']);
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.pipes).toEqual([]);
    expect(cv.handrails).toEqual([]);
  });

  it('向き・長さを変えられる（配置後に編集できる）', () => {
    useCanvasStore.getState().updateStair('st1', { angleDeg: 90, flip: true });
    useCanvasStore.getState().updatePipe('pp1', { lengthMm: 6000, angleDeg: 30 });
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.stairs![0]).toMatchObject({ angleDeg: 90, flip: true });
    expect(cv.pipes![0]).toMatchObject({ lengthMm: 6000, angleDeg: 30 });
  });

  it('undo で元に戻る（履歴に乗っている）', () => {
    useCanvasStore.getState().moveElement('st1', 60, 0);
    useCanvasStore.getState().updateStair('st1', { angleDeg: 180 });
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().canvasData.stairs![0].angleDeg).toBe(0);
  });

  it('範囲選択に入る', () => {
    const cv = useCanvasStore.getState().canvasData;
    const ids = collectIdsInRect(cv, { x: -10, y: -10, w: 400, h: 400 });
    expect(ids).toContain('st1');
    expect(ids).toContain('pp1');
  });

  it('ページ全体の範囲（出力の枠）に入る', () => {
    const only = { ...legacySaved(), handrails: [], posts: [], antis: [], stairs: [stair], pipes: [] };
    const b = computeContentBounds(only);
    expect(b).not.toBeNull();
    expect(b!.maxX).toBeGreaterThanOrEqual(stair.x);
    expect(b!.maxY).toBeGreaterThan(stair.y);
  });

  it('ページ間コピーで運ばれる（id は振り直し）', () => {
    const cv = useCanvasStore.getState().canvasData;
    const { payload } = buildCrossPagePayload(cv, ['st1', 'pp1']);
    expect(payload.stairs).toHaveLength(1);
    expect(payload.pipes).toHaveLength(1);
    expect(payload.stairs[0].id).not.toBe('st1');
    const merged = mergePayloadIntoCanvas(legacySaved(), payload);
    expect(merged.stairs).toHaveLength(1);
    expect(merged.pipes).toHaveLength(1);
  });
});
