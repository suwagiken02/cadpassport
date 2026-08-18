// ============================================================
// S-1 (commit 5): 敷地境界線を、範囲選択・ページ間コピー・まとめ移動・
// ページの範囲計算・空判定へ登録する。
//
// ここを飛ばすと、実機では次の形で出る:
//   ・範囲でぐるっと囲んでも敷地だけ選ばれない
//   ・ページを複製すると敷地だけ消える
//   ・敷地が建物の外に広がっているのに PDF/画像の枠が建物までしか取れず、切れる
//   ・敷地だけ描いたページが「空」と判定されて保存が止まる
// ============================================================
import { describe, it, expect } from 'vitest';
import { collectIdsInRect } from '../rangeSelect';
import { computeContentBounds } from '../contentBounds';
import { canvasDataIsEmpty } from '../saveGuard';
import {
  buildCrossPagePayload, mergePayloadIntoCanvas, payloadCount,
} from '../crossPageCopy';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasData, SitePolygon } from '@/types';

const base = (over: Partial<CanvasData> = {}): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
  ...over,
} as CanvasData);

/** 建物より外に広がる敷地。 */
const site = (id = 'site:1', d = 0): SitePolygon => ({
  id,
  points: [
    { x: -50 + d, y: -40 + d }, { x: 150 + d, y: -40 + d },
    { x: 150 + d, y: 120 + d }, { x: -50 + d, y: 120 + d },
  ],
});

const building = {
  id: 'b1', type: 'polygon' as const, fill: '#3d3d3a',
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
};

// ============================================================
describe('範囲選択で拾える', () => {
  const cv = base({ buildings: [building], sitePolygons: [site()] });

  it('全部を囲めば敷地も選ばれる', () => {
    expect(collectIdsInRect(cv, { x: -200, y: -200, w: 600, h: 600 })).toContain('site:1');
  });

  it('外形の頂点がひとつでも入れば拾う（建物と同じ判定）', () => {
    // 敷地の左上の角だけを囲む
    const ids = collectIdsInRect(cv, { x: -60, y: -50, w: 20, h: 20 });
    expect(ids).toContain('site:1');
    expect(ids).not.toContain('b1');
  });

  it('どの頂点も入らなければ拾わない', () => {
    expect(collectIdsInRect(cv, { x: 300, y: 300, w: 50, h: 50 })).not.toContain('site:1');
  });

  it('敷地が無いページの結果は変わらない', () => {
    const noSite = base({ buildings: [building] });
    expect(collectIdsInRect(noSite, { x: -200, y: -200, w: 600, h: 600 })).toEqual(['b1']);
  });

  it('飛び地の敷地も別々に拾える', () => {
    const two = base({ sitePolygons: [site('site:1'), site('site:2', 400)] });
    expect(collectIdsInRect(two, { x: -200, y: -200, w: 400, h: 400 })).toEqual(['site:1']);
    expect(collectIdsInRect(two, { x: -200, y: -200, w: 900, h: 900 }))
      .toEqual(['site:1', 'site:2']);
  });
});

// ============================================================
describe('ページの範囲に入る（出力の枠が切れない）', () => {
  it('建物より外へ広がる敷地まで含まれる', () => {
    const b = computeContentBounds(base({ buildings: [building], sitePolygons: [site()] }))!;
    expect(b.minX).toBeLessThanOrEqual(-50);
    expect(b.minY).toBeLessThanOrEqual(-40);
    expect(b.maxX).toBeGreaterThanOrEqual(150);
    expect(b.maxY).toBeGreaterThanOrEqual(120);
  });

  it('敷地だけのページでも範囲が取れる', () => {
    const b = computeContentBounds(base({ sitePolygons: [site()] }));
    expect(b).not.toBeNull();
    expect(b!.maxX - b!.minX).toBe(200);
  });

  it('敷地が無いページの範囲は変わらない', () => {
    expect(computeContentBounds(base({ buildings: [building] })))
      .toEqual(computeContentBounds(base({ buildings: [building], sitePolygons: [] })));
  });
});

// ============================================================
describe('空判定', () => {
  it('敷地だけ描いたページは空ではない', () => {
    expect(canvasDataIsEmpty(base({ sitePolygons: [site()] }))).toBe(false);
  });

  it('何も無いページは従来どおり空', () => {
    expect(canvasDataIsEmpty(base())).toBe(true);
    expect(canvasDataIsEmpty(base({ sitePolygons: [] }))).toBe(true);
  });
});

// ============================================================
describe('ページ間コピー', () => {
  const cv = base({ buildings: [building], sitePolygons: [site()] });
  let n = 0;
  const genId = () => `new:${++n}`;

  it('選択に含めるとペイロードへ入る', () => {
    n = 0;
    const { payload } = buildCrossPagePayload(cv, ['site:1'], genId);
    expect(payload.sitePolygons).toHaveLength(1);
    expect(payloadCount(payload)).toBe(1);
  });

  it('新しい id が振られる（元と衝突しない）', () => {
    n = 0;
    const { payload } = buildCrossPagePayload(cv, ['site:1'], genId);
    expect(payload.sitePolygons[0].id).not.toBe('site:1');
  });

  it('元の id は「移動時に消す対象」として返る', () => {
    n = 0;
    const { sourceIds } = buildCrossPagePayload(cv, ['site:1'], genId);
    expect(sourceIds).toContain('site:1');
  });

  it('外形は形を保ったまま入る', () => {
    n = 0;
    const { payload } = buildCrossPagePayload(cv, ['site:1'], genId);
    expect(payload.sitePolygons[0].points).toEqual(site().points);
  });

  it('貼り付け先のページに追記される（既存の敷地は消えない）', () => {
    n = 0;
    const { payload } = buildCrossPagePayload(cv, ['site:1'], genId);
    const target = base({ sitePolygons: [site('other')] });
    const merged = mergePayloadIntoCanvas(target, payload);
    expect(merged.sitePolygons).toHaveLength(2);
    expect(merged.sitePolygons!.map((s) => s.id)).toContain('other');
  });

  it('敷地を選んでいなければ 1 枚も入らない', () => {
    n = 0;
    const { payload } = buildCrossPagePayload(cv, ['b1'], genId);
    expect(payload.sitePolygons).toHaveLength(0);
  });

  it('敷地が無いページのコピー結果は変わらない', () => {
    n = 0;
    const a = buildCrossPagePayload(base({ buildings: [building] }), ['b1'], () => 'fixed');
    n = 0;
    const b = buildCrossPagePayload(base({ buildings: [building], sitePolygons: [] }), ['b1'], () => 'fixed');
    expect(a.payload).toEqual(b.payload);
  });
});

// ============================================================
describe('まとめ移動', () => {
  const st = () => useCanvasStore.getState();

  it('「建物」カテゴリで選ぶと、敷地も実際に動く', () => {
    st().setCanvasData(base({ buildings: [building], sitePolygons: [site()] }));
    useCanvasStore.setState({
      moveSelectMode: {
        active: true, step: 'move',
        categories: { scaffold: false, building: true, obstacle: false, memo: false },
        selectedIds: ['site:1'], dxMm: 0, dyMm: 0,
        backup: st().canvasData,
      },
    });
    st().shiftMoveSelected(100, 200);   // mm → grid 10 / 20
    expect(st().canvasData.sitePolygons![0].points[0]).toEqual({ x: -40, y: -20 });
  });

  it('選んでいない敷地は動かない', () => {
    st().setCanvasData(base({ sitePolygons: [site('site:1'), site('site:2', 400)] }));
    useCanvasStore.setState({
      moveSelectMode: {
        active: true, step: 'move',
        categories: { scaffold: false, building: true, obstacle: false, memo: false },
        selectedIds: ['site:1'], dxMm: 0, dyMm: 0,
        backup: st().canvasData,
      },
    });
    st().shiftMoveSelected(100, 0);
    expect(st().canvasData.sitePolygons![1].points).toEqual(site('site:2', 400).points);
  });

  it('「建物」カテゴリを外していれば動かない', () => {
    st().setCanvasData(base({ sitePolygons: [site()] }));
    useCanvasStore.setState({
      moveSelectMode: {
        active: true, step: 'move',
        categories: { scaffold: true, building: false, obstacle: false, memo: false },
        selectedIds: ['site:1'], dxMm: 0, dyMm: 0,
        backup: st().canvasData,
      },
    });
    st().shiftMoveSelected(100, 100);
    expect(st().canvasData.sitePolygons![0].points).toEqual(site().points);
  });
});
