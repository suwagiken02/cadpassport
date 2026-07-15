'use client';

import { create } from 'zustand';
import { supabase } from '@/lib/supabase/client';
import { extractSupabaseEmail } from '@/lib/auth/supabaseUser';

/**
 * Supabase Auth が返す英語エラーメッセージを日本語化する。
 * 該当しないエラーは元のメッセージをそのまま返す (= フォールバック)。
 * module スコープの private 関数 (= 現時点では authStore.ts 内のみ参照)。
 */
function localizeAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません';
  }
  if (message.includes('Email not confirmed')) {
    return 'メールアドレスの確認が完了していません。確認メールをご確認ください';
  }
  if (message.includes('User already registered')) {
    return 'このメールアドレスは既に登録されています';
  }
  if (message.includes('Password should be at least')) {
    return 'パスワードは 6 文字以上で入力してください';
  }
  if (message.includes('Unable to validate email address')) {
    return 'メールアドレスの形式が正しくありません';
  }
  if (message.includes('Email rate limit exceeded')) {
    return '確認メールの送信回数が上限を超えました。しばらくしてから再度お試しください';
  }
  if (message.includes('signup is disabled') || message.includes('Signups not allowed')) {
    return 'アカウント作成は現在無効になっています';
  }
  if (message.includes('OAuth') || message.includes('oauth')) {
    return 'OAuth プロバイダーへの接続に失敗しました';
  }
  return message;
}

/** Phase 0a で作成した固定 Default Company の UUID。
 *  Phase 0d で本格的な認証 + 会社割当が入るまでフォールバックとして使用。 */
export const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

type Profile = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  logo_url: string | null;
};

const ANON_USER = { id: 'anonymous', email: '' };
const ANON_PROFILE: Profile = { id: 'anonymous', company_id: null, company_name: null, logo_url: null };

type AuthStore = {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  /** 現在のユーザーの所属会社 ID（Phase 0b）。null なら未ロード or 匿名 → DEFAULT_COMPANY_ID にフォールバック */
  currentCompanyId: string | null;
  loading: boolean;
  setUser: (user: { id: string; email: string } | null) => void;
  setProfile: (profile: Profile | null) => void;
  setCurrentCompanyId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  signUpWithId: (params: {
    username: string;
    password: string;
    lastName: string;
    firstName: string;
    birthDate: string;
    pin: string;
    acknowledgePinWarning?: boolean;
  }) => Promise<string | null>;
  signInWithId: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  loadSession: () => Promise<void>;
  updateProfile: (companyName: string, logoUrl?: string) => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: ANON_USER,
  profile: ANON_PROFILE,
  currentCompanyId: null,
  loading: false,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setCurrentCompanyId: (id) => set({ currentCompanyId: id }),
  setLoading: (loading) => set({ loading }),

  signIn: async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return localizeAuthError(error.message);
      await get().loadSession();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'ログインに失敗しました';
    }
  },
  signUp: async (email, password) => {
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return localizeAuthError(error.message);
      // 改善 11: サインアップ後は自動ログインせず、 サインアウトしてユーザーに手動ログインさせる。
      // UI 側で /auth?signup=success にリダイレクトして完了 banner を表示する流れ。
      await supabase.auth.signOut();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'アカウント作成に失敗しました';
    }
  },
  signInWithGoogle: async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) return localizeAuthError(error.message);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Google ログインに失敗しました';
    }
  },
  signUpWithId: async ({ username, password, lastName, firstName, birthDate, pin, acknowledgePinWarning }) => {
    try {
      const res = await fetch('/api/auth/signup-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, password, lastName, firstName, birthDate, pin,
          acknowledgePinWarning: acknowledgePinWarning === true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // 警告コード (= PIN-生年月日 一致) はそのまま返して UI 側で Modal 判定
        if (data?.warning === 'pin-matches-birthdate') {
          return 'pin-matches-birthdate';
        }
        return typeof data?.error === 'string' ? data.error : 'アカウント作成に失敗しました';
      }
      // 改善 11: 自動ログインせず、 UI 側で /auth?signup=success へリダイレクト。
      // ID/PW では API Route が createUser のみ実行 (= server-side、 session 作成なし) なので
      // signInWithId 呼び出しを削除すれば session は作成されない (= signOut 不要)。
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'アカウント作成に失敗しました';
    }
  },
  signInWithId: async (username, password) => {
    try {
      const email = `${username}@cadpassport.local`;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return localizeAuthError(error.message);
      await get().loadSession();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'ログインに失敗しました';
    }
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: ANON_USER, profile: ANON_PROFILE, currentCompanyId: null });
  },

  loadSession: async () => {
    set({ loading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        set({ user: { id: session.user.id, email: extractSupabaseEmail(session.user) } });
        try {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          if (data) {
            set({
              profile: data,
              currentCompanyId: data.company_id ?? null,
            });
          } else {
            set({ currentCompanyId: null });
          }
        } catch {
          // profile 取得失敗しても続行 (= currentCompanyId は null のまま)
          set({ currentCompanyId: null });
        }
      } else {
        // Day 7 commit A: セッションなし → ANON 状態に戻す。
        // middleware が認証必須パスで /auth へリダイレクトするため、 ここでの匿名サインイン
        // (= 旧 signInAnonymously) は不要 (= 削除済)。
        set({ user: ANON_USER, profile: ANON_PROFILE, currentCompanyId: null });
      }
    } catch {
      set({ user: ANON_USER, profile: ANON_PROFILE, currentCompanyId: null });
    }
    set({ loading: false });
  },

  updateProfile: async (companyName, logoUrl) => {
    const { user } = get();
    if (!user || user.id === 'anonymous') return;
    const updates: Record<string, string> = { company_name: companyName };
    if (logoUrl) updates.logo_url = logoUrl;
    try {
      await supabase.from('profiles').update(updates).eq('id', user.id);
      set({ profile: { ...get().profile!, ...updates } as Profile });
    } catch {
      // ignore
    }
  },
}));
