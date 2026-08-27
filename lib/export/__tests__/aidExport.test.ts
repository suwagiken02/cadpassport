// ============================================================
// E-8-v5c commit 3/4: 補助線を出力に含めるかの切り替え。
//
// 補助線は作図中の目安であって図面の中身ではないので、**既定では出力に含めない**。
// 印刷プレビューのチェック 1 つで PDF / PNG / DXF に共通で効く。
//
// ここで押さえるのは 3 つ:
//   ・フラグ false で補助線が出ない／true で出る（DXF）
//   ・フラグ false で枠が変わらない／true で補助線を含んだ枠になる（contentBounds）
//   ・補助線を使っていない既存の図面は、出力がバイト単位で完全に不変
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildDxf } from '../dxfExport';
import { computeContentBounds } from '@/lib/pages/contentBounds';
import { aidLineFromPoints, newFreePart } from '@/lib/konva/freeParts';
import type { CanvasData, Point } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const base = (over: Partial<CanvasData> = {}): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [{ id: 'b1', type: 'polygon', points: rect(0, 0, 100, 80), fill: '#3d3d3a' }],
  roofOverhangs: [], obstacles: [],
  handrails: [{ id: 'h1', x: 10, y: 10, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
  posts: [], antis: [], memos: [],
  compass: { angle: 0 },
  ...over,
} as CanvasData);

/** 建物の外へ大きくはみ出した補助線と目印。 */
const aids = () => [
  aidLineFromPoints('free:line:1', { x: -500, y: -400 }, { x: 600, y: 500 }),
  newFreePart('point', 'free:point:1', { x: 700, y: -600 }, {}),
];
/** 部材（比較用・補助ではない）。 */
const scaffoldPart = () => newFreePart('rail', 'free:rail:1', { x: 50, y: 40 }, { sizeMm: 1800 });

const countOn = (dxf: string, layer: string) =>
  (dxf.match(new RegExp(`0\\nLINE\\n8\\n${layer}\\n`, 'g')) ?? []).length;
const hasLayerDef = (dxf: string, name: string) =>
  new RegExp(`0\\nLAYER\\n2\\n${name}\\n`).test(dxf);

// ============================================================
describe('DXF: フラグ false で補助線が出ない', () => {
  const data = base({ freeParts: aids() });

  it('補助線の線が 1 本も出ない', () => {
    expect(countOn(buildDxf(data), 'AID')).toBe(0);
    expect(countOn(buildDxf(data, { includeAids: false }), 'AID')).toBe(0);
  });

  it('AID レイヤーの定義そのものが出ない', () => {
    expect(hasLayerDef(buildDxf(data), 'AID')).toBe(false);
    expect(buildDxf(data)).not.toContain('AID');
  });

  it('FREEPART にも紛れ込まない（部材扱いにしていない）', () => {
    expect(countOn(buildDxf(data), 'FREEPART')).toBe(0);
  });

  it('補助線がある図面でも、無い図面と同じ出力になる', () => {
    expect(buildDxf(data)).toBe(buildDxf(base()));
  });

  it('オプションを渡さない従来の呼び方でも含めない（既定 false）', () => {
    expect(buildDxf(data)).toBe(buildDxf(data, {}));
  });
});

// ============================================================
describe('DXF: フラグ true で補助線が出る', () => {
  const data = base({ freeParts: aids() });
  const dxf = buildDxf(data, { includeAids: true });

  it('AID レイヤーが定義される', () => {
    expect(hasLayerDef(dxf, 'AID')).toBe(true);
  });

  it('補助線が線として出る（1 本 ＋ 目印の十字 2 本）', () => {
    expect(countOn(dxf, 'AID')).toBe(3);
  });

  it('FREEPART とは別のレイヤーに出る（部材と混ざらない）', () => {
    expect(countOn(dxf, 'FREEPART')).toBe(0);
  });

  it('部材は従来どおり FREEPART に出る', () => {
    const withBoth = buildDxf(
      base({ freeParts: [...aids(), scaffoldPart()] }), { includeAids: true },
    );
    expect(countOn(withBoth, 'FREEPART')).toBeGreaterThan(0);
    expect(countOn(withBoth, 'AID')).toBe(3);
  });

  it('部材だけの図面では、含める指定をしても AID が出ない', () => {
    const only = buildDxf(base({ freeParts: [scaffoldPart()] }), { includeAids: true });
    expect(hasLayerDef(only, 'AID')).toBe(false);
  });

  it('建物・手摺など既存の中身は変わらない', () => {
    const off = buildDxf(base({ freeParts: aids() }));
    // 増えたぶんは AID の定義行と 3 本の線だけ
    const stripped = dxf
      .replace(/0\nLAYER\n2\nAID\n70\n0\n62\n8\n6\nCONTINUOUS\n/, '')
      .replace(/(0\nLINE\n8\nAID\n(?:1[01]\n-?[\d.]+\n2[01]\n-?[\d.]+\n){2})/g, '');
    expect(stripped).toBe(off);
  });
});

// ============================================================
describe('contentBounds: 同じフラグに従う', () => {
  const withAids = base({ freeParts: aids() });

  it('false なら枠が変わらない（補助線が外へはみ出していても）', () => {
    expect(computeContentBounds(withAids)).toEqual(computeContentBounds(base()));
    expect(computeContentBounds(withAids, { includeAids: false }))
      .toEqual(computeContentBounds(base()));
  });

  it('true なら補助線を含んだ枠になる', () => {
    const b = computeContentBounds(withAids, { includeAids: true })!;
    expect(b.minX).toBeLessThanOrEqual(-500);
    expect(b.minY).toBeLessThanOrEqual(-600);
    expect(b.maxX).toBeGreaterThanOrEqual(700);
    expect(b.maxY).toBeGreaterThanOrEqual(500);
  });

  it('true のほうが枠が広い（印刷範囲に入る）', () => {
    const off = computeContentBounds(withAids)!;
    const on = computeContentBounds(withAids, { includeAids: true })!;
    expect(on.maxX - on.minX).toBeGreaterThan(off.maxX - off.minX);
  });

  it('部材は含めるか否かに関わらず必ず入る', () => {
    const d = base({ freeParts: [scaffoldPart()] });
    expect(computeContentBounds(d)).toEqual(computeContentBounds(d, { includeAids: true }));
  });

  it('補助線だけのページでも、含めなければ枠は建物のまま', () => {
    expect(computeContentBounds(base({ freeParts: aids() })))
      .toEqual(computeContentBounds(base()));
  });
});

// ============================================================
describe('既存の図面（補助線を使っていない）が 1 バイトも変わらない', () => {
  const legacy = base({
    freeParts: [scaffoldPart()],
    stairs: [{ id: 'st1', x: 60, y: 180, angleDeg: 0 }],
    pipes: [{ id: 'pp1', x: 20, y: 30, lengthMm: 3000, angleDeg: 45 }],
    sitePolygons: [{ id: 's1', points: rect(-50, -50, 300, 280) }],
  } as Partial<CanvasData>);

  it('DXF がフラグの有無で変わらない', () => {
    const a = buildDxf(legacy);
    expect(buildDxf(legacy, { includeAids: false })).toBe(a);
    expect(buildDxf(legacy, { includeAids: true })).toBe(a);
  });

  it('contentBounds も変わらない', () => {
    const a = computeContentBounds(legacy);
    expect(computeContentBounds(legacy, { includeAids: false })).toEqual(a);
    expect(computeContentBounds(legacy, { includeAids: true })).toEqual(a);
  });

  it('freeParts を持たない図面でも落ちない', () => {
    const old = base();
    expect('freeParts' in old).toBe(false);
    expect(() => buildDxf(old, { includeAids: true })).not.toThrow();
    expect(() => computeContentBounds(old, { includeAids: true })).not.toThrow();
  });
});

// ============================================================
describe('PNG / PDF はレイヤーを隠して実現する', () => {
  const aidVis = read('lib/export/aidVisibility.ts');

  it('AidLayer を名指しで隠す', () => {
    expect(aidVis).toMatch(/stage\.find\(`\.\$\{AID_LAYER_NAME\}`\)/);
  });

  it('含めるときは何もしない', () => {
    expect(aidVis).toMatch(/if \(includeAids\) return fn\(\);/);
  });

  it('例外が出ても必ず元に戻す', () => {
    expect(aidVis).toMatch(/\} finally \{[^]*?l\.visible\(true\)/);
  });

  it('もともと非表示のレイヤーは触らない（戻しすぎない）', () => {
    expect(aidVis).toMatch(/if \(!l\.visible\(\)\) continue;/);
  });

  it('PNG が通っている', () => {
    expect(read('lib/export/pngExport.ts')).toMatch(/withAidsHidden\(opts\?\.includeAids/);
  });

  it('単ページ PDF が通っている', () => {
    expect(read('app/editor/[id]/page.tsx'))
      .toMatch(/withAidsHidden\(settings\.includeAids, \(\) => withFittedPrintView\(/);
  });

  it('全ページ PDF が通っている（ページ遷移をまたぐ経路）', () => {
    expect(read('lib/export/multiPageExport.ts'))
      .toMatch(/return withAidsHidden\(settings\.includeAids, async \(\) => \{/);
  });
});
