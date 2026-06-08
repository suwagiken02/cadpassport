-- =========================================================================
-- CAD パスポート: メートル/インチ規格の切替 (unit_system)
--
-- TOP 設定 (/settings) で選択した規格を会社単位 (handrail_settings と同じ
-- スコープ) で保存する。'metric' | 'inch'、既定 'metric'。
-- 規格切替は新規割付にだけ効き、保存済み図面の部材値は変更しない。
--
-- 0002 と同パターン: ADD COLUMN IF NOT EXISTS + 既存行 backfill。
-- DATABASE_SAFETY_RULES.md §3 推奨範囲: ADD COLUMN、デフォルトあり、
-- NOT NULL なし → 非破壊。
-- =========================================================================

ALTER TABLE handrail_settings
  ADD COLUMN IF NOT EXISTS unit_system text DEFAULT 'metric';

-- 既存レコードに 'metric' を backfill (NULL のものだけ更新)
UPDATE handrail_settings
SET unit_system = 'metric'
WHERE unit_system IS NULL;
