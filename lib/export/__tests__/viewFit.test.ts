import { describe, it, expect } from 'vitest';
import { fitViewToPrintArea, buildingsCenterGrid, type ViewTransform } from '../viewFit';
import { pdfFileName, getPrintAreaGrid } from '../pdfExport';
import { INITIAL_GRID_PX, ZOOM_MIN, ZOOM_MAX } from '@/lib/konva/gridUtils';

// ============================================================
// E-7-1: PDF 出力前のビュー合わせ。印刷枠がビューポートに収まらないと、背景・グリッドが
// 描かれていない画面外領域が白紙のまま PDF に出る（単一ページ出力にもあった潜在バグ）。
// ============================================================
const FALLBACK: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
const VP = { width: 1000, height: 800 };

describe('fitViewToPrintArea', () => {
  it('印刷枠がビューポートに収まる zoom を返す（短い辺で決まる）', () => {
    const area = { widthGrid: 1000, heightGrid: 1000 }; // 正方形
    const r = fitViewToPrintArea(area, { x: 0, y: 0 }, VP, FALLBACK);
    // 高さ 800 が制約 → zoom = 800/(1000*3) * 0.98
    expect(r.zoom).toBeCloseTo((800 / (1000 * INITIAL_GRID_PX)) * 0.98, 9);
    expect(r.fits).toBe(true);
    // 実寸で収まっていること
    expect(area.widthGrid * INITIAL_GRID_PX * r.zoom).toBeLessThanOrEqual(VP.width);
    expect(area.heightGrid * INITIAL_GRID_PX * r.zoom).toBeLessThanOrEqual(VP.height);
  });

  it('center が画面中央に来る pan を返す', () => {
    const area = { widthGrid: 100, heightGrid: 100 };
    const center = { x: 50, y: 20 };
    const r = fitViewToPrintArea(area, center, VP, FALLBACK);
    const gridPx = INITIAL_GRID_PX * r.zoom;
    expect(center.x * gridPx + r.panX).toBeCloseTo(VP.width / 2, 9);
    expect(center.y * gridPx + r.panY).toBeCloseTo(VP.height / 2, 9);
  });

  it('zoom は ZOOM_MAX / ZOOM_MIN にクランプされる', () => {
    const tiny = fitViewToPrintArea({ widthGrid: 1, heightGrid: 1 }, { x: 0, y: 0 }, VP, FALLBACK);
    expect(tiny.zoom).toBe(ZOOM_MAX);
    const huge = fitViewToPrintArea({ widthGrid: 1e7, heightGrid: 1e7 }, { x: 0, y: 0 }, VP, FALLBACK);
    expect(huge.zoom).toBe(ZOOM_MIN);
    expect(huge.fits).toBe(false); // ZOOM_MIN でも収まらない
  });

  it('印刷枠/中心/ビューポートが無ければ現在のビューをそのまま返す（従来挙動）', () => {
    expect(fitViewToPrintArea(null, { x: 0, y: 0 }, VP, FALLBACK)).toEqual({ ...FALLBACK, fits: false });
    expect(fitViewToPrintArea({ widthGrid: 10, heightGrid: 10 }, null, VP, FALLBACK)).toEqual({ ...FALLBACK, fits: false });
    expect(fitViewToPrintArea({ widthGrid: 10, heightGrid: 10 }, { x: 0, y: 0 }, { width: 0, height: 0 }, FALLBACK))
      .toEqual({ ...FALLBACK, fits: false });
  });

  it('実データ相当: A4横 1/100 の印刷枠が 1000x800 のビューポートに収まる', () => {
    const area = getPrintAreaGrid('A4_landscape', '1/100')!;
    const r = fitViewToPrintArea(area, { x: 100, y: 100 }, VP, FALLBACK);
    expect(r.fits).toBe(true);
    expect(area.widthGrid * INITIAL_GRID_PX * r.zoom).toBeLessThanOrEqual(VP.width);
  });
});

describe('buildingsCenterGrid', () => {
  it('建物の外接矩形の中心', () => {
    const b = [{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }] }];
    expect(buildingsCenterGrid(b)).toEqual({ x: 50, y: 30 });
  });
  it('複数建物をまたいだ中心', () => {
    const b = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { points: [{ x: 90, y: 50 }, { x: 100, y: 60 }] },
    ];
    expect(buildingsCenterGrid(b)).toEqual({ x: 50, y: 30 });
  });
  it('建物なしは null', () => {
    expect(buildingsCenterGrid([])).toBeNull();
  });
});

describe('pdfFileName', () => {
  it('単一ページは従来どおり「_平面図.pdf」', () => {
    expect(pdfFileName('現場A')).toBe('現場A_平面図.pdf');
    expect(pdfFileName('現場A', false)).toBe('現場A_平面図.pdf');
  });
  it('全ページは「_図面一式.pdf」', () => {
    expect(pdfFileName('現場A', true)).toBe('現場A_図面一式.pdf');
  });
  it('現場名なしは「図面」', () => {
    expect(pdfFileName('')).toBe('図面_平面図.pdf');
    expect(pdfFileName(undefined, true)).toBe('図面_図面一式.pdf');
  });
});
