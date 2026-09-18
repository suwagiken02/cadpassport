/**
 * @vitest-environment jsdom
 */
// ============================================================
// 排他の「画面」の検証 — 実際に描画してクリックを流す。
//
// 既存の modeExclusivity.test.ts は**状態の持ち方**を見ている。
// 状態が正しくても表示や受け口が追従していない穴が残りうるので、ここでは
// 実際に DOM へ描画し、**本物のクリックを流して**確かめる。
//   ・モードボタンの点灯表示
//   ・部材パレットが画面にあるか
//   ・方向入力モーダルが画面にあるか
//   ・クリックしたときに何が増える／増えないか
//
// このフォルダ（__tests__/ui/）だけ jsdom で動く（vitest.config.ts）。
// ※ jsdom はレイアウトを計算しないので、「画面からはみ出す」「他の UI の裏に
//   潜る」といった寸法・重なりの不具合は**この道具では検出できない**。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useCanvasStore } from '@/stores/canvasStore';
import ModeToolbar from '@/components/toolbar/ModeToolbar';
import PartSelector from '@/components/toolbar/PartSelector';
import DirectionInputModal from '@/components/building/DirectionInputModal';
import type { CanvasData } from '@/types';

const st = () => useCanvasStore.getState();

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/**
 * 編集画面と同じ組み合わせで描く。
 * パレットの表示条件は親（app/editor/[id]/page.tsx）が持っているので、
 * そこも一緒に再現する（コンポーネント単体だと「出ているか」を判定できない）。
 */
function Screen() {
  const showPartSelector = useCanvasStore((s) => s.showPartSelector);
  const mode = useCanvasStore((s) => s.mode);
  const showDirectionInputModal = useCanvasStore((s) => s.showDirectionInputModal);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ModeToolbar),
    (showPartSelector || mode === 'obstacle')
      ? React.createElement(PartSelector)
      : null,
    // 方向入力モーダルの表示条件も親（page.tsx:804）が持っている。
    showDirectionInputModal
      ? React.createElement(DirectionInputModal, { onClose: () => {} })
      : null,
  );
}

/** そのラベルのモードボタン。 */
const modeButton = (label: string): HTMLElement => {
  const span = screen.getAllByText(label).find((e) => e.closest('button'));
  if (!span) throw new Error('ボタンが見つからない: ' + label);
  return span.closest('button')!;
};

/** そのモードボタンが点灯しているか（点灯は bg-accent）。 */
const isLit = (label: string): boolean => modeButton(label).className.includes('bg-accent');

/** 部材パレットが画面に出ているか（パレット固有の見出しで判定）。 */
const paletteShown = (): boolean => screen.queryAllByText('ドロップで削除').length > 0;

/** 方向入力モーダルが画面に出ているか。 */
const directionModalShown = (): boolean => screen.queryAllByText('距離').length > 0;

/** キャンバスをクリックする（配置の受け口は window に付いている）。 */
function clickCanvas(x = 400, y = 300) {
  const opts = { clientX: x, clientY: y, bubbles: true } as const;
  fireEvent.pointerDown(window, opts);
  fireEvent.pointerUp(window, opts);
}

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({
    mode: 'select', selectActive: true, isMeasuring: false,
    showPartSelector: false, planeAddTool: null, elevationAddTool: null,
    obstaclePreview: null, pendingObstacleType: null,
    isHeightMarkerMode: false, isRidgeLineMode: false, isMagnetPinMode: false,
    isReorderMode: false, planePartPreview: null, handrailPreview: null,
    directionPoints: [], showDirectionInputModal: false, pendingDirection: null,
  });
});
afterEach(() => cleanup());

// ============================================================
describe('前提: 点灯・パレット・モーダルの見分けがついている', () => {
  it('平常時は「選択」が点いていて「消去」は点いていない', () => {
    render(React.createElement(Screen));
    expect(isLit('選択')).toBe(true);
    expect(isLit('消去')).toBe(false);
  });

  it('部材パレットを開くと「部材」が点き、パレットが出る', () => {
    render(React.createElement(Screen));
    fireEvent.click(modeButton('部材'));
    expect(isLit('部材')).toBe(true);
    expect(paletteShown()).toBe(true);
  });
});

// ============================================================
describe('1) 部材を ON にして「消去」を押す', () => {
  beforeEach(() => {
    render(React.createElement(Screen));
    fireEvent.click(modeButton('部材'));
    st().setPlaneAddTool({ type: 'handrail', lengthMm: 1800, direction: 'horizontal' });
  });

  it('押す前は「部材」が点いていて、パレットも出ている', () => {
    expect(isLit('部材')).toBe(true);
    expect(paletteShown()).toBe(true);
  });

  it('消去を押すと「部材」の点灯表示が消える', () => {
    fireEvent.click(modeButton('消去'));
    expect(isLit('部材')).toBe(false);
  });

  it('消去が点灯する', () => {
    fireEvent.click(modeButton('消去'));
    expect(isLit('消去')).toBe(true);
  });

  it('点いているのは「消去」だけ', () => {
    fireEvent.click(modeButton('消去'));
    for (const label of ['選択', '躯体', '足場', '部材', 'メモ']) {
      expect(isLit(label), label).toBe(false);
    }
    expect(isLit('消去')).toBe(true);
  });

  it('パレットが画面から消える', () => {
    fireEvent.click(modeButton('消去'));
    expect(paletteShown()).toBe(false);
  });

  it('★ キャンバスをクリックしても部材は 1 つも増えない', () => {
    fireEvent.click(modeButton('消去'));
    const before = st().canvasData.handrails.length;
    clickCanvas();
    expect(st().canvasData.handrails.length).toBe(before);
    expect(st().canvasData.posts.length).toBe(0);
    expect(st().canvasData.antis.length).toBe(0);
  });

  it('削除の側は生きている（消去モードのまま）', () => {
    fireEvent.click(modeButton('消去'));
    clickCanvas();
    expect(st().mode).toBe('erase');
  });
});

// ============================================================
describe('2) 障害物を選んで「消去」を押す', () => {
  beforeEach(() => {
    render(React.createElement(Screen));
    act(() => {
      st().setMode('obstacle');
      st().setPendingObstacleType('ecocute');
      st().setPlaneAddTool({
        type: 'obstacle', obstacleType: 'ecocute', widthMm: 900, heightMm: 600, rotation: 0,
      });
      st().setObstaclePreview({ x: 0, y: 0, widthGrid: 90, heightGrid: 60, type: 'ecocute' });
    });
  });

  it('押す前はパレットが出ていて、シャドーもある', () => {
    expect(paletteShown()).toBe(true);
    expect(st().obstaclePreview).not.toBeNull();
  });

  it('★ 消去を押すとシャドーが消える', () => {
    fireEvent.click(modeButton('消去'));
    expect(st().obstaclePreview).toBeNull();
  });

  it('パレットが画面から消える', () => {
    fireEvent.click(modeButton('消去'));
    expect(paletteShown()).toBe(false);
  });

  it('点いているのは「消去」だけ', () => {
    fireEvent.click(modeButton('消去'));
    expect(isLit('消去')).toBe(true);
    expect(isLit('部材')).toBe(false);
    expect(isLit('躯体')).toBe(false);
  });

  it('★ キャンバスをクリックしても障害物は増えない', () => {
    fireEvent.click(modeButton('消去'));
    const before = st().canvasData.obstacles.length;
    clickCanvas();
    expect(st().canvasData.obstacles.length).toBe(before);
  });
});

// ============================================================
describe('3) 障害物の「壁方向」で描いている途中に「消去」を押す（最重要）', () => {
  /** 壁方向ボタンと同じ順序（PartSelector の onClick そのもの）。 */
  function startWallDirection(type: 'carport' | 'ecocute' = 'carport') {
    const s = st();
    s.setPendingTargetType('obstacle');
    s.setPendingObstacleType(type);
    s.setBuildingInputMethod('direction');
    s.setMode('building');
    s.clearDirectionPoints();
  }

  beforeEach(() => { render(React.createElement(Screen)); });

  it('描き始めるとモーダルが画面に出る', () => {
    // React の外から状態を変えるので、再描画を待ってから画面を見る。
    act(() => {
      startWallDirection();
      st().addDirectionPoint({ x: 0, y: 0 });
      st().setPendingDirection('right');      // 方向を選ぶとモーダルの中身が出る
      st().setShowDirectionInputModal(true);
    });
    expect(directionModalShown()).toBe(true);
  });

  it('★ 消去を押すとモーダルが画面から消える', () => {
    act(() => {
      startWallDirection();
      st().addDirectionPoint({ x: 0, y: 0 });
      st().setPendingDirection('right');
      st().setShowDirectionInputModal(true);
    });
    expect(directionModalShown()).toBe(true);    // 出ていることを確かめてから
    fireEvent.click(modeButton('消去'));
    expect(directionModalShown()).toBe(false);
  });

  it('描きかけも残らない', () => {
    startWallDirection();
    st().addDirectionPoint({ x: 0, y: 0 });
    fireEvent.click(modeButton('消去'));
    expect(st().directionPoints).toHaveLength(0);
    expect(st().pendingObstacleType).toBeNull();
  });

  it('★ そのあと、改めて壁方向入力で障害物が最後まで作れる', () => {
    // 一度、描きかけで消去へ抜ける
    startWallDirection();
    st().addDirectionPoint({ x: 0, y: 0 });
    st().setShowDirectionInputModal(true);
    fireEvent.click(modeButton('消去'));

    // 改めて最初から
    startWallDirection('carport');
    expect(st().mode).toBe('building');
    expect(st().pendingTargetType).toBe('obstacle');
    expect(st().pendingObstacleType).toBe('carport');   // ← ここを一度壊した

    // 四角を一周ぶん打つ
    for (const p of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }]) {
      st().addDirectionPoint(p);
    }
    const pts = st().directionPoints;
    expect(pts).toHaveLength(4);

    // 確定（app/editor/[id]/page.tsx と同じ組み立て）
    const s = st();
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    s.addObstacle({
      id: 'o-test', type: s.pendingObstacleType!, x: minX, y: minY,
      width: maxX - minX, height: maxY - minY, points: pts,
    });

    expect(st().canvasData.obstacles).toHaveLength(1);
    expect(st().canvasData.obstacles[0].type).toBe('carport');
    expect(st().canvasData.obstacles[0].width).toBe(100);
    expect(st().canvasData.obstacles[0].height).toBe(80);
  });

  it('消去を挟まなくても作れる（回帰の確認）', () => {
    startWallDirection('ecocute');
    expect(st().pendingObstacleType).toBe('ecocute');
    expect(st().pendingTargetType).toBe('obstacle');
  });
});
