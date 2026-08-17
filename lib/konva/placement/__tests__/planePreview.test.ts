// ============================================================
// P-3 (A)(B): 平面部材のシャドー（ゴースト）を全部材で揃える。
//
// ■ 直した 2 件
// (A) アンチのゴーストが「手摺の細線」で出ていた。
//     updatePlanePreview の最後の分岐が handrail と anti の共用で、
//     setHandrailPreview しか呼んでいなかった（描くのは 3px の青い線）。
//     実物は幅 400/250 の琥珀色の板なので、まるで別物＝実機では
//     「アンチのシャドーが出ない」に見えていた。
// (B) ゴーストの入れ物が 3 つ（handrailPreview / planePartPreview /
//     obstaclePreview）あるのに、分岐ごとに自分の入れ物しか消していなかった。
//     部材を持ち替えると**前の部材のゴーストが残った**（支柱→アンチ など）。
//
// ここでは実際にストアを叩いて、
//   ・アンチのゴーストが「アンチの姿」で出ること
//   ・**置かれる位置と吸着ルールが 1 ミリも変わっていない**こと
//   ・どの持ち替えでも、立っているゴーストがちょうど 1 つであること
// を確かめる。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { clearPlanePreviews, placePlanePart, updatePlanePreview } from '../planePlacement';
import { antiRectGrid } from '@/lib/konva/antiShape';
import { snapHandrailPlacement } from '@/lib/konva/snapUtils';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { PlacePayload } from '@/components/toolbar/placePayload';
import type { CanvasData, HandrailLengthMm, Point } from '@/types';

const st = () => useCanvasStore.getState();
const cv = () => useCanvasStore.getState().canvasData;

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** 吸着相手になる手摺を 1 本置いた図面。 */
const withHandrail = (): CanvasData => ({
  ...blank(),
  handrails: [{ id: 'h1', x: 100, y: 100, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
} as CanvasData);

const ANTI: PlacePayload = { type: 'anti', lengthMm: 1800, direction: 'horizontal', antiWidth: 400 };
const HANDRAIL: PlacePayload = { type: 'handrail', lengthMm: 1800, direction: 'horizontal' };
const POST: PlacePayload = { type: 'post' };
const STAIR: PlacePayload = { type: 'stair', angleDeg: 0, flip: false };
const PIPE: PlacePayload = { type: 'pipe', lengthMm: 5000, angleDeg: 45 };
const OBSTACLE: PlacePayload = {
  type: 'obstacle', obstacleType: 'aircon', widthMm: 800, heightMm: 300, rotation: 0,
};

/** いま立っているゴーストの入れ物（snapPoint は姿ではなく印なので数えない）。 */
const liveGhosts = (): string[] => {
  const s = st();
  return [
    s.handrailPreview ? 'handrailPreview' : null,
    s.planePartPreview ? `planePartPreview:${s.planePartPreview.kind}` : null,
    s.obstaclePreview ? 'obstaclePreview' : null,
  ].filter((v): v is string => v !== null);
};

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({ zoom: 1, panX: 0, panY: 0 });
  clearPlanePreviews();
});

// ============================================================
describe('アンチのシャドーが「アンチの姿」で出る (= P-3 A)', () => {
  it('手摺の入れ物ではなく、アンチ専用のゴーストに入る', () => {
    updatePlanePreview(ANTI, { x: 30, y: 40 });
    expect(st().planePartPreview).toMatchObject({ kind: 'anti' });
    expect(st().handrailPreview).toBeNull();
  });

  it('幅・長さ・向きがゴーストに乗る', () => {
    updatePlanePreview({ ...ANTI, direction: 'vertical', antiWidth: 250, lengthMm: 900 }, { x: 0, y: 0 });
    const g = st().planePartPreview as { kind: 'anti'; anti: { width: number; lengthMm: number; direction: string } };
    expect(g.anti).toMatchObject({ width: 250, lengthMm: 900, direction: 'vertical' });
  });

  it('ゴーストの外形が、置かれる実物の外形と一致する', () => {
    for (const dir of ['horizontal', 'vertical'] as const) {
      for (const width of [400, 250] as const) {
        st().setCanvasData(blank());
        const payload = { ...ANTI, direction: dir, antiWidth: width };
        updatePlanePreview(payload, { x: 12, y: 34 });
        const ghost = (st().planePartPreview as { kind: 'anti'; anti: Parameters<typeof antiRectGrid>[0] }).anti;
        placePlanePart(payload, { x: 12, y: 34 });
        expect(antiRectGrid(ghost), `${dir}/${width}`).toEqual(antiRectGrid(cv().antis[0]));
      }
    }
  });

  it('ゴーストの位置と、置かれる位置が一致する（吸着なし）', () => {
    updatePlanePreview(ANTI, { x: 7, y: 13 });
    const ghost = (st().planePartPreview as { kind: 'anti'; anti: Point }).anti;
    placePlanePart(ANTI, { x: 7, y: 13 });
    expect({ x: cv().antis[0].x, y: cv().antis[0].y }).toEqual({ x: ghost.x, y: ghost.y });
  });

  it('ゴーストの位置と、置かれる位置が一致する（手摺へ吸着したとき）', () => {
    st().setCanvasData(withHandrail());
    updatePlanePreview(ANTI, { x: 102, y: 101 });
    const ghost = (st().planePartPreview as { kind: 'anti'; anti: Point }).anti;
    expect({ x: ghost.x, y: ghost.y }).toEqual({ x: 100, y: 100 });   // 吸着している
    placePlanePart(ANTI, { x: 102, y: 101 });
    expect({ x: cv().antis[0].x, y: cv().antis[0].y }).toEqual({ x: ghost.x, y: ghost.y });
  });

  it('手摺のシャドーは従来どおり handrailPreview のまま', () => {
    updatePlanePreview(HANDRAIL, { x: 30, y: 40 });
    expect(st().handrailPreview).not.toBeNull();
    expect(st().planePartPreview).toBeNull();
  });

  it('キャンバスの外ではアンチのゴーストも出さない', () => {
    updatePlanePreview(ANTI, { x: 1, y: 1 });
    expect(st().planePartPreview).not.toBeNull();
    updatePlanePreview(ANTI, null);
    expect(st().planePartPreview).toBeNull();
  });
});

// ============================================================
describe('アンチの吸着ルールは 1 ミリも変えていない (= P-3 A)', () => {
  /** 配置に使われる吸着（変更前と同じ 1 本）。期待値はここから作る。 */
  const expected = (cursor: Point, payload = ANTI): Point => {
    const zoom = st().zoom;
    const snapRadius = Math.max(Math.round(80 / (INITIAL_GRID_PX * zoom)), 5);
    const p = payload as Extract<PlacePayload, { type: 'anti' }>;
    const r = snapHandrailPlacement(
      cursor, p.lengthMm as HandrailLengthMm, p.direction,
      cv().handrails, snapRadius, cv().antis,
    );
    return r ? r.snappedStart : cursor;
  };

  it('手摺のまわり一帯で、置かれる位置が従来の計算と完全に一致する', () => {
    for (let dx = -40; dx <= 40; dx += 8) {
      for (let dy = -40; dy <= 40; dy += 8) {
        st().setCanvasData(withHandrail());
        const cursor = { x: 100 + dx, y: 100 + dy };
        const want = expected(cursor);
        placePlanePart(ANTI, cursor);
        expect({ x: cv().antis[0].x, y: cv().antis[0].y }, `${cursor.x},${cursor.y}`).toEqual(want);
      }
    }
  });

  it('ゴーストも同じ計算に従う（位置がずれない）', () => {
    for (let dx = -40; dx <= 40; dx += 8) {
      st().setCanvasData(withHandrail());
      const cursor = { x: 100 + dx, y: 104 };
      const want = expected(cursor);
      updatePlanePreview(ANTI, cursor);
      const ghost = (st().planePartPreview as { kind: 'anti'; anti: Point }).anti;
      expect({ x: ghost.x, y: ghost.y }, `${cursor.x}`).toEqual(want);
    }
  });

  it('縦置き・別サイズでも一致する', () => {
    const payload: PlacePayload = { type: 'anti', lengthMm: 900, direction: 'vertical', antiWidth: 250 };
    for (const cursor of [{ x: 100, y: 100 }, { x: 103, y: 98 }, { x: 250, y: 300 }]) {
      st().setCanvasData(withHandrail());
      const want = expected(cursor, payload);
      placePlanePart(payload, cursor);
      expect({ x: cv().antis[0].x, y: cv().antis[0].y }).toEqual(want);
    }
  });

  it('吸着したときはスナップ印も従来どおり出る', () => {
    st().setCanvasData(withHandrail());
    updatePlanePreview(ANTI, { x: 102, y: 101 });
    expect(st().snapPoint).toEqual({ x: 100, y: 100 });
  });

  it('置いた中身（幅・長さ・向き）は従来どおり', () => {
    placePlanePart({ type: 'anti', lengthMm: 1200, direction: 'vertical', antiWidth: 250 }, { x: 5, y: 6 });
    expect(cv().antis[0]).toMatchObject({ lengthMm: 1200, direction: 'vertical', width: 250 });
  });
});

// ============================================================
describe('部材を持ち替えても前のゴーストが残らない (= P-3 B)', () => {
  const ALL: [name: string, payload: PlacePayload][] = [
    ['手摺', HANDRAIL], ['支柱', POST], ['アンチ', ANTI],
    ['階段', STAIR], ['単管', PIPE], ['障害物', OBSTACLE],
  ];

  it('どの持ち替えでも、立っているゴーストはちょうど 1 つ', () => {
    for (const [fromName, from] of ALL) {
      for (const [toName, to] of ALL) {
        clearPlanePreviews();
        updatePlanePreview(from, { x: 50, y: 50 });
        updatePlanePreview(to, { x: 60, y: 60 });
        expect(liveGhosts(), `${fromName} → ${toName}`).toHaveLength(1);
      }
    }
  });

  it('支柱 → アンチ で支柱の丸が残らない（実機で見えていた形）', () => {
    updatePlanePreview(POST, { x: 50, y: 50 });
    expect(st().planePartPreview).toMatchObject({ kind: 'post' });
    updatePlanePreview(ANTI, { x: 60, y: 60 });
    expect(st().planePartPreview).toMatchObject({ kind: 'anti' });
    expect(st().handrailPreview).toBeNull();
  });

  it('階段 → 手摺 で階段が残らない', () => {
    updatePlanePreview(STAIR, { x: 50, y: 50 });
    updatePlanePreview(HANDRAIL, { x: 60, y: 60 });
    expect(st().planePartPreview).toBeNull();
    expect(st().handrailPreview).not.toBeNull();
  });

  it('障害物 → 階段 で障害物が残らない', () => {
    updatePlanePreview(OBSTACLE, { x: 50, y: 50 });
    expect(st().obstaclePreview).not.toBeNull();
    updatePlanePreview(STAIR, { x: 60, y: 60 });
    expect(st().obstaclePreview).toBeNull();
    expect(st().planePartPreview).toMatchObject({ kind: 'stair' });
  });

  it('アンチ → 障害物 でアンチが残らない', () => {
    updatePlanePreview(ANTI, { x: 50, y: 50 });
    updatePlanePreview(OBSTACLE, { x: 60, y: 60 });
    expect(st().planePartPreview).toBeNull();
    expect(st().obstaclePreview).not.toBeNull();
  });

  it('キャンバスの外へ出たら、どの部材でも全部消える', () => {
    for (const [name, payload] of ALL) {
      updatePlanePreview(payload, { x: 50, y: 50 });
      updatePlanePreview(payload, null);
      expect(liveGhosts(), name).toEqual([]);
      expect(st().snapPoint, name).toBeNull();
    }
  });

  it('持ち替えても、置かれるのは今選んでいる部材だけ', () => {
    updatePlanePreview(STAIR, { x: 50, y: 50 });
    updatePlanePreview(ANTI, { x: 60, y: 60 });
    placePlanePart(ANTI, { x: 60, y: 60 });
    expect(cv().antis).toHaveLength(1);
    expect(cv().stairs ?? []).toHaveLength(0);
  });
});
