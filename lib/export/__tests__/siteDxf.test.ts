// ============================================================
// S-1 (commit 4): 敷地境界線を DXF に出す。
//
// 決めごと（鮎澤氏の判断）:
//   ・レイヤーは SITE。**敷地があるときだけ**定義を出す
//     ＝敷地を使っていない既存の図面は、出力がバイト単位で完全に不変
//   ・形式は建物と同じ LWPOLYLINE（閉じた外形なので LINE に割らない）
//   ・線種は CONTINUOUS のまま（LTYPE テーブルは今回入れない）
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildDxf } from '../dxfExport';
import { gridToMm } from '@/lib/konva/gridUtils';
import type { CanvasData, SitePolygon } from '@/types';

const base = (over: Partial<CanvasData> = {}): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
  ...over,
} as CanvasData);

/** 既存部材ひとそろい（回帰の基準）。 */
const legacy = (): Partial<CanvasData> => ({
  buildings: [{
    id: 'b1', type: 'polygon' as const, fill: '#3d3d3a',
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
  }],
  handrails: [{ id: 'h1', x: 10, y: 20, lengthMm: 1800, direction: 'horizontal' as const, color: '#000' }],
  posts: [{ id: 'p1', x: 5, y: 6 }],
  antis: [{ id: 'a1', x: 1, y: 2, width: 400 as const, lengthMm: 1800, direction: 'horizontal' as const }],
  memos: [{ id: 'm1', x: 3, y: 4, text: 'メモ' }],
  stairs: [{ id: 'st1', x: 60, y: 180, angleDeg: 0 }],
  pipes: [{ id: 'pp1', x: 20, y: 30, lengthMm: 3000, angleDeg: 45 }],
} as Partial<CanvasData>);

const site: SitePolygon = {
  id: 'site:1',
  points: [{ x: -20, y: -20 }, { x: 140, y: -20 }, { x: 140, y: 120 }, { x: -20, y: 120 }],
};

/** レイヤー名で書かれたエンティティだけを数える。 */
const countOn = (dxf: string, layer: string, type: string) =>
  (dxf.match(new RegExp(`0\\n${type}\\n8\\n${layer}\\n`, 'g')) ?? []).length;

const hasLayerDef = (dxf: string, name: string) =>
  new RegExp(`0\\nLAYER\\n2\\n${name}\\n`).test(dxf);

// ============================================================
describe('敷地が無ければ、出力は 1 バイトも変わらない', () => {
  it('空のページ', () => {
    expect(buildDxf(base({ sitePolygons: [] }))).toBe(buildDxf(base()));
  });

  it('既存部材ひとそろいのページ', () => {
    expect(buildDxf(base({ ...legacy(), sitePolygons: [] }))).toBe(buildDxf(base(legacy())));
  });

  it('sitePolygons を持たない（古い）図面でも壊れない', () => {
    const old = base(legacy());
    expect('sitePolygons' in old).toBe(false);
    expect(() => buildDxf(old)).not.toThrow();
  });

  it('SITE レイヤーの定義そのものが出ない', () => {
    expect(hasLayerDef(buildDxf(base(legacy())), 'SITE')).toBe(false);
    expect(buildDxf(base(legacy()))).not.toContain('SITE');
  });

  it('既存レイヤーの定義は従来どおり全部ある', () => {
    const dxf = buildDxf(base(legacy()));
    for (const name of ['BUILDING', 'ROOF', 'HANDRAIL', 'POST', 'ANTI', 'OBSTACLE',
      'DIMENSION', 'MEMO', 'STAIR', 'PIPE', 'FREEPART']) {
      expect(hasLayerDef(dxf, name), name).toBe(true);
    }
  });
});

// ============================================================
describe('敷地があれば SITE レイヤーに出る', () => {
  const dxf = buildDxf(base({ sitePolygons: [site] }));

  it('SITE レイヤーが定義される', () => {
    expect(hasLayerDef(dxf, 'SITE')).toBe(true);
  });

  it('他のレイヤーと色がぶつからない', () => {
    const colors = (dxf.match(/0\nLAYER\n2\n\w+\n70\n0\n62\n(\d+)\n/g) ?? [])
      .map((s) => s.match(/62\n(\d+)/)![1]);
    const siteColor = dxf.match(/0\nLAYER\n2\nSITE\n70\n0\n62\n(\d+)\n/)![1];
    expect(siteColor).toBe('1');
    // 1 を使っているのは SITE だけ
    expect(colors.filter((c) => c === siteColor)).toHaveLength(1);
  });

  it('閉じたポリライン 1 本で出る（建物と同じ粒度）', () => {
    expect(countOn(dxf, 'SITE', 'LWPOLYLINE')).toBe(1);
    expect(dxf).toContain(`0\nLWPOLYLINE\n8\nSITE\n90\n4\n70\n1\n`);
  });

  it('LINE には割らない', () => {
    expect(countOn(dxf, 'SITE', 'LINE')).toBe(0);
  });

  it('外形の全頂点が mm で出る', () => {
    for (const p of site.points) {
      expect(dxf).toContain(`10\n${gridToMm(p.x)}\n20\n${gridToMm(p.y)}\n`);
    }
  });

  it('複数枚（飛び地）でも全部出る', () => {
    const two = buildDxf(base({
      sitePolygons: [site, { id: 'site:2', points: [{ x: 300, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 400 }] }],
    }));
    expect(countOn(two, 'SITE', 'LWPOLYLINE')).toBe(2);
    expect(two).toContain(`0\nLWPOLYLINE\n8\nSITE\n90\n3\n70\n1\n`);
  });

  it('線種は CONTINUOUS のまま（LTYPE は今回入れない）', () => {
    expect(dxf).toMatch(/0\nLAYER\n2\nSITE\n70\n0\n62\n1\n6\nCONTINUOUS\n/);
    expect(dxf).not.toContain('DASHDOT');
    expect(dxf).not.toContain('LTYPE');
  });
});

// ============================================================
describe('敷地を足しても既存部材の行はそのまま', () => {
  const before = buildDxf(base(legacy()));
  const after = buildDxf(base({ ...legacy(), sitePolygons: [site] }));

  it('建物のポリラインは 1 本のまま（敷地が建物として出ていない）', () => {
    expect(countOn(before, 'BUILDING', 'LWPOLYLINE')).toBe(1);
    expect(countOn(after, 'BUILDING', 'LWPOLYLINE')).toBe(1);
  });

  it('既存部材のエンティティ数が変わらない', () => {
    for (const [layer, type] of [
      ['HANDRAIL', 'LINE'], ['POST', 'CIRCLE'], ['ANTI', 'SOLID'],
      ['STAIR', 'LWPOLYLINE'], ['PIPE', 'LINE'],
    ] as const) {
      expect(countOn(after, layer, type), layer).toBe(countOn(before, layer, type));
    }
  });

  it('DXF の骨格（セクション構造）は従来どおり', () => {
    expect(after).toContain('0\nSECTION\n2\nHEADER\n0\nENDSEC\n');
    expect(after).toContain('0\nSECTION\n2\nTABLES\n');
    expect(after).toContain('0\nSECTION\n2\nENTITIES\n');
    expect(after.endsWith(before.slice(before.lastIndexOf('0\nENDSEC')))).toBe(true);
  });

  it('増えた差分は SITE の定義行とポリラインだけ', () => {
    const removed = after
      .replace(/0\nLAYER\n2\nSITE\n70\n0\n62\n1\n6\nCONTINUOUS\n/, '')
      .replace(/0\nLWPOLYLINE\n8\nSITE\n90\n4\n70\n1\n(?:10\n-?[\d.]+\n20\n-?[\d.]+\n){4}/, '');
    expect(removed).toBe(before);
  });
});
