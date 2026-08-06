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

/** 自動配置からの手戻りを測るための印（フェーズ0-B「手戻り」）。 */
let lastAutoLayoutAt = 0;
let editsSinceAutoLayout = 0;

const isBrowser = () => typeof window !== 'undefined';
/** 本番のみ送る。dev/test では組み立てるだけで送信しない。 */
const isEnabled = () => isBrowser() && process.env.NODE_ENV === 'production';

/** 1 回の利用（タブを開いてから閉じるまで）を表す id。 */
function getSessionId(): string {
  if (sessionId) return sessionId;
  if (!isBrowser()) return 'server';
  try {
    const KEY = 'ashiba-plan:analytics:sid';
    const saved = window.sessionStorage.getItem(KEY);
    if (saved) { sessionId = saved; return saved; }
    const id = (window.crypto?.randomUUID?.() ?? `s${Date.now()}${Math.random()}`).slice(0, 36);
    window.sessionStorage.setItem(KEY, id);
    sessionId = id;
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
 * ログイン中の利用者を計測に紐づける（ハッシュのみ）。
 * ログイン直後に 1 回呼ぶ。ログアウト時は null を渡す。
 */
export function identify(userId: string | null): void {
  if (!isBrowser()) return;   // Web Crypto はブラウザのみ
  try {
    if (!userId) { userHash = null; return; }
    void hashUserId(userId).then((h) => { userHash = h; });
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
      flush(true);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
  } catch (e) {
    console.warn('[analytics] bindLifecycle failed', e);
  }
}

/** キューへ積む（同じイベントが連続していたら count をまとめる）。 */
function pushEvent(
  eventName: string,
  props?: EventProps,
  opts?: { screen?: string | null; durationMs?: number; ok?: boolean },
): void {
  const safe = sanitize(props);
  const screen = opts?.screen ?? currentScreen;
  const last = queue[queue.length - 1];
  if (
    last && last.event_name === eventName && last.screen === screen
    && opts?.durationMs == null && opts?.ok == null && last.duration_ms == null
    && JSON.stringify(last.props) === JSON.stringify(safe)
  ) {
    last.count += 1;
    return;
  }
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
  if (queue.length >= FLUSH_AT) flush();
  else scheduleFlush();
}

function scheduleFlush(): void {
  if (timer || !isBrowser()) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_INTERVAL_MS);
}

/**
 * 溜まったイベントを送る。失敗しても握りつぶす（本体には一切影響させない）。
 * immediate=true はページ離脱時。keepalive で最後の 1 回を届ける。
 */
export function flush(immediate = false): void {
  if (queue.length === 0) return;
  if (!isEnabled()) { queue = []; return; }
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  const rows = batch.map((e) => ({ ...e, user_hash: userHash }));
  try {
    if (immediate && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      // 離脱時は fetch が中断されるので sendBeacon（Supabase の REST へ直接）。
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/events`;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
      const blob = new Blob([JSON.stringify(rows)], { type: 'application/json' });
      // sendBeacon はヘッダを付けられないので apikey をクエリに載せる。
      const ok = navigator.sendBeacon(`${url}?apikey=${encodeURIComponent(key)}`, blob);
      if (ok) return;
    }
    void supabase.from('events').insert(rows).then(({ error }) => {
      if (error) console.warn('[analytics] insert failed', error.message);
    });
  } catch (e) {
    console.warn('[analytics] flush failed', e);
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

/** テスト・デバッグ用（送信せずに中身を見る）。 */
export function __getQueueForTest(): QueuedEvent[] {
  return queue;
}
/** テスト用リセット。 */
export function __resetForTest(): void {
  queue = [];
  currentScreen = null;
  lastAutoLayoutAt = 0;
  editsSinceAutoLayout = 0;
}
