// ============================================================
// S-9 commit 1: 敷地の頂点を辺の中点から足す。
//
// S-4 で頂点の移動までは入ったが、辺の途中に頂点を足せず、形を直すには
// 描き直すしかなかった。辺の中点に「押せば頂点が増える」ゴーストのつまみを出す。
//
// ダブルクリックや長押しではなく**見えているものを押す**方式にしたのは、
// タッチでは指を置くまで位置が取れず、ホバーでの予告が使えないため（S-7 の教訓）。
//
// ここでいちばん大事なのは 2 つ:
//   ・頂点の index がずれて「別の頂点が動く」「掴んでいた頂点を見失う」が起きないこと
//   ・S-4 の移動・S-6 の青・S-7 の赤を 1 ミリも壊していないこと
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  SITE_GHOST_HIT, SITE_GHOST_MIN_EDGE_PX, SITE_GHOST_OPACITY, SITE_GHOST_R,
  SITE_VERTEX_HIT, SITE_VERTEX_R,
  edgeMidpointsGrid, insertPointAfterEdge, withPendingEdit, type SiteVertexEdit,
} from '@/lib/konva/siteShape';
import type { CanvasData, Point, SitePolygon } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const siteLayer = read('components/canvas/SiteLayer.tsx');

const st = () => useCanvasStore.getState();
const sites = (): SitePolygon[] => st().canvasData.sitePolygons ?? [];
const pts = (i = 0) => sites()[i].points;

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** 200×160 の四角い敷地（頂点 4・辺 4）。 */
const square = (id = 'site:1'): SitePolygon => ({
  id,
  points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 160 }, { x: 0, y: 160 }],
});

beforeEach(() => {
  st().setCanvasData({ ...blank(), sitePolygons: [square()] } as CanvasData);
  st().setSelectedIds(['site:1']);
});

// ============================================================
describe('辺の中点（pure）', () => {
  it('閉じた外形なので辺の数＝頂点の数', () => {
    expect(edgeMidpointsGrid(square().points)).toHaveLength(4);
  });

  it('各辺の中点が正しい', () => {
    const m = edgeMidpointsGrid(square().points);
    expect(m[0].point).toEqual({ x: 100, y: 0 });     // 上辺
    expect(m[1].point).toEqual({ x: 200, y: 80 });    // 右辺
    expect(m[2].point).toEqual({ x: 100, y: 160 });   // 下辺
    expect(m[3].point).toEqual({ x: 0, y: 80 });      // 左辺（最後の頂点 → 最初の頂点）
  });

  it('辺の長さも返す（短い辺の判定に使う）', () => {
    const m = edgeMidpointsGrid(square().points);
    expect(m[0].lengthGrid).toBe(200);
    expect(m[1].lengthGrid).toBe(160);
  });

  it('辺の番号は「頂点 i → 頂点 i+1」', () => {
    expect(edgeMidpointsGrid(square().points).map((m) => m.edgeIndex)).toEqual([0, 1, 2, 3]);
  });

  it('点が足りなければ空', () => {
    expect(edgeMidpointsGrid([])).toEqual([]);
    expect(edgeMidpointsGrid([{ x: 0, y: 0 }])).toEqual([]);
  });

  it('三角形でも 3 辺ぶん出る', () => {
    expect(edgeMidpointsGrid([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toHaveLength(3);
  });
});

// ============================================================
describe('差し込む位置（pure）— 形が崩れないこと', () => {
  it('辺 i の頂点は index i+1 に入る', () => {
    const p = square().points;
    expect(insertPointAfterEdge(p, 0, { x: 100, y: 0 })[1]).toEqual({ x: 100, y: 0 });
    expect(insertPointAfterEdge(p, 1, { x: 200, y: 80 })[2]).toEqual({ x: 200, y: 80 });
  });

  it('前後の頂点の間に挟まる（順序が入れ替わらない）', () => {
    const out = insertPointAfterEdge(square().points, 1, { x: 200, y: 80 });
    expect(out.map((q) => `${q.x},${q.y}`)).toEqual([
      '0,0', '200,0', '200,80', '200,160', '0,160',
    ]);
  });

  it('最後の辺（閉じる辺）は末尾に付く', () => {
    const out = insertPointAfterEdge(square().points, 3, { x: 0, y: 80 });
    expect(out).toHaveLength(5);
    expect(out[4]).toEqual({ x: 0, y: 80 });
  });

  it('元の配列を書き換えない', () => {
    const p = square().points;
    insertPointAfterEdge(p, 0, { x: 1, y: 1 });
    expect(p).toHaveLength(4);
  });
});

// ============================================================
describe('中点をタップすると頂点が増える', () => {
  it('頂点が 1 つ増える', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(pts()).toHaveLength(5);
  });

  it('押した場所（中点）に入る', () => {
    st().insertSitePolygonPoint('site:1', 1, { x: 200, y: 80 });
    expect(pts()[2]).toEqual({ x: 200, y: 80 });
  });

  it('外形の形が変わらない（一直線上に足しただけ）', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    // 追加後も 4 隅はそのまま
    expect(pts()[0]).toEqual({ x: 0, y: 0 });
    expect(pts()[2]).toEqual({ x: 200, y: 0 });
  });

  it('続けて足せる', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    st().insertSitePolygonPoint('site:1', 3, { x: 200, y: 80 });
    expect(pts()).toHaveLength(6);
  });

  it('ドラッグして離した位置にも足せる（中点から動かした先）', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 120, y: -40 });
    expect(pts()[1]).toEqual({ x: 120, y: -40 });
  });

  it('保存が必要な状態になる', () => {
    useCanvasStore.setState({ isDirty: false });
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(st().isDirty).toBe(true);
  });

  it('他の敷地は変わらない', () => {
    st().setCanvasData({
      ...blank(), sitePolygons: [square('site:1'), square('site:2')],
    } as CanvasData);
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(pts(0)).toHaveLength(5);
    expect(pts(1)).toHaveLength(4);
  });

  it('建物・部材は 1 つも変わらない', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon', points: square().points, fill: '#3d3d3a' }],
      handrails: [{ id: 'h1', x: 1, y: 2, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
      sitePolygons: [square()],
    } as CanvasData);
    const before = JSON.stringify({ b: st().canvasData.buildings, h: st().canvasData.handrails });
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(JSON.stringify({ b: st().canvasData.buildings, h: st().canvasData.handrails })).toBe(before);
  });
});

// ============================================================
describe('おかしな指定では何もしない', () => {
  it('居ない敷地', () => {
    const before = JSON.stringify(sites());
    st().insertSitePolygonPoint('nope', 0, { x: 1, y: 1 });
    expect(JSON.stringify(sites())).toBe(before);
  });

  it('範囲外の辺番号', () => {
    const before = JSON.stringify(sites());
    st().insertSitePolygonPoint('site:1', 9, { x: 1, y: 1 });
    st().insertSitePolygonPoint('site:1', -1, { x: 1, y: 1 });
    expect(JSON.stringify(sites())).toBe(before);
  });

  it('何もしなかったときは履歴も積まない', () => {
    const n = st().history.past.length;
    st().insertSitePolygonPoint('nope', 0, { x: 1, y: 1 });
    expect(st().history.past.length).toBe(n);
  });
});

// ============================================================
describe('Undo は 1 操作 1 回', () => {
  it('1 回足したら 1 回で戻る', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(pts()).toHaveLength(5);
    st().undo();
    expect(pts()).toEqual(square().points);
  });

  it('2 回足したら 2 回で戻る', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    st().insertSitePolygonPoint('site:1', 3, { x: 200, y: 80 });
    st().undo();
    expect(pts()).toHaveLength(5);
    st().undo();
    expect(pts()).toHaveLength(4);
  });

  it('足してから動かすと 2 回（操作が 2 つあったので正しい粒度）', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 1, { x: 100, y: -50 });
    st().undo();
    expect(pts()[1]).toEqual({ x: 100, y: 0 });
    st().undo();
    expect(pts()).toHaveLength(4);
  });
});

// ============================================================
describe('index がずれない（今回いちばん危ないところ）', () => {
  it('追加すると後ろの頂点の index が 1 つ後ろへ動く', () => {
    // 追加前: index 2 は (200,160)
    expect(pts()[2]).toEqual({ x: 200, y: 160 });
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    // 追加後: 同じ点は index 3 になる
    expect(pts()[3]).toEqual({ x: 200, y: 160 });
  });

  it('追加のあとに動かしても、狙った頂点が動く', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    // 新しい頂点は index 1。そこを動かす
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 1, { x: 100, y: -80 });
    expect(pts()[1]).toEqual({ x: 100, y: -80 });
    // 4 隅は動いていない
    expect(pts()[0]).toEqual({ x: 0, y: 0 });
    expect(pts()[2]).toEqual({ x: 200, y: 0 });
  });

  it('ドラッグ中はゴーストを描かない（追加で index がずれる経路そのものが無い）', () => {
    expect(siteLayer).toMatch(/\{editable && !drag && sites\.filter/);
  });

  it('ストアへ書くのは離した 1 回だけ（動かしている間は書かない）', () => {
    // ゴーストのドラッグ中は setDrag だけ。insert は onDragEnd の 1 回
    expect(siteLayer).toMatch(/onDragMove=\{\(e\) => \{\s*setDrag\(\{\s*kind: 'insert'/);
    expect((siteLayer.match(/insertSitePolygonPoint\(/g) ?? [])).toHaveLength(2);  // ドラッグ確定＋タップ
  });

  it('ドラッグの直後の click では二重に足さない', () => {
    expect(siteLayer).toMatch(/if \(ghostDraggedRef\.current\) return;/);
    expect(siteLayer).toMatch(/ghostDraggedRef\.current = true;/);
    expect(siteLayer).toMatch(/GHOST_CLICK_GUARD_MS/);
  });

  it('頂点 index を持つのは画面の一時状態だけ（保存データは持たない）', () => {
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(Object.keys(sites()[0]).sort()).toEqual(['id', 'points']);
  });
});

// ============================================================
describe('操作中の仮表示（pure）', () => {
  const p = square().points;

  it('移動中はその頂点だけ差し替わる', () => {
    const edit: SiteVertexEdit = { kind: 'move', id: 'site:1', index: 1, point: { x: 300, y: -50 } };
    expect(withPendingEdit(p, edit, 'site:1')[1]).toEqual({ x: 300, y: -50 });
    expect(withPendingEdit(p, edit, 'site:1')).toHaveLength(4);
  });

  it('追加中は仮の頂点が挟まる（線が指に追従する）', () => {
    const edit: SiteVertexEdit = { kind: 'insert', id: 'site:1', edgeIndex: 0, point: { x: 100, y: -60 } };
    const out = withPendingEdit(p, edit, 'site:1');
    expect(out).toHaveLength(5);
    expect(out[1]).toEqual({ x: 100, y: -60 });
  });

  it('別の敷地には影響しない', () => {
    const edit: SiteVertexEdit = { kind: 'insert', id: 'other', edgeIndex: 0, point: { x: 1, y: 1 } };
    expect(withPendingEdit(p, edit, 'site:1')).toBe(p);
  });

  it('操作していなければそのまま', () => {
    expect(withPendingEdit(p, null, 'site:1')).toBe(p);
  });

  it('外形の表示も距離ガイドも同じ 1 本を通る（食い違わない）', () => {
    expect(siteLayer).toMatch(/const pointsOf = \(id: string, pts: Point\[\]\): Point\[\] => withPendingEdit\(pts, drag, id\);/);
    expect(siteLayer).toMatch(/points: withPendingEdit\(s\.points, drag, s\.id\)/);
  });
});

// ============================================================
describe('ゴーストの見た目と当たり判定', () => {
  it('本物より小さく・薄い', () => {
    expect(SITE_GHOST_R).toBeLessThan(SITE_VERTEX_R);
    expect(SITE_GHOST_OPACITY).toBeLessThan(1);
  });

  it('当たりは本物より小さい（重なったら本物が優先される）', () => {
    expect(SITE_GHOST_HIT).toBeLessThan(SITE_VERTEX_HIT);
  });

  it('それでも指で押せる大きさ', () => {
    expect(SITE_GHOST_HIT).toBeGreaterThanOrEqual(20);
  });

  it('短い辺には出さない（両端のつまみと団子にならない）', () => {
    expect(SITE_GHOST_MIN_EDGE_PX).toBeGreaterThan(SITE_VERTEX_HIT);
    expect(siteLayer).toMatch(/\.filter\(\(m\) => m\.lengthGrid \* gridPx >= SITE_GHOST_MIN_EDGE_PX\)/);
  });

  it('選んでいる敷地にだけ出る', () => {
    expect(siteLayer).toMatch(/\{editable && !drag && sites\.filter\(\(s\) => selectedIds\.includes\(s\.id\)\)/);
  });

  it('つまみと同じ「触れる状態」でだけ出る（消去・一括移動では出さない）', () => {
    expect(siteLayer).toMatch(/const editable = plainSelect && selectActive && !selectLockBuilding;/);
  });
});

// ============================================================
describe('伝播の抑止（範囲選択・敷地ごとの移動と喧嘩しない）', () => {
  it('ゴーストも既存のつまみと同じ cancelBubble を持つ', () => {
    const mouse = (siteLayer.match(/onMouseDown=\{\(e: Konva\.KonvaEventObject<MouseEvent>\) => \{ e\.cancelBubble = true; \}\}/g) ?? []);
    const touch = (siteLayer.match(/onTouchStart=\{\(e: Konva\.KonvaEventObject<TouchEvent>\) => \{ e\.cancelBubble = true; \}\}/g) ?? []);
    expect(mouse).toHaveLength(2);   // 本物のつまみ ＋ ゴースト
    expect(touch).toHaveLength(2);
  });

  it('外形の線は従来どおり触れる（敷地ごと動かす経路を塞いでいない）', () => {
    expect(siteLayer).toMatch(/hitStrokeWidth=\{listening \? 14 : 0\}/);
  });
});

// ============================================================
describe('S-4 / S-6 / S-7 を壊していない', () => {
  it('S-4: 頂点の移動が従来どおり', () => {
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 1, { x: 250, y: -30 });
    expect(pts()[1]).toEqual({ x: 250, y: -30 });
    st().undo();
    expect(pts()[1]).toEqual({ x: 200, y: 0 });
  });

  it('S-4: つまみのドラッグの配線が残っている', () => {
    expect(siteLayer).toMatch(/onDragStart=\{\(\) => \{[^]*?pushHistory\(\)/);
    expect(siteLayer).toMatch(/setSitePolygonPoint\(site\.id, index/);
    expect(siteLayer).toMatch(/dragBoundFunc=\{\(pos\) => \{/);
    expect(siteLayer).toMatch(/snapSiteVertex\(/);
  });

  it('S-6: 青い距離表示はそのまま', () => {
    expect(siteLayer).toMatch(/const GAP_COLOR = '#2563EB';/);
    expect(siteLayer).toMatch(/\{editable && gaps\.map/);
  });

  it('S-6: 追加中でも距離が追従する（仮の頂点を見ている）', () => {
    expect(siteLayer).toMatch(/\}, \[sitePolygons, buildings, selectedIds, drag\]\);/);
  });

  it('S-7: 起点選びの赤いガイドは別レイヤーのまま', () => {
    expect(siteLayer).not.toMatch(/nearestBuildingCornerGuide/);
    expect(read('components/canvas/SiteStartGuideLayer.tsx')).toMatch(/nearestBuildingCornerGuide/);
  });

  it('ゴーストはつまみより先に描く（つまみが前面で掴みやすいまま）', () => {
    expect(siteLayer.indexOf('{/* S-9:')).toBeLessThan(siteLayer.indexOf('{/* S-4:'));
  });
});
