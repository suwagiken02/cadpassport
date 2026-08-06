// ============================================================
// 行動計測 (フェーズ0-A〜C)
//
// 使い方はこれだけ:
//   import { track } from '@/lib/analytics';
//   track('auto_layout_apply', { edges: 8, floors: 2 });
//
// 約束事（守れないなら計測しない方がマシ、という優先順位）:
//   1. 本体を止めない。送信は完全に非同期・失敗は握りつぶす（console.warn だけ）。
//      計測の例外が業務を止めることは絶対に無い（全部 try/catch で包む）。
//   2. 個人情報を残さない。user_id は SHA-256 の先頭 16 文字だけ。
//      図面の実データ（座標・建物名・住所・プロジェクト名）は送らない。
//      props は「数値・真偽・短い列挙値」だけに削ってから送る（sanitize）。
//   3. DB を叩きすぎない。数秒ごとにまとめて 1 回 insert（バッチ）。
//      同じイベントが連続したら count でまとめる。
//   4. 開発環境では送らない（本番のみ）。ローカルの操作でデータが汚れない。
// ============================================================
import { supabase } from '@/lib/supabase/client';

/** まとめて送るまでの待ち時間(ms)。 */
const FLUSH_INTERVAL_MS = 5000;
/** これだけ溜まったら待たずに送る。 */
const FLUSH_AT = 20;
/** 1 回の送信で送る最大件数（これを超えたら次回へ回す）。 */
const MAX_BATCH = 50;
/** props の文字列値の最大長。長い文字列＝自由入力＝個人情報の可能性、として捨てる。 */
const MAX_STR = 48;
/** props のキー数の上限。 */
const MAX_KEYS = 12;
/**
 * 1 セッションで送る最大件数（レート制限）。これを超えたら以降は捨てる。
 * DB 側でトリガを使って殴ると本体の書き込みが重くなるので、送る側で止める。
 */
const MAX_EVENTS_PER_SESSION = 1000;
/** ログイン確定待ちで溜めておける最大件数（メモリの上限）。 */
const MAX_QUEUE = 200;

/**
 * props に入れてはいけないキー（自由入力・実データの温床）。
 * 迷ったら入れない方針。ここに無くても長い文字列は sanitize で落ちる。
 */
const DENY_KEYS = new Set([
  'name', 'title', 'address', 'email', 'phone', 'tel', 'company', 'companyname',
  'contractor', 'client', 'owner', 'user', 'userid', 'user_id', 'password',
  'note', 'memo', 'text', 'comment', 'url', 'points', 'x', 'y', 'coords',
  'canvasdata', 'canvas_data', 'projectname', 'project_name', 'drawingtitle',
]);

export type EventProps = Record<string, unknown>;

type QueuedEvent = {
  occurred_at: string;
  session_id: string;
  event_name: string;
  screen: string | null;
  count: number;
  duration_ms: number | null;
  ok: boolean | null;
  props: Record<string, string | number | boolean>;
  app_version: string | null;
};

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionId: string | null = null;
let userHash: string | null = null;
let currentScreen: string | null = null;
let screenEnteredAt = 0;
let listenersBound = false;
/** sessionStorage からの復帰を 1 回だけ行うための印。 */
let queueRestored = false;
/** 認証イベントの購読を 1 回だけ始めるための印。 */
let authWatchStarted = false;
/** このセッションで送った件数（レート制限用）。 */
let sentThisSession = 0;
/** ログイン済みか（events の insert は authenticated のみ許可）。 */
let signedIn = false;

/** 自動配置からの手戻りを測るための印（フェーズ0-B「手戻り」）。 */
let lastAutoLayoutAt = 0;
let editsSinceAutoLayout = 0;

/** authStore の未ログイン時のプレースホルダ id。これはハッシュしない（別人として数えてしまう）。 */
const ANON_ID = 'anonymous';

const isBrowser = () => typeof window !== 'undefined';
/** 本番のみ送る。dev/test では組み立てるだけで送信しない。 */
const isEnabled = () => isBrowser() && process.env.NODE_ENV === 'production';

/**
 * 1 回の利用（タブを開いてから閉じるまで）を表す id。
 *
 * OAuth（Google ログイン）は外部サイトへ飛んで戻ってくるので、その間に
 * sessionStorage が失われる端末がある。失われると 1 回の作業が 2 セッションに
 * 割れ、ファネルの到達率が嘘になる（実測で「一覧 2 / 作図 1 = 50%」になった）。
 * そこで localStorage に「最後に使った session_id と時刻」も置き、
 * 30 分以内なら同じセッションの続きとして扱う。
 *   ・localStorage に置くのは **id と時刻だけ**（イベントの中身は置かない）。
 *   ・30 分空いたら別のセッション（一般的なセッションの区切り方に合わせる）。
 */
const SID_KEY = 'ashiba-plan:analytics:sid';
const SID_FALLBACK_KEY = 'ashiba-plan:analytics:sid-last';
/** これだけ間が空いたら別セッションとみなす(ms)。 */
const SESSION_GAP_MS = 30 * 60 * 1000;

function newSessionId(): string {
  try {
    return window.crypto?.randomUUID?.() ?? `s${Date.now()}${Math.random()}`;
  } catch {
    return `s${Date.now()}`;
  }
}

/** 使うたびに「最後に使った時刻」を更新する（次の復帰の判断材料）。 */
function touchSession(id: string): void {
  try {
    window.localStorage.setItem(SID_FALLBACK_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    /* 使えない環境では諦める（sessionStorage だけで動く） */
  }
}

function getSessionId(): string {
  if (sessionId) { touchSession(sessionId); return sessionId; }
  if (!isBrowser()) return 'server';
  try {
    const saved = window.sessionStorage.getItem(SID_KEY);
    if (saved) { sessionId = saved; touchSession(saved); return saved; }
    // sessionStorage が消えている（OAuth のリダイレクト等）。直前の続きなら引き継ぐ。
    try {
      const raw = window.localStorage.getItem(SID_FALLBACK_KEY);
      if (raw) {
        const { id, at } = JSON.parse(raw) as { id: string; at: number };
        if (id && typeof at === 'number' && Date.now() - at < SESSION_GAP_MS) {
          sessionId = id;
          window.sessionStorage.setItem(SID_KEY, id);
          touchSession(id);
          return id;
        }
      }
    } catch {
      /* 壊れていたら新規に切る */
    }
    const id = newSessionId();
    window.sessionStorage.setItem(SID_KEY, id);
    sessionId = id;
    touchSession(id);
    return id;
  } catch {
    sessionId = `s${Date.now()}`;
    return sessionId;
  }
}

/** user_id → SHA-256 先頭 16 文字。ここから本人には戻せない（個人情報を持たないため）。 */
async function hashUserId(userId: string): Promise<string | null> {
  try {
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * ログイン中の利用者を計測に紐づける（ハッシュのみ）(= 匿名ハッシュの重複修正)。
 *
 * 実測で「セッション 1 なのに利用者 2」が出た。原因は、まだセッションが確定して
 * いない瞬間に、ストアの初期値である 'anonymous' を掴んで別のハッシュを作って
 * いたこと。**ハッシュの元は Supabase のセッションの user.id ただ 1 つ**にする。
 */
export function identify(userId: string | null): void {
  if (!isBrowser()) return;   // Web Crypto はブラウザのみ
  try {
    if (!userId || userId === ANON_ID) {
      // 未ログイン。ハッシュは消すが、既に積んだイベントは捨てない（再ログインで送る）。
      userHash = null;
      signedIn = false;
      return;
    }
    signedIn = true;
    void hashUserId(userId).then((h) => {
      // 同じ人は毎回同じ値。ログイン前後で値が変わらない。
      userHash = h;
      flush();
    });
  } catch (e) {
    console.warn('[analytics] identify failed', e);
  }
}

/**
 * props を「安全な形」に削る。
 *   ・数値/真偽 … そのまま
 *   ・文字列   … 48 文字までの短い値のみ（それ以上は自由入力とみなして捨てる）
 *   ・その他   … 捨てる（オブジェクト・配列＝図面データの可能性）
 *   ・禁止キー … 捨てる
 */
function sanitize(props?: EventProps): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  let keys = 0;
  for (const [k, v] of Object.entries(props)) {
    if (keys >= MAX_KEYS) break;
    const key = k.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!key || DENY_KEYS.has(key)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) { out[key] = v; keys++; continue; }
    if (typeof v === 'boolean') { out[key] = v; keys++; continue; }
    if (typeof v === 'string' && v.length > 0 && v.length <= MAX_STR) { out[key] = v; keys++; }
  }
  return out;
}

/** ページを離れるときの取りこぼしを防ぐ（1 回だけ登録）。 */
function bindLifecycle(): void {
  if (listenersBound || !isBrowser()) return;
  listenersBound = true;
  try {
    const onHide = () => {
      if (currentScreen) {
        // 画面ごとの滞在時間（詰まりの指標）。離脱時に必ず 1 本残す。
        pushEvent('screen_leave', { }, {
          screen: currentScreen, durationMs: Date.now() - screenEnteredAt,
        });
      }
      void flush();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
  } catch (e) {
    console.warn('[analytics] bindLifecycle failed', e);
  }
}

/**
 * キューの保存先（sessionStorage）(= 計測の欠落修正)。
 *
 * なぜ sessionStorage か:
 *   ・ページ遷移や再読み込みでモジュールの変数は消える。実測で、ログイン画面の
 *     イベント（screen_view/sign_in/sign_out）が /projects へ移る所で丸ごと失われていた。
 *   ・sessionStorage は**そのタブの中だけ**で生き、タブを閉じれば消える。
 *     session_id の寿命と一致するので、余計に長生きしない。
 *   ・localStorage だと別タブ・翌日の起動にまで古いイベントが残り、
 *     「いつのものか分からないログ」が混ざる。Cookie は送信量が増えるだけで利点が無い。
 */
const QUEUE_KEY = 'ashiba-plan:analytics:queue';

/** キューを保存する（失敗しても無視。計測のために本体を止めない）。 */
function persistQueue(): void {
  if (!isBrowser()) return;
  try {
    if (queue.length === 0) window.sessionStorage.removeItem(QUEUE_KEY);
    else window.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* 容量超過などは無視 */
  }
}

/** 前のページで積んだキューを引き継ぐ（1 回だけ）。 */
function restoreQueue(): void {
  if (queueRestored || !isBrowser()) return;
  queueRestored = true;
  try {
    const raw = window.sessionStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as QueuedEvent[];
    if (Array.isArray(saved) && saved.length > 0) queue = [...saved, ...queue];
  } catch {
    /* 壊れていたら捨てる */
  }
}

/** キューへ積む（同じイベントが連続していたら count をまとめる）。 */
function pushEvent(
  eventName: string,
  props?: EventProps,
  opts?: { screen?: string | null; durationMs?: number; ok?: boolean },
): void {
  restoreQueue();   // 前のページのぶんを引き継いでから積む
  const safe = sanitize(props);
  const screen = opts?.screen ?? currentScreen;
  const last = queue[queue.length - 1];
  if (
    last && last.event_name === eventName && last.screen === screen
    && opts?.durationMs == null && opts?.ok == null && last.duration_ms == null
    && JSON.stringify(last.props) === JSON.stringify(safe)
  ) {
    last.count += 1;
    persistQueue();
    return;
  }
  // レート制限: 1 セッションの上限を超えたら以降は積まない（本体には影響しない）。
  if (sentThisSession + queue.length >= MAX_EVENTS_PER_SESSION) return;
  queue.push({
    occurred_at: new Date().toISOString(),
    session_id: getSessionId(),
    event_name: eventName.slice(0, 64),
    screen: screen ? screen.slice(0, 64) : null,
    count: 1,
    duration_ms: opts?.durationMs != null ? Math.round(opts.durationMs) : null,
    ok: opts?.ok ?? null,
    props: safe,
    app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
  });
  persistQueue();
  if (queue.length >= FLUSH_AT) flush();
  else scheduleFlush();
}

function scheduleFlush(): void {
  if (timer || !isBrowser()) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_INTERVAL_MS);
}

/**
 * 溜まったイベントを送る。失敗しても本体には一切影響させない。
 *
 * 送信に失敗したぶんは**キューへ戻して保存する**（次の機会に送り直す）。
 * 以前は送る前にキューから外していたため、失敗＝そのまま消失だった。
 * ログアウト時の sign_out が 1 件も残らなかったのはこれが原因。
 *
 * sendBeacon は使わない。ヘッダを付けられず、ログイン中の資格情報
 * （Authorization: Bearer）を載せられないため、RLS(authenticated のみ)に
 * 弾かれて黙って消える。代わりに「保存して次のページで送り直す」で担保する。
 */
export function flush(): Promise<void> {
  restoreQueue();
  if (queue.length === 0) return Promise.resolve();
  if (!isEnabled()) { queue = []; persistQueue(); return Promise.resolve(); }
  // events の insert はログイン済みのみ許可（0010 の RLS）。ログインが確定するまでは
  //   溜めて待つ（直後に identify が呼ばれる）。溜まりすぎたら古いものから捨てる。
  if (!signedIn) {
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    persistQueue();
    return Promise.resolve();
  }
  if (sentThisSession >= MAX_EVENTS_PER_SESSION) { queue = []; persistQueue(); return Promise.resolve(); }
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  persistQueue();
  const rows = batch.map((e) => ({ ...e, user_hash: userHash }));
  try {
    return Promise.resolve(supabase.from('events').insert(rows))
      .then(({ error }) => {
        if (!error) { sentThisSession += rows.length; return; }
        console.warn('[analytics] insert failed', error.message);
        // 失敗したぶんは戻す（次のページ・次の flush で送り直す）。
        queue = [...batch, ...queue].slice(-MAX_QUEUE);
        persistQueue();
      })
      .catch((e) => {
        console.warn('[analytics] insert threw', e);
        queue = [...batch, ...queue].slice(-MAX_QUEUE);
        persistQueue();
      });
  } catch (e) {
    console.warn('[analytics] flush failed', e);
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
    persistQueue();
    return Promise.resolve();
  }
}

/**
 * イベントを 1 本記録する（これだけ使えばよい）。
 *
 * @param eventName スネークケースの短い名前（例: 'export_done'）
 * @param properties 数値・真偽・短い列挙値のみ。実データは書かない
 */
export function track(eventName: string, properties?: EventProps): void {
  try {
    bindLifecycle();
    // 自動配置の後の手直しを数える（手戻りの指標）。
    if (eventName === 'auto_layout_apply') {
      lastAutoLayoutAt = Date.now();
      editsSinceAutoLayout = 0;
    }
    if (eventName === 'manual_edit' && lastAutoLayoutAt > 0) {
      editsSinceAutoLayout += 1;
      pushEvent(eventName, {
        ...properties,
        edits_since_auto: editsSinceAutoLayout,
        ms_since_auto: Date.now() - lastAutoLayoutAt,
      });
      return;
    }
    pushEvent(eventName, properties);
  } catch (e) {
    console.warn('[analytics] track failed', e);
  }
}

/**
 * 画面の切り替わりを記録する。前の画面の滞在時間（screen_leave.duration_ms）も残す。
 * 「異常に長い滞在＝詰まり」を見るための土台。
 */
export function trackScreen(screen: string): void {
  try {
    bindLifecycle();
    if (currentScreen === screen) return;
    if (currentScreen) {
      pushEvent('screen_leave', {}, {
        screen: currentScreen, durationMs: Date.now() - screenEnteredAt,
      });
    }
    currentScreen = screen;
    screenEnteredAt = Date.now();
    pushEvent('screen_view', {}, { screen });
  } catch (e) {
    console.warn('[analytics] trackScreen failed', e);
  }
}

/**
 * 失敗を記録する。where は「発生箇所」の短い識別子（例: 'drawing_save'）。
 * message は型・分類のみ（例外の生文字列は個人情報を含み得るので入れない）。
 */
export function trackError(where: string, kind?: string): void {
  track('error', { where, kind: kind?.slice(0, MAX_STR) });
}

/**
 * 成否つきの操作を記録する。ok=false の連続＝詰まり。
 */
export function trackResult(eventName: string, ok: boolean, properties?: EventProps): void {
  try {
    bindLifecycle();
    pushEvent(eventName, properties, { ok });
  } catch (e) {
    console.warn('[analytics] trackResult failed', e);
  }
}

/** 処理時間つきの記録（重い処理の体感を測る）。 */
export function trackDuration(eventName: string, ms: number, properties?: EventProps): void {
  try {
    bindLifecycle();
    pushEvent(eventName, properties, { durationMs: ms });
  } catch (e) {
    console.warn('[analytics] trackDuration failed', e);
  }
}

// ============================================================
// ログインの検知は「1 箇所」に集約する (= OAuth 対応)
//
// Google ログインは外部サイトへ飛んでから戻るので、authStore.signIn を通らない。
// 方式ごとに track を書くと必ず取りこぼす（実測で sign_in が 0 件だった）。
// Supabase の onAuthStateChange なら、Google / メール / ID のどれでも
// 「セッションが確立した瞬間」を 1 箇所で拾える。
// ============================================================

/** 同じセッションで sign_in を二重に記録しないための印。 */
const SIGNED_IN_KEY = 'ashiba-plan:analytics:signed-in';
/** 新規登録とみなす、アカウント作成からの猶予(ms)。 */
const NEW_USER_WINDOW_MS = 5 * 60 * 1000;

/** 認証方式を判別する（個人情報は取り出さない）。 */
function authMethodOf(user: {
  app_metadata?: { provider?: string };
  email?: string | null;
}): string {
  const provider = user.app_metadata?.provider;
  if (provider && provider !== 'email') return provider;              // google 等
  if (user.email?.endsWith('@cadpassport.local')) return 'id';        // ID ログイン
  return 'email';
}

/**
 * 認証イベントの購読を始める（アプリ起動時に 1 回）。
 * ここだけが sign_in / sign_out の記録場所。
 */
export function startAuthTracking(): void {
  if (!isBrowser() || authWatchStarted) return;
  authWatchStarted = true;
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      try {
        const user = session?.user;
        if (event === 'SIGNED_OUT') {
          track('sign_out');
          void flush().then(() => identify(null));
          try { window.sessionStorage.removeItem(SIGNED_IN_KEY); } catch { /* noop */ }
          return;
        }
        if (!user) return;
        identify(user.id);
        // SIGNED_IN はタブ復帰やトークン更新でも飛ぶので、セッション内で 1 回だけ記録する。
        let already = false;
        try { already = window.sessionStorage.getItem(SIGNED_IN_KEY) === user.id; } catch { /* noop */ }
        if (already) return;
        try { window.sessionStorage.setItem(SIGNED_IN_KEY, user.id); } catch { /* noop */ }
        if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
        // 作ったばかりのアカウントなら新規登録。既存ならログイン。
        const createdAt = user.created_at ? Date.parse(user.created_at) : NaN;
        const isNew = Number.isFinite(createdAt) && Date.now() - createdAt < NEW_USER_WINDOW_MS;
        const method = authMethodOf(user);
        trackResult(isNew ? 'sign_up' : 'sign_in', true, {
          method,
          // 起動時の復帰（INITIAL_SESSION）か、その場でのログインか
          resumed: event === 'INITIAL_SESSION',
        });
        void flush();
      } catch (e) {
        console.warn('[analytics] auth event failed', e);
      }
    });
  } catch (e) {
    console.warn('[analytics] startAuthTracking failed', e);
  }
}

/** テスト・デバッグ用（送信せずに中身を見る）。 */
export function __getQueueForTest(): QueuedEvent[] {
  return queue;
}
/** テスト用: 紐づけの状態を見る（同一人物が同一ハッシュかの検証）。 */
export function __getIdentityForTest(): { signedIn: boolean; userHash: string | null } {
  return { signedIn, userHash };
}
/** テスト用: 送信できる状態（ログイン済み）にする。 */
export function __setSignedInForTest(v: boolean): void {
  signedIn = v;
}
/** テスト用リセット。 */
export function __resetForTest(): void {
  queue = [];
  currentScreen = null;
  lastAutoLayoutAt = 0;
  editsSinceAutoLayout = 0;
  sentThisSession = 0;
  signedIn = false;
  userHash = null;
  queueRestored = false;
  try { if (isBrowser()) window.sessionStorage.removeItem(QUEUE_KEY); } catch { /* noop */ }
}
