// ============================================================
// E-7-fix5: PDF が赤い印刷枠の外まで印刷される件。
//
// ■ 実際の原因
// 印刷枠の中心の決め方が、**3 か所に別々に書かれていた**。
//   ・画面に描く側（GridCanvas） … 建物の中心、無ければ画面の中央
//   ・ビューを寄せる側（exportViewport） … 建物の中心、無ければ null
//   ・PDF を切り取る側（pdfExport） … 建物の中心、無ければ **null**
// 切り取る側は `if (area && center)` で守られていたため、**建物がまだ無い図面では
// 中心が決まらず、切り取りそのものを飛ばして全体を PDF に入れていた**。
// 一度でも枠を動かせば printAreaCenter が入って直る、という症状と一致する。
//
// 直し方は座標の調整ではなく、**中心の決め方を 1 本にする**こと。
// あわせて、枠を出した時点で中心を確定させ、出力側が既定値に頼らないようにした。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildingsCenterGrid, resolvePrintAreaCenter } from '../viewFit';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

const viewport = { width: 800, height: 600 };
const view = { zoom: 1, panX: 0, panY: 0 };
const building = (x: number, y: number, w: number, h: number) =>
  ({ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });

// ============================================================
describe('不具合の再現 — 建物が無いと中心が決まらなかった', () => {
  it('建物が無ければ、建物からは中心を出せない', () => {
    // これが null を返し、切り取る側の `if (area && center)` が偽になっていた
    expect(buildingsCenterGrid([])).toBeNull();
  });

  it('直したあと: 建物が無くても必ず中心が決まる（null を返さない）', () => {
    const c = resolvePrintAreaCenter(null, [], viewport, view, INITIAL_GRID_PX);
    expect(c).not.toBeNull();
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
  });

  it('建物が無いときは画面の中央（描く側が出していた位置と同じ）', () => {
    const gridPx = INITIAL_GRID_PX * view.zoom;
    expect(resolvePrintAreaCenter(null, [], viewport, view, INITIAL_GRID_PX)).toEqual({
      x: (viewport.width / 2 - view.panX) / gridPx,
      y: (viewport.height / 2 - view.panY) / gridPx,
    });
  });
});

// ============================================================
describe('中心の決め方は 1 本（優先順）', () => {
  it('ユーザーが決めた位置がいちばん強い', () => {
    expect(resolvePrintAreaCenter({ x: 123, y: 456 }, [building(0, 0, 100, 100)], viewport, view, INITIAL_GRID_PX))
      .toEqual({ x: 123, y: 456 });
  });

  it('決めていなければ建物の中心', () => {
    expect(resolvePrintAreaCenter(null, [building(0, 0, 100, 80)], viewport, view, INITIAL_GRID_PX))
      .toEqual({ x: 50, y: 40 });
  });

  it('建物が複数なら全体の中心', () => {
    expect(resolvePrintAreaCenter(null, [building(0, 0, 100, 100), building(100, 100, 100, 100)], viewport, view, INITIAL_GRID_PX))
      .toEqual({ x: 100, y: 100 });
  });

  it('建物も無ければ画面の中央', () => {
    const c = resolvePrintAreaCenter(null, [], viewport, { zoom: 2, panX: -100, panY: -50 }, INITIAL_GRID_PX);
    expect(c.x).toBeCloseTo((400 + 100) / (INITIAL_GRID_PX * 2), 9);
    expect(c.y).toBeCloseTo((300 + 50) / (INITIAL_GRID_PX * 2), 9);
  });

  it('undefined でも決まる', () => {
    expect(resolvePrintAreaCenter(undefined, [building(0, 0, 10, 10)], viewport, view, INITIAL_GRID_PX))
      .toEqual({ x: 5, y: 5 });
  });

  it('ズームが 0 でも落ちない', () => {
    expect(resolvePrintAreaCenter(null, [], viewport, { zoom: 0, panX: 0, panY: 0 }, INITIAL_GRID_PX))
      .toEqual({ x: 0, y: 0 });
  });
});

// ============================================================
describe('★ 一度も動かしていない初期状態でも、正しい値が渡る', () => {
  const modal = read('components/output/ExportModal.tsx');

  it('枠を出した時点で中心を確定させる', () => {
    expect(modal).toMatch(/if \(!showPrintArea\) toggleShowPrintArea\(\);/);
    expect(modal).toMatch(/if \(!st\.printAreaCenter\) \{[^]*?st\.setPrintAreaCenter\(resolvePrintAreaCenter\(/);
  });

  it('すでに決まっていれば上書きしない（ユーザーの指定を消さない）', () => {
    expect(modal).toMatch(/if \(!st\.printAreaCenter\)/);
  });

  it('ビューを寄せる前に決める（寄せたあとだと画面の中央がずれる）', () => {
    const body = modal.slice(modal.indexOf('const handleConfirmSettings'));
    expect(body.indexOf('setPrintAreaCenter(resolvePrintAreaCenter('))
      .toBeLessThan(body.indexOf('zoomToFitPrintArea('));
  });
});

// ============================================================
describe('3 か所が同じ 1 本を通る（別々の既定値を持たない）', () => {
  const grid = read('components/canvas/GridCanvas.tsx');
  const pdf = read('lib/export/pdfExport.ts');
  const vp = read('lib/export/exportViewport.ts');

  it('描く側', () => {
    expect(grid).toMatch(/const centerGrid = resolvePrintAreaCenter\(/);
  });

  it('ビューを寄せる側', () => {
    expect(vp).toMatch(/const center = resolvePrintAreaCenter\(/);
  });

  it('PDF を切り取る側', () => {
    expect(pdf).toMatch(/const center = resolvePrintAreaCenter\(/);
  });

  it('切り取る側が独自の既定値を持たない（ここが原因だった）', () => {
    expect(pdf).not.toMatch(/printAreaCenterがnullの場合は建物の中心を使う/);
    expect(pdf).not.toMatch(/let center = printAreaCenter;/);
  });

  it('描く側も独自の既定値を持たない', () => {
    expect(grid).not.toMatch(/let centerGrid: \{ x: number; y: number \};/);
  });

  it('寄せる側も独自の既定値を持たない', () => {
    expect(vp).not.toMatch(/printAreaCenter \?\? buildingsCenterGrid/);
  });
});

// ============================================================
describe('全ページでも同じ（ページごとに枠を指定する経路）', () => {
  const wizard = read('components/export/PdfPageWizardBar.tsx');
  const multi = read('lib/export/multiPageExport.ts');

  it('ページごとの中心を出力へ渡している', () => {
    expect(multi).toMatch(/const center = centers\?\.\[p\.id\] \?\? \(isCurrent \? useCanvasStore\.getState\(\)\.printAreaCenter : null\);/);
  });

  it('渡した中心で切り取る（寄せる側と同じ値）', () => {
    expect(multi).toMatch(/withFittedPrintView\(cv, settings\.paperSize, settings\.scale, center,/);
    expect(multi).toMatch(/printAreaCenter: center,/);
  });

  it('ウィザードは枠を確定して次のページへ進む', () => {
    expect(wizard).toMatch(/const center = useCanvasStore\.getState\(\)\.printAreaCenter;/);
  });
});

// ============================================================
describe('全ページも、枠を指定していないページで中心が決まる', () => {
  const wizard = read('components/export/PdfPageWizardBar.tsx');

  it('指定が無ければ既定の中心を入れる', () => {
    expect(wizard).toMatch(/centerForPage\(wizard\.centers, page\.id\) \?\? resolvePrintAreaCenter\(/);
  });

  it('指定があればそちらを使う（ユーザーの指定を消さない）', () => {
    expect(wizard).toMatch(/centerForPage\(wizard\.centers, page\.id\) \?\?/);
  });

  it('ビューを寄せる前に決める', () => {
    expect(wizard.indexOf('setPrintAreaCenter(centerForPage'))
      .toBeLessThan(wizard.indexOf('zoomToFitPrintArea(vw, vh)'));
  });
});
