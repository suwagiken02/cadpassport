// ============================================================
// P-1-fix7: 階段・単管がキャンバスに置かれない／見えない。
//
// ■ 原因
// PlanePartLayer は GridCanvas に **import されているだけで、JSX に
// 置かれていなかった**（P-1 でレイヤーを作ったが、載せる 1 行が入らなかった）。
// データは addStair / addPipe で増えていたのに、描くものが誰も居ないので
// 見えず、当たり判定も無いので選べなかった。
//
// ■ ここで止めること
//   ・PlanePartLayer が GridCanvas に載っていること
//   ・同じ事故（import したのに載せ忘れ）を **全レイヤー** について機械的に止める
//   ・描画・当たり判定の作法が手摺(ScaffoldLayer)と同じであること
//   ・置いた部材の画面座標が妥当な範囲に来ること（桁ずれで画面外に描かない）
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import {
  PLANE_PART_COLORS, pipeEndpointsGrid, snapStairToCellGrid, stairCornersGrid,
} from '@/lib/konva/planeParts';
import type { Pipe, Stair } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const gridCanvas = read('components/canvas/GridCanvas.tsx');
const planeLayer = read('components/canvas/PlanePartLayer.tsx');
const scaffoldLayer = read('components/canvas/ScaffoldLayer.tsx');

describe('レイヤーが実際にキャンバスに載っている', () => {
  it('PlanePartLayer が GridCanvas に置かれている（P-1-fix7 の原因）', () => {
    expect(gridCanvas).toMatch(/<PlanePartLayer\s*\/>/);
  });

  it('import しただけで載せ忘れたレイヤーが 1 つも無い', () => {
    const imported = (gridCanvas.match(/^import\s+\w*Layer\s+from\s+'\.\/[\w/]+';$/gm) ?? [])
      .map((line) => /^import\s+(\w*Layer)\s/.exec(line)![1]);
    expect(imported.length).toBeGreaterThan(5);   // 走査が効いていることの確認
    const missing = imported.filter((name) => !new RegExp(`<${name}[\\s/>]`).test(gridCanvas));
    expect(missing).toEqual([]);
  });

  it('足場部材の直後にある（手摺・支柱・アンチと同じ重なり順）', () => {
    expect(gridCanvas).toMatch(/<ScaffoldLayer\s*\/>[^]*?<PlanePartLayer\s*\/>/);
    // メモ・ピンより下（部材どうしの重なりは足場グループの中で完結する）
    expect(gridCanvas).toMatch(/<PlanePartLayer\s*\/>[^]*?<MemoLayer\s*\/>/);
  });
});

describe('描画・当たり判定の作法が手摺と同じ', () => {
  it('階段・単管を canvasData から読んでいる', () => {
    expect(planeLayer).toMatch(/canvasData\.stairs/);
    expect(planeLayer).toMatch(/canvasData\.pipes/);
  });

  it('座標の写し方が ScaffoldLayer と同じ（グリッド × gridPx ＋ pan）', () => {
    expect(planeLayer).toMatch(/const gridPx = INITIAL_GRID_PX \* zoom/);
    expect(scaffoldLayer).toMatch(/const gridPx = INITIAL_GRID_PX \* zoom/);
    expect(planeLayer).toMatch(/gx \* gridPx \+ panX/);
    expect(planeLayer).toMatch(/gy \* gridPx \+ panY/);
  });

  it('触れる条件が ScaffoldLayer と同じ式', () => {
    const gate = /\(mode === 'select' && selectActive && !select(?:Lock\.parts|LockParts)\)\s*\|\|\s*\(mode === 'select' && isReorderMode\)/;
    expect(gate.test(scaffoldLayer), 'ScaffoldLayer').toBe(true);
    expect(gate.test(planeLayer), 'PlanePartLayer').toBe(true);
    // 消去・まとめ移動でも触れる（手摺と同じ）
    expect(planeLayer).toMatch(/mode === 'erase' \|\| mode === 'move-select'/);
  });

  it('ドラッグで動かせる（手摺と同じ moveElement 経由）', () => {
    expect(planeLayer).toMatch(/draggable=\{mode === 'select'\}/);
    expect(planeLayer).toMatch(/moveElement\(/);
  });

  it('タップで選択される（selectedIds に乗る）', () => {
    expect(planeLayer).toMatch(/setSelectedIds\(\[stair\.id\]\)/);
    expect(planeLayer).toMatch(/setSelectedIds\(\[pipe\.id\]\)/);
  });
});

describe('色が背景に溶けない', () => {
  /** GridCanvas のキャンバス背景（明るい／暗い）。 */
  const BG = ['#ffffff', '#0a0a0a'];

  it('背景色の定義は従来どおり', () => {
    expect(gridCanvas).toMatch(/const colorCanvasBg = isDarkMode \? '#0a0a0a' : '#ffffff'/);
  });

  it('階段・単管の色が背景と違う', () => {
    for (const [name, c] of Object.entries(PLANE_PART_COLORS)) {
      expect(BG, name).not.toContain(c.toLowerCase());
    }
  });

  it('透明・非表示にしていない', () => {
    expect(planeLayer).not.toMatch(/opacity=\{0\}/);
    expect(planeLayer).not.toMatch(/visible=\{false\}/);
  });
});

describe('置いた部材の画面座標が妥当', () => {
  /** PlanePartLayer と同じ写し方。 */
  const toScreen = (g: number, pan: number, zoom: number) => g * INITIAL_GRID_PX * zoom + pan;

  it('キャンバス中央あたりに落とせば、画面内に描かれる', () => {
    const zoom = 1, panX = 0, panY = 0;
    // 800×600 の画面のまんなかを指す位置（グリッド）
    const cursor = { x: 400 / (INITIAL_GRID_PX * zoom), y: 300 / (INITIAL_GRID_PX * zoom) };
    const at = snapStairToCellGrid(cursor, 0);
    const stair: Stair = { id: 's', x: at.x, y: at.y, angleDeg: 0 };
    // 区画へ吸着するので角が境界(0)に来ることはある。見たいのは桁ずれで
    // 画面外へ飛んでいないこと＝外形が画面の中に収まっていること。
    for (const c of stairCornersGrid(stair)) {
      expect(toScreen(c.x, panX, zoom)).toBeGreaterThanOrEqual(0);
      expect(toScreen(c.x, panX, zoom)).toBeLessThanOrEqual(800);
      expect(toScreen(c.y, panY, zoom)).toBeGreaterThanOrEqual(0);
      expect(toScreen(c.y, panY, zoom)).toBeLessThanOrEqual(600);
    }
  });

  it('階段は目に見える大きさになる（潰れない）', () => {
    const stair: Stair = { id: 's', x: 0, y: 0, angleDeg: 0 };
    const c = stairCornersGrid(stair);
    const wPx = (c[1].x - c[0].x) * INITIAL_GRID_PX;
    const hPx = (c[2].y - c[1].y) * INITIAL_GRID_PX;
    expect(wPx).toBeGreaterThan(10);    // 600mm
    expect(hPx).toBeGreaterThan(30);    // 1800mm
  });

  it('単管も目に見える長さになる', () => {
    const pipe: Pipe = { id: 'p', x: 0, y: 0, lengthMm: 1000, angleDeg: 0 };
    const [a, b] = pipeEndpointsGrid(pipe);
    expect(Math.hypot(b.x - a.x, b.y - a.y) * INITIAL_GRID_PX).toBeGreaterThan(10);
  });

  it('パンしても手摺と同じだけずれる（座標系が共通）', () => {
    expect(toScreen(10, 250, 2)).toBe(10 * INITIAL_GRID_PX * 2 + 250);
  });
});

describe('ドロップでデータが増える経路', () => {
  it('ドロップは階段を区画へ吸着して addStair を呼ぶ', () => {
    const src = read('components/toolbar/PartSelector.tsx');
    expect(src).toMatch(/toolbarDrag\.type === 'stair'[^]*?snapStairToCellGrid\(gridPos, toolbarDrag\.angleDeg\)[^]*?addStair\(/);
  });

  it('ドロップは単管を置いた位置そのままで addPipe を呼ぶ', () => {
    const src = read('components/toolbar/PartSelector.tsx');
    expect(src).toMatch(/toolbarDrag\.type === 'pipe'[^]*?addPipe\(\{[^]*?x: gridPos\.x, y: gridPos\.y/);
  });
});
