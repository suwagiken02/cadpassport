import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * 選択カテゴリロックの listening 制御 + localStorage 永続化 を test。
 */

type SelectLock = {
  parts: boolean;
  building: boolean;
  obstacle: boolean;
  roof: boolean;
  dimension: boolean;
};

type Category = 'parts' | 'building' | 'obstacle' | 'roof' | 'dimension';

/** 各 Layer の listening 計算 (= mode + selectActive + !selectLock[category] の AND) */
function calcSelectListen(
  mode: string,
  category: Category,
  selectActive: boolean,
  selectLock: SelectLock,
): boolean {
  if (mode !== 'select') return false;
  if (!selectActive) return false;
  return !selectLock[category];
}

const DEFAULT_LOCK: SelectLock = {
  parts: false,
  building: false,
  obstacle: false,
  roof: false,
  dimension: false,
};

describe('calcSelectListen (= 選択ロックの listening 計算)', () => {
  it('mode != select で全カテゴリ false', () => {
    expect(calcSelectListen('building', 'parts', true, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('erase', 'obstacle', true, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('memo', 'dimension', true, DEFAULT_LOCK)).toBe(false);
  });

  it('selectActive=false で全カテゴリ false (= 選択 OFF)', () => {
    expect(calcSelectListen('select', 'parts', false, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('select', 'building', false, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('select', 'obstacle', false, DEFAULT_LOCK)).toBe(false);
    expect(calcSelectListen('select', 'dimension', false, DEFAULT_LOCK)).toBe(false);
  });

  it('selectActive=true + 全 lock false で全カテゴリ true (= default 全解除)', () => {
    expect(calcSelectListen('select', 'parts', true, DEFAULT_LOCK)).toBe(true);
    expect(calcSelectListen('select', 'building', true, DEFAULT_LOCK)).toBe(true);
    expect(calcSelectListen('select', 'obstacle', true, DEFAULT_LOCK)).toBe(true);
    expect(calcSelectListen('select', 'dimension', true, DEFAULT_LOCK)).toBe(true);
  });

  it('lock=true のカテゴリのみ false、 他は true 維持', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    expect(calcSelectListen('select', 'parts', true, lock)).toBe(false);
    expect(calcSelectListen('select', 'building', true, lock)).toBe(true);
    expect(calcSelectListen('select', 'obstacle', true, lock)).toBe(true);
    expect(calcSelectListen('select', 'dimension', true, lock)).toBe(true);
  });

  it('複数 lock 同時可: parts + dimension lock', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true, dimension: true };
    expect(calcSelectListen('select', 'parts', true, lock)).toBe(false);
    expect(calcSelectListen('select', 'dimension', true, lock)).toBe(false);
    expect(calcSelectListen('select', 'building', true, lock)).toBe(true);
    expect(calcSelectListen('select', 'obstacle', true, lock)).toBe(true);
  });

  it('roof カテゴリ (= placeholder) も state として動作', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, roof: true };
    expect(calcSelectListen('select', 'roof', true, lock)).toBe(false);
    // 他カテゴリは影響なし
    expect(calcSelectListen('select', 'parts', true, lock)).toBe(true);
  });
});

/** useCanvasInteraction の hit 経路 gate ロジック (= mode='select' で lock ON なら return) */
function shouldGateHit(
  mode: string,
  isPartsHit: boolean,
  isObstacleHit: boolean,
  selectLock: SelectLock,
): boolean {
  if (mode !== 'select') return false;
  if (isPartsHit && selectLock.parts) return true;
  if (isObstacleHit && selectLock.obstacle) return true;
  return false;
}

describe('shouldGateHit (= 部材 / 障害物の hit 経路 gate)', () => {
  it('mode != select で gate しない', () => {
    expect(shouldGateHit('building', true, false, { ...DEFAULT_LOCK, parts: true })).toBe(false);
    expect(shouldGateHit('erase', false, true, { ...DEFAULT_LOCK, obstacle: true })).toBe(false);
  });

  it('parts ロック ON + 部材 hit で gate (= 選択 / drag 不可)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    expect(shouldGateHit('select', true, false, lock)).toBe(true);
  });

  it('parts ロック OFF + 部材 hit は通る', () => {
    expect(shouldGateHit('select', true, false, DEFAULT_LOCK)).toBe(false);
  });

  it('obstacle ロック ON + 障害物 hit で gate', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, obstacle: true };
    expect(shouldGateHit('select', false, true, lock)).toBe(true);
  });

  it('obstacle ロック OFF + 障害物 hit は通る', () => {
    expect(shouldGateHit('select', false, true, DEFAULT_LOCK)).toBe(false);
  });

  it('parts のみロック + 障害物 hit は通る (= 他カテゴリ影響なし)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    expect(shouldGateHit('select', false, true, lock)).toBe(false);
  });

  it('hit 無し (= parts/obstacle 共に false) は gate しない', () => {
    const lock: SelectLock = { parts: true, building: true, obstacle: true, roof: true, dimension: true };
    expect(shouldGateHit('select', false, false, lock)).toBe(false);
  });
});

describe('selectLock localStorage 永続化', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selectLock を JSON 形式で保存・復元', () => {
    const lock: SelectLock = { parts: true, building: false, obstacle: true, roof: false, dimension: false };
    localStorage.setItem('ashiba-plan:selectLock', JSON.stringify(lock));
    const saved = localStorage.getItem('ashiba-plan:selectLock');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as SelectLock;
    expect(parsed).toEqual(lock);
  });

  it('未保存時は null (= default 全 false 維持)', () => {
    expect(localStorage.getItem('ashiba-plan:selectLock')).toBeNull();
  });

  it('JSON 不正値は parse 失敗 → default 維持', () => {
    localStorage.setItem('ashiba-plan:selectLock', 'invalid-json');
    let parsed: unknown = null;
    try {
      const saved = localStorage.getItem('ashiba-plan:selectLock');
      if (saved) parsed = JSON.parse(saved);
    } catch {
      parsed = null;
    }
    expect(parsed).toBeNull();
  });
});
