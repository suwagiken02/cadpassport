-- ============================================================
-- 0012: 下図の孤児画像の点検と回収 (= U-1 commit 5)
--
-- 通常の経路では孤児は出ない:
--   ・物件を削除 … ① Storage を消す → ② 行を消す の順で行う
--   ・ページを削除 … 同じくそのページぶんを先に消す
--   ・画像を差し替え … 新しいものを上げたあとに古い実体を消す
-- ただし通信の失敗などで ① が落ちても ② は進めるようにしてある
-- （画像が消せないからといって物件を消せない方が困るため）。
-- そのとき取り残された画像を、あとから機械的に見つけて消すのがこの SQL。
--
-- パスは underlays/{projectId}/{drawingId}/{underlayId}.jpg なので、
-- 1 段目の projectId が projects に無ければ孤児と判定できる。
--
-- 実行方法: Supabase ダッシュボード → SQL Editor → 貼り付け → Run
-- ※ サービス側（service_role）で実行すること。RLS を通すと孤児は見えない。
-- ============================================================

-- ① 点検: 孤児が何件あるか見る（消す前に必ずこちらで確認する）
select
  (storage.foldername(name))[1] as project_id,
  count(*)                      as files,
  pg_size_pretty(sum(coalesce((metadata->>'size')::bigint, 0))) as size
from storage.objects
where bucket_id = 'underlays'
  and (storage.foldername(name))[1] not in (select id::text from projects)
group by 1
order by 2 desc;

-- ② 一覧: 実際のファイルを見る
-- select name, created_at, (metadata->>'size')::bigint as bytes
-- from storage.objects
-- where bucket_id = 'underlays'
--   and (storage.foldername(name))[1] not in (select id::text from projects)
-- order by created_at;

-- ③ 回収: ①で件数を確かめてから実行する（元に戻せない）
-- delete from storage.objects
-- where bucket_id = 'underlays'
--   and (storage.foldername(name))[1] not in (select id::text from projects);

-- 補足: ページ（drawings）が消えたぶんの孤児も同じ考え方で見つけられる。
--   2 段目の drawingId が drawings に無いもの。物件が生きているあいだは
--   ①では引っかからないので、必要になったらこちらを使う。
-- select name from storage.objects
-- where bucket_id = 'underlays'
--   and (storage.foldername(name))[2] not in (select id::text from drawings);
