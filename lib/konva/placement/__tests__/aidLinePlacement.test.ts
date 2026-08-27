// ============================================================
// E-8-v5c commit 2: 補助線を 2 クリックで引く。
//
// 既存の配置経路はすべて 1 クリック前提（placeFreePartAt(atGrid) で即座に置く）。
// 補助線だけは「起点をクリック → 終点をクリック」の 2 回で引く。
//   ・1 回目は**何も置かない**（起点を覚えるだけ）
//   ・2 回目で結んで確定する
//   ・引いている最中は、起点からカーソルまでの線が見える（確定と同じ関数を通る）
// 他の種類が 1 クリックのままであることも、ここで固定する。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  aidLineDraftTo, cancelAidLine, freePartDraftAt, placeFreePartAt, snapAidEndpoint,
} from '../freePartPlacement';
import {
  AID_LINE_MIN_MM, aidLineFromPoints, canDrawAidLine, freePartsToPrimitives,
} from '@/lib/konva/freeParts';
import { GRID_MM } from '@/lib/konva/elevation/elevationParts';
import type { CanvasData, Point } from '@/types';

const st = () => useCanvasStore.getState();
const free = () => st().canvasData.freeParts ?? [];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** その線の primitive の両端（グリッド）。 */
const endsOf = (part: Parameters<typeof freePartsToPrimitives>[0][number]) => {
  const [p] = freePartsToPrimitives([part]) as
    { x1: number; y1: number; x2: number; y2: number }[];
  return p;
};

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({
    zoom: 1, panX: 0, panY: 0, elevationAddTool: null, aidLineStart: null,
    elevationAddSize: 1800, elevationAddFlip: false, elevationAddAngle: 0,
  });
});

// ============================================================
describe('2 クリックで引く', () => {
  beforeEach(() => { st().setElevationAddTool('line'); });

  it('1 回目では何も置かない（起点を覚えるだけ）', () => {
    expect(placeFreePartAt({ x: 0, y: 0 })).toBe(false);
    expect(free()).toHaveLength(0);
    expect(st().aidLineStart).toEqual({ x: 0, y: 0 });
  });

  it('2 回目で 1 本できる', () => {
    placeFreePartAt({ x: 0, y: 0 });
    expect(placeFreePartAt({ x: 100, y: 0 })).toBe(true);
    expect(free()).toHaveLength(1);
    expect(free()[0].kind).toBe('line');
  });

  it('確定したら起点は消える（次の線が前の点から始まらない）', () => {
    placeFreePartAt({ x: 0, y: 0 });
    placeFreePartAt({ x: 100, y: 0 });
    expect(st().aidLineStart).toBeNull();
  });

  it('続けて何本でも引ける', () => {
    for (const [a, b] of [[0, 100], [200, 300], [400, 500]]) {
      placeFreePartAt({ x: a, y: 0 });
      placeFreePartAt({ x: b, y: 50 });
    }
    expect(free()).toHaveLength(3);
    expect(new Set(free().map((p) => p.id)).size).toBe(3);
  });

  it('指定した 2 点をそのまま通る', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 100 }],
      [{ x: 10, y: 20 }, { x: 110, y: -30 }],
      [{ x: -50, y: 80 }, { x: 20, y: 15 }],
    ] as [Point, Point][]) {
      st().setCanvasData(blank());
      useCanvasStore.setState({ aidLineStart: null });
      placeFreePartAt(a);
      placeFreePartAt(b);
      const e = endsOf(free()[0]);
      expect(e.x1, `${a.x},${a.y}`).toBeCloseTo(a.x, 3);
      expect(e.y1).toBeCloseTo(a.y, 3);
      expect(e.x2).toBeCloseTo(b.x, 3);
      expect(e.y2).toBeCloseTo(b.y, 3);
    }
  });

  it('斜めに引ける（角度の制約が無い）', () => {
    placeFreePartAt({ x: 0, y: 0 });
    placeFreePartAt({ x: 137, y: -89 });
    const e = endsOf(free()[0]);
    expect(e.x2 - e.x1).toBeCloseTo(137, 3);
    expect(e.y2 - e.y1).toBeCloseTo(-89, 3);
  });
});

// ============================================================
describe('短すぎる／誤タップ', () => {
  beforeEach(() => { st().setElevationAddTool('line'); });

  it('同じ場所を 2 回押しても線はできない', () => {
    placeFreePartAt({ x: 10, y: 10 });
    expect(placeFreePartAt({ x: 10, y: 10 })).toBe(false);
    expect(free()).toHaveLength(0);
  });

  it('そのとき起点は打ち直しになる（引きかけが宙に浮かない）', () => {
    placeFreePartAt({ x: 10, y: 10 });
    placeFreePartAt({ x: 10, y: 10 });
    expect(st().aidLineStart).toEqual({ x: 10, y: 10 });
  });

  it('最短の長さの判定', () => {
    const min = AID_LINE_MIN_MM / GRID_MM;
    expect(canDrawAidLine({ x: 0, y: 0 }, { x: min - 0.01, y: 0 })).toBe(false);
    expect(canDrawAidLine({ x: 0, y: 0 }, { x: min + 0.01, y: 0 })).toBe(true);
  });
});

// ============================================================
describe('引きかけの取り消し', () => {
  it('種類を変えたら捨てる（別の種類の線が生まれない）', () => {
    st().setElevationAddTool('line');
    placeFreePartAt({ x: 0, y: 0 });
    expect(st().aidLineStart).not.toBeNull();
    st().setElevationAddTool('rail');
    expect(st().aidLineStart).toBeNull();
  });

  it('ツールを外しても捨てる', () => {
    st().setElevationAddTool('line');
    placeFreePartAt({ x: 0, y: 0 });
    st().setElevationAddTool(null);
    expect(st().aidLineStart).toBeNull();
  });

  it('明示的に取り消せる', () => {
    st().setElevationAddTool('line');
    placeFreePartAt({ x: 0, y: 0 });
    cancelAidLine();
    expect(st().aidLineStart).toBeNull();
  });

  it('取り消したあとは、次のクリックが 1 点目になる', () => {
    st().setElevationAddTool('line');
    placeFreePartAt({ x: 0, y: 0 });
    cancelAidLine();
    expect(placeFreePartAt({ x: 500, y: 500 })).toBe(false);
    expect(st().aidLineStart).toEqual({ x: 500, y: 500 });
    expect(free()).toHaveLength(0);
  });
});

// ============================================================
describe('引いている最中の姿', () => {
  beforeEach(() => { st().setElevationAddTool('line'); });

  it('1 点目を打つ前は何も出ない', () => {
    expect(aidLineDraftTo({ x: 100, y: 0 })).toBeNull();
  });

  it('1 点目を打つと、そこからカーソルまでの線が出る', () => {
    placeFreePartAt({ x: 0, y: 0 });
    const draft = aidLineDraftTo({ x: 100, y: 50 })!;
    const e = endsOf(draft);
    expect(e.x1).toBeCloseTo(0, 3);
    expect(e.x2).toBeCloseTo(100, 3);
    expect(e.y2).toBeCloseTo(50, 3);
  });

  it('見えている線と、置かれる線が一致する', () => {
    placeFreePartAt({ x: 10, y: 20 });
    const ghost = endsOf(aidLineDraftTo({ x: 110, y: -30 })!);
    placeFreePartAt({ x: 110, y: -30 });
    const placed = endsOf(free()[0]);
    expect(placed).toMatchObject({ x1: ghost.x1, y1: ghost.y1, x2: ghost.x2, y2: ghost.y2 });
  });

  it('短すぎる間は出ない', () => {
    placeFreePartAt({ x: 0, y: 0 });
    expect(aidLineDraftTo({ x: 0.1, y: 0 })).toBeNull();
  });

  it('線を選んでいないときは出ない', () => {
    st().setElevationAddTool('rail');
    expect(aidLineDraftTo({ x: 100, y: 0 })).toBeNull();
  });
});

// ============================================================
describe('端点の吸着（建物・敷地の角へ軽く）', () => {
  beforeEach(() => {
    st().setCanvasData({
      ...blank(),
      buildings: [{
        id: 'b1', type: 'polygon', fill: '#3d3d3a',
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
      }],
    } as CanvasData);
    st().setElevationAddTool('line');
  });

  it('建物の角の近くは角に吸い付く', () => {
    expect(snapAidEndpoint({ x: 2, y: 2 })).toEqual({ x: 0, y: 0 });
  });

  it('角から離れれば指した位置そのまま（自由が原則）', () => {
    expect(snapAidEndpoint({ x: 50.5, y: 40.5 })).toEqual({ x: 50.5, y: 40.5 });
  });

  it('引いた線の端点も吸着する', () => {
    placeFreePartAt({ x: 2, y: 2 });
    placeFreePartAt({ x: 102, y: 1 });
    const e = endsOf(free()[0]);
    expect(e.x1).toBeCloseTo(0, 3);
    expect(e.y1).toBeCloseTo(0, 3);
    expect(e.x2).toBeCloseTo(100, 3);
    expect(e.y2).toBeCloseTo(0, 3);
  });

  it('敷地の角にも吸着する', () => {
    st().setCanvasData({
      ...st().canvasData,
      sitePolygons: [{ id: 's1', points: [{ x: 500, y: 500 }, { x: 600, y: 500 }, { x: 600, y: 580 }] }],
    } as CanvasData);
    expect(snapAidEndpoint({ x: 501, y: 501 })).toEqual({ x: 500, y: 500 });
  });

  it('部材には吸い付かない（接合スナップの対象外）', () => {
    st().setCanvasData({
      ...blank(),
      freeParts: [aidLineFromPoints('x', { x: 0, y: 0 }, { x: 100, y: 0 })],
    } as CanvasData);
    // 部材（手摺）を置いても、補助線の端点は寄らない
    expect(snapAidEndpoint({ x: 50.5, y: 0.5 })).toEqual({ x: 50.5, y: 0.5 });
  });
});

// ============================================================
describe('他の種類は 1 クリックのまま（既存を変えていない）', () => {
  it.each(['rail', 'post', 'board', 'jack', 'brace'] as const)('%s は 1 回で置かれる', (kind) => {
    st().setElevationAddTool(kind);
    expect(placeFreePartAt({ x: 0, y: 0 })).toBe(true);
    expect(free()).toHaveLength(1);
    expect(free()[0].kind).toBe(kind);
  });

  it('部材を置いても補助線の起点は作られない', () => {
    st().setElevationAddTool('rail');
    placeFreePartAt({ x: 0, y: 0 });
    expect(st().aidLineStart).toBeNull();
  });

  it('部材のシャドーは従来どおり出る', () => {
    st().setElevationAddTool('rail');
    expect(freePartDraftAt({ x: 0, y: 0 })).not.toBeNull();
  });

  it('何も選んでいなければ置かない', () => {
    st().setElevationAddTool(null);
    expect(placeFreePartAt({ x: 0, y: 0 })).toBe(false);
    expect(free()).toHaveLength(0);
  });
});

// ============================================================
describe('引いた線は既存の仕組みに乗る', () => {
  beforeEach(() => {
    st().setElevationAddTool('line');
    placeFreePartAt({ x: 0, y: 0 });
    placeFreePartAt({ x: 100, y: 50 });
  });

  it('undo で消せる', () => {
    expect(free()).toHaveLength(1);
    st().undo();
    expect(free()).toHaveLength(0);
  });

  it('削除できる', () => {
    st().removeElement(free()[0].id);
    expect(free()).toHaveLength(0);
  });

  it('移動できる（既存の moveElement）', () => {
    const before = endsOf(free()[0]);
    st().moveElement(free()[0].id, 30, 20);
    const after = endsOf(free()[0]);
    expect(after.x1 - before.x1).toBeCloseTo(30, 3);
    expect(after.y1 - before.y1).toBeCloseTo(20, 3);
    // 形は変わらない
    expect(after.x2 - after.x1).toBeCloseTo(before.x2 - before.x1, 3);
  });

  it('id が補助線として分かる形（採番が部材と混ざらない）', () => {
    expect(free()[0].id).toMatch(/^free:line:\d+$/);
  });
});
