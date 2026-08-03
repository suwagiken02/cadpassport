// ============================================================
// E-8-v3c-2: パレット配置の入力方式（立面で先行実装 → 平面へ展開する共通部分）。
// 判定を pure に切り出してあるので、DOM 無しで固定できる。
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  clientToCanvasPoint, isInsideRect, movedEnough, placementModeForPointer,
} from '../placementInput';

describe('入力方式の判定', () => {
  it('指・ペンはドラッグ&ドロップ、マウスはシャドー追従+クリック', () => {
    expect(placementModeForPointer('touch')).toBe('drag-drop');
    expect(placementModeForPointer('pen')).toBe('drag-drop');
    expect(placementModeForPointer('mouse')).toBe('hover-click');
  });

  it('種別が取れない環境はマウス扱い（クリックで置ける）', () => {
    expect(placementModeForPointer(undefined)).toBe('hover-click');
    expect(placementModeForPointer('')).toBe('hover-click');
  });
});

describe('ドロップ先の判定', () => {
  const rect = { left: 100, top: 50, right: 500, bottom: 400 };

  it('キャンバスの中で離せば配置、外なら取り消し', () => {
    expect(isInsideRect({ clientX: 300, clientY: 200 }, rect)).toBe(true);
    expect(isInsideRect({ clientX: 100, clientY: 50 }, rect)).toBe(true);   // 縁は中
    expect(isInsideRect({ clientX: 99, clientY: 200 }, rect)).toBe(false);
    expect(isInsideRect({ clientX: 300, clientY: 401 }, rect)).toBe(false);
  });

  it('キャンバスが無い場合は置かない', () => {
    expect(isInsideRect({ clientX: 300, clientY: 200 }, null)).toBe(false);
  });
});

describe('掴んだだけ / 引き出した の区別', () => {
  const from = { clientX: 200, clientY: 200 };

  it('しきい値未満はドラッグではない（＝ボタンを押しただけ＝選択のみ）', () => {
    expect(movedEnough(from, { clientX: 203, clientY: 202 })).toBe(false);
  });

  it('しきい値以上は引き出したと見なす', () => {
    expect(movedEnough(from, { clientX: 230, clientY: 200 })).toBe(true);
    expect(movedEnough(from, { clientX: 200, clientY: 160 })).toBe(true);
  });

  it('しきい値は指定できる（平面では別値にできる）', () => {
    expect(movedEnough(from, { clientX: 210, clientY: 200 }, 20)).toBe(false);
    expect(movedEnough(from, { clientX: 230, clientY: 200 }, 20)).toBe(true);
  });
});

describe('クライアント座標 → キャンバス座標', () => {
  it('キャンバスの左上を原点にした座標へ直す', () => {
    expect(clientToCanvasPoint({ clientX: 300, clientY: 200 }, { left: 100, top: 50 }))
      .toEqual({ x: 200, y: 150 });
  });

  it('キャンバスが無ければ null（図ごとの変換に進ませない）', () => {
    expect(clientToCanvasPoint({ clientX: 300, clientY: 200 }, null)).toBeNull();
  });
});
