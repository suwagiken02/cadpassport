/* eslint-disable no-console */
// ============================================================
// 行動ログの集計（フェーズ0-D）
//
//   npm run analyze              直近 30 日
//   npm run analyze -- --days 7  直近 7 日
//
// 必要な環境変数（.env.local を読むか、シェルで export する）:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   ← RLS を bypass して events を読むため。**共有しないこと**
//
// 出力は Markdown（標準出力）。そのまま docs/ に貼るか、AI への入力にする。
// 目的は「どこで詰まって、何が使われていないか」を数字で出すこと。
// ============================================================
import { createClient } from '@supabase/supabase-js';

/** ファネルの定義（この順に到達しているかを見る）。 */
const FUNNEL: { key: string; label: string; match: (e: EventRow) => boolean }[] = [
  { key: 'auth', label: 'ログイン画面', match: (e) => e.screen === 'auth' },
  { key: 'signed_in', label: 'ログイン成功', match: (e) => e.event_name === 'sign_in' && e.ok === true },
  { key: 'projects', label: 'プロジェクト一覧', match: (e) => e.screen === 'projects' },
  { key: 'editor', label: '作図画面', match: (e) => e.screen === 'editor' },
  { key: 'auto_layout', label: '自動配置を実行', match: (e) => e.event_name === 'auto_layout_apply' },
  { key: 'save', label: '図面を保存', match: (e) => e.event_name === 'drawing_save' && e.ok === true },
  { key: 'export', label: '出力まで到達', match: (e) => e.event_name === 'export_done' && e.ok === true },
];

/**
 * 「あるはずの機能」の一覧。ログに 1 件も出てこなければ
 * 「使われていない＝廃止候補」の根拠になる（0 件を明示するために必要）。
 */
const KNOWN_FEATURES = [
  'auto_layout_open', 'auto_layout_apply', 'elevation_open', 'export_open', 'export_done',
  'drawing_save', 'project_create', 'sign_in', 'sign_up', 'sign_out', 'manual_edit',
];

/** 滞在時間がこれを超えたら「詰まっているかも」として挙げる(ms)。 */
const LONG_STAY_MS = 5 * 60 * 1000;

type EventRow = {
  occurred_at: string;
  user_hash: string | null;
  session_id: string;
  event_name: string;
  screen: string | null;
  count: number;
  duration_ms: number | null;
  ok: boolean | null;
  props: Record<string, unknown> | null;
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function pct(n: number, d: number): string {
  return d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`;
}

/** 数値の分布（中央値・最大）。件数が少なくても嘘をつかないよう素直に出す。 */
function summary(values: number[]): string {
  if (values.length === 0) return '該当なし';
  const s = [...values].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const avg = s.reduce((t, v) => t + v, 0) / s.length;
  return `件数 ${s.length} / 中央値 ${med} / 平均 ${avg.toFixed(1)} / 最大 ${s[s.length - 1]}`;
}

async function main(): Promise<void> {
  const days = Number(arg('days', '30'));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。');
    process.exit(1);
  }
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const rows: EventRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('events').select('*')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('events の取得に失敗:', error.message); process.exit(1); }
    rows.push(...(data as EventRow[]));
    if (!data || data.length < PAGE) break;
  }

  const out: string[] = [];
  const p = (s = '') => out.push(s);

  p(`# 行動ログ集計（直近 ${days} 日 / ${since.slice(0, 10)} 〜）`);
  p();
  if (rows.length === 0) {
    p('この期間のログはありません。（本番でのみ送信されます）');
    console.log(out.join('\n'));
    return;
  }

  // ---- 規模 ----
  const users = new Set(rows.map((r) => r.user_hash).filter(Boolean));
  const sessions = new Set(rows.map((r) => r.session_id));
  const total = rows.reduce((t, r) => t + (r.count ?? 1), 0);
  p('## 規模');
  p();
  p(`- アクティブユーザー数（匿名ハッシュ）: **${users.size}**`);
  p(`- セッション数: **${sessions.size}**`);
  p(`- イベント総数: ${total}（行数 ${rows.length}）`);
  p();

  // ---- ファネル ----
  p('## ファネル（セッション単位の到達率）');
  p();
  p('| 段階 | 到達セッション | 到達率(全体) | 前段からの離脱 |');
  p('|---|---:|---:|---:|');
  const reached = FUNNEL.map((f) => new Set(rows.filter(f.match).map((r) => r.session_id)));
  const base = reached[0].size || sessions.size;
  FUNNEL.forEach((f, i) => {
    const n = reached[i].size;
    const prev = i === 0 ? base : reached[i - 1].size;
    const drop = i === 0 ? 0 : prev - n;
    p(`| ${f.label} | ${n} | ${pct(n, base)} | ${i === 0 ? '-' : `${drop}（${pct(drop, prev)}）`} |`);
  });
  p();

  // ---- 機能別の利用回数 ----
  p('## 機能別の利用回数');
  p();
  const byName = new Map<string, number>();
  for (const r of rows) byName.set(r.event_name, (byName.get(r.event_name) ?? 0) + (r.count ?? 1));
  const ranked = Array.from(byName.entries())
    .filter(([k]) => k !== 'screen_view' && k !== 'screen_leave')
    .sort((a, b) => b[1] - a[1]);
  p('| イベント | 回数 |');
  p('|---|---:|');
  for (const [k, v] of ranked) p(`| ${k} | ${v} |`);
  p();
  const unused = KNOWN_FEATURES.filter((k) => !byName.has(k));
  p(`**この期間に 1 度も使われていない機能: ${unused.length === 0 ? 'なし' : unused.join(', ')}**`);
  p('（0 件が続く機能は廃止候補。ただし計測を仕込み忘れていないかを先に確認すること）');
  p();

  // ---- 手戻り ----
  p('## 手戻り（自動配置のあとの手直し）');
  p();
  const applied = rows.filter((r) => r.event_name === 'auto_layout_apply');
  const edits = rows.filter((r) => r.event_name === 'manual_edit' && r.props?.edits_since_auto != null);
  const perSession = new Map<string, number>();
  for (const e of edits) {
    const v = Number(e.props?.edits_since_auto ?? 0);
    perSession.set(e.session_id, Math.max(perSession.get(e.session_id) ?? 0, v));
  }
  p(`- 自動配置の実行: ${applied.reduce((t, r) => t + (r.count ?? 1), 0)} 回`);
  p(`- 自動配置後の手直し回数（セッションごとの最大）: ${summary(Array.from(perSession.values()))}`);
  const within5m = edits.filter((e) => Number(e.props?.ms_since_auto ?? Infinity) <= 5 * 60 * 1000);
  p(`- うち 5 分以内の手直し: ${within5m.length} 件（直後の作り直し＝自動配置の精度不足の疑い）`);
  p();

  // ---- 詰まり ----
  p('## 詰まり');
  p();
  const fails = rows.filter((r) => r.ok === false);
  const failByName = new Map<string, number>();
  for (const r of fails) failByName.set(r.event_name, (failByName.get(r.event_name) ?? 0) + (r.count ?? 1));
  p('### 失敗した操作');
  p();
  if (failByName.size === 0) p('失敗の記録はありません。');
  else {
    p('| 操作 | 失敗回数 |');
    p('|---|---:|');
    for (const [k, v] of Array.from(failByName.entries()).sort((a, b) => b[1] - a[1])) p(`| ${k} | ${v} |`);
  }
  p();
  // 同じ操作を連続で失敗したセッション（＝手が止まっている）
  const consec = new Map<string, number>();
  const bySession = new Map<string, EventRow[]>();
  for (const r of rows) {
    const list = bySession.get(r.session_id) ?? [];
    list.push(r);
    bySession.set(r.session_id, list);
  }
  for (const list of Array.from(bySession.values())) {
    let run = 0, prevName = '';
    for (const r of list) {
      if (r.ok === false && r.event_name === prevName) run += 1;
      else { run = r.ok === false ? 1 : 0; prevName = r.event_name; }
      if (run >= 2) consec.set(r.event_name, (consec.get(r.event_name) ?? 0) + 1);
    }
  }
  p('### 同じ操作の連続失敗（2 回以上続いた回数）');
  p();
  if (consec.size === 0) p('連続失敗はありません。');
  else for (const [k, v] of Array.from(consec.entries()).sort((a, b) => b[1] - a[1])) p(`- ${k}: ${v}`);
  p();

  // ---- 滞在時間 ----
  p('## 滞在時間が長い画面');
  p();
  const stays = rows.filter((r) => r.event_name === 'screen_leave' && r.duration_ms != null);
  const byScreen = new Map<string, number[]>();
  for (const r of stays) {
    const k = r.screen ?? '(不明)';
    byScreen.set(k, [...(byScreen.get(k) ?? []), r.duration_ms as number]);
  }
  p('| 画面 | 滞在(ms) の分布 | 5 分超の回数 |');
  p('|---|---|---:|');
  for (const [k, v] of Array.from(byScreen.entries())) {
    p(`| ${k} | ${summary(v)} | ${v.filter((ms) => ms > LONG_STAY_MS).length} |`);
  }
  p();

  // ---- エラー ----
  p('## エラー発生箇所 トップ10');
  p();
  const errs = new Map<string, number>();
  for (const r of rows.filter((r2) => r2.event_name === 'error')) {
    const where = String(r.props?.where ?? '(不明)');
    errs.set(where, (errs.get(where) ?? 0) + (r.count ?? 1));
  }
  if (errs.size === 0) p('エラーの記録はありません。');
  else {
    p('| 発生箇所 | 件数 |');
    p('|---|---:|');
    for (const [k, v] of Array.from(errs.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)) p(`| ${k} | ${v} |`);
  }
  p();
  p('---');
  p('この集計は「事実」だけを出す。改善案は docs/proposals/ に、採否は docs/decisions.md に残すこと。');

  console.log(out.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
