// ============================================================
// 認証イベントの記録（方式に依らず 1 箇所で拾う）と、
// ドラッグ移動が 1 件にまとまることの担保。
//
// 実測（本番・Google 認証で 1 周）:
//   ・sign_in / sign_up / sign_out が 0 件。Google ログインは外部サイトへ飛んで
//     戻るので authStore.signIn を通らない。方式ごとに仕込むと必ず取りこぼす。
//   ・manual_edit が 134 件（実際の手直しは 4 回）。ドラッグ中に moveElement が
//     連続で呼ばれ、1 回の移動が数十件になっていた。
//     ここが壊れると「自動配置の精度が低い」という誤った結論を生む。
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

type AuthHandler = (event: string, session: unknown) => void;
let handler: AuthHandler | null = null;
/** 実際に events へ送られた行（＝計測として成立したもの）。 */
let inserted: { event_name: string; ok: boolean | null; props: Record<string, unknown> }[] = [];

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}
const session = makeStorage();

beforeEach(() => {
  vi.resetModules();
  handler = null;
  inserted = [];
  session.clear();
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: session,
    localStorage: makeStorage(),
    crypto: { randomUUID: () => 'sid-auth-test' },
    addEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).document = { addEventListener: () => {} };
  vi.doMock('@/lib/supabase/client', () => ({
    supabase: {
      auth: { onAuthStateChange: (cb: AuthHandler) => { handler = cb; return { data: null }; } },
      from: () => ({
        insert: (rows: typeof inserted) => { inserted.push(...rows); return Promise.resolve({ error: null }); },
      }),
    },
  }));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
  vi.doUnmock('@/lib/supabase/client');
  vi.unstubAllEnvs();
});

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u-1',
  created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),   // 30 日前＝既存
  app_metadata: { provider: 'email' },
  email: 'a@example.com',
  ...over,
});

/** 認証を購読した状態の analytics を用意する（本番と同じく実際に送るところまで動かす）。 */
async function setupAuth() {
  vi.stubEnv('NODE_ENV', 'production');
  const a = await import('../analytics');
  a.startAuthTracking();
  return a;
}

/** 送信は非同期なので、マイクロタスクを 1 巡させてから確認する。 */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ログインの検知は方式に依らず 1 箇所（OAuth 対応）', () => {
  it('Google ログイン（signIn を通らない経路）でも sign_in が送られる', async () => {
    await setupAuth();
    handler!('SIGNED_IN', { user: user({ app_metadata: { provider: 'google' } }) });
    await settle();
    const e = inserted.find((x) => x.event_name === 'sign_in');
    expect(e).toBeDefined();
    expect(e!.props.method).toBe('google');
    expect(e!.ok).toBe(true);
  });

  it('メールログインは method=email', async () => {
    await setupAuth();
    handler!('SIGNED_IN', { user: user() });
    await settle();
    expect(inserted.find((x) => x.event_name === 'sign_in')!.props.method).toBe('email');
  });

  it('ID ログイン（@cadpassport.local）は method=id', async () => {
    await setupAuth();
    handler!('SIGNED_IN', { user: user({ email: 'taro@cadpassport.local' }) });
    await settle();
    expect(inserted.find((x) => x.event_name === 'sign_in')!.props.method).toBe('id');
  });

  it('作ったばかりのアカウントは sign_up として区別される', async () => {
    await setupAuth();
    handler!('SIGNED_IN', { user: user({ created_at: new Date().toISOString() }) });
    await settle();
    const names = inserted.map((x) => x.event_name);
    expect(names).toContain('sign_up');
    expect(names).not.toContain('sign_in');
  });

  it('同じセッションで何度 SIGNED_IN が飛んでも 1 回だけ記録する', async () => {
    await setupAuth();
    handler!('SIGNED_IN', { user: user() });
    handler!('TOKEN_REFRESHED', { user: user() });
    handler!('SIGNED_IN', { user: user() });
    await settle();
    expect(inserted.filter((x) => x.event_name === 'sign_in')).toHaveLength(1);
  });

  it('ログアウトは sign_out として送られる（紐づけを外す前に送り切る）', async () => {
    await setupAuth();
    handler!('SIGNED_IN', { user: user() });
    await settle();
    handler!('SIGNED_OUT', null);
    await settle();
    expect(inserted.map((x) => x.event_name)).toContain('sign_out');
  });

  it('ログイン時に匿名ハッシュが紐づく（送信できる状態になる）', async () => {
    const a = await setupAuth();
    handler!('SIGNED_IN', { user: user() });
    expect(a.__getIdentityForTest().signedIn).toBe(true);
  });

  it('購読は 1 回だけ（二重に記録しない）', async () => {
    const a = await setupAuth();
    const first = handler;
    a.startAuthTracking();
    expect(handler).toBe(first);
  });

  it('認証イベントの処理が失敗しても本体を止めない', async () => {
    await setupAuth();
    expect(() => handler!('SIGNED_IN', {
      user: { id: 'x', get created_at(): string { throw new Error('boom'); } },
    })).not.toThrow();
  });
});

describe('ドラッグ移動は 1 件（手戻り指標を壊さない）', () => {
  it('moveElement を 50 回呼んでも manual_edit は 1 件も出ない（ドラッグ中は数えない）', async () => {
    const a = await import('../analytics');
    const { useCanvasStore } = await import('@/stores/canvasStore');
    a.__resetForTest();
    const s = useCanvasStore.getState();
    s.addHandrail({
      id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000', floor: 1,
    } as never);
    a.__resetForTest();          // 追加ぶんの manual_edit を除いてから計測
    for (let i = 0; i < 50; i++) useCanvasStore.getState().moveElement('h1', 1, 0);
    expect(a.__getQueueForTest().filter((e) => e.event_name === 'manual_edit')).toHaveLength(0);
  });

  it('移動の記録はドラッグ終了時の 1 箇所だけ（ソースで固定）', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../konva/useCanvasInteraction.ts'), 'utf8');
    // ドラッグ終了(onWindowUp)の中で 1 回だけ記録している
    const up = src.slice(src.indexOf('const onWindowUp'));
    expect((up.match(/track\('manual_edit', \{ kind: 'move' \}\)/g) ?? [])).toHaveLength(1);
    // ドラッグ中(onWindowMove)では記録しない
    const move = src.slice(src.indexOf('const onWindowMove'), src.indexOf('const onWindowUp'));
    expect(move.includes('manual_edit')).toBe(false);
  });

  it('store の moveElement には track を戻さない（連続呼び出しの入口）', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../stores/canvasStore.ts'), 'utf8');
    const body = src.slice(src.indexOf('  moveElement: (id, dx, dy) => {'));
    expect(body.slice(0, 400).includes("track('manual_edit'")).toBe(false);
  });
});

// ============================================================
// 実測（本番の生ログ）で分かったこと:
//   session 109ebc47 … sign_in が 3 件（すべて user_hash=null）、move は 1 件
//   session f8d53d00 … move 19 件（＝古いバンドルが動いていたセッション）
// つまり移動の修正は効いていたが、
//   (a) sign_in の重複防止が OAuth のリダイレクトで失われる
//   (b) ハッシュが出る前に送るので user_hash が null になる
// の 2 つが残っていた。ここはその 2 つを、実機と同じ「リダイレクトで
// sessionStorage だけが消える」状況で再現して固定する。
// ============================================================
describe('OAuth のリダイレクトをまたいでも sign_in は 1 件', () => {
  it('sessionStorage が消えても二重に記録しない（印は localStorage）', async () => {
    const a = await setupAuth();
    handler!('SIGNED_IN', { user: user() });
    await settle();
    expect(inserted.filter((x) => x.event_name === 'sign_in')).toHaveLength(1);

    // ← Google から戻ってくる。sessionStorage は失われ、localStorage は残る。
    session.clear();
    vi.resetModules();
    const b = await import('../analytics');
    b.startAuthTracking();
    handler!('SIGNED_IN', { user: user() });
    await settle();
    await b.flush();
    expect(inserted.filter((x) => x.event_name === 'sign_in')).toHaveLength(1);
  });

  it('ログアウトすれば次のログインは記録される（印が消える）', async () => {
    const a = await setupAuth();
    handler!('SIGNED_IN', { user: user() });
    await settle();
    handler!('SIGNED_OUT', null);
    await settle();
    handler!('SIGNED_IN', { user: user() });
    await settle();
    await a.flush();
    expect(inserted.filter((x) => x.event_name === 'sign_in')).toHaveLength(2);
  });
});

describe('利用者を数えられる形で送る（user_hash が null にならない）', () => {
  it('ハッシュが出るまで送らない → 送られた行にはハッシュが付く', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // 実機と同じく、ハッシュ計算は非同期（Web Crypto）。
    const digest = (_alg: string, data: ArrayBufferView) => new Promise<ArrayBuffer>((resolve) => {
      setTimeout(() => {
        const bytes = new Uint8Array(data.buffer as ArrayBuffer);
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) out[i] = (bytes[i % bytes.length] + i) & 0xff;
        resolve(out.buffer);
      }, 5);
    });
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: session,
      localStorage: makeStorage(),
      crypto: { subtle: { digest } },
      addEventListener: () => {},
    };
    const a = await import('../analytics');
    a.startAuthTracking();
    handler!('SIGNED_IN', { user: user() });
    await a.flush();                       // ハッシュ確定前の送信は見送られる
    expect(inserted).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 20));   // ハッシュ確定 → 自動で送られる
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted.every((r) => (r as unknown as { user_hash: string | null }).user_hash)).toBe(true);
  });
});
