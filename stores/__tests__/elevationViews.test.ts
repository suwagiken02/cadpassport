import { describe, it, expect } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasData, ElevationView } from '@/types';

const emptyData = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
  memos: [], compass: { angle: 0 },
});

const view = (id: string, face: ElevationView['face']): ElevationView => ({
  id, face, originGrid: { x: 100, y: 100 }, scale: 1,
  primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0, stroke: '#000', width: 1 }],
});

const views = (): ElevationView[] => useCanvasStore.getState().canvasData.elevationViews ?? [];
const reset = () => {
  useCanvasStore.getState().setCanvasData(emptyData());
  useCanvasStore.setState({ history: { past: [], future: [] } });
};

describe('canvasStore: elevationViews (E-4a)', () => {
  it('normalize: 旧データ(欠落)は [] 補完', () => {
    useCanvasStore.getState().setCanvasData(emptyData());
    expect(views()).toEqual([]);
  });

  it('add → 追加、undo で戻る', () => {
    reset();
    useCanvasStore.getState().addElevationView(view('v1', 'north'));
    expect(views()).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(views()).toHaveLength(0);
  });

  it('同じ面を再 add → 置換（1件・最新）', () => {
    reset();
    useCanvasStore.getState().addElevationView(view('v1', 'north'));
    useCanvasStore.getState().addElevationView(view('v2', 'north'));
    expect(views().map((v) => v.id)).toEqual(['v2']);
  });

  it('別の面は共存', () => {
    reset();
    useCanvasStore.getState().addElevationView(view('n', 'north'));
    useCanvasStore.getState().addElevationView(view('s', 'south'));
    expect(views().map((v) => v.id).sort()).toEqual(['n', 's']);
  });

  it('move で originGrid が更新', () => {
    reset();
    useCanvasStore.getState().addElevationView(view('v1', 'north'));
    useCanvasStore.getState().moveElevationView('v1', { x: 200, y: 300 });
    expect(views()[0].originGrid).toEqual({ x: 200, y: 300 });
  });

  it('removeElement で消える(消去ツール対応)', () => {
    reset();
    useCanvasStore.getState().addElevationView(view('v1', 'north'));
    useCanvasStore.getState().removeElement('v1');
    expect(views()).toHaveLength(0);
  });
});
