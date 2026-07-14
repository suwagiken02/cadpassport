import { describe, it, expect } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasData, RidgeLine } from '@/types';

const emptyData = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
  memos: [], compass: { angle: 0 },
});

const rl = (id: string, h = 7000): RidgeLine =>
  ({ id, buildingId: 'B', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, heightMm: h });

const lines = (): RidgeLine[] => useCanvasStore.getState().canvasData.ridgeLines ?? [];

const reset = () => {
  useCanvasStore.getState().setCanvasData(emptyData());
  useCanvasStore.setState({ history: { past: [], future: [] } });
};

describe('canvasStore: ridgeLines (E-3.8c)', () => {
  it('normalize: 旧データ(ridgeLines 欠落)は [] 補完', () => {
    useCanvasStore.getState().setCanvasData(emptyData());
    expect(lines()).toEqual([]);
  });

  it('add → 追加され、undo で戻る(pushHistory 追随)', () => {
    reset();
    useCanvasStore.getState().addRidgeLine(rl('r1'));
    expect(lines()).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(lines()).toHaveLength(0);
  });

  it('update: heightMm 変更で値と lastRidgeInputMm が更新', () => {
    reset();
    useCanvasStore.getState().addRidgeLine(rl('r1', 7000));
    useCanvasStore.getState().updateRidgeLine('r1', { heightMm: 6500 });
    expect(lines()[0].heightMm).toBe(6500);
    expect(useCanvasStore.getState().lastRidgeInputMm).toBe(6500);
  });

  it('move: 端点が更新される', () => {
    reset();
    useCanvasStore.getState().addRidgeLine(rl('r1'));
    useCanvasStore.getState().moveRidgeLine('r1', { x: 5, y: 5 }, { x: 20, y: 5 });
    const r = lines()[0];
    expect(r.p1).toEqual({ x: 5, y: 5 });
    expect(r.p2).toEqual({ x: 20, y: 5 });
  });

  it('removeRidgeLine / removeElement / removeElements で消える(消去ツール対応)', () => {
    reset();
    useCanvasStore.getState().addRidgeLine(rl('r1'));
    useCanvasStore.getState().addRidgeLine(rl('r2'));
    useCanvasStore.getState().addRidgeLine(rl('r3'));
    useCanvasStore.getState().removeRidgeLine('r1');
    expect(lines().map((r) => r.id)).toEqual(['r2', 'r3']);
    useCanvasStore.getState().removeElement('r2');
    expect(lines().map((r) => r.id)).toEqual(['r3']);
    useCanvasStore.getState().removeElements(['r3']);
    expect(lines()).toHaveLength(0);
  });
});
