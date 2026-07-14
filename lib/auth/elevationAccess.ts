// ============================================================
// 立面プレビュー(E-3系)の公開範囲判定（E-3.15）。
// 現状は管理者(鮎澤氏)のみに限定。ロール機構が無いためメールのホワイトリストで判定する。
// 将来の一般解禁は ELEVATION_PREVIEW_EMAILS を空にするか、下の判定を `return true` に1行変更で済む。
// ============================================================

/** 立面プレビューを使える管理者メール（小文字比較）。 */
const ELEVATION_PREVIEW_EMAILS = ['suwagiken02@gmail.com'];

/** 立面プレビュー機能を使えるユーザーか。email ホワイトリストで判定（大文字小文字/前後空白は無視）。 */
export function isElevationPreviewUser(user: { email?: string | null } | null | undefined): boolean {
  const email = (user?.email ?? '').trim().toLowerCase();
  if (!email) return false;
  return ELEVATION_PREVIEW_EMAILS.some((e) => e.toLowerCase() === email);
}
