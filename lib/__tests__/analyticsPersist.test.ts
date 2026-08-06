// ============================================================
// 計測イベントの欠落・利用者数の重複（実測で見つかった不具合）の再発防止。
//
// 実測（本番）で起きたこと:
//   ・ログイン画面のイベント（screen_view/sign_in/sign_out）が 0 件。
//     ページが切り替わった時点で、まだ送っていないぶんが消えていた。
//   ・「セッション 1 なのに利用者 2」。ログイン確定前の仮 id('anonymous') を
//     ハッシュしてしまい、同じ人に 2 つのハッシュが付いていた。
//
// ここでは、ブラウザ（window + sessionStorage）を模して
//   1) 積む → 2) モジュールを読み込み直す（＝ページが切り替わった） → 3) 残っている
// を検証する。モジュール変数は消えるが sessionStorage は残る、という前提の確認でもある。
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** sessionStorage の最小実装（タブの中だけで生き、閉じれば消える性質を模す）。 */
function makeSessionStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    _map: map,
  };
}

const store = makeSessionStorage();

beforeEach(() => {
  vi.resetModules();
  store.clear();
  // ブラウザに見せかける（isBrowser() が true になる）。
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: store,
    crypto: { randomUUID: () => 'test-session-0000' },
    addEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).document = { addEventListener: () => {} };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

/** 「新しいページを開いた」＝モジュールを読み込み直す。 */
async function loadAnalytics() {
  return import('../analytics');
}

describe('ページ遷移をまたいでもイベントが消えない', () => {
  it('積んだイベントは sessionStorage に保存される', async () => {
    const a = await loadAnalytics();
    a.trackScreen('auth');
    a.trackResult('sign_in', true, { method: 'id' });
    const saved = JSON.parse(store.getItem('ashiba-plan:analytics:queue') ?? '[]');
    expect(saved.map((e: { event_name: string }) => e.event_name))
      .toEqual(['screen_view', 'sign_in']);
  });

  it('別のページで読み込み直しても、前のページのぶんが残っている', async () => {
    const a = await loadAnalytics();
    a.trackScreen('auth');
    a.trackResult('sign_in', true);
    expect(a.__getQueueForTest()).toHaveLength(2);

    // ← ここでページが切り替わる（モジュール変数は消える）
    vi.resetModules();
    const b = await loadAnalytics();
    expect(b.__getQueueForTest()).toHaveLength(0);   // 変数上は空

    // 次に積んだ時点で、前のページのぶんが復帰する
    b.trackScreen('projects');
    const names = b.__getQueueForTest().map((e) => e.event_name);
    expect(names).toContain('sign_in');
    expect(names.filter((n) => n === 'screen_view')).toHaveLength(2);   // auth と projects
  });

  it('flush でも復帰する（積む前に送信が走っても取りこぼさない）', async () => {
    const a = await loadAnalytics();
    a.trackResult('sign_out', true);
    vi.resetModules();
    const b = await loadAnalytics();
    b.flush();                       // 本番以外は送らないが、復帰は行われる
    expect(store.getItem('ashiba-plan:analytics:queue')).toBeNull();   // 送信済み扱いで空に
  });

  it('保存が壊れていても落ちない（本体を止めない）', async () => {
    store.setItem('ashiba-plan:analytics:queue', '{壊れたJSON');
    const a = await loadAnalytics();
    expect(() => a.track('x')).not.toThrow();
    expect(a.__getQueueForTest().map((e) => e.event_name)).toEqual(['x']);
  });

  it('sessionStorage が使えない環境でも落ちない', async () => {
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem: () => { throw new Error('denied'); },
        setItem: () => { throw new Error('denied'); },
        removeItem: () => { throw new Error('denied'); },
      },
      addEventListener: () => {},
    };
    const a = await loadAnalytics();
    expect(() => a.track('x')).not.toThrow();
  });
});

describe('匿名ハッシュは同一人物で同一値（利用者数の重複を防ぐ）', () => {
  it("未ログインの仮 id('anonymous') ではハッシュを作らない", async () => {
    const a = await loadAnalytics();
    a.identify('anonymous');
    expect(a.__getIdentityForTest()).toEqual({ signedIn: false, userHash: null });
  });

  it('identify(null) でもキューは捨てない（再ログインで送るため）', async () => {
    const a = await loadAnalytics();
    a.trackResult('sign_out', true);
    a.identify(null);
    expect(a.__getQueueForTest()).toHaveLength(1);
    expect(a.__getIdentityForTest().signedIn).toBe(false);
  });

  it('同じ user_id からは毎回同じハッシュになる（ログイン前後で変わらない）', async () => {
    // Web Crypto を模す（同じ入力 → 同じ出力）。
    const digest = async (_alg: string, data: ArrayBufferView) => {
      const bytes = new Uint8Array(data.buffer as ArrayBuffer);
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++) out[i] = (bytes[i % bytes.length] + i) & 0xff;
      return out.buffer;
    };
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: store,
      crypto: { subtle: { digest } },
      addEventListener: () => {},
    };
    const a = await loadAnalytics();
    a.identify('user-123');
    await new Promise((r) => setTimeout(r, 0));
    const first = a.__getIdentityForTest().userHash;
    expect(first).toMatch(/^[0-9a-f]{16}$/);

    a.identify(null);
    a.identify('user-123');
    await new Promise((r) => setTimeout(r, 0));
    expect(a.__getIdentityForTest().userHash).toBe(first);
  });
});

// ============================================================
// OAuth（Google ログイン）・移動イベント過多・セッション分割の再発防止。
//
// 実測（本番・Google 認証で 1 周）:
//   ・sign_in / sign_up / sign_out / screen_view(auth) が 0 件
//     → Google ログインは authStore.signIn を通らない（外部サイトへ飛んで戻る）。
//       方式ごとに仕込む限り必ず取りこぼす。
//   ・manual_edit が 134 件（実際の手直しは 4 回）
//     → ドラッグ中に moveElement が連続で呼ばれ、1 回の移動が数十件になっていた。
//   ・1 回の通し操作なのにセッションが 2 つ
//     → OAuth のリダイレクトで sessionStorage が失われ、session_id が切り替わっていた。
// ============================================================
describe('セッションは 1 回のタブ利用で 1 つ（OAuth のリダイレクトをまたぐ）', () => {
  const local = makeSessionStorage();

  beforeEach(() => {
    local.clear();
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: store,
      localStorage: local,
      crypto: { randomUUID: () => `sid-${Math.random().toString(16).slice(2, 10)}` },
      addEventListener: () => {},
    };
  });

  it('sessionStorage が消えても、直前の続きなら同じ session_id を引き継ぐ', async () => {
    const a = await loadAnalytics();
    a.track('screen_view');
    const first = a.__getQueueForTest()[0].session_id;

    // 外部サイト（Google）へ飛んで戻り、sessionStorage が失われた状況
    store.clear();
    vi.resetModules();
    const b = await loadAnalytics();
    b.track('screen_view');
    expect(b.__getQueueForTest()[0].session_id).toBe(first);
  });

  it('30 分以上空いていれば別のセッションとして切り直す', async () => {
    const a = await loadAnalytics();
    a.track('x');
    const first = a.__getQueueForTest()[0].session_id;

    store.clear();
    // 最後に使った時刻を 31 分前に偽装
    local.setItem('ashiba-plan:analytics:sid-last',
      JSON.stringify({ id: first, at: Date.now() - 31 * 60 * 1000 }));
    vi.resetModules();
    const b = await loadAnalytics();
    b.track('x');
    expect(b.__getQueueForTest()[0].session_id).not.toBe(first);
  });

  it('localStorage が使えなくても落ちない（sessionStorage だけで動く）', async () => {
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: store,
      localStorage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } },
      crypto: { randomUUID: () => 'sid-x' },
      addEventListener: () => {},
    };
    const a = await loadAnalytics();
    expect(() => a.track('x')).not.toThrow();
    expect(a.__getQueueForTest()[0].session_id).toBe('sid-x');
  });
});

describe('送信に失敗したイベントは消えない（ログアウト時の取りこぼし対策）', () => {
  it('insert が失敗したらキューへ戻して保存する', async () => {
    // 本番扱い＋失敗する insert を仕込む
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('@/lib/supabase/client', () => ({
      supabase: { from: () => ({ insert: () => Promise.resolve({ error: { message: 'RLS' } }) }) },
    }));
    const a = await loadAnalytics();
    a.identify('user-1');
    a.__setSignedInForTest(true);
    a.track('sign_out');
    await a.flush();
    // ハッシュ確定の後に自動で走る再送も終わらせてから確かめる（実機と同じ非同期）。
    await new Promise((r) => setTimeout(r, 5));
    // 失われず、次の機会に送れるよう残っている
    expect(a.__getQueueForTest().map((e) => e.event_name)).toContain('sign_out');
    const saved = JSON.parse(store.getItem('ashiba-plan:analytics:queue') ?? '[]');
    expect(saved.map((e: { event_name: string }) => e.event_name)).toContain('sign_out');
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/supabase/client');
  });
});
