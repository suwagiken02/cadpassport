import { describe, it, expect } from 'vitest';
import { extractSupabaseEmail } from '../supabaseUser';
import { isElevationPreviewUser } from '../elevationAccess';

// 実データ形（Supabase session.user 相当）→ email 取得 → 立面ロック判定 の結線を固定（E-4.1）。
// 従来テストは「email を渡せば判定は正しい」しか見ておらず、取得経路が未検証だった。
describe('Supabase 実ユーザー → email 取得 → 立面ロック判定 (E-4.1)', () => {
  it('通常ログイン: email はトップレベル → 管理者は true', () => {
    const supaUser = { email:'suwagiken02@gmail.com', user_metadata: { name: 'a' } };
    const email = extractSupabaseEmail(supaUser);
    expect(email).toBe('suwagiken02@gmail.com');
    expect(isElevationPreviewUser({ email })).toBe(true);
  });

  it('email が user_metadata 側のみでも取得して判定できる（フォールバック）', () => {
    const supaUser = { email:null, user_metadata: { email: 'suwagiken02@gmail.com' } };
    expect(isElevationPreviewUser({ email: extractSupabaseEmail(supaUser) })).toBe(true);
  });

  it('前後空白・大文字混じりでも正規化して判定', () => {
    const supaUser = { email:'  SuwaGiken02@Gmail.com ', user_metadata: {} };
    expect(isElevationPreviewUser({ email: extractSupabaseEmail(supaUser) })).toBe(true);
  });

  it('非管理者は false', () => {
    const supaUser = { email:'other@example.com', user_metadata: {} };
    expect(isElevationPreviewUser({ email: extractSupabaseEmail(supaUser) })).toBe(false);
  });

  it('匿名（email 空・hydrate 前）は false', () => {
    expect(extractSupabaseEmail({ email: '' })).toBe('');
    expect(isElevationPreviewUser({ email: extractSupabaseEmail({ email: '' }) })).toBe(false);
  });

  it('user が null/undefined でも安全に ""', () => {
    expect(extractSupabaseEmail(null)).toBe('');
    expect(extractSupabaseEmail(undefined)).toBe('');
  });
});
