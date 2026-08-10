// ============================================================
// E-8-v5a commit 2: 登録漏れの防止。
//
// キャンバスの新しい住人（freeParts）は、型と描画だけ足しても住人にならない。
// 「その配列を知らない場所」が 1 つでもあると、そこで静かに落ちる:
//   ・contentBounds を知らない        → PDF/画像の枠から切れる
//   ・crossPageCopy を知らない        → ページ間コピーで消える
//   ・saveGuard を知らない            → 部材だけのページが「空」と判定され保存が止まる
//   ・rangeSelect / 件数表示を知らない → 選べない・全体表示が効かない
// どれもデータ消失に直結するので、機械的に止める（ElevationPlaceDialog の
// ソース走査テストと同じ手法）。
//
// 併せて、既知の未修正問題だった「立面ビューの背景の外に置いた部材が
// PDF 出力で切れる」もここで固定する。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeContentBounds } from '@/lib/pages/contentBounds';
import { canvasDataIsEmpty } from '@/lib/pages/saveGuard';
import { collectIdsInRect } from '@/lib/pages/rangeSelect';
import {
  buildCrossPagePayload, collectSelectionSubset, instantiateSubset, mergePayloadIntoCanvas,
  payloadIds,
} from '@/lib/pages/crossPageCopy';
import { freePartAnchorGrid, freePartsBoundsGrid, newFreePart } from '../freeParts';
import type { CanvasData, ElevationView } from '@/types';

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

/** キャンバスの住人として freeParts を知っていなければならないファイルと、その目印。 */
const MUST_KNOW: [file: string, mark: RegExp][] = [
  ['lib/pages/contentBounds.ts', /freeParts/],
  ['lib/pages/crossPageCopy.ts', /freeParts/],
  ['lib/pages/saveGuard.ts', /freeParts/],
  ['lib/pages/rangeSelect.ts', /freeParts/],
  ['lib/konva/useCanvasInteraction.ts', /freeParts/],
  ['lib/export/dxfExport.ts', /freeParts/],
  ['app/editor/[id]/page.tsx', /freeParts/],
  ['stores/canvasStore.ts', /freeParts/],
  ['components/scaffold/MoveSelectRangePanel.tsx', /freeParts/],
  // 描画レイヤーは配列名ではなくコンポーネントで載る。
  ['components/canvas/GridCanvas.tsx', /FreePartLayer/],
];

const base = (over: Partial<CanvasData> = {}): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
  ...over,
} as CanvasData);

const rail = (id = 'f1', at = { x: 200, y: 100 }) =>
  newFreePart('rail', id, at, { sizeMm: 1800 });

describe('登録漏れをソースで止める', () => {
  it.each(MUST_KNOW)('%s は freeParts を知っている', (p, mark) => {
    expect(mark.test(src(p))).toBe(true);
  });

  it('canvasStore は初期値・正規化・削除・移動の全部で知っている', () => {
    const s = src('stores/canvasStore.ts');
    // createEmptyCanvasData / normalize / removeElement / removeElements / moveElement
    expect((s.match(/freeParts/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(s).toMatch(/freeParts: data\.freeParts \?\? \[\]/);
  });

  it('GridCanvas に描画レイヤーが載っている', () => {
    expect(src('components/canvas/GridCanvas.tsx')).toMatch(/<FreePartLayer \/>/);
  });
});

describe('出力の枠（contentBounds）', () => {
  it('手動部材だけのページでも範囲が出る', () => {
    const b = computeContentBounds(base({ freeParts: [rail()] }));
    expect(b).not.toBeNull();
    const fb = freePartsBoundsGrid([rail()])!;
    expect(b!.minX).toBeLessThanOrEqual(fb.minX);
    expect(b!.maxX).toBeGreaterThanOrEqual(fb.maxX);
  });

  it('部材が枠に含まれる（PDF/画像で切れない）', () => {
    const far = rail('f1', { x: 5000, y: -3000 });
    const b = computeContentBounds(base({
      buildings: [{ id: 'b1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }],
      freeParts: [far],
    } as Partial<CanvasData>))!;
    const a = freePartAnchorGrid(far)!;
    expect(b.maxX).toBeGreaterThanOrEqual(a.x);
    expect(b.minY).toBeLessThanOrEqual(a.y);
  });

  it('無ければ従来どおり（何も足さない）', () => {
    const cv = base({ buildings: [{ id: 'b1', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] } as Partial<CanvasData>);
    expect(computeContentBounds(cv)).toEqual(computeContentBounds({ ...cv, freeParts: [] }));
  });
});

describe('立面ビューの背景の外に置いた部材が切れない（既知の未修正問題）', () => {
  /** 背景は原点まわりの小さな絵。部材だけ遠くに置いてある立面ビュー。 */
  const viewWithFarPart = (): ElevationView => ({
    id: 'v1', face: 'north', originGrid: { x: 0, y: 0 }, scale: 1,
    primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#fff' }],
    parts: [{
      id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 20000, x1Mm: 21800, levelMm: 3000,
    }],
    geom: { minXg: 0, scaffolds: [] },
  } as ElevationView);

  it('部材のぶんまで枠が伸びる', () => {
    const b = computeContentBounds(base({ elevationViews: [viewWithFarPart()] }))!;
    expect(b.maxX).toBeGreaterThanOrEqual(2000);   // 20000mm = 2000 グリッド
    expect(b.minY).toBeLessThanOrEqual(-300);      // 高さ 3000mm = -300 グリッド
  });

  it('部材の無い旧ビューは従来どおり背景だけ', () => {
    const plain: ElevationView = {
      id: 'v2', face: 'north', originGrid: { x: 0, y: 0 }, scale: 1,
      primitives: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#fff' }],
    } as ElevationView;
    const b = computeContentBounds(base({ elevationViews: [plain] }))!;
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
  });
});

describe('保存の安全ガード（saveGuard）', () => {
  it('手動部材だけのページは「空」ではない', () => {
    expect(canvasDataIsEmpty(base())).toBe(true);
    expect(canvasDataIsEmpty(base({ freeParts: [rail()] }))).toBe(false);
  });
});

describe('範囲選択（rangeSelect）', () => {
  it('矩形に入れば選ばれる', () => {
    const cv = base({ freeParts: [rail('f1', { x: 50, y: 50 })] });
    expect(collectIdsInRect(cv, { x: 0, y: 0, w: 200, h: 200 })).toContain('f1');
  });

  it('矩形の外なら選ばれない', () => {
    const cv = base({ freeParts: [rail('f1', { x: 5000, y: 5000 })] });
    expect(collectIdsInRect(cv, { x: 0, y: 0, w: 200, h: 200 })).not.toContain('f1');
  });
});

describe('ページ間コピー（crossPageCopy）', () => {
  it('選択に含めれば運ばれる（id は振り直し）', () => {
    const cv = base({ freeParts: [rail('f1'), rail('f2', { x: 400, y: 100 })] });
    const { payload } = buildCrossPagePayload(cv, ['f1']);
    expect(payload.freeParts).toHaveLength(1);
    expect(payload.freeParts[0].id).not.toBe('f1');
    expect(payloadIds(payload)).toEqual([payload.freeParts[0].id]);
  });

  it('貼り付け先の配列に足される（既存は失われない）', () => {
    const cv = base({ freeParts: [rail('f1')] });
    const { payload } = buildCrossPagePayload(cv, ['f1']);
    const merged = mergePayloadIntoCanvas(base({ freeParts: [rail('other', { x: 0, y: 0 })] }), payload);
    expect(merged.freeParts).toHaveLength(2);
  });

  it('オフセットぶんだけ位置がずれる（自由座標に効く）', () => {
    const cv = base({ freeParts: [rail('f1', { x: 100, y: 100 })] });
    const { subset } = collectSelectionSubset(cv, ['f1']);
    const out = instantiateSubset(subset, { x: 30, y: -20 });
    const a = freePartAnchorGrid(out.freeParts[0])!;
    expect(a.x).toBeCloseTo(130);
    expect(a.y).toBeCloseTo(80);
  });

  it('選んでいなければ運ばれない', () => {
    const cv = base({ freeParts: [rail('f1')] });
    expect(buildCrossPagePayload(cv, []).payload.freeParts).toEqual([]);
  });
});
