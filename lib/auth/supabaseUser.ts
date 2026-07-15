// ============================================================
// Supabase の user オブジェクトから email を確実に取得する（取得経路の集約・E-4.1）。
// 通常は user.email（password / Google OAuth いずれもトップレベル）に入るが、
// 一部プロバイダ/設定では user_metadata.email 側にしか無いことがあるためフォールバックする。
// ここで trim のみ行い、大文字小文字の正規化は判定側（isElevationPreviewUser）に委ねる。
// ============================================================

type SupabaseUserLike =
  | {
      email?: string | null;
      user_metadata?: ({ email?: string | null } & Record<string, unknown>) | null;
    }
  | null
  | undefined;

/** Supabase user から email を取得。順序: email → user_metadata.email。無ければ ''（前後空白は除去）。 */
export function extractSupabaseEmail(user: SupabaseUserLike): string {
  const raw = user?.email ?? user?.user_metadata?.email ?? '';
  return (raw ?? '').trim();
}
