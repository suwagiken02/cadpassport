import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NOTICE_VERSION, NOTICE_KEY, isNoticeDismissed, dismissNotice } from '../notice';

// localStorage を差し替える簡易 mock。
function makeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

describe('notice: キー生成', () => {
  it('NOTICE_KEY はバージョン付き（次回変更で使い回し可能）', () => {
    expect(NOTICE_VERSION).toBe('v20260704');
    expect(NOTICE_KEY).toBe('ashiba-plan:noticeDismissed:v20260704');
  });
});

describe('notice: 既読フラグ', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('未保存なら未既読（表示する）', () => {
    vi.stubGlobal('window', { localStorage: makeStore() });
    expect(isNoticeDismissed()).toBe(false);
  });

  it('dismissNotice 後は既読', () => {
    const store = makeStore();
    vi.stubGlobal('window', { localStorage: store });
    dismissNotice();
    expect(store.getItem(NOTICE_KEY)).toBe('1');
    expect(isNoticeDismissed()).toBe(true);
  });

  it('別バージョンのフラグでは既読にならない（再表示される）', () => {
    const store = makeStore();
    store.setItem('ashiba-plan:noticeDismissed:v20250101', '1'); // 旧バージョン
    vi.stubGlobal('window', { localStorage: store });
    expect(isNoticeDismissed()).toBe(false);
  });

  it('localStorage 例外時は false（表示側に倒す）・dismiss も投げない', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
      },
    });
    expect(isNoticeDismissed()).toBe(false);
    expect(() => dismissNotice()).not.toThrow();
  });
});
