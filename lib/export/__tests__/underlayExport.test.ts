// ============================================================
// U-1 commit 4: 下図を出力に含める。
//
// 補助線（E-8-v5c）と同じ仕組みだが、**既定は「出す」**（補助線とは逆）。
// 背景ごと印刷することがこの機能の目的そのものだから。
// DXF はラスターを載せられないので対象外。contentBounds にも含めない
// （背景は建物より大きいのが普通で、含めると印刷枠が無駄に広がる）。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildDxf } from '../dxfExport';
import { computeContentBounds } from '@/lib/pages/contentBounds';
import { identityTransform } from '@/lib/konva/underlay';
import type { CanvasData, Underlay } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

const base = (over: Partial<CanvasData> = {}): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [{
    id: 'b1', type: 'polygon', fill: '#3d3d3a',
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
  }],
  roofOverhangs: [], obstacles: [],
  handrails: [{ id: 'h1', x: 10, y: 10, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
  posts: [], antis: [], memos: [],
  compass: { angle: 0 },
  ...over,
} as CanvasData);

/** 建物よりずっと大きい下図（枠に入れると印刷範囲が広がる大きさ）。 */
const underlay = (): Underlay => ({
  id: 'u1', storagePath: 'p1/d1/u1.jpg',
  widthPx: 4000, heightPx: 3000,
  transform: { ...identityTransform(), scale: 1, originGrid: { x: -2000, y: -1500 } },
  opacity: 0.5,
});

// ============================================================
describe('DXF は対象外（写真は載せられない）', () => {
  const withU = base({ underlay: underlay() } as Partial<CanvasData>);

  it('下図があっても DXF は変わらない', () => {
    expect(buildDxf(withU)).toBe(buildDxf(base()));
  });

  it('含める指定をしても変わらない（DXF には効かない）', () => {
    expect(buildDxf(withU, { includeAids: true })).toBe(buildDxf(base(), { includeAids: true }));
  });

  it('画像への参照が 1 文字も出ない', () => {
    expect(buildDxf(withU)).not.toContain('u1.jpg');
    expect(buildDxf(withU)).not.toContain('UNDERLAY');
  });

  it('UI でも DXF では選べないことを示す', () => {
    const modal = read('components/output/ExportModal.tsx');
    expect(modal).toMatch(/disabled=\{format === 'dxf'\}/);
    expect(modal).toMatch(/（DXF は写真を出力できません）/);
  });
});

// ============================================================
describe('contentBounds には含めない', () => {
  it('下図があっても枠が変わらない', () => {
    expect(computeContentBounds(base({ underlay: underlay() } as Partial<CanvasData>)))
      .toEqual(computeContentBounds(base()));
  });

  it('補助線のフラグでも変わらない（下図は無関係）', () => {
    const d = base({ underlay: underlay() } as Partial<CanvasData>);
    expect(computeContentBounds(d, { includeAids: true })).toEqual(computeContentBounds(base()));
  });

  it('印刷したい範囲はユーザーが枠で決める（背景で勝手に広げない）', () => {
    const b = computeContentBounds(base({ underlay: underlay() } as Partial<CanvasData>))!;
    expect(b.minX).toBe(0);      // 下図は -2000 まで広がっているが無視される
    expect(b.minY).toBe(0);
  });
});

// ============================================================
describe('PNG / PDF は表示を切り替えて出す', () => {
  const vis = read('lib/export/underlayVisibility.ts');

  it('既定は「出す」（補助線とは逆）', () => {
    expect(vis).toMatch(/const want = include !== false;/);
  });

  it('名前で名指しして切り替える', () => {
    expect(vis).toMatch(/stage\.find\(`\.\$\{UNDERLAY_GROUP_NAME\}`\)/);
  });

  it('すでにその状態なら触らない（戻しすぎない）', () => {
    expect(vis).toMatch(/if \(was === want\) continue;/);
  });

  it('例外が出ても必ず元に戻す', () => {
    expect(vis).toMatch(/\} finally \{[^]*?c\.node\.visible\(c\.was\)/);
  });

  it('画面の「隠す」とは独立して効く（ノードを消さず visible で切る）', () => {
    const layer = read('components/canvas/UnderlayLayer.tsx');
    expect(layer).toMatch(/visible=\{!hidden\}/);
    // hidden ではノードを外さない（外すと出力側から出せなくなる）
    expect(layer).toMatch(/if \(!underlay \|\| !image\) return null;/);
    expect(layer).not.toMatch(/\|\| hidden\) return null;/);
  });
});

// ============================================================
describe('読み込みが間に合わないまま撮らない', () => {
  it('PNG は撮る前に待つ', () => {
    expect(read('lib/export/pngExport.ts'))
      .toMatch(/await whenUnderlayReady\(useCanvasStore\.getState\(\)\.canvasData\.underlay\?\.storagePath\)/);
  });

  it('単ページ PDF も待つ', () => {
    expect(read('app/editor/[id]/page.tsx'))
      .toMatch(/await whenUnderlayReady\(canvasData\.underlay\?\.storagePath\)/);
  });

  it('全ページ PDF はページごとに待つ（ページごとに下図が違う）', () => {
    const multi = read('lib/export/multiPageExport.ts');
    expect(multi).toMatch(/await whenUnderlayReady\(cv\.underlay\?\.storagePath\)/);
    // 差し替えたあとに待つ（差し替え前だと前のページの下図を待ってしまう）
    expect(multi.indexOf('const cv = useCanvasStore.getState().canvasData;'))
      .toBeLessThan(multi.indexOf('await whenUnderlayReady(cv.underlay?.storagePath)'));
  });
});

// ============================================================
describe('チェックは 1 つで、3 経路すべてに渡る', () => {
  const modal = read('components/output/ExportModal.tsx');
  const editor = read('app/editor/[id]/page.tsx');

  it('既定はオン（背景ごと印刷するのが目的）', () => {
    expect(modal).toMatch(/const \[includeUnderlay, setIncludeUnderlay\] = useState\(true\);/);
  });

  it('下図があるページでだけ出す', () => {
    expect(modal).toMatch(/const hasUnderlay = !!useCanvasStore\(\(s\) => s\.canvasData\.underlay\);/);
    expect(modal).toMatch(/\{hasUnderlay && \(/);
  });

  it('PNG / DXF の経路に渡る', () => {
    expect(modal).toMatch(/onExport\(\{ format, paperSize, scale, includeAids, includeUnderlay \}\)/);
  });

  it('「このページのみ」の PDF に渡る', () => {
    expect(modal).toMatch(/allPages, includeAids, includeUnderlay, onProgress/);
  });

  it('「全ページ」はウィザードの状態に載る（ページ遷移で消えない）', () => {
    expect(modal).toMatch(/includeAids,\s*\n\s*includeUnderlay,/);
    expect(read('lib/export/pdfWizard.ts')).toMatch(/includeUnderlay\?: boolean;/);
  });

  it('handleExport が PNG と PDF の両方で使う', () => {
    expect(editor).toMatch(/includeUnderlay: settings\.includeUnderlay,/);
    expect(editor).toMatch(/withUnderlayVisibility\(settings\.includeUnderlay,/);
  });

  it('全ページの出力もくるんでいる', () => {
    expect(read('lib/export/multiPageExport.ts'))
      .toMatch(/withUnderlayVisibility\(settings\.includeUnderlay, async \(\) => \{/);
  });
});

// ============================================================
describe('下図を使っていない図面は 1 ミリも変わらない', () => {
  const legacy = base();

  it('DXF が不変', () => {
    expect('underlay' in legacy).toBe(false);
    expect(buildDxf(legacy, { includeAids: false })).toBe(buildDxf(legacy));
  });

  it('contentBounds が不変', () => {
    expect(computeContentBounds(legacy, { includeAids: false }))
      .toEqual(computeContentBounds(legacy));
  });

  it('出力の切り替えも出ない', () => {
    expect(read('components/output/ExportModal.tsx')).toMatch(/\{hasUnderlay && \(/);
  });
});
