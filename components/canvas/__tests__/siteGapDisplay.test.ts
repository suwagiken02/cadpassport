// ============================================================
// S-6: すき間の距離を「敷地を選んでいる間ずっと」出す。
//
// ・選んだら出る／選択を外したら消える
// ・頂点を動かせば数値も追従する
// ・建物が無ければ何も出ない（落ちない）
// ・S-7 で頂点ドラッグ中の赤いガイドは外したので、ここは青だけになる
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { gapGuides } from '@/lib/konva/siteGapGuides';
import type { CanvasData, Point, SitePolygon } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const siteLayer = read('components/canvas/SiteLayer.tsx');

const st = () => useCanvasStore.getState();

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/**
 * SiteLayer が出す本数を決めている式そのもの。
 *   選んでいる敷地だけを相手にし、ドラッグ中はその頂点を差し替えてから計算する。
 */
const shownGaps = (drag?: { id: string; index: number; point: Point }) => {
  const s = st();
  const chosen = (s.canvasData.sitePolygons ?? []).filter((sp) => s.selectedIds.includes(sp.id));
  if (chosen.length === 0 || s.canvasData.buildings.length === 0) return [];
  const shapes = chosen.map((sp) => ({
    points: drag && drag.id === sp.id
      ? sp.points.map((p, i) => (i === drag.index ? drag.point : p))
      : sp.points,
  }));
  return gapGuides(s.canvasData.buildings, shapes).filter((g) => g.mm > 0);
};

const site: SitePolygon = { id: 'site:1', points: rect(-100, -100, 300, 280) };

beforeEach(() => {
  st().setCanvasData({
    ...blank(),
    buildings: [{ id: 'b1', type: 'polygon', points: rect(0, 0, 100, 80), fill: '#3d3d3a' }],
    sitePolygons: [site],
  } as CanvasData);
  st().setSelectedIds([]);
});

// ============================================================
describe('選んでいる間だけ出る', () => {
  it('選ぶ前は出ない', () => {
    expect(shownGaps()).toHaveLength(0);
  });

  it('敷地を選ぶと出る（矩形なら出隅 4 つ × 2 方向 ＝ 8 本）', () => {
    st().setSelectedIds(['site:1']);
    expect(shownGaps()).toHaveLength(8);
  });

  it('選択を外すと消える', () => {
    st().setSelectedIds(['site:1']);
    expect(shownGaps().length).toBeGreaterThan(0);
    st().setSelectedIds([]);
    expect(shownGaps()).toHaveLength(0);
  });

  it('別のもの（建物）を選んでいるだけでは出ない', () => {
    st().setSelectedIds(['b1']);
    expect(shownGaps()).toHaveLength(0);
  });

  it('選んだ敷地だけが相手になる（選んでいない敷地は無視する）', () => {
    st().setCanvasData({
      ...st().canvasData,
      sitePolygons: [site, { id: 'site:2', points: rect(-300, -300, 900, 900) }],
    } as CanvasData);
    // 内側の site:1 を選べば、そこまでの離れ（1000mm）
    st().setSelectedIds(['site:1']);
    expect(shownGaps().map((g) => g.mm)).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
    // 外側の site:2 だけを選べば、そこまでの離れ（内側の site:1 は相手にしない）
    st().setSelectedIds(['site:2']);
    const far = shownGaps();
    expect(far).toHaveLength(8);
    for (const g of far) expect(g.mm).toBeGreaterThanOrEqual(3000);
  });

  it('つまみと同じ条件でだけ描く（消去・一括移動では出さない）', () => {
    expect(siteLayer).toMatch(/\{editable && gaps\.map/);
  });
});

// ============================================================
describe('形が変われば数値も追従する', () => {
  beforeEach(() => { st().setSelectedIds(['site:1']); });

  it('頂点をドラッグしている間、その向きの数値が変わる', () => {
    const before = shownGaps();
    const left = (gs: typeof before) => gs.filter((g) => g.axis === 'x' && g.to.x < 0).map((g) => g.mm);
    expect(left(before)).toEqual([1000, 1000]);
    // 左上の頂点だけを左へ 100 グリッド動かす → 左辺が斜めになる
    const during = shownGaps({ id: 'site:1', index: 0, point: { x: -200, y: -100 } });
    // 左のすき間はどちらも広がる
    for (const mm of left(during)) expect(mm).toBeGreaterThan(1000);
    // 辺が斜めになったので、上下 2 本の値は別々になる（真横に測っているため）
    expect(left(during)[0]).not.toBe(left(during)[1]);
  });

  it('平行に動かせば、その辺のすき間がそろって変わる', () => {
    // 左辺の 2 頂点を同じだけ動かす（辺は縦のまま）
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 0, { x: -200, y: -100 });
    st().setSitePolygonPoint('site:1', 3, { x: -200, y: 180 });
    const left = shownGaps().filter((g) => g.axis === 'x' && g.to.x < 0).map((g) => g.mm);
    expect(left).toEqual([2000, 2000]);
  });

  it('確定したあとも同じ数値のまま（ドラッグ中と確定後で食い違わない）', () => {
    const during = shownGaps({ id: 'site:1', index: 0, point: { x: -200, y: -100 } });
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 0, { x: -200, y: -100 });
    expect(shownGaps()).toEqual(during);
  });

  it('undo で元の数値に戻る', () => {
    const before = shownGaps();
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 0, { x: -200, y: -100 });
    st().undo();
    expect(shownGaps()).toEqual(before);
  });

  it('建物を動かしても追従する', () => {
    const before = shownGaps();
    st().moveElement('b1', 20, 0);
    expect(shownGaps()).not.toEqual(before);
  });
});

// ============================================================
describe('建物が無い図面', () => {
  beforeEach(() => {
    st().setCanvasData({ ...blank(), sitePolygons: [site] } as CanvasData);
    st().setSelectedIds(['site:1']);
  });

  it('何も出ない（落ちない）', () => {
    expect(() => shownGaps()).not.toThrow();
    expect(shownGaps()).toHaveLength(0);
  });

  it('つまみの経路は生きたまま', () => {
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 0, { x: -150, y: -150 });
    expect(st().canvasData.sitePolygons![0].points[0]).toEqual({ x: -150, y: -150 });
  });
});

// ============================================================
describe('重くしないための作り', () => {
  it('形が変わったときだけ計算する（画面を動かしただけでは計算しない）', () => {
    expect(siteLayer).toMatch(/const gaps = useMemo\(/);
    // 依存は「図形」と「選択」と「ドラッグ中の点」だけ。zoom / panX / panY は入れない
    expect(siteLayer).toMatch(/\}, \[sitePolygons, buildings, selectedIds, drag\]\);/);
  });

  it('画面座標への変換は描くときに行う（計算結果はグリッドのまま）', () => {
    expect(siteLayer).toMatch(/const ax = sx\(g\.from\.x\);/);
  });

  it('選んでいない敷地・建物ゼロでは計算に入る前に切り上げる', () => {
    expect(siteLayer).toMatch(/if \(chosen\.length === 0 \|\| buildings\.length === 0\) return \[\];/);
  });
});

// ============================================================
describe('見た目（控えめに）', () => {
  it('落ち着いた色・細い線・小さい字', () => {
    expect(siteLayer).toMatch(/const GAP_COLOR = '#2563EB';/);
    expect(siteLayer).toMatch(/const GAP_DASH = \[4, 4\];/);
    expect(siteLayer).toMatch(/const GAP_FONT = 11;/);
    // S-7: 赤いガイドは頂点ドラッグから外したので、この層には赤が無い
    expect(siteLayer).not.toMatch(/#EF4444/);
  });

  it('常時表示の線は細い', () => {
    const gap = siteLayer.slice(siteLayer.indexOf('{editable && gaps.map'), siteLayer.indexOf('{/* S-9:'));
    expect(gap).toMatch(/strokeWidth=\{1\}/);
    expect(gap).toMatch(/opacity=\{0\.75\}/);
  });

  it('触れない（操作を邪魔しない）', () => {
    const gap = siteLayer.slice(siteLayer.indexOf('{editable && gaps.map'), siteLayer.indexOf('{/* S-9:'));
    expect((gap.match(/listening=\{false\}/g) ?? []).length).toBe(2);
    expect(gap).not.toMatch(/draggable|onClick|onTap/);
  });

  it('つまみより下に描く（つまみが掴みやすいまま）', () => {
    expect(siteLayer.indexOf('{editable && gaps.map'))
      .toBeLessThan(siteLayer.indexOf('{/* S-4:'));
  });
});

// ============================================================
describe('つまみ側の挙動は変えていない', () => {
  it('S-7: 頂点ドラッグ中の赤いガイドは外した（青だけになる）', () => {
    expect(siteLayer).not.toMatch(/nearestBuildingCornerGuide/);
    expect(siteLayer).not.toMatch(/\{drag && guide/);
  });

  it('つまみのドラッグ・確定・吸着の配線もそのまま', () => {
    expect(siteLayer).toMatch(/onDragStart=\{\(\) => \{[^]*?pushHistory\(\)/);
    expect(siteLayer).toMatch(/setSitePolygonPoint\(site\.id, index/);
    expect(siteLayer).toMatch(/dragBoundFunc=\{\(pos\) => \{/);
    expect(siteLayer).toMatch(/snapSiteVertex\(/);
  });
});
