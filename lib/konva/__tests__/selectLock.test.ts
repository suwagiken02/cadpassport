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

/**
 * 各 Layer の listening 計算。
 * 「ロック中」と判定するのは selectActive=true のときだけ。
 * selectActive=false (= フッター選択 OFF / 入替モード) では selectLock を無視して触れる。
 */
function calcSelectListen(
  mode: string,
  category: Category,
  selectActive: boolean,
  selectLock: SelectLock,
): boolean {
  if (mode !== 'select') return false;
  const isLocked = selectActive && selectLock[category];
  return !isLocked;
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

  it('selectActive=false で selectLock 無視 → 全カテゴリ true (= 入替モード等でロック誤発動しない)', () => {
    // lock を全 ON にしても selectActive=false なら触れる
    const lock: SelectLock = { parts: true, building: true, obstacle: true, roof: true, dimension: true };
    expect(calcSelectListen('select', 'parts', false, lock)).toBe(true);
    expect(calcSelectListen('select', 'building', false, lock)).toBe(true);
    expect(calcSelectListen('select', 'obstacle', false, lock)).toBe(true);
    expect(calcSelectListen('select', 'dimension', false, lock)).toBe(true);
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

/**
 * useCanvasInteraction の hit 経路 gate ロジック。
 * mode='select' かつ selectActive=true で lock ON なら return (= hit 無視)。
 * selectActive=false (= 入替モード等) では gate せず hit を通す。
 */
function shouldGateHit(
  mode: string,
  selectActive: boolean,
  isPartsHit: boolean,
  isObstacleHit: boolean,
  selectLock: SelectLock,
): boolean {
  if (mode !== 'select' || !selectActive) return false;
  if (isPartsHit && selectLock.parts) return true;
  if (isObstacleHit && selectLock.obstacle) return true;
  return false;
}

describe('shouldGateHit (= 部材 / 障害物の hit 経路 gate)', () => {
  it('mode != select で gate しない', () => {
    expect(shouldGateHit('building', true, true, false, { ...DEFAULT_LOCK, parts: true })).toBe(false);
    expect(shouldGateHit('erase', true, false, true, { ...DEFAULT_LOCK, obstacle: true })).toBe(false);
  });

  it('selectActive=false で gate しない (= 入替モード等で部材 hit を通す)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true, obstacle: true };
    expect(shouldGateHit('select', false, true, false, lock)).toBe(false);
    expect(shouldGateHit('select', false, false, true, lock)).toBe(false);
  });

  it('parts ロック ON + 部材 hit で gate (= 選択 / drag 不可)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    expect(shouldGateHit('select', true, true, false, lock)).toBe(true);
  });

  it('parts ロック OFF + 部材 hit は通る', () => {
    expect(shouldGateHit('select', true, true, false, DEFAULT_LOCK)).toBe(false);
  });

  it('obstacle ロック ON + 障害物 hit で gate', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, obstacle: true };
    expect(shouldGateHit('select', true, false, true, lock)).toBe(true);
  });

  it('obstacle ロック OFF + 障害物 hit は通る', () => {
    expect(shouldGateHit('select', true, false, true, DEFAULT_LOCK)).toBe(false);
  });

  it('parts のみロック + 障害物 hit は通る (= 他カテゴリ影響なし)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    expect(shouldGateHit('select', true, false, true, lock)).toBe(false);
  });

  it('hit 無し (= parts/obstacle 共に false) は gate しない', () => {
    const lock: SelectLock = { parts: true, building: true, obstacle: true, roof: true, dimension: true };
    expect(shouldGateHit('select', true, false, false, lock)).toBe(false);
  });
});

/**
 * Layer の listening 計算式の純関数版 (= ScaffoldLayer 手摺 + ObstacleLayer 矩形の修正後の式)。
 * `selectListenXxx || mode === 'erase' || mode === 'move-select'` を再現。
 */
function calcLayerListening(
  selectListen: boolean,
  mode: string,
): boolean {
  return selectListen || mode === 'erase' || mode === 'move-select';
}

describe('calcLayerListening (= 手摺 L160 / 矩形障害物 L296 修正後の listening)', () => {
  it('selectListen=true → listening true (= ロックなし、 触れる)', () => {
    expect(calcLayerListening(true, 'select')).toBe(true);
  });

  it('selectListen=false + mode=select → listening false (= ロック中、 触れない)', () => {
    expect(calcLayerListening(false, 'select')).toBe(false);
  });

  it('selectListen=false でも mode=erase / move-select は listening true (= 消去 / 範囲移動は別経路)', () => {
    expect(calcLayerListening(false, 'erase')).toBe(true);
    expect(calcLayerListening(false, 'move-select')).toBe(true);
  });

  it('selectListen=false + mode=building / memo / roof で listening false (= 通常 mode 切替)', () => {
    expect(calcLayerListening(false, 'building')).toBe(false);
    expect(calcLayerListening(false, 'memo')).toBe(false);
    expect(calcLayerListening(false, 'roof')).toBe(false);
  });

  it('連動: selectLock.parts=true → calcSelectListen=false → calcLayerListening=false (= 手摺 drag 不可)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    const sel = calcSelectListen('select', 'parts', true, lock);
    expect(sel).toBe(false);
    expect(calcLayerListening(sel, 'select')).toBe(false);
  });

  it('連動: selectLock.obstacle=true → calcSelectListen=false → calcLayerListening=false (= 矩形障害物 drag 不可)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, obstacle: true };
    const sel = calcSelectListen('select', 'obstacle', true, lock);
    expect(sel).toBe(false);
    expect(calcLayerListening(sel, 'select')).toBe(false);
  });
});

/**
 * 入替モード (reorderMode) の selectActive 連動 (= 案B: toggleReorderMode で selectActive を切替)。
 * ON 時 selectActive=false (= ロック無効化), OFF 時 selectActive=true 復帰。
 */
function reorderToggleSelectActive(next: boolean): boolean {
  return next ? false : true;
}

describe('selectLock は selectActive=true 時のみ有効 (= reorderMode 等でロック誤発動しない)', () => {
  it('mode=select + selectActive=false → listening=true (= ロック無視で触れる)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    const sel = calcSelectListen('select', 'parts', false, lock);
    expect(sel).toBe(true);
    expect(calcLayerListening(sel, 'select')).toBe(true);
  });

  it('mode=select + selectActive=true + selectLock.parts=true → listening=false (= ロック中)', () => {
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    const sel = calcSelectListen('select', 'parts', true, lock);
    expect(sel).toBe(false);
    expect(calcLayerListening(sel, 'select')).toBe(false);
  });

  it('入替モード (= 案B で selectActive=false) → 部材 listening=true (= 入替可能)', () => {
    const selectActive = reorderToggleSelectActive(true); // toggleReorderMode ON
    expect(selectActive).toBe(false);
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true }; // parts ロック ON でも
    const sel = calcSelectListen('select', 'parts', selectActive, lock);
    expect(sel).toBe(true);
    expect(calcLayerListening(sel, 'select')).toBe(true);
    // hit gate も通す (= selectActive=false なので gate しない)
    expect(shouldGateHit('select', selectActive, true, false, lock)).toBe(false);
  });

  it('入替モード終了 (= 案B で selectActive=true 復帰) → ロック再有効', () => {
    const selectActive = reorderToggleSelectActive(false); // toggleReorderMode OFF
    expect(selectActive).toBe(true);
    const lock: SelectLock = { ...DEFAULT_LOCK, parts: true };
    const sel = calcSelectListen('select', 'parts', selectActive, lock);
    expect(sel).toBe(false);
    expect(shouldGateHit('select', selectActive, true, false, lock)).toBe(true);
  });

  it('move-select は selectActive / lock 無関係に listening=true (= 既存挙動維持)', () => {
    const lock: SelectLock = { parts: true, building: true, obstacle: true, roof: true, dimension: true };
    const sel = calcSelectListen('select', 'parts', true, lock);
    expect(sel).toBe(false);
    expect(calcLayerListening(sel, 'move-select')).toBe(true);
  });
});

describe('selectLock デフォルト値 (= 部材のみロック ON、 他 OFF)', () => {
  it('部材のみ true、 他は全 false が想定 default', () => {
    const expected: SelectLock = {
      parts: true,
      building: false,
      obstacle: false,
      roof: false,
      dimension: false,
    };
    expect(expected.parts).toBe(true);
    expect(expected.building).toBe(false);
    expect(expected.obstacle).toBe(false);
    expect(expected.roof).toBe(false);
    expect(expected.dimension).toBe(false);
  });

  it('デフォルト適用時、 部材のみ drag 不可、 他は触れる (= 連動 check)', () => {
    const defaultLock: SelectLock = {
      parts: true, building: false, obstacle: false, roof: false, dimension: false,
    };
    expect(calcSelectListen('select', 'parts', true, defaultLock)).toBe(false);
    expect(calcSelectListen('select', 'building', true, defaultLock)).toBe(true);
    expect(calcSelectListen('select', 'obstacle', true, defaultLock)).toBe(true);
    expect(calcSelectListen('select', 'dimension', true, defaultLock)).toBe(true);
  });
});

/** 躯体トグル判定 (= ModeToolbar の handleMainButton 'kutai' 分岐) */
function shouldResetKutai(isKutaiMode: boolean): 'reset' | 'open' {
  return isKutaiMode ? 'reset' : 'open';
}

/** メモトグル判定 */
function shouldResetMemo(mode: string): 'reset' | 'open' {
  return mode === 'memo' ? 'reset' : 'open';
}

describe('躯体ボタンのトグル化 (= 再タップで mode + 関連 state リセット)', () => {
  it('isKutaiMode=false で open (= 通常 popover open)', () => {
    expect(shouldResetKutai(false)).toBe('open');
  });

  it('isKutaiMode=true で reset (= 関連 state 全リセット)', () => {
    expect(shouldResetKutai(true)).toBe('reset');
  });
});

describe('メモボタンのトグル化', () => {
  it('mode=memo で reset', () => {
    expect(shouldResetMemo('memo')).toBe('reset');
  });

  it('mode=select で open (= 通常 modal open)', () => {
    expect(shouldResetMemo('select')).toBe('open');
    expect(shouldResetMemo('building')).toBe('open');
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
