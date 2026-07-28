import { describe, it, expect } from 'vitest';
import { extractSupabaseEmail } from '../supabaseUser';

// ============================================================
// Supabase の user オブジェクトから email を取り出す経路（authStore が使う）。
// 旧・立面プレビューの管理者判定(E-3.15/E-4.1)は撤去したが、email 取得の正しさは
// ログイン状態表示や会社名の解決で使い続けるため、ここに残す。
// ============================================================
describe('extractSupabaseEmail', () => {
  it('通常ログイン: email はトップレベル', () => {
    expect(extractSupabaseEmail({ email: 'user@example.com', user_metadata: { name: 'a' } }))
      .toBe('user@example.com');
  });

  it('email が user_metadata 側のみでも取得できる（フォールバック）', () => {
    expect(extractSupabaseEmail({ email: null, user_metadata: { email: 'meta@example.com' } }))
      .toBe('meta@example.com');
  });

  it('前後空白は除去する（大文字小文字はそのまま＝正規化は利用側の責務）', () => {
    expect(extractSupabaseEmail({ email: '  Mixed@Example.com ', user_metadata: {} }))
      .toBe('Mixed@Example.com');
  });

  it('email 空・user が null/undefined でも安全に ""', () => {
    expect(extractSupabaseEmail({ email: '' })).toBe('');
    expect(extractSupabaseEmail(null)).toBe('');
    expect(extractSupabaseEmail(undefined)).toBe('');
  });
});
