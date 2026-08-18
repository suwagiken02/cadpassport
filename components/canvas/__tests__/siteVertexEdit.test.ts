// ============================================================
// S-4 (commit 2): 敷地の頂点をつまみで引っ張って直す。
//
// 手描き（S-1/S-2）でも自動生成（S-3）でも同じに扱う。動かす向きに制約はかけない
// （敷地は S-2 で斜め・任意角度を許しているため）。
//
// 頂点編集を入れるのは**敷地だけ**。建物には「建物と足場は必ず平行」の絶対原則が
// あるので、建物・屋根・障害物には入れない。既存要素の選択挙動も変えない。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  SITE_VERTEX_HIT, SITE_VERTEX_R, SITE_VERTEX_SNAP_PX, snapSiteVertex, tidyPoint,
} from '@/lib/konva/siteShape';
import type { CanvasData, Point, SitePolygon } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const siteLayer = read('components/canvas/SiteLayer.tsx');
const buildingLayer = read('components/canvas/BuildingLayer.tsx');
const obstacleLayer = read('components/canvas/ObstacleLayer.tsx');

const st = () => useCanvasStore.getState();
const sites = (): SitePolygon[] => useCanvasStore.getState().canvasData.sitePolygons ?? [];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

const square = (id: string, d = 0): SitePolygon => ({
  id,
  points: [{ x: d, y: d }, { x: 100 + d, y: d }, { x: 100 + d, y: 80 + d }, { x: d, y: 80 + d }],
});

/** つまみを 1 回ドラッグしたときと同じ順序で叩く（掴む → 離す）。 */
const dragVertex = (id: string, index: number, to: Point) => {
  st().pushHistory();                       // つまみを掴んだ時点で 1 回だけ
  st().setSitePolygonPoint(id, index, to);  // 離した時点で確定
};

beforeEach(() => {
  st().setCanvasData({ ...blank(), sitePolygons: [square('site:1')] } as CanvasData);
});

// ============================================================
describe('頂点を動かすと座標が変わる', () => {
  it('掴んだ頂点だけが動く', () => {
    dragVertex('site:1', 1, { x: 150, y: -20 });
    expect(sites()[0].points).toEqual([
      { x: 0, y: 0 }, { x: 150, y: -20 }, { x: 100, y: 80 }, { x: 0, y: 80 },
    ]);
  });

  it('斜めにも自由に動かせる（軸に平行への制約をかけていない）', () => {
    dragVertex('site:1', 2, { x: 123.4, y: 56.7 });
    expect(sites()[0].points[2]).toEqual({ x: 123.4, y: 56.7 });
  });

  it('多角形は閉じたまま（頂点の数が変わらない）', () => {
    dragVertex('site:1', 0, { x: -50, y: -50 });
    expect(sites()[0].points).toHaveLength(4);
  });

  it('他の敷地は動かない', () => {
    st().setCanvasData({
      ...blank(), sitePolygons: [square('site:1'), square('site:2', 500)],
    } as CanvasData);
    const other = sites()[1].points.map((p) => ({ ...p }));
    dragVertex('site:1', 0, { x: -50, y: -50 });
    expect(sites()[1].points).toEqual(other);
  });

  it('建物・障害物・足場は 1 つも変わらない', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon', points: square('x').points, fill: '#3d3d3a' }],
      obstacles: [{ id: 'o1', type: 'aircon', x: 5, y: 6, width: 8, height: 3 }],
      sitePolygons: [square('site:1')],
    } as CanvasData);
    const before = JSON.stringify({ b: st().canvasData.buildings, o: st().canvasData.obstacles });
    dragVertex('site:1', 0, { x: -50, y: -50 });
    expect(JSON.stringify({ b: st().canvasData.buildings, o: st().canvasData.obstacles })).toBe(before);
  });

  it('保存が必要な状態になる', () => {
    useCanvasStore.setState({ isDirty: false });
    st().setSitePolygonPoint('site:1', 0, { x: 1, y: 1 });
    expect(st().isDirty).toBe(true);
  });

  it('自動生成した敷地でも同じに動かせる', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon', points: square('x').points, fill: '#3d3d3a' }],
    } as CanvasData);
    st().generateSitePolygons(1000);
    const id = sites()[0].id;
    dragVertex(id, 0, { x: -999, y: -999 });
    expect(sites()[0].points[0]).toEqual({ x: -999, y: -999 });
  });
});

// ============================================================
describe('おかしな指定では何もしない', () => {
  it('居ない敷地', () => {
    const before = JSON.stringify(sites());
    st().setSitePolygonPoint('nope', 0, { x: 1, y: 1 });
    expect(JSON.stringify(sites())).toBe(before);
  });

  it('範囲外の頂点番号', () => {
    const before = JSON.stringify(sites());
    st().setSitePolygonPoint('site:1', 9, { x: 1, y: 1 });
    st().setSitePolygonPoint('site:1', -1, { x: 1, y: 1 });
    expect(JSON.stringify(sites())).toBe(before);
  });
});

// ============================================================
describe('undo で 1 ドラッグ前に戻る', () => {
  it('1 回のドラッグは 1 回の undo で戻る', () => {
    const before = sites()[0].points.map((p) => ({ ...p }));
    dragVertex('site:1', 1, { x: 150, y: -20 });
    expect(sites()[0].points[1]).toEqual({ x: 150, y: -20 });
    st().undo();
    expect(sites()[0].points).toEqual(before);
  });

  it('2 回ドラッグしたら 2 回の undo で戻る（途中の履歴を積みすぎない）', () => {
    const before = sites()[0].points.map((p) => ({ ...p }));
    dragVertex('site:1', 1, { x: 150, y: -20 });
    dragVertex('site:1', 2, { x: 160, y: 90 });
    st().undo();
    expect(sites()[0].points[2]).toEqual({ x: 100, y: 80 });
    expect(sites()[0].points[1]).toEqual({ x: 150, y: -20 });
    st().undo();
    expect(sites()[0].points).toEqual(before);
  });

  it('ストアの差し替え自体は履歴を積まない（ドラッグ中に溜めない）', () => {
    const n = st().history.past.length;
    st().setSitePolygonPoint('site:1', 0, { x: 1, y: 1 });
    st().setSitePolygonPoint('site:1', 0, { x: 2, y: 2 });
    st().setSitePolygonPoint('site:1', 0, { x: 3, y: 3 });
    expect(st().history.past.length).toBe(n);
  });
});

// ============================================================
describe('吸着は「近くの角へ軽く」だけ', () => {
  const cands: Point[] = [{ x: 100, y: 100 }, { x: 300, y: 50 }];

  it('近くの角があれば、そこへ寄る', () => {
    expect(snapSiteVertex({ x: 103, y: 98 }, cands, 10)).toEqual({ x: 100, y: 100 });
  });

  it('いちばん近い角へ寄る', () => {
    expect(snapSiteVertex({ x: 290, y: 55 }, cands, 100)).toEqual({ x: 300, y: 50 });
  });

  it('遠ければ指した場所のまま（自由が原則）', () => {
    expect(snapSiteVertex({ x: 200, y: 200 }, cands, 10)).toEqual({ x: 200, y: 200 });
  });

  it('寄せ先が無ければそのまま', () => {
    expect(snapSiteVertex({ x: 7.123456, y: 8 }, [], 10)).toEqual({ x: 7.123, y: 8 });
  });

  it('グリッドには吸着させない（角以外へ寄せない）', () => {
    // 10 の倍数に丸められたりしない
    expect(snapSiteVertex({ x: 47, y: 93 }, [], 10)).toEqual({ x: 47, y: 93 });
  });

  it('浮動小数のごみは落とす（0.1mm まで）', () => {
    expect(tidyPoint({ x: 1.00000000001, y: -2.9999999999 })).toEqual({ x: 1, y: -3 });
  });

  it('つまみは指で掴める大きさ（見た目より当たりを大きく）', () => {
    expect(SITE_VERTEX_R).toBeGreaterThanOrEqual(6);
    expect(SITE_VERTEX_HIT).toBeGreaterThan(SITE_VERTEX_R * 2);
    expect(SITE_VERTEX_SNAP_PX).toBeLessThan(SITE_VERTEX_HIT);
  });
});

// ============================================================
describe('つまみを出す条件', () => {
  it('選んでいる敷地にだけ出る', () => {
    expect(siteLayer).toMatch(/sites\.filter\(\(s\) => selectedIds\.includes\(s\.id\)\)/);
  });

  it('素の選択モードで触れる状態のときだけ（消去・一括移動では出さない）', () => {
    expect(siteLayer).toMatch(/const editable = plainSelect && selectActive && !selectLockBuilding;/);
    expect(siteLayer).toMatch(/\{editable && sites\.filter/);
  });

  it('1 ドラッグ 1 undo（掴んだ時に 1 回だけ履歴を積む）', () => {
    expect(siteLayer).toMatch(/onDragStart=\{\(\) => \{[^]*?pushHistory\(\)/);
    expect(siteLayer).toMatch(/onDragEnd=\{\(e\) => \{[^]*?setSitePolygonPoint\(site\.id, index/);
    // 動かしている間はストアへ書かない（画面に見せるだけ）
    expect(siteLayer).toMatch(/onDragMove=\{\(e\) => \{\s*setDrag\(/);
  });

  it('つまみの操作はステージへ渡さない（範囲選択と喧嘩しない）', () => {
    expect(siteLayer).toMatch(/onMouseDown=\{\(e: Konva\.KonvaEventObject<MouseEvent>\) => \{ e\.cancelBubble = true; \}\}/);
    expect(siteLayer).toMatch(/onTouchStart=\{\(e: Konva\.KonvaEventObject<TouchEvent>\) => \{ e\.cancelBubble = true; \}\}/);
  });

  it('自分自身の角へは吸着させない（辺が潰れない）', () => {
    expect(siteLayer).toMatch(/sites\.filter\(\(s\) => s\.id !== id\)/);
  });

  it('ドラッグ中は線も指に追従する', () => {
    expect(siteLayer).toMatch(/const pointsOf =/);
    expect(siteLayer).toMatch(/points=\{pts\.flatMap/);
  });
});

// ============================================================
describe('頂点編集は敷地だけ（建物・屋根・障害物には入れない）', () => {
  it('建物レイヤーに頂点のつまみが無い', () => {
    expect(buildingLayer).not.toMatch(/setSitePolygonPoint|dragBoundFunc/);
    expect(buildingLayer).not.toMatch(/<Circle/);
  });

  it('障害物レイヤーにも入れていない', () => {
    expect(obstacleLayer).not.toMatch(/setSitePolygonPoint/);
  });

  it('頂点を書き換えるストアの入口は敷地専用', () => {
    const store = read('stores/canvasStore.ts');
    expect((store.match(/setSitePolygonPoint/g) ?? []).length).toBeGreaterThan(0);
    expect(store).not.toMatch(/setBuildingPoint|setObstaclePoint|setRoofPoint/);
  });

  it('建物の当たり判定・選択の条件は従来のまま', () => {
    expect(buildingLayer).toMatch(/const selectListenBuilding =\s*\(plainSelect && selectActive && !selectLock\.building\)/);
    expect(buildingLayer).toMatch(/id=\{building\.id\}/);
  });
});
