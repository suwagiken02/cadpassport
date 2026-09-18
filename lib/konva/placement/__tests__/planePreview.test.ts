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
import { INITIAL_GRID_PX, mmToGrid } from '@/lib/konva/gridUtils';
import { antiCornerAt, snapAntiPlacement } from '../antiSnap';
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
describe('アンチの吸着 (= P-4 で基点を四隅から選ぶ形に変えた)', () => {
  // P-3 のときは「旧ルール（左上固定）と 1 ミリも変わらない」ことを固定していた。
  // P-4 で**基点を四隅から選ぶ**ようにしたので、その固定は役目を終えた。
  // ここでは新しいルールの不変条件を固定する。
  //   ・ゴーストと配置は必ず一致する（同じ関数を通す）
  //   ・吸着先は従来と同じ snapToHandrail が返す点
  //   ・下から近づけたときは従来とまったく同じ位置
  const snapRadius = () => Math.max(Math.round(80 / (INITIAL_GRID_PX * st().zoom)), 5);

  it('ゴーストと配置が、手摺のまわり一帯でぴったり一致する', () => {
    for (let dx = -40; dx <= 40; dx += 8) {
      for (let dy = -40; dy <= 40; dy += 8) {
        st().setCanvasData(withHandrail());
        const cursor = { x: 100 + dx, y: 100 + dy };
        updatePlanePreview(ANTI, cursor);
        const ghost = (st().planePartPreview as { kind: 'anti'; anti: Point }).anti;
        placePlanePart(ANTI, cursor);
        expect({ x: cv().antis[0].x, y: cv().antis[0].y }, `${cursor.x},${cursor.y}`)
          .toEqual({ x: ghost.x, y: ghost.y });
      }
    }
  });

  it('置かれた板のいずれかの隅が、必ず吸着先に乗る', () => {
    const p = ANTI as Extract<PlacePayload, { type: 'anti' }>;
    for (let dx = -40; dx <= 40; dx += 8) {
      for (let dy = -40; dy <= 40; dy += 8) {
        st().setCanvasData(withHandrail());
        const cursor = { x: 100 + dx, y: 100 + dy };
        const r = snapAntiPlacement(
          cursor, p.lengthMm as HandrailLengthMm, p.antiWidth, p.direction,
          cv().handrails, snapRadius(), cv().antis,
        );
        placePlanePart(ANTI, cursor);
        const placed = { x: cv().antis[0].x, y: cv().antis[0].y };
        if (!r) continue;                      // 吸着圏外はカーソルのまま（従来どおり）
        expect(placed, `${cursor.x},${cursor.y}`).toEqual(r.topLeft);
        const corner = antiCornerAt(r.topLeft, p.lengthMm, p.antiWidth, p.direction, r.anchor);
        expect(corner.x).toBeCloseTo(r.snapIndicator.x, 9);
        expect(corner.y).toBeCloseTo(r.snapIndicator.y, 9);
      }
    }
  });

  it('下から近づけたときは、従来（左上を吸着先に合わせる）と同じ位置', () => {
    st().setCanvasData(withHandrail());
    const p = ANTI as Extract<PlacePayload, { type: 'anti' }>;
    const cursor = { x: 102, y: 103 };         // 左上が端点 (100,100) の近く
    const r = snapAntiPlacement(
      cursor, p.lengthMm as HandrailLengthMm, p.antiWidth, p.direction,
      cv().handrails, snapRadius(), cv().antis,
    )!;
    expect(r.anchor).toBe('topLeft');
    expect(r.topLeft).toEqual(r.snapIndicator);
  });

  it('★ 上から近づけると、下辺が吸着先に乗る（P-4 で できるようになったこと）', () => {
    st().setCanvasData(withHandrail());
    const p = ANTI as Extract<PlacePayload, { type: 'anti' }>;
    const h = mmToGrid(p.antiWidth);           // 横向きアンチの高さ
    const cursor = { x: 102, y: 100 - h + 3 }; // 下辺が端点 (100,100) の近く
    const r = snapAntiPlacement(
      cursor, p.lengthMm as HandrailLengthMm, p.antiWidth, p.direction,
      cv().handrails, snapRadius(), cv().antis,
    )!;
    expect(r.anchor).toBe('bottomLeft');
    expect(r.topLeft.y + h).toBeCloseTo(r.snapIndicator.y, 9);
    expect(r.topLeft.y).toBeLessThan(r.snapIndicator.y);   // 板は線の上
  });

  it('手摺が無ければ吸着せず、カーソルのまま（従来どおり）', () => {
    st().setCanvasData(blank());
    placePlanePart(ANTI, { x: 33, y: 44 });
    expect({ x: cv().antis[0].x, y: cv().antis[0].y }).toEqual({ x: 33, y: 44 });
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
