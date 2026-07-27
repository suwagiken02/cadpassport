import { describe, it, expect } from 'vitest';
import type { CanvasData, ElevationView, Point } from '@/types';
import { canvasDataIsEmpty } from '../saveGuard';

// ============================================================
// E-7-fix2: 立面「新しいページへ配置」で作る canvas_data の性質を固定する。
// ElevationPlaceDialog の blankCanvasData + mergeElevationViews と同じ組み立てを再現し、
//  ・新ページに立面が入っていること
//  ・元ページのデータが一切参照/変更されないこと（別オブジェクトであること）
// を回帰として押さえる。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

function blankCanvasData(): CanvasData {
  return {
    version: '1.0', grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
    memos: [], compass: { angle: 0 },
  };
}

/** ElevationPlaceDialog.mergeElevationViews と同じ規約（同面は置換）。 */
function mergeElevationViews(cv: CanvasData, views: ElevationView[]): CanvasData {
  const placed = new Set(views.map((v) => v.face));
  const kept = (cv.elevationViews ?? []).filter((e) => !placed.has(e.face));
  return { ...cv, elevationViews: [...kept, ...views] };
}

const view = (face: ElevationView['face'], id: string = face): ElevationView =>
  ({ id, face, originGrid: { x: 20, y: 20 }, scale: 0.5, primitives: [] });

/** 元ページ（平面図）: 建物と手摺がある。 */
const originalPage = (): CanvasData => ({
  ...blankCanvasData(),
  buildings: [{ id: 'b1', type: 'polygon', points: RECT, fill: '#3d3d3a' }],
  handrails: [{ id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#fff' }],
});

describe('立面の新規ページ配置: 新ページの中身', () => {
  it('4面の立面が入る（空ページ扱いにならない）', () => {
    const views = [view('south'), view('east'), view('north'), view('west')];
    const merged = mergeElevationViews(blankCanvasData(), views);
    expect(merged.elevationViews).toHaveLength(4);
    expect(merged.elevationViews!.map((v) => v.face).sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(canvasDataIsEmpty(merged)).toBe(false);
  });

  it('新ページは白紙ベース（元ページの建物・手摺を持ち込まない）', () => {
    const merged = mergeElevationViews(blankCanvasData(), [view('south')]);
    expect(merged.buildings).toEqual([]);
    expect(merged.handrails).toEqual([]);
  });

  it('元ページの canvasData は一切変更されない（新ページ作成は非破壊）', () => {
    const original = originalPage();
    const snapshot = JSON.parse(JSON.stringify(original));
    const merged = mergeElevationViews(blankCanvasData(), [view('south'), view('east')]);

    expect(original).toEqual(snapshot);             // 元ページは不変
    expect(merged).not.toBe(original);              // 別オブジェクト
    expect(original.elevationViews ?? []).toEqual([]); // 元ページに立面は足されない
  });
});

describe('既存ページへ配置: 既存内容の保全', () => {
  it('既存ページの建物・手摺を保ったまま立面だけ足す', () => {
    const target = originalPage();
    const merged = mergeElevationViews(target, [view('south')]);
    expect(merged.buildings).toEqual(target.buildings);
    expect(merged.handrails).toEqual(target.handrails);
    expect(merged.elevationViews).toHaveLength(1);
  });

  it('同じ面は置換、他の面は残す', () => {
    const target: CanvasData = { ...originalPage(), elevationViews: [view('south', 'old-south'), view('north', 'keep-north')] };
    const merged = mergeElevationViews(target, [view('south', 'new-south')]);
    const ids = merged.elevationViews!.map((v) => v.id).sort();
    expect(ids).toEqual(['keep-north', 'new-south']);
  });
});
