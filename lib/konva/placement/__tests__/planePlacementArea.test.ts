// ============================================================
// P-3 (C)(D): 平面部材の「置く操作」を受け付ける範囲と、支柱の二重配置。
//
// (C) 支柱だけ旧クリック配置が残っていた
//     useCanvasInteraction の mode==='post' に「クリックで支柱配置」が生きており、
//     P-2 の新経路（武装＋クリック）と**両方**走っていた。手摺端の近くを
//     クリックすると支柱が 2 本、同じ座標に重なって入る（見た目は 1 本、
//     Undo 1 回では 1 本残る）。手摺・アンチ・階段・単管に旧経路は無い。
//
// (D) パレットの上のタップが配置として通っていた
//     パレットはキャンバスに**重なって浮いている**のに、受付判定はキャンバスの
//     矩形しか見ていなかった。武装したあとにパレットの「┃縦」「向き」「角度」を
//     押すと、その pointerup が配置として通り、パネルの下（見えない場所）に
//     部材が置かれていた。引き出し経路はゴミ箱判定でパレットを除いていたので、
//     経路によって挙動が違う状態でもあった。
//
// 実機と同じ関数（placePlanePartAtClient / updatePlanePreviewAtClient）を、
// 画面の矩形を渡して直接叩く。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  clearPlanePreviews, isInAnyRect, isInRect,
  placePlanePartAtClient, placementGridAt, updatePlanePreviewAtClient,
  type ScreenRect,
} from '../planePlacement';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { PlacePayload } from '@/components/toolbar/placePayload';
import type { CanvasData } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../../', p), 'utf8');
const st = () => useCanvasStore.getState();
const cv = () => useCanvasStore.getState().canvasData;

/** 800x600 のキャンバス。 */
const CANVAS: ScreenRect = { left: 0, top: 0, right: 800, bottom: 600 };
/** その上に浮いている PC のパレット（下部中央）。 */
const PALETTE: ScreenRect = { left: 100, top: 400, right: 700, bottom: 590 };

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** 支柱の吸着相手。端点は (100,100) と (280,100)。 */
const withHandrail = (): CanvasData => ({
  ...blank(),
  handrails: [{ id: 'h1', x: 100, y: 100, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
} as CanvasData);

const PARTS: [name: string, payload: PlacePayload, count: () => number][] = [
  ['手摺', { type: 'handrail', lengthMm: 1800, direction: 'horizontal' }, () => cv().handrails.length],
  ['支柱', { type: 'post' }, () => cv().posts.length],
  ['アンチ', { type: 'anti', lengthMm: 1800, direction: 'horizontal', antiWidth: 400 }, () => cv().antis.length],
  ['階段', { type: 'stair', angleDeg: 0, flip: false }, () => (cv().stairs ?? []).length],
  ['単管', { type: 'pipe', lengthMm: 5000, angleDeg: 45 }, () => (cv().pipes ?? []).length],
  ['障害物', { type: 'obstacle', obstacleType: 'aircon', widthMm: 800, heightMm: 300, rotation: 0 }, () => cv().obstacles.length],
];

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({ zoom: 1, panX: 0, panY: 0 });
  clearPlanePreviews();
});

// ============================================================
describe('パレットの上では置かない (= P-3 D)', () => {
  /** パレットのど真ん中。キャンバスの矩形の中でもある。 */
  const onPalette = { x: 400, y: 500 };
  /** キャンバスのうちパレットに隠れていないところ。 */
  const onCanvas = { x: 400, y: 200 };

  it('前提: その点はキャンバスの矩形の中にある（重なっている）', () => {
    expect(isInRect(onPalette.x, onPalette.y, CANVAS)).toBe(true);
    expect(isInRect(onPalette.x, onPalette.y, PALETTE)).toBe(true);
  });

  it.each(PARTS)('%s: パレットの上で離しても増えない', (_name, payload, count) => {
    expect(count()).toBe(0);
    const placed = placePlanePartAtClient(payload, onPalette.x, onPalette.y, CANVAS, [PALETTE]);
    expect(placed).toBe(false);
    expect(count()).toBe(0);
  });

  it.each(PARTS)('%s: パレットの外（キャンバス）なら置ける', (_name, payload, count) => {
    const placed = placePlanePartAtClient(payload, onCanvas.x, onCanvas.y, CANVAS, [PALETTE]);
    expect(placed).toBe(true);
    expect(count()).toBe(1);
  });

  it('パレットの上ではシャドーも出さない', () => {
    updatePlanePreviewAtClient({ type: 'post' }, onCanvas.x, onCanvas.y, CANVAS, [PALETTE]);
    expect(st().planePartPreview).not.toBeNull();
    updatePlanePreviewAtClient({ type: 'post' }, onPalette.x, onPalette.y, CANVAS, [PALETTE]);
    expect(st().planePartPreview).toBeNull();
  });

  it('パレットの縁（境界そのもの）も受け付けない', () => {
    for (const p of [
      { x: PALETTE.left, y: PALETTE.top },
      { x: PALETTE.right, y: PALETTE.bottom },
      { x: PALETTE.left, y: PALETTE.bottom },
    ]) {
      expect(placementGridAt(p.x, p.y, CANVAS, [PALETTE]), `${p.x},${p.y}`).toBeNull();
    }
  });

  it('キャンバスの外でも置かない（従来どおり）', () => {
    for (const p of [{ x: -1, y: 100 }, { x: 900, y: 100 }, { x: 100, y: -5 }, { x: 100, y: 700 }]) {
      expect(placePlanePartAtClient({ type: 'post' }, p.x, p.y, CANVAS, [PALETTE])).toBe(false);
    }
    expect(cv().posts).toHaveLength(0);
  });

  it('キャンバスが無い（描画前）なら置かない', () => {
    expect(placePlanePartAtClient({ type: 'post' }, 400, 200, null, [])).toBe(false);
    expect(cv().posts).toHaveLength(0);
  });

  it('パレットが複数（PC パネル＋モバイルバー）でも全部避ける', () => {
    const mobile: ScreenRect = { left: 0, top: 520, right: 800, bottom: 600 };
    expect(placePlanePartAtClient({ type: 'post' }, 50, 560, CANVAS, [PALETTE, mobile])).toBe(false);
    expect(cv().posts).toHaveLength(0);
  });

  it('置ける場所なら、キャンバス座標が正しくグリッドへ変換される', () => {
    useCanvasStore.setState({ zoom: 2, panX: 30, panY: -20 });
    const g = placementGridAt(430, 180, CANVAS, [PALETTE]);
    expect(g).toEqual({
      x: Math.round((430 - 30) / (INITIAL_GRID_PX * 2)),
      y: Math.round((180 - (-20)) / (INITIAL_GRID_PX * 2)),
    });
  });

  it('キャンバスの左上が原点になる（矩形のオフセットを引く）', () => {
    const shifted: ScreenRect = { left: 100, top: 60, right: 900, bottom: 660 };
    expect(placementGridAt(160, 120, shifted, [])).toEqual(
      placementGridAt(60, 60, CANVAS, []),
    );
  });
});

// ============================================================
describe('削除ドロップの範囲と、配置しない範囲は同じ 1 本 (= P-3 D)', () => {
  const src = read('components/toolbar/PartSelector.tsx');

  it('パレットの矩形は 1 か所で作る', () => {
    expect(src).toMatch(/const paletteRects = useCallback\(\(\): ScreenRect\[\]/);
    expect(src).toMatch(/\[panelRef\.current, mobilePanelRef\.current, trashRef\.current\]/);
  });

  it('ゴミ箱判定もその矩形を使う（判定を書き分けない）', () => {
    expect(src).toMatch(/const isOverTrash = useCallback\(\s*\(x: number, y: number\): boolean => isInAnyRect\(x, y, paletteRects\(\)\)/);
  });

  it('配置・シャドー・下見の 3 つとも同じ矩形を渡す', () => {
    for (const fn of ['updatePlanePreviewAtClient', 'placePlanePartAtClient', 'placementGridAt']) {
      expect(src, fn).toMatch(new RegExp(`${fn}\\([^)]*canvasRect\\(\\), paletteRects\\(\\)`));
    }
  });

  it('表示されていないパネルは範囲に入れない（PC でのモバイルバー等）', () => {
    expect(src).toMatch(/r\.width > 0 && r\.height > 0/);
  });

  it('複数の矩形の判定は isInAnyRect 1 本', () => {
    expect(isInAnyRect(400, 500, [PALETTE])).toBe(true);
    expect(isInAnyRect(400, 200, [PALETTE])).toBe(false);
    expect(isInAnyRect(400, 200, [])).toBe(false);
  });
});

// ============================================================
describe('支柱がちょうど 1 本だけ置かれる (= P-3 C)', () => {
  /** 手摺の端点 (100,100) のすぐ近く（画面 px）。zoom=1 / pan=0 なので px = grid*3。 */
  const nearEnd = { x: 100 * INITIAL_GRID_PX + 2, y: 100 * INITIAL_GRID_PX + 2 };

  beforeEach(() => {
    st().setCanvasData(withHandrail());
  });

  it('手摺端の近くを 1 回クリック → 支柱は 1 本', () => {
    expect(cv().posts).toHaveLength(0);
    placePlanePartAtClient({ type: 'post' }, nearEnd.x, nearEnd.y, CANVAS, [PALETTE]);
    expect(cv().posts).toHaveLength(1);
  });

  it('その 1 本は手摺の端点へ吸着している（吸着は失われていない）', () => {
    placePlanePartAtClient({ type: 'post' }, nearEnd.x, nearEnd.y, CANVAS, [PALETTE]);
    expect(cv().posts[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('3 回クリックしたら 3 本（1 回 1 本のまま）', () => {
    for (let i = 0; i < 3; i++) {
      placePlanePartAtClient({ type: 'post' }, nearEnd.x, nearEnd.y, CANVAS, [PALETTE]);
    }
    expect(cv().posts).toHaveLength(3);
  });

  it('Undo 1 回で、そのクリックぶんが残らず消える（二重なら 1 本残っていた）', () => {
    placePlanePartAtClient({ type: 'post' }, nearEnd.x, nearEnd.y, CANVAS, [PALETTE]);
    expect(cv().posts).toHaveLength(1);
    st().undo();
    expect(cv().posts).toHaveLength(0);
  });

  it('手摺から離れた場所でも 1 本置ける（新経路は吸着圏外でも置く）', () => {
    placePlanePartAtClient({ type: 'post' }, 600, 200, CANVAS, [PALETTE]);
    expect(cv().posts).toHaveLength(1);
  });

  it('旧クリック配置は撤去されている（二重に走る元を断つ）', () => {
    const interaction = read('lib/konva/useCanvasInteraction.ts');
    expect(interaction).not.toMatch(/if \(s\.mode === 'post'\)/);
    // 残る addPost は Alt+ドラッグ複製の 1 か所だけ
    expect((interaction.match(/addPost\(/g) ?? []).length).toBe(1);
    expect(interaction).toMatch(/const newP = \{ \.\.\.hitPost, id: uuidv4\(\) \}/);
  });

  it('他の部材にはもともと旧経路が無い（addHandrail/addAnti は複製の 1 か所だけ）', () => {
    const interaction = read('lib/konva/useCanvasInteraction.ts');
    expect((interaction.match(/addAnti\(/g) ?? []).length).toBe(1);
    // 手摺はタッチ複製と Alt 複製の 2 か所（どちらも既存要素のコピーで、新規配置ではない）
    expect((interaction.match(/s\.addHandrail\(/g) ?? []).length).toBe(2);
    expect(interaction).not.toMatch(/addStair\(|addPipe\(/);
  });
});
