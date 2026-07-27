import { describe, it, expect } from 'vitest';
import type { CanvasData, ElevationView, Point } from '@/types';
import { canvasDataIsEmpty, checkSaveSafety, needsExistingCheck } from '../saveGuard';

// ============================================================
// E-7-fix2: 立面の「新しいページへ配置」で元ページの内容が消えた件のガード。
// ・遷移直後は store の drawingId だけ先に新ページへ変わり、canvasData は前ページのまま。
//   この窓で保存すると別ページの内容を書き込む（id 取り違え）。
// ・空データで中身のあるページを潰す保存も止める（ワイプガード）。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

function blank(): CanvasData {
  return {
    version: '1.0', grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
    memos: [], compass: { angle: 0 },
  };
}
const withBuilding = (): CanvasData => ({
  ...blank(),
  buildings: [{ id: 'b1', type: 'polygon', points: RECT, fill: '#000' }],
});
const withElevationOnly = (): CanvasData => ({
  ...blank(),
  elevationViews: [{ id: 'e1', face: 'south', originGrid: { x: 0, y: 0 }, scale: 1, primitives: [] } as ElevationView],
});

describe('canvasDataIsEmpty', () => {
  it('白紙は空', () => {
    expect(canvasDataIsEmpty(blank())).toBe(true);
    expect(canvasDataIsEmpty(null)).toBe(true);
  });
  it('建物があれば空でない', () => {
    expect(canvasDataIsEmpty(withBuilding())).toBe(false);
  });
  it('立面ビューだけでも空でない（立面ページを空扱いにしない）', () => {
    expect(canvasDataIsEmpty(withElevationOnly())).toBe(false);
  });
  it('高さマーカー・棟・屋根だけでも空でない', () => {
    expect(canvasDataIsEmpty({ ...blank(), heightMarkers: [{ id: 'h', buildingId: 'b', edgeIndex: 0, t: 0, heightMm: 5000 }] })).toBe(false);
    expect(canvasDataIsEmpty({ ...blank(), ridgeLines: [{ id: 'r', buildingId: 'b', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, heightMm: 5000 }] })).toBe(false);
    expect(canvasDataIsEmpty({ ...blank(), roofs: [{ id: 'rf', buildingId: 'b', roofShape: 'gable', uniformMm: 600 }] })).toBe(false);
  });
});

describe('checkSaveSafety: id 取り違えガード', () => {
  it('メモリ上のデータが保存先と同じ図面なら OK', () => {
    expect(checkSaveSafety({
      targetDrawingId: 'A', loadedDrawingId: 'A', next: withBuilding(), existingIsEmpty: null,
    })).toEqual({ ok: true });
  });

  it('遷移直後（loadedDrawingId が別ページ）は中断 ← 元ページ消失の再現条件', () => {
    // 新ページ B へ遷移した直後: drawingId=B だがメモリは A のデータ。
    const r = checkSaveSafety({
      targetDrawingId: 'B', loadedDrawingId: 'A', next: withBuilding(), existingIsEmpty: null,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('id-mismatch');
  });

  it('ロード未完了（loadedDrawingId=null）も中断', () => {
    const r = checkSaveSafety({
      targetDrawingId: 'A', loadedDrawingId: null, next: withBuilding(), existingIsEmpty: null,
    });
    expect(r.ok === false && r.reason).toBe('id-mismatch');
  });

  it('保存先 id が空でも中断', () => {
    const r = checkSaveSafety({
      targetDrawingId: '', loadedDrawingId: '', next: withBuilding(), existingIsEmpty: null,
    });
    expect(r.ok === false && r.reason).toBe('id-mismatch');
  });
});

describe('checkSaveSafety: 空ワイプガード', () => {
  it('中身のあるページを空データで上書きしようとしたら中断', () => {
    const r = checkSaveSafety({
      targetDrawingId: 'A', loadedDrawingId: 'A', next: blank(), existingIsEmpty: false,
    });
    expect(r.ok === false && r.reason).toBe('blank-overwrite');
  });

  it('既存も空なら空保存を許す（正当な全削除）', () => {
    expect(checkSaveSafety({
      targetDrawingId: 'A', loadedDrawingId: 'A', next: blank(), existingIsEmpty: true,
    })).toEqual({ ok: true });
  });

  it('中身のある保存は既存を確認せず通す', () => {
    expect(needsExistingCheck(withBuilding())).toBe(false);
    expect(checkSaveSafety({
      targetDrawingId: 'A', loadedDrawingId: 'A', next: withBuilding(), existingIsEmpty: null,
    })).toEqual({ ok: true });
  });

  it('空データのときだけ既存の確認が要る', () => {
    expect(needsExistingCheck(blank())).toBe(true);
  });
});
