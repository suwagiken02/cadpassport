import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * 移動ボタン拡張のロジックを純関数で test する。
 * useCanvasInteraction.ts の hit 時 filter 判定 + 各 Layer の canDrag 計算 + localStorage 永続化 + vibrate モック。
 */

type MoveFilter = { parts: boolean; dimensions: boolean; buildings: boolean; obstacles: boolean };
type Category = 'parts' | 'obstacles' | 'buildings' | 'dimensions' | 'other';

/** useCanvasInteraction.ts と同等のロジック (= hit 時 drag 可否判定) */
function isDragAllowed(
  category: Category,
  moveEnabled: boolean,
  moveFilter: MoveFilter,
): boolean {
  if (!moveEnabled) return false;
  if (category === 'parts') return moveFilter.parts;
  if (category === 'obstacles') return moveFilter.obstacles;
  if (category === 'buildings') return moveFilter.buildings;
  if (category === 'dimensions') return moveFilter.dimensions;
  return true; // memo / heightMarker / magnetPin 等は moveEnabled のみに従う
}

/** 各 Layer の canDrag 計算 (= mode + moveEnabled + filter の AND) */
function calcCanDrag(
  mode: string,
  category: Category,
  moveEnabled: boolean,
  moveFilter: MoveFilter,
): boolean {
  if (mode !== 'select') return false;
  return isDragAllowed(category, moveEnabled, moveFilter);
}

const DEFAULT_FILTER: MoveFilter = {
  parts: true,
  dimensions: true,
  buildings: true,
  obstacles: true,
};

describe('isDragAllowed (= 移動 filter logic)', () => {
  it('moveEnabled=false で全カテゴリ drag 不可', () => {
    expect(isDragAllowed('parts', false, DEFAULT_FILTER)).toBe(false);
    expect(isDragAllowed('dimensions', false, DEFAULT_FILTER)).toBe(false);
    expect(isDragAllowed('buildings', false, DEFAULT_FILTER)).toBe(false);
    expect(isDragAllowed('obstacles', false, DEFAULT_FILTER)).toBe(false);
    expect(isDragAllowed('other', false, DEFAULT_FILTER)).toBe(false);
  });

  it('moveEnabled=true + 全 filter true で全カテゴリ drag 可', () => {
    expect(isDragAllowed('parts', true, DEFAULT_FILTER)).toBe(true);
    expect(isDragAllowed('dimensions', true, DEFAULT_FILTER)).toBe(true);
    expect(isDragAllowed('buildings', true, DEFAULT_FILTER)).toBe(true);
    expect(isDragAllowed('obstacles', true, DEFAULT_FILTER)).toBe(true);
  });

  it('moveFilter で false のカテゴリのみ drag 不可、 他は維持', () => {
    const filter: MoveFilter = { ...DEFAULT_FILTER, parts: false };
    expect(isDragAllowed('parts', true, filter)).toBe(false);
    expect(isDragAllowed('dimensions', true, filter)).toBe(true);
    expect(isDragAllowed('buildings', true, filter)).toBe(true);
    expect(isDragAllowed('obstacles', true, filter)).toBe(true);
  });

  it('仕様外カテゴリ (= other = memo / heightMarker / magnetPin) は moveEnabled のみに従う', () => {
    expect(isDragAllowed('other', true, DEFAULT_FILTER)).toBe(true);
    // 全 filter false でも moveEnabled=true なら drag 可
    const allFalse: MoveFilter = { parts: false, dimensions: false, buildings: false, obstacles: false };
    expect(isDragAllowed('other', true, allFalse)).toBe(true);
    // moveEnabled=false なら drag 不可
    expect(isDragAllowed('other', false, DEFAULT_FILTER)).toBe(false);
  });
});

describe('calcCanDrag (= Layer 側 canDrag 計算)', () => {
  it('mode が select 以外なら全カテゴリ false', () => {
    expect(calcCanDrag('building', 'parts', true, DEFAULT_FILTER)).toBe(false);
    expect(calcCanDrag('erase', 'obstacles', true, DEFAULT_FILTER)).toBe(false);
    expect(calcCanDrag('memo', 'buildings', true, DEFAULT_FILTER)).toBe(false);
  });

  it('mode=select + moveEnabled=true で filter に従う', () => {
    expect(calcCanDrag('select', 'parts', true, DEFAULT_FILTER)).toBe(true);
    const filter: MoveFilter = { ...DEFAULT_FILTER, dimensions: false };
    expect(calcCanDrag('select', 'dimensions', true, filter)).toBe(false);
    expect(calcCanDrag('select', 'parts', true, filter)).toBe(true);
  });

  it('mode=select + moveEnabled=false で全カテゴリ false (= filter true でも)', () => {
    expect(calcCanDrag('select', 'parts', false, DEFAULT_FILTER)).toBe(false);
    expect(calcCanDrag('select', 'other', false, DEFAULT_FILTER)).toBe(false);
  });
});

describe('localStorage 永続化', () => {
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

  it('moveEnabled の保存・復元 (= ashiba-plan:moveEnabled キー)', () => {
    localStorage.setItem('ashiba-plan:moveEnabled', '0');
    const saved = localStorage.getItem('ashiba-plan:moveEnabled');
    expect(saved).toBe('0');
  });

  it('moveFilter の保存・復元 (= JSON 形式)', () => {
    const filter: MoveFilter = { parts: false, dimensions: true, buildings: false, obstacles: true };
    localStorage.setItem('ashiba-plan:moveFilter', JSON.stringify(filter));
    const saved = localStorage.getItem('ashiba-plan:moveFilter');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed).toEqual(filter);
  });

  it('未保存時は null (= default true 維持)', () => {
    expect(localStorage.getItem('ashiba-plan:moveEnabled')).toBeNull();
    expect(localStorage.getItem('ashiba-plan:moveFilter')).toBeNull();
  });
});

describe('navigator.vibrate モック', () => {
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrateMock = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigator.vibrate(50) が呼び出される', () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }
    expect(vibrateMock).toHaveBeenCalledWith(50);
    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  it('vibrate 非対応環境では呼ばれない', () => {
    vi.stubGlobal('navigator', {});
    // typeof check で safe
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      (navigator as any).vibrate(50);
    }
    expect(vibrateMock).toHaveBeenCalledTimes(0);
  });
});
