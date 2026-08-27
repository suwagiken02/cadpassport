// ============================================================
// E-8-v5a-fix: まっさらなキャンバスに立面部材が置けなかった件。
//
// ■ 原因
// mode の既定は 'view'（図面を開いた直後の閲覧モード）。ところが FreePartLayer の
// 配置ゲートは ElevationViewLayer の条件をそのまま流用しており、
// isPlainSelectMode（mode === 'select' が必須）を要求していた。
// つまり開いた直後は置き場所の面がそもそも出ておらず、何も起きなかった。
//
// 平面部材は「配置は mode 非依存のドラッグ&ドロップ」で作られている。
// 立面部材も同じ流儀に揃える。
//
// ここでは、その判定（placementGate）を状態の組み合わせで固定する。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { canPlaceFreePart, viewCanReceivePart } from '../elevation/placementGate';
import { freePartAnchorGrid, newFreePart } from '../freeParts';
import type { CanvasToolFlags } from '../toolMode';
import type { ModeType } from '@/types';

const flagsOf = (mode: ModeType, over: Partial<CanvasToolFlags> = {}): CanvasToolFlags =>
  ({ mode, moveSelectActive: mode === 'move-select', ...over });

const ctx = (over: Partial<Parameters<typeof canPlaceFreePart>[0]> = {}) => ({
  addTool: 'rail' as const,
  flags: flagsOf('view'),
  selectActive: true,
  viewSelected: false,
  ...over,
});

describe('開いた直後（閲覧モード）から置ける — 今回の不具合', () => {
  it("mode の既定は 'view'（＝この状態で置けないと達成条件を満たさない）", () => {
    expect(useCanvasStore.getInitialState().mode).toBe('view');
  });

  it('閲覧モードでも置ける', () => {
    expect(canPlaceFreePart(ctx({ flags: flagsOf('view') }))).toBe(true);
  });

  it('選択モードでも置ける（従来から動いていた経路）', () => {
    expect(canPlaceFreePart(ctx({ flags: flagsOf('select') }))).toBe(true);
  });

  it('選択ツールが無効でも置ける（配置は mode・選択状態に依らない）', () => {
    expect(canPlaceFreePart(ctx({ flags: flagsOf('view'), selectActive: false }))).toBe(true);
    expect(canPlaceFreePart(ctx({ flags: flagsOf('select'), selectActive: false }))).toBe(true);
  });

  it('平面部材と同じ流儀（mode を問わない）', () => {
    for (const mode of ['view', 'select', 'handrail', 'post', 'anti', 'stair', 'pipe'] as ModeType[]) {
      expect(canPlaceFreePart(ctx({ flags: flagsOf(mode) })), mode).toBe(true);
    }
  });
});

describe('置かない状況', () => {
  it('部材を選んでいなければ置かない', () => {
    expect(canPlaceFreePart(ctx({ addTool: null }))).toBe(false);
  });

  it('「文字」ツールは配置ではない', () => {
    expect(canPlaceFreePart(ctx({ addTool: 'text' }))).toBe(false);
  });

  it('消しゴム・建物入力中は置かない', () => {
    expect(canPlaceFreePart(ctx({ flags: flagsOf('erase') }))).toBe(false);
    expect(canPlaceFreePart(ctx({ flags: flagsOf('building') }))).toBe(false);
  });

  it('キャンバスのクリックを占有するツール中は譲る', () => {
    const tools: Partial<CanvasToolFlags>[] = [
      { isMeasuring: true }, { isHeightMarkerMode: true }, { isRidgeLineMode: true },
      { isMagnetPinMode: true }, { isAreaDesignationMode: true }, { isReorderMode: true },
    ];
    for (const t of tools) {
      expect(canPlaceFreePart(ctx({ flags: flagsOf('select', t) })), JSON.stringify(t)).toBe(false);
    }
    expect(canPlaceFreePart(ctx({ flags: flagsOf('move-select') }))).toBe(false);
  });
});

describe('立面ビューを選択中は従来どおりビューへ入る', () => {
  it('ビューが受け取れる状態で選択中なら freeParts へは置かない', () => {
    const flags = flagsOf('select');
    expect(viewCanReceivePart(flags, true)).toBe(true);
    expect(canPlaceFreePart(ctx({ flags, viewSelected: true }))).toBe(false);
  });

  it('ビューを選択していても、受け取れない状態なら freeParts が拾う', () => {
    // 閲覧モードでは ElevationViewLayer が対話版を出さない＝誰も受け取れない
    const flags = flagsOf('view');
    expect(viewCanReceivePart(flags, true)).toBe(false);
    expect(canPlaceFreePart(ctx({ flags, viewSelected: true }))).toBe(true);
  });

  it('選択ツールが無効なら、ビューは受け取れない', () => {
    expect(viewCanReceivePart(flagsOf('select'), false)).toBe(false);
    expect(canPlaceFreePart(ctx({ flags: flagsOf('select'), selectActive: false, viewSelected: true })))
      .toBe(true);
  });

  it('二重に置かれない（ビューが受けるときは freeParts が下りる）', () => {
    for (const mode of ['view', 'select', 'erase'] as ModeType[]) {
      for (const selectActive of [true, false]) {
        const flags = flagsOf(mode);
        const view = viewCanReceivePart(flags, selectActive);
        const free = canPlaceFreePart(ctx({ flags, selectActive, viewSelected: true }));
        expect(view && free, `${mode}/${selectActive}`).toBe(false);
      }
    }
  });
});

describe('達成条件: まっさらなキャンバスに 1 本置ける', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData({
      version: '1.0',
      grid: { unitMm: 10, cols: 600, rows: 400 },
      buildings: [], roofOverhangs: [], obstacles: [],
      handrails: [], posts: [], antis: [], memos: [],
      compass: { angle: 0 },
    } as never);
    useCanvasStore.setState({ mode: 'view', selectedIds: [] });
  });

  it('立面ビュー 0 件・閲覧モードでゲートが開く', () => {
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.elevationViews).toEqual([]);
    expect(canPlaceFreePart(ctx({ flags: flagsOf(useCanvasStore.getState().mode) }))).toBe(true);
  });

  it('配置すると canvasData.freeParts が増える', () => {
    useCanvasStore.getState().addFreePart(newFreePart('rail', 'free:rail:1', { x: 50, y: 30 }, { sizeMm: 1800 }));
    const cv = useCanvasStore.getState().canvasData;
    expect(cv.freeParts).toHaveLength(1);
    expect(cv.elevationViews).toEqual([]);           // ビューは作られない
    expect(freePartAnchorGrid(cv.freeParts![0])!.x).toBeCloseTo(50);
  });

  it('部材があれば、置いていない状態でもレイヤーは描画を出す', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../components/canvas/FreePartLayer.tsx'), 'utf8');
    // 「何も無く、置いてもいない」ときだけ何も出さない
    //   E-8-v5c: 補助線は AidLayer が描くので、この判定は補助も含めた全体（allParts）で見る。
    expect(src).toMatch(/if \(allParts\.length === 0 && !placing\) return null;/);
  });
});

describe('配線', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../components/canvas/FreePartLayer.tsx'), 'utf8');

  it('レイヤーは判定を placementGate に任せている（条件を書き分けない）', () => {
    expect(src).toMatch(/canPlaceFreePart\(\{ addTool, flags, selectActive, viewSelected \}\)/);
    // 素の選択モードを配置の条件にしていない
    expect(src).not.toMatch(/placing = .*isPlainSelectMode/);
  });

  it('描画レイヤーはキャンバスに載っている', () => {
    const grid = fs.readFileSync(
      path.resolve(__dirname, '../../../components/canvas/GridCanvas.tsx'), 'utf8');
    expect(grid).toMatch(/<FreePartLayer \/>/);
  });

  it('部材の選択・移動は従来どおり選択モードの条件のまま', () => {
    expect(src).toMatch(/const interactive = \(isPlainSelectMode\(flags\) && selectActive\) \|\| mode === 'erase'/);
  });
});
