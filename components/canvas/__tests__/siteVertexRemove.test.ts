// ============================================================
// S-9 commit 2: 敷地の頂点を消す。
//
// ■ いちばん大事なこと
// 「動かそうとして消えた」が絶対に起きないこと。そのために
//   ・削除は**ダブルクリック／ダブルタップだけ**。単発の操作には割り当てない
//   ・動かした直後（300ms）のダブル操作は無視する
// 単発（タップ・ドラッグ）に削除を割り当てていない以上、誤操作で消える経路は
// 構造的に存在しない。ここではその構造と、消えてはいけない場面を固定する。
//
// ■ 三角形が最小
// 頂点が 3 つのときは消さない。ストア側が最後の砦で、UI 側でも重ねてガードし、
// つまみの色でも「消せない」ことを示す。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  SITE_MIN_VERTICES, SITE_SELECT_COLOR, SITE_VERTEX_LOCKED_COLOR, canRemoveSiteVertex,
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

/** 五角形（頂点 5）。1 つ消しても三角形にならない。 */
const pentagon = (id = 'site:1'): SitePolygon => ({
  id,
  points: [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 240, y: 100 },
    { x: 100, y: 160 }, { x: 0, y: 100 },
  ],
});
const triangle = (id = 'site:1'): SitePolygon => ({
  id, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 160 }],
});
const square = (id = 'site:1'): SitePolygon => ({
  id, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 160 }, { x: 0, y: 160 }],
});

const setSites = (...s: SitePolygon[]) => {
  st().setCanvasData({ ...blank(), sitePolygons: s } as CanvasData);
  st().setSelectedIds([s[0].id]);
};

beforeEach(() => { setSites(pentagon()); });

// ============================================================
describe('消せる', () => {
  it('頂点が 1 つ減る', () => {
    st().removeSitePolygonPoint('site:1', 2);
    expect(pts()).toHaveLength(4);
  });

  it('狙った頂点だけが消える', () => {
    st().removeSitePolygonPoint('site:1', 2);   // (240,100)
    expect(pts().map((p) => `${p.x},${p.y}`))
      .toEqual(['0,0', '200,0', '100,160', '0,100']);
  });

  it('最初の頂点も最後の頂点も消せる', () => {
    st().removeSitePolygonPoint('site:1', 0);
    expect(pts()[0]).toEqual({ x: 200, y: 0 });
    setSites(pentagon());
    st().removeSitePolygonPoint('site:1', 4);
    expect(pts()).toHaveLength(4);
    expect(pts()[3]).toEqual({ x: 100, y: 160 });
  });

  it('消したあとも外形が閉じている（頂点が 3 つ以上ある）', () => {
    st().removeSitePolygonPoint('site:1', 1);
    st().removeSitePolygonPoint('site:1', 1);
    expect(pts().length).toBeGreaterThanOrEqual(3);
    // 順序が保たれ、同じ点が重複していない
    expect(new Set(pts().map((p) => `${p.x},${p.y}`)).size).toBe(pts().length);
  });

  it('保存が必要な状態になる', () => {
    useCanvasStore.setState({ isDirty: false });
    st().removeSitePolygonPoint('site:1', 2);
    expect(st().isDirty).toBe(true);
  });

  it('他の敷地は変わらない', () => {
    setSites(pentagon('site:1'), pentagon('site:2'));
    st().removeSitePolygonPoint('site:1', 2);
    expect(pts(0)).toHaveLength(4);
    expect(pts(1)).toHaveLength(5);
  });

  it('建物・部材は 1 つも変わらない', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon', points: square().points, fill: '#3d3d3a' }],
      handrails: [{ id: 'h1', x: 1, y: 2, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
      sitePolygons: [pentagon()],
    } as CanvasData);
    const before = JSON.stringify({ b: st().canvasData.buildings, h: st().canvasData.handrails });
    st().removeSitePolygonPoint('site:1', 2);
    expect(JSON.stringify({ b: st().canvasData.buildings, h: st().canvasData.handrails })).toBe(before);
  });
});

// ============================================================
describe('三角形は減らさない（最後の砦）', () => {
  it('頂点が 3 つなら消さない', () => {
    setSites(triangle());
    st().removeSitePolygonPoint('site:1', 0);
    expect(pts()).toHaveLength(3);
  });

  it('どの頂点を指定しても消えない', () => {
    setSites(triangle());
    for (const i of [0, 1, 2]) st().removeSitePolygonPoint('site:1', i);
    expect(pts()).toHaveLength(3);
  });

  it('消さなかったときは履歴も積まない', () => {
    setSites(triangle());
    const n = st().history.past.length;
    st().removeSitePolygonPoint('site:1', 0);
    expect(st().history.past.length).toBe(n);
  });

  it('四角形から 1 つ消して三角形になったら、それ以上減らない', () => {
    setSites(square());
    st().removeSitePolygonPoint('site:1', 0);
    expect(pts()).toHaveLength(3);
    st().removeSitePolygonPoint('site:1', 0);
    expect(pts()).toHaveLength(3);
  });

  it('判定は 1 か所（UI もストアも同じ述語を見る）', () => {
    expect(SITE_MIN_VERTICES).toBe(3);
    expect(canRemoveSiteVertex(3)).toBe(false);
    expect(canRemoveSiteVertex(4)).toBe(true);
    expect(canRemoveSiteVertex(2)).toBe(false);
  });

  it('UI 側でも重ねてガードしている', () => {
    expect(siteLayer).toMatch(/if \(!canRemoveSiteVertex\(pointCount\)\) return;/);
  });

  it('ストア側にも同じガードがある（UI を通らなくても守られる）', () => {
    expect(read('stores/canvasStore.ts')).toMatch(/if \(target\.points\.length <= 3\) return;/);
  });
});

// ============================================================
describe('消えてはいけない場面で消えない（誤操作の防止）', () => {
  it('削除はダブル操作からしか呼ばれない', () => {
    // removeVertex を呼ぶのは onDblClick / onDblTap の 2 か所だけ
    expect((siteLayer.match(/removeVertex\(site\.id, index, site\.points\.length\)/g) ?? []))
      .toHaveLength(2);
    expect(siteLayer).toMatch(/onDblClick=\{\(\) => removeVertex\(/);
    expect(siteLayer).toMatch(/onDblTap=\{\(\) => removeVertex\(/);
  });

  it('シングルのタップ・クリックには削除を割り当てていない', () => {
    // つまみのブロックに onClick / onTap が無い（ゴーストのタップは追加用で別物）
    const handle = siteLayer.slice(siteLayer.indexOf('{/* S-4:'));
    expect(handle).not.toMatch(/onClick=\{\(\) => removeVertex/);
    expect(handle).not.toMatch(/onTap=\{\(\) => removeVertex/);
  });

  it('ドラッグには削除を割り当てていない', () => {
    expect(siteLayer).not.toMatch(/onDragEnd=\{[^]*?removeSitePolygonPoint/);
    expect(siteLayer).not.toMatch(/onDragStart=\{[^]*?removeSitePolygonPoint/);
  });

  it('動かした直後のダブル操作は無視する', () => {
    expect(siteLayer).toMatch(/if \(vertexDraggedRef\.current\) return;/);
    expect(siteLayer).toMatch(/vertexDraggedRef\.current = true;/);
    expect(siteLayer).toMatch(/VERTEX_CLICK_GUARD_MS/);
  });

  it('印を立てるのはドラッグ開始、伏せるのはドラッグ終了の後', () => {
    expect(siteLayer).toMatch(/onDragStart=\{\(\) => \{[^]*?vertexDraggedRef\.current = true;/);
    expect(siteLayer)
      .toMatch(/onDragEnd=\{\(e\) => \{[^]*?vertexDraggedRef\.current = false; \}, VERTEX_CLICK_GUARD_MS\)/);
  });

  it('伏せる時間はゴーストと同じ 300ms', () => {
    expect(siteLayer).toMatch(/const VERTEX_CLICK_GUARD_MS = 300;/);
    expect(siteLayer).toMatch(/const GHOST_CLICK_GUARD_MS = 300;/);
  });

  it('おかしな指定では何もしない', () => {
    const before = JSON.stringify(sites());
    st().removeSitePolygonPoint('nope', 0);
    st().removeSitePolygonPoint('site:1', 9);
    st().removeSitePolygonPoint('site:1', -1);
    expect(JSON.stringify(sites())).toBe(before);
  });
});

// ============================================================
describe('消せないことを見た目で示す', () => {
  it('頂点が 3 つのときは色を変える', () => {
    expect(siteLayer).toMatch(/const removable = canRemoveSiteVertex\(site\.points\.length\);/);
    expect(siteLayer).toMatch(/stroke=\{removable \? SITE_SELECT_COLOR : SITE_VERTEX_LOCKED_COLOR\}/);
  });

  it('消せる色と消せない色が違う', () => {
    expect(SITE_VERTEX_LOCKED_COLOR).not.toBe(SITE_SELECT_COLOR);
  });

  it('消せない色は落ち着いた灰色（操作できないことが伝わる）', () => {
    expect(SITE_VERTEX_LOCKED_COLOR).toBe('#9CA3AF');
  });

  it('掴めなくはしない（三角形でも移動はできる）', () => {
    setSites(triangle());
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 0, { x: -50, y: -50 });
    expect(pts()[0]).toEqual({ x: -50, y: -50 });
  });
});

// ============================================================
describe('Undo は 1 操作 1 回', () => {
  it('1 回消したら 1 回で戻る', () => {
    st().removeSitePolygonPoint('site:1', 2);
    expect(pts()).toHaveLength(4);
    st().undo();
    expect(pts()).toEqual(pentagon().points);
  });

  it('2 回消したら 2 回で戻る', () => {
    st().removeSitePolygonPoint('site:1', 2);
    st().removeSitePolygonPoint('site:1', 1);
    st().undo();
    expect(pts()).toHaveLength(4);
    st().undo();
    expect(pts()).toHaveLength(5);
  });

  it('足す → 消す も 1 回ずつ戻る', () => {
    setSites(square());
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });
    expect(pts()).toHaveLength(5);
    st().removeSitePolygonPoint('site:1', 1);
    expect(pts()).toHaveLength(4);
    st().undo();
    expect(pts()).toHaveLength(5);
    st().undo();
    expect(pts()).toEqual(square().points);
  });
});

// ============================================================
describe('削除で index がずれても不具合が出ない', () => {
  it('消すと後ろの頂点の index が 1 つ前へ動く', () => {
    expect(pts()[3]).toEqual({ x: 100, y: 160 });
    st().removeSitePolygonPoint('site:1', 1);
    expect(pts()[2]).toEqual({ x: 100, y: 160 });
  });

  it('削除のあとに動かしても、狙った頂点が動く', () => {
    st().removeSitePolygonPoint('site:1', 1);
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 2, { x: 111, y: 222 });
    expect(pts()[2]).toEqual({ x: 111, y: 222 });
    expect(pts()[0]).toEqual({ x: 0, y: 0 });   // 他は動いていない
  });

  it('ドラッグ中は削除できない（掴んだ頂点を見失う経路が無い）', () => {
    // 削除はダブル操作のみで、ドラッグ中はドラッグが継続している＝dbl は来ない。
    // 加えて、動かした直後は vertexDraggedRef で伏せてある。
    expect(siteLayer).toMatch(/if \(vertexDraggedRef\.current\) return;/);
  });

  it('保存データは index を持たない（消しても他に波及しない）', () => {
    st().removeSitePolygonPoint('site:1', 2);
    expect(Object.keys(sites()[0]).sort()).toEqual(['id', 'points']);
  });

  it('削除しても他の配列に影響しない', () => {
    const before = JSON.stringify({
      st: st().canvasData.stairs, pi: st().canvasData.pipes, fp: st().canvasData.freeParts,
    });
    st().removeSitePolygonPoint('site:1', 2);
    expect(JSON.stringify({
      st: st().canvasData.stairs, pi: st().canvasData.pipes, fp: st().canvasData.freeParts,
    })).toBe(before);
  });
});

// ============================================================
describe('S-4 / S-6 / S-7 / ゴーストを壊していない', () => {
  it('S-4: 頂点の移動が従来どおり', () => {
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 1, { x: 250, y: -30 });
    expect(pts()[1]).toEqual({ x: 250, y: -30 });
    st().undo();
    expect(pts()[1]).toEqual({ x: 200, y: 0 });
  });

  it('S-4: つまみのドラッグの配線が残っている', () => {
    expect(siteLayer).toMatch(/setSitePolygonPoint\(site\.id, index/);
    expect(siteLayer).toMatch(/dragBoundFunc=\{\(pos\) => \{/);
    expect(siteLayer).toMatch(/snapSiteVertex\(/);
  });

  it('S-6: 青い距離表示はそのまま', () => {
    expect(siteLayer).toMatch(/const GAP_COLOR = '#2563EB';/);
    expect(siteLayer).toMatch(/\{editable && gaps\.map/);
  });

  it('S-7: 起点選びの赤いガイドは別レイヤーのまま', () => {
    expect(siteLayer).not.toMatch(/nearestBuildingCornerGuide/);
  });

  it('commit 1 のゴーストはそのまま（追加が壊れていない）', () => {
    expect(siteLayer).toMatch(/\{editable && !drag && sites\.filter/);
    expect(siteLayer).toMatch(/\.filter\(\(m\) => m\.lengthGrid \* gridPx >= SITE_GHOST_MIN_EDGE_PX\)/);
    expect(siteLayer).toMatch(/if \(ghostDraggedRef\.current\) return;/);
  });

  it('ゴーストの追加と、つまみの削除で印が別（取り違えない）', () => {
    expect(siteLayer).toMatch(/const ghostDraggedRef = React\.useRef\(false\);/);
    expect(siteLayer).toMatch(/const vertexDraggedRef = React\.useRef\(false\);/);
  });

  it('足す・動かす・消すが同じ敷地で通しで動く', () => {
    setSites(square());
    st().insertSitePolygonPoint('site:1', 0, { x: 100, y: 0 });   // 5
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 1, { x: 100, y: -80 });    // 動かす
    st().removeSitePolygonPoint('site:1', 1);                     // 4
    expect(pts()).toEqual(square().points);
  });
});
