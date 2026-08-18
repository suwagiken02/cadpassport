// ============================================================
// S-3 (commit 2): 敷地の自動生成をストアから叩く。
//
// いちばん大事なのは「作られた敷地が、手で描いた敷地と**完全に同じ扱い**になること」。
// 自動生成の目印を持たせていないので、選択・移動・削除・DXF・ページ複製は
// すべて S-1 の仕組みがそのまま効く。ここではそれを実際に叩いて確かめる。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { buildDxf } from '@/lib/export/dxfExport';
import { collectIdsInRect } from '@/lib/pages/rangeSelect';
import { buildCrossPagePayload } from '@/lib/pages/crossPageCopy';
import { canvasDataIsEmpty } from '@/lib/pages/saveGuard';
import type { BuildingShape, CanvasData, Point, SitePolygon } from '@/types';

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

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const building = (id: string, pts: Point[]): BuildingShape => ({
  id, type: 'polygon', points: pts, fill: '#3d3d3a',
});

/** 建物 1 棟（10m × 8m）だけの図面。 */
const oneBuilding = () => {
  st().setCanvasData({ ...blank(), buildings: [building('b1', rect(0, 0, 1000, 800))] } as CanvasData);
};

beforeEach(() => {
  st().setCanvasData(blank());
});

// ============================================================
describe('作る', () => {
  it('建物 1 棟から敷地が 1 枚できる', () => {
    oneBuilding();
    expect(st().generateSitePolygons(1000)).toBe(1);
    expect(sites()).toHaveLength(1);
  });

  it('外壁から指定距離だけ外側にできている', () => {
    oneBuilding();
    st().generateSitePolygons(1000);
    const xs = sites()[0].points.map((p) => p.x);
    const ys = sites()[0].points.map((p) => p.y);
    expect(Math.min(...xs)).toBe(-100);
    expect(Math.min(...ys)).toBe(-100);
    expect(Math.max(...xs)).toBe(1100);
    expect(Math.max(...ys)).toBe(900);
  });

  it('接する 2 棟はひとつにまとまる（棟ごとに作らない）', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [building('b1', rect(0, 0, 100, 100)), building('b2', rect(100, 0, 100, 100))],
    } as CanvasData);
    expect(st().generateSitePolygons(1000)).toBe(1);
  });

  it('建物が無ければ何も作らない（履歴も汚さない）', () => {
    const before = st().history.past.length;
    expect(st().generateSitePolygons(1000)).toBe(0);
    expect(sites()).toHaveLength(0);
    expect(st().history.past.length).toBe(before);
  });

  it('すでに敷地があれば置き換えずに増やす', () => {
    oneBuilding();
    st().addSitePolygon({ id: 'hand:1', points: rect(-500, -500, 100, 100) });
    st().generateSitePolygons(1000);
    expect(sites()).toHaveLength(2);
    expect(sites()[0].id).toBe('hand:1');         // 手描きが残っている
    expect(sites()[0].points).toEqual(rect(-500, -500, 100, 100));
  });

  it('続けて押すとそのぶん増える', () => {
    oneBuilding();
    st().generateSitePolygons(1000);
    st().generateSitePolygons(2000);
    expect(sites()).toHaveLength(2);
    expect(Math.min(...sites()[1].points.map((p) => p.x))).toBe(-200);
  });

  it('undo で戻せる', () => {
    oneBuilding();
    st().generateSitePolygons(1000);
    expect(sites()).toHaveLength(1);
    st().undo();
    expect(sites()).toHaveLength(0);
  });

  it('保存が必要な状態になる', () => {
    oneBuilding();
    useCanvasStore.setState({ isDirty: false });
    st().generateSitePolygons(1000);
    expect(st().isDirty).toBe(true);
  });

  it('建物・障害物・足場は 1 つも変わらない（見るのは buildings だけ）', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [building('b1', rect(0, 0, 1000, 800))],
      obstacles: [{ id: 'o1', type: 'aircon', x: 2000, y: 2000, width: 80, height: 30 }],
      handrails: [{ id: 'h1', x: 3000, y: 3000, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
    } as CanvasData);
    const before = JSON.stringify({ b: cv().buildings, o: cv().obstacles, h: cv().handrails });
    st().generateSitePolygons(1000);
    expect(JSON.stringify({ b: cv().buildings, o: cv().obstacles, h: cv().handrails })).toBe(before);
    // 障害物は遠くにあるが、敷地は建物だけを囲んでいる
    expect(Math.max(...sites()[0].points.map((p) => p.x))).toBe(1100);
  });
});

// ============================================================
describe('作られた敷地は、手で描いた敷地とまったく同じ扱い', () => {
  beforeEach(() => {
    oneBuilding();
    st().generateSitePolygons(1000);
  });

  it('特別な属性を持たない（id と points だけ）', () => {
    expect(Object.keys(sites()[0]).sort()).toEqual(['id', 'points']);
  });

  it('手描きの敷地と見分けがつかない（同じ形の素のオブジェクト）', () => {
    st().addSitePolygon({ id: 'hand:1', points: rect(0, 0, 10, 10) });
    const [auto, hand] = sites();
    expect(Object.keys(auto).sort()).toEqual(Object.keys(hand).sort());
  });

  it('removeElement で消せる', () => {
    st().removeElement(sites()[0].id);
    expect(sites()).toHaveLength(0);
  });

  it('moveElement で動く（外形の全頂点がずれる）', () => {
    const id = sites()[0].id;
    const before = sites()[0].points.map((p) => ({ ...p }));
    st().moveElement(id, 25, -13);
    sites()[0].points.forEach((p, i) => {
      expect(p.x).toBe(before[i].x + 25);
      expect(p.y).toBe(before[i].y - 13);
    });
  });

  it('DXF に SITE レイヤーで出る', () => {
    const dxf = buildDxf(cv());
    expect(dxf).toMatch(/0\nLAYER\n2\nSITE\n/);
    expect((dxf.match(/0\nLWPOLYLINE\n8\nSITE\n/g) ?? [])).toHaveLength(1);
  });

  it('範囲選択で拾える', () => {
    const ids = collectIdsInRect(cv(), { x: -500, y: -500, w: 3000, h: 3000 });
    expect(ids).toContain(sites()[0].id);
  });

  it('ページ間コピーに入る', () => {
    const { payload } = buildCrossPagePayload(cv(), [sites()[0].id], () => 'new:1');
    expect(payload.sitePolygons).toHaveLength(1);
    expect(payload.sitePolygons[0].id).toBe('new:1');
  });

  it('敷地だけのページも「空」ではない', () => {
    const onlySite = { ...blank(), sitePolygons: sites() } as CanvasData;
    expect(canvasDataIsEmpty(onlySite)).toBe(false);
  });

  it('保存して開き直しても残る（normalize で消えない）', () => {
    const saved = JSON.parse(JSON.stringify(cv())) as CanvasData;
    st().setCanvasData(blank());
    st().setCanvasData(saved);
    expect(sites()).toHaveLength(1);
  });
});

// ============================================================
describe('手描きの敷地（S-1 / S-2）の挙動は変わらない', () => {
  it('addSitePolygon は従来どおり 1 枚だけ足す', () => {
    st().addSitePolygon({ id: 'hand:1', points: rect(0, 0, 100, 100) });
    expect(sites()).toEqual([{ id: 'hand:1', points: rect(0, 0, 100, 100) }]);
  });

  it('自動生成を挟んでも手描きの敷地の中身は変わらない', () => {
    oneBuilding();
    const hand = { id: 'hand:1', points: rect(-500, -500, 100, 100) };
    st().addSitePolygon(hand);
    st().generateSitePolygons(1000);
    expect(sites().find((s) => s.id === 'hand:1')).toEqual(hand);
  });

  it('自動生成は建物が無いと何もしないので、手描きだけの図面は素通し', () => {
    st().addSitePolygon({ id: 'hand:1', points: rect(0, 0, 100, 100) });
    const before = JSON.stringify(sites());
    expect(st().generateSitePolygons(1000)).toBe(0);
    expect(JSON.stringify(sites())).toBe(before);
  });
});
