-- =========================================================================
-- 行動計測: events テーブル（フェーズ0-B）
--
-- 目的:
--   「どこで詰まって、何が使われていないか」を数字で見えるようにする。
--   AI が改善提案を出すための材料であり、機能追加・廃止の根拠になる。
--
-- 個人情報は入れない（絶対）:
--   - user_id は保存しない。SHA-256 の先頭 16 文字（user_hash）だけを持つ。
--     同一ユーザーの追跡はできるが、ここから本人には戻せない。
--   - 図面の実データ（座標・建物名・住所・プロジェクト名）は props に入れない。
--     クライアント側(lib/analytics.ts)で数値・真偽・短い列挙値だけに削ってから送る。
--   - props はサイズ上限を DB 側でも縛る（万一の混入時の被害を小さくする）。
--
-- 分析できること（この 1 テーブルで足りる設計）:
--   ・ファネル離脱 … screen + event_name の到達順（session_id ごとに並べる）
--   ・利用頻度     … event_name の件数（0 件＝使われていない機能の根拠）
--   ・手戻り       … manual_edit の edits_since_auto / ms_since_auto（自動配置の後の手直し）
--   ・詰まり       … 同じ event_name の連続失敗（ok=false）、screen_leave の duration_ms
--   ・エラー       … event_name='error' の where（発生箇所）と件数
--
-- 注意: 実行は Supabase ダッシュボードの SQL Editor で手動。
--       アプリ側は「テーブルが無ければ送信が失敗するだけ」で本体は動く（非ブロッキング）。
-- =========================================================================

create table if not exists events (
  id bigint generated always as identity primary key,
  -- 発生時刻（クライアントの時計。集計はこちらを使う）
  occurred_at timestamptz not null default now(),
  -- 受信時刻（サーバ時計。時計ズレの検出用）
  created_at timestamptz not null default now(),
  -- 匿名化した利用者（SHA-256 の先頭 16 文字。未ログインは null）
  user_hash text,
  -- 1 回の利用（タブを開いてから閉じるまで）。ファネルはこれで並べる
  session_id text not null,
  -- イベント名（例: editor_open / auto_layout_apply / manual_edit / error）
  event_name text not null,
  -- 画面名（例: auth / projects / editor / export）
  screen text,
  -- 同じイベントが連続したときの回数（クライアント側でまとめて送る）
  count integer not null default 1,
  -- 滞在時間・処理時間(ms)。screen_leave や重い処理の計測に使う
  duration_ms integer,
  -- 成否。false の連続＝詰まりの signal
  ok boolean,
  -- 付随情報（数値・真偽・短い列挙値のみ。個人情報・図面データは入れない）
  props jsonb not null default '{}'::jsonb,
  -- アプリのバージョン（リリース前後の比較用）
  app_version text,

  constraint events_event_name_len check (char_length(event_name) <= 64),
  constraint events_screen_len check (screen is null or char_length(screen) <= 64),
  constraint events_props_size check (pg_column_size(props) <= 2048),
  constraint events_count_positive check (count > 0)
);

-- 集計で使う軸にだけ索引を張る（書き込みが主なので最小限）
create index if not exists events_occurred_at_idx on events (occurred_at desc);
create index if not exists events_name_time_idx on events (event_name, occurred_at desc);
create index if not exists events_session_idx on events (session_id, occurred_at);
create index if not exists events_user_time_idx on events (user_hash, occurred_at desc);

-- =========================================================================
-- 管理者フラグ（集計を見てよい人）。既存 profiles に足すだけ。
-- =========================================================================
alter table profiles add column if not exists is_admin boolean not null default false;

-- =========================================================================
-- RLS: 「入れるだけ、読めない」
--   ・insert … ログイン済み/未ログインどちらも可（ログイン画面の離脱も測るため）。
--              ただし読み出しは一切できないので、他人のログを覗くことはできない。
--   ・select … 管理者(profiles.is_admin)のみ。集計スクリプトは service_role で
--              RLS を bypass するので、通常運用ではこのポリシーに触れない。
--   ・update/delete … 誰にも許可しない（ポリシーを作らない＝拒否）。
-- =========================================================================
alter table events enable row level security;

drop policy if exists "Anyone can insert events" on events;
create policy "Anyone can insert events"
  on events for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can read events" on events;
create policy "Admins can read events"
  on events for select
  to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- =========================================================================
-- 保持期間: 生ログは 180 日で捨てる（分析に必要な粒度は集計後に残す運用）。
--   pg_cron が有効なら下を有効化。無効なら手動 or 別バッチで実行する。
-- =========================================================================
-- select cron.schedule('purge-events', '0 4 * * *',
--   $$ delete from events where occurred_at < now() - interval '180 days' $$);
