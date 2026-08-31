-- ============================================================
-- 0011: underlays バケット（下図の画像）のアクセス権 (= U-1)
--
-- パス: underlays/{projectId}/{drawingId}/{underlayId}.jpg
-- 触れるのは「その物件の持ち主」だけ。判定は projects.owner_id へ問い合わせる
-- （既存の drawings のポリシーと同じ作法）。
--
-- 先頭をユーザー ID ではなく物件 ID にしてあるのが要点。持ち主が変わっても
-- 会社共有を入れても、ポリシーが自動的に追従する。
--
-- ■ 事前にダッシュボードで行うこと（SQL では作れない）
--   Storage → New bucket
--     Name: underlays
--     Public bucket: オフ（← 必須。オンにすると URL を知れば誰でも見られる）
--     Restrict file size: 10 MB
--     Allowed MIME types: image/jpeg, image/png
--
-- ■ 実行方法
--   Supabase ダッシュボード → SQL Editor → New query → 貼り付け → Run
--   「Success. No rows returned」が出れば成功（許可証を作るだけなので行は返らない）。
--
-- ■ 物件を削除するときの順序（重要）
--   このポリシーは「projects に自分の物件として存在すること」を条件にしている。
--   projects の行を先に消すと、その物件の画像は**誰も消せなくなり永久に残る**。
--   必ず ① Storage の画像を消す → ② drawings と projects の行を消す の順で行うこと。
--
-- ■ 共有リンクで見る人について
--   共有で見る人は物件の持ち主ではないため、下図の画像は読めない（意図した挙動）。
--   画像だけが出ず、グリッドと足場は正常に見える。
-- ============================================================

-- 作り直せるように、同名のものがあれば先に落とす
drop policy if exists "Users can view own underlays" on storage.objects;
drop policy if exists "Users can insert own underlays" on storage.objects;
drop policy if exists "Users can update own underlays" on storage.objects;
drop policy if exists "Users can delete own underlays" on storage.objects;

-- 読む（表示・ダウンロード）
create policy "Users can view own underlays"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'underlays'
    and (storage.foldername(name))[1] in (
      select id::text from projects where owner_id = auth.uid()
    )
  );

-- 入れる（アップロード）
create policy "Users can insert own underlays"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'underlays'
    and (storage.foldername(name))[1] in (
      select id::text from projects where owner_id = auth.uid()
    )
  );

-- 上書き（同じパスへの入れ直し）
create policy "Users can update own underlays"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'underlays'
    and (storage.foldername(name))[1] in (
      select id::text from projects where owner_id = auth.uid()
    )
  );

-- 消す（差し替えの古い実体・物件やページの削除）
create policy "Users can delete own underlays"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'underlays'
    and (storage.foldername(name))[1] in (
      select id::text from projects where owner_id = auth.uid()
    )
  );

-- 確認: 4 つ並んでいれば成功
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
