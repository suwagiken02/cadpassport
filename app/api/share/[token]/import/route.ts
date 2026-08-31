import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/share/[token]/import
 * 共有 URL からプロジェクトを取り込み (= 受信者用)。
 *
 * フロー (= 9 ステップ):
 *   1. token 形式確認
 *   2. 認証チェック
 *   3. shared_links 検索 + 期限確認
 *   4. 元 projects 取得
 *   5. 受信者の current company_id 取得 (= profiles.company_id)
 *   6. 新 projects INSERT (= 受信者 owner_id、 受信者 company_id、 元データコピー)
 *   7. 元 drawings 全件取得
 *   8. 各 drawing を新 project_id で INSERT (= canvas_data + title コピー)
 *      - 失敗時は新 projects 削除 (= cascade で drawings も削除) でロールバック
 *   9. { newProjectId, drawingsCount } 返却
 *
 * セキュリティ:
 *   - 認証必須
 *   - 期限切れは 410 Gone
 *   - 元データ無変更 (= 取り込みはコピー作成のみ)
 *   - 部分失敗ロールバック (= 新 projects 削除で cascade 削除)
 */
/**
 * 下図の参照を落とす (= U-1)。画像は元の持ち主の Storage にあるので、
 * 取り込んだ人は読めない。参照を残すと「読めない下図」になるだけなので消す。
 */
function stripUnderlay(canvasData: unknown): unknown {
  if (!canvasData || typeof canvasData !== 'object') return canvasData;
  const cv = canvasData as Record<string, unknown>;
  if (!('underlay' in cv)) return canvasData;
  const next = { ...cv };
  delete next.underlay;
  return next;
}

export async function POST(_request: Request, { params }: { params: { token: string } }) {
  // Step 1: token 形式確認
  const token = params.token;
  if (!token || !UUID_REGEX.test(token)) {
    return NextResponse.json({ error: '共有 URL が無効です' }, { status: 404 });
  }

  // Step 2: 認証チェック
  const cookieStore = cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }
  const userId = session.user.id;

  // Step 3: shared_links 検索 + 期限確認
  const { data: shareData, error: shareError } = await supabaseAdmin
    .from('shared_links')
    .select('project_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (shareError) {
    return NextResponse.json({ error: '取り込みに失敗しました' }, { status: 500 });
  }
  if (!shareData) {
    return NextResponse.json({ error: '共有 URL が無効です' }, { status: 404 });
  }
  if (new Date(shareData.expires_at) < new Date()) {
    return NextResponse.json({ error: '共有 URL の有効期限が切れています' }, { status: 410 });
  }

  // Step 4: 元 projects 取得
  const { data: srcProject, error: srcError } = await supabaseAdmin
    .from('projects')
    .select('name, address')
    .eq('id', shareData.project_id)
    .maybeSingle();

  if (srcError || !srcProject) {
    return NextResponse.json({ error: '共有元のプロジェクトが見つかりません' }, { status: 410 });
  }

  // Step 5: 受信者の current company_id 取得
  const { data: receiverProfile } = await supabaseAdmin
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  const receiverCompanyId = receiverProfile?.company_id ?? null;

  // Step 6: 新 projects INSERT (= 受信者 owner_id + company_id)
  const { data: newProject, error: insertProjectError } = await supabaseAdmin
    .from('projects')
    .insert({
      owner_id: userId,
      company_id: receiverCompanyId,
      name: srcProject.name,
      address: srcProject.address,
    })
    .select('id')
    .single();

  if (insertProjectError || !newProject) {
    return NextResponse.json({ error: '取り込みに失敗しました' }, { status: 500 });
  }
  const newProjectId = newProject.id;

  // Step 7: 元 drawings 全件取得
  const { data: srcDrawings, error: drawingsFetchError } = await supabaseAdmin
    .from('drawings')
    .select('title, canvas_data')
    .eq('project_id', shareData.project_id);

  if (drawingsFetchError) {
    // ロールバック: 新 projects 削除
    await supabaseAdmin.from('projects').delete().eq('id', newProjectId);
    return NextResponse.json({ error: '取り込みに失敗しました' }, { status: 500 });
  }

  // Step 8: 各 drawing を新 project_id で INSERT
  let drawingsCount = 0;
  if (srcDrawings && srcDrawings.length > 0) {
    const newDrawings = srcDrawings.map(d => ({
      project_id: newProjectId,
      title: d.title,
      // U-1: 下図（背景の平面図）は引き継がない。画像は元の持ち主の Storage に
      //   あり、取り込んだ人には読む権限が無い。参照だけ残すと「読めない下図」に
      //   なるので、ここで落としておく（合わせ込みの情報も一緒に消える）。
      canvas_data: stripUnderlay(d.canvas_data),
      // thumbnail_url は NULL (= 実装上未使用、 schema 定義のみ)
    }));
    const { error: drawingsInsertError } = await supabaseAdmin
      .from('drawings')
      .insert(newDrawings);

    if (drawingsInsertError) {
      // ロールバック: 新 projects 削除 (= cascade で drawings も削除)
      await supabaseAdmin.from('projects').delete().eq('id', newProjectId);
      return NextResponse.json({ error: '取り込みに失敗しました' }, { status: 500 });
    }
    drawingsCount = srcDrawings.length;
  }

  // Step 9: 成功
  return NextResponse.json(
    {
      newProjectId,
      drawingsCount,
    },
    { status: 201 },
  );
}
