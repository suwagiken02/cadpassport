// ============================================================
// S-1 (commit 1): 敷地境界線のデータとストア。
//
// 敷地は建物（buildings[]）とは**別の入れ物**にしている。buildings[] に混ぜると、
// 足場の自動配置が敷地の外周にも回る／敷地が屋根の親候補になる、といった巻き添えが
// 起きるため。「自動は構造を持つ、手動は自由」の原則どおり、敷地は完全に自由な
// 手描き外形で、足場・屋根・立面・階のどれにも参加しない。
//
// ここで押さえること:
//   ・既存プロジェクト（sitePolygons を持たない JSON）が何も変わらずに開けること
//   ・足す・消す・動かすが、他の配列を 1 つも巻き込まないこと
//   ・undo で戻せること
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasData, SitePolygon } from '@/types';

const st = () => useCanvasStore.getState();
const cv = () => useCanvasStore.getState().canvasData;
const sites = (): SitePolygon[] => cv().sitePolygons ?? [];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

const square = (id: string, x = 0, y = 0, w = 100, h = 80): SitePolygon => ({
  id,
  points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
});

beforeEach(() => {
  st().setCanvasData(blank());
});

// ============================================================
describe('既存プロジェクト（敷地なし）がそのまま開ける', () => {
  it('sitePolygons を持たない図面を読み込むと [] になる', () => {
    const legacy = blank();
    expect('sitePolygons' in legacy).toBe(false);
    st().setCanvasData(legacy);
    expect(cv().sitePolygons).toEqual([]);
  });

  it('他のフィールドは 1 つも変わらない', () => {
    const legacy = {
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon' as const, points: [{ x: 0, y: 0 }], fill: '#3d3d3a' }],
      handrails: [{ id: 'h1', x: 1, y: 2, lengthMm: 1800, direction: 'horizontal' as const, color: '#000' }],
    } as CanvasData;
    st().setCanvasData(legacy);
    expect(cv().buildings).toEqual(legacy.buildings);
    expect(cv().handrails).toEqual(legacy.handrails);
  });

  it('保存済みの敷地はそのまま読める（正規化で消えない）', () => {
    st().setCanvasData({ ...blank(), sitePolygons: [square('site:1')] } as CanvasData);
    expect(sites()).toHaveLength(1);
    expect(sites()[0].points).toHaveLength(4);
  });

  it('新規図面の初期値は空配列', () => {
    expect(Array.isArray(cv().sitePolygons)).toBe(true);
  });
});

// ============================================================
describe('足す', () => {
  it('addSitePolygon で 1 枚増える', () => {
    st().addSitePolygon(square('site:1'));
    expect(sites()).toHaveLength(1);
    expect(sites()[0].id).toBe('site:1');
  });

  it('複数枚持てる（飛び地の敷地）', () => {
    st().addSitePolygon(square('site:1'));
    st().addSitePolygon(square('site:2', 500, 500));
    expect(sites().map((s) => s.id)).toEqual(['site:1', 'site:2']);
  });

  it('外形の点はそのまま入る（丸めない・並べ替えない）', () => {
    const s = square('site:1', 3, 7, 111, 222);
    st().addSitePolygon(s);
    expect(sites()[0].points).toEqual(s.points);
  });

  it('建物には 1 枚も入らない（別の入れ物であること）', () => {
    st().addSitePolygon(square('site:1'));
    expect(cv().buildings).toHaveLength(0);
    expect(cv().obstacles).toHaveLength(0);
    expect(cv().roofs ?? []).toHaveLength(0);
  });

  it('undo で戻せる', () => {
    st().addSitePolygon(square('site:1'));
    expect(sites()).toHaveLength(1);
    st().undo();
    expect(sites()).toHaveLength(0);
  });

  it('保存が必要な状態になる', () => {
    useCanvasStore.setState({ isDirty: false });
    st().addSitePolygon(square('site:1'));
    expect(st().isDirty).toBe(true);
  });
});

// ============================================================
describe('消す', () => {
  beforeEach(() => {
    st().setCanvasData({
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon' as const, points: [{ x: 0, y: 0 }], fill: '#3d3d3a' }],
      sitePolygons: [square('site:1'), square('site:2', 500, 500)],
    } as CanvasData);
  });

  it('removeElement で 1 枚だけ消える', () => {
    st().removeElement('site:1');
    expect(sites().map((s) => s.id)).toEqual(['site:2']);
  });

  it('removeElements でまとめて消える', () => {
    st().removeElements(['site:1', 'site:2']);
    expect(sites()).toHaveLength(0);
  });

  it('建物を消しても敷地は残る（親子関係を持たない）', () => {
    st().removeElement('b1');
    expect(cv().buildings).toHaveLength(0);
    expect(sites()).toHaveLength(2);
  });

  it('敷地を消しても建物は残る', () => {
    st().removeElement('site:1');
    expect(cv().buildings).toHaveLength(1);
  });

  it('undo で戻せる', () => {
    st().removeElement('site:1');
    st().undo();
    expect(sites()).toHaveLength(2);
  });
});

// ============================================================
describe('動かす', () => {
  beforeEach(() => {
    st().setCanvasData({
      ...blank(), sitePolygons: [square('site:1', 10, 20, 100, 80), square('site:2', 500, 500)],
    } as CanvasData);
  });

  it('外形の全頂点が同じだけずれる', () => {
    st().moveElement('site:1', 5, -3);
    expect(sites()[0].points).toEqual([
      { x: 15, y: 17 }, { x: 115, y: 17 }, { x: 115, y: 97 }, { x: 15, y: 97 },
    ]);
  });

  it('形は変わらない（辺の長さが保たれる）', () => {
    const before = sites()[0].points;
    st().moveElement('site:1', 40, 40);
    const after = sites()[0].points;
    for (let i = 0; i < before.length; i++) {
      const j = (i + 1) % before.length;
      expect(Math.hypot(after[j].x - after[i].x, after[j].y - after[i].y))
        .toBe(Math.hypot(before[j].x - before[i].x, before[j].y - before[i].y));
    }
  });

  it('他の敷地は動かない', () => {
    const other = sites()[1].points;
    st().moveElement('site:1', 5, 5);
    expect(sites()[1].points).toEqual(other);
  });

  it('居ない id では何も動かない', () => {
    const before = JSON.stringify(sites());
    st().moveElement('nope', 5, 5);
    expect(JSON.stringify(sites())).toBe(before);
  });
});
