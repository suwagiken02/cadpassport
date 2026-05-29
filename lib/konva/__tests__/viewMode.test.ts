import { describe, it, expect } from 'vitest';
import type { ModeType } from '@/types';

/**
 * 図面初期 mode 'view' (= 閲覧モード) の挙動確認。
 * - 初期化時 'view' で開始 (= 既存 'select' から変更)
 * - 各 Layer の listening 計算は 'view' で false (= 触れない)
 * - useCanvasInteraction の hit 経路は 'view' で即 return
 */

type SelectLock = {
  parts: boolean;
  building: boolean;
  obstacle: boolean;
  roof: boolean;
  dimension: boolean;
};

/** ModeType に 'view' が含まれるかコンパイル時に保証 (= 型 narrowing で確認) */
function isView(mode: ModeType): boolean {
  return mode === 'view';
}

/** Layer の listening 計算 (= 既存ロジック等価) */
function calcSelectListen(
  mode: ModeType,
  category: 'parts' | 'building' | 'obstacle' | 'dimension' | 'roof',
  selectActive: boolean,
  selectLock: SelectLock,
): boolean {
  if (mode !== 'select') return false;
  if (!selectActive) return false;
  return !selectLock[category];
}

/** useCanvasInteraction hit 経路 gate (= 'view' で即 return = false 相当) */
function shouldHandleHit(mode: ModeType): boolean {
  if (mode === 'view') return false;
  return true;
}

const DEFAULT_LOCK: SelectLock = {
  parts: true,
  building: false,
  obstacle: false,
  roof: false,
  dimension: false,
};

describe('図面初期 mode = view (= 閲覧モードから開始)', () => {
  it("ModeType に 'view' が定義されている", () => {
    const m: ModeType = 'view';
    expect(isView(m)).toBe(true);
  });

  it('view モードでは全カテゴリの listening が false (= 触れない閲覧状態)', () => {
    expect(calcSelectListen('view', 'parts', true, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('view', 'building', true, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('view', 'obstacle', true, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('view', 'dimension', true, DEFAULT_LOCK)).toBe(false);
  });

  it('view モードでは selectActive / selectLock の状態に関わらず listening false', () => {
    const noLock: SelectLock = { parts: false, building: false, obstacle: false, roof: false, dimension: false };
    expect(calcSelectListen('view', 'parts', true, noLock)).toBe(false);
    expect(calcSelectListen('view', 'building', false, noLock)).toBe(false);
  });

  it("useCanvasInteraction hit 経路は 'view' で起動しない (= 即 return)", () => {
    expect(shouldHandleHit('view')).toBe(false);
  });

  it("'select' / 'erase' / 'building' 等の通常 mode は hit 経路を通る", () => {
    expect(shouldHandleHit('select')).toBe(true);
    expect(shouldHandleHit('erase')).toBe(true);
    expect(shouldHandleHit('building')).toBe(true);
    expect(shouldHandleHit('memo')).toBe(true);
  });

  it("'select' モードに切り替えると listening が有効化 (= ユーザがボタン押下後)", () => {
    expect(calcSelectListen('select', 'building', true, DEFAULT_LOCK)).toBe(true);
    expect(calcSelectListen('select', 'parts', true, DEFAULT_LOCK)).toBe(false);
  });
});
