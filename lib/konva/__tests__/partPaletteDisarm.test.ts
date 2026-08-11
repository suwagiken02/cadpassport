// ============================================================
// P-2 commit 1: タブを切り替えたら、切り替え**前**のタブの武装を解除する。
//
// 症状: 【立面図】タブで部材を選んだまま【平面部材】タブへ戻しても、立面部材の
// シャドーがカーソルに追従し続ける。E-8-v5c で立面タブが自動で手摺を選ぶように
// なったため、この状態に入りやすくなった。
//
// 「武装」= パレットで部材を選んでいて、キャンバスを触ると置かれる状態。
// タブを離れたらその武装は持ち越さない。部材メニュー自体を閉じたときも同じ。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';

const st = () => useCanvasStore.getState();

beforeEach(() => {
  useCanvasStore.setState({
    partPaletteTab: 'plane', elevationAddTool: null, elevationEditSelectedId: null,
    showPartSelector: false,
  });
});

describe('タブ切替で前のタブの武装が解ける', () => {
  it('立面 → 平面 で立面部材の選択が解ける（今回の症状）', () => {
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('rail');
    expect(st().elevationAddTool).toBe('rail');

    st().setPartPaletteTab('plane');
    expect(st().elevationAddTool).toBeNull();
    expect(st().partPaletteTab).toBe('plane');
  });

  it('選んでいた部材の種類によらず解ける', () => {
    for (const kind of ['post', 'rail', 'board', 'jack', 'brace'] as const) {
      st().setPartPaletteTab('elevation');
      st().setElevationAddTool(kind);
      st().setPartPaletteTab('plane');
      expect(st().elevationAddTool, kind).toBeNull();
    }
  });

  it('立面の部材選択（編集対象）も一緒に外れる', () => {
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('rail');
    useCanvasStore.setState({ elevationEditSelectedId: 'manual:rail:1' });
    st().setPartPaletteTab('plane');
    expect(st().elevationEditSelectedId).toBeNull();
  });

  it('平面 → 立面 でも、平面側に持ち越しは無い', () => {
    st().setPartPaletteTab('plane');
    st().setPartPaletteTab('elevation');
    expect(st().partPaletteTab).toBe('elevation');
    // 立面タブへ入った時点では、まだ何も武装していない（選ぶのはパレットの仕事）
    expect(st().elevationAddTool).toBeNull();
  });

  it('同じタブを押し直しただけなら解除しない', () => {
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('brace');
    st().setPartPaletteTab('elevation');
    expect(st().elevationAddTool).toBe('brace');
  });

  it('往復しても残らない', () => {
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('post');
    st().setPartPaletteTab('plane');
    st().setPartPaletteTab('elevation');
    // 戻った時点では未武装。パレットが開いたときに手摺を選ぶ（E-8-v5c）
    expect(st().elevationAddTool).toBeNull();
  });
});

describe('部材メニューを閉じたら武装が解ける', () => {
  it('閉じると立面部材の選択が外れる', () => {
    st().togglePartSelector();               // 開く
    expect(st().showPartSelector).toBe(true);
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('rail');

    st().togglePartSelector();               // 閉じる
    expect(st().showPartSelector).toBe(false);
    expect(st().elevationAddTool).toBeNull();
  });

  it('開くときは何も壊さない', () => {
    useCanvasStore.setState({ elevationAddTool: 'rail', showPartSelector: false });
    st().togglePartSelector();
    expect(st().showPartSelector).toBe(true);
    expect(st().elevationAddTool).toBe('rail');
  });

  it('✕ で閉じる経路も同じ結果になる（PartSelector の onClose）', () => {
    st().togglePartSelector();
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('board');
    // onClose: setElevationAddTool(null) → togglePartSelector()
    st().setElevationAddTool(null);
    st().togglePartSelector();
    expect(st().showPartSelector).toBe(false);
    expect(st().elevationAddTool).toBeNull();
  });
});
