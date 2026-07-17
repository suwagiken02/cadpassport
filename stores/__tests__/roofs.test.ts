import { describe, it, expect } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import type { BuildingShape, CanvasData, Roof } from '@/types';

const RECT: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000',
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }],
  roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null, roofShape: 'hip' },
};

// roofs を省いた旧データ（lift 対象）。
const legacyData = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [RECT], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
  memos: [], compass: { angle: 0 },
});

const roofs = (): Roof[] => useCanvasStore.getState().canvasData.roofs ?? [];
const roof = (id: string, edgeRange: number[]): Roof =>
  ({ id, buildingId: 'B', edgeRange, roofShape: 'gable', uniformMm: 600 });

describe('canvasStore: roofs lift (R-1d)', () => {
  it('roofs 未定義の旧データは building.roof から全周 Roof へ lift される', () => {
    useCanvasStore.getState().setCanvasData(legacyData());
    const rs = roofs();
    expect(rs).toHaveLength(1);
    expect(rs[0].buildingId).toBe('B');
    expect(rs[0].edgeRange).toEqual([0, 1, 2, 3]);
    expect(rs[0].edgeOverhangsMm).toEqual({ 0: 600, 1: 600, 2: 600, 3: 600 });
  });

  it('lift は冪等: 既に roofs があれば再 lift しない（尊重）', () => {
    const data = { ...legacyData(), roofs: [roof('keep', [0])] };
    useCanvasStore.getState().setCanvasData(data);
    expect(roofs()).toHaveLength(1);
    expect(roofs()[0].id).toBe('keep'); // lift されず元のまま
  });

  it('屋根なし建物のみなら roofs は空（lift されない）', () => {
    useCanvasStore.getState().setCanvasData({ ...legacyData(), buildings: [{ ...RECT, roof: undefined }] });
    expect(roofs()).toEqual([]);
  });
});

describe('canvasStore: roofs CRUD + undo (R-1d)', () => {
  const reset = () => {
    useCanvasStore.getState().setCanvasData({ ...legacyData(), roofs: [] });
    useCanvasStore.setState({ history: { past: [], future: [] } });
  };

  it('add → undo で戻る', () => {
    reset();
    useCanvasStore.getState().addRoof(roof('r1', [0, 1]));
    expect(roofs()).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(roofs()).toHaveLength(0);
  });

  it('update → patch 反映・undo で戻る', () => {
    reset();
    useCanvasStore.getState().addRoof(roof('r1', [0]));
    useCanvasStore.getState().updateRoof('r1', { uniformMm: 900 });
    expect(roofs()[0].uniformMm).toBe(900);
    useCanvasStore.getState().undo();
    expect(roofs()[0].uniformMm).toBe(600);
  });

  it('remove → undo で戻る', () => {
    reset();
    useCanvasStore.getState().addRoof(roof('r1', [0]));
    useCanvasStore.getState().removeRoof('r1');
    expect(roofs()).toHaveLength(0);
    useCanvasStore.getState().undo();
    expect(roofs()).toHaveLength(1);
  });

  it('建物削除でその子屋根も除去（孤児防止）', () => {
    reset();
    useCanvasStore.getState().addRoof(roof('r1', [0]));
    useCanvasStore.getState().removeElement('B'); // building id = 'B'
    expect(roofs()).toEqual([]);
  });
});
