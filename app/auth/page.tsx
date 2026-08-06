'use client';

import { Suspense, useState, useEffect } from 'react';
import { trackScreen } from '@/lib/analytics';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import PasswordInput from '@/components/ui/PasswordInput';
import { useIsWebView } from '@/hooks/useIsWebView';
import { useIsAndroid } from '@/hooks/useIsAndroid';

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // フェーズ0: 画面到達（ファネルの 1 段目）。ログイン前のぶんは sessionStorage に
  //   積まれ、ログインが確定した時点でまとめて送られる。
  useEffect(() => { trackScreen('auth'); }, []);
  // 改善 11: サインアップ後のリダイレクト先 /auth?signup=success で完了 banner 表示
  const showSignupSuccess = searchParams.get('signup') === 'success';
  // PW リセット 改善: PW 更新後のリダイレクト先 /auth?reset=success で完了 banner 表示
  const showResetSuccess = searchParams.get('reset') === 'success';
  const { signIn, signUp, signInWithGoogle, signUpWithId, signInWithId } = useAuthStore();
  // 改善 15b-2: mode 5 値拡張 (= ログイン + サインアップ方式選択 + 各方式画面)。
  // 'signup-method' = メールアドレス使う/使わないの方式選択画面、
  // 'signup-email' = メールアドレスサインアップ詳細フォーム、
  // 'signup-id-intro' = ID 説明画面、 'signup-id-form' = ID サインアップ詳細フォーム。
  const [mode, setMode] = useState<
    'login' | 'signup-method' | 'signup-email' | 'signup-id-intro' | 'signup-id-form'
  >('login');
  // 既存 JSX の isSignUp 参照 (= 確認入力 JSX 等) を互換性維持。
  // signup-method / signup-id-intro 状態では確認入力 JSX 不要なので false。
  const isSignUp = mode === 'signup-email' || mode === 'signup-id-form';
  // setIsSignUp(true) → サインアップ方式選択画面へ。 setIsSignUp(false) → ログインへ。
  const setIsSignUp = (val: boolean) => setMode(val ? 'signup-method' : 'login');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  // ID/PW 認証用 state (= ID タブで使用)
  const [username, setUsername] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  // 生年月日 3 dropdown (= 簡易 31 日固定、 submit 時に isValidDate で正規化)
  // SSR hydration 対策: 初期値計算を useState 初期化関数で client 側に閉じる
  const [currentYear] = useState(() => new Date().getFullYear());
  const [birthYear, setBirthYear] = useState(() => new Date().getFullYear() - 30);
  const [birthMonth, setBirthMonth] = useState(1);
  const [birthDay, setBirthDay] = useState(1);
  const [pin, setPin] = useState('');
  // 確認入力 (= サインアップ時のタイポ防止、 サーバーには送らない)
  // confirmPassword は メアド/PW タブと ID タブで共有 (= タブ切替時の値残存は許容)
  const [confirmUsername, setConfirmUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPinWarning, setShowPinWarning] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 改善 15b-1: 統一ログインフォーム用 (= 「ID もしくはメールアドレス」 の入力値)
  const [identifier, setIdentifier] = useState('');

  // 利用規約 + プラポリ 同意チェック (= サインアップ専用、 mode === 'signup-email' / 'signup-id-form' の form で使用)
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // OAuth WebView ブロック対策: アプリ内 webview からのアクセス検知
  const isWebView = useIsWebView();
  // WebView Phase 2: Android のみ「Chrome で開く」 button (= intent:// URI) を表示
  const isAndroid = useIsAndroid();

  /**
   * Android Chrome 強制起動 handler (= intent:// URI scheme)。
   *
   * webview 内で押すと、 現在 URL を Chrome に渡して開き直す。
   * package=com.android.chrome で Chrome 限定起動 (= 他ブラウザにフォールバックさせない)。
   *
   * 注: iOS は intent:// 非対応のため、 button は isAndroid && で Android のみ表示。
   * fragment (= URL の #xxx) は intent パラメータの #Intent と衝突するため除外。
   */
  const handleOpenInChrome = () => {
    if (typeof window === 'undefined') return;
    const { host, pathname, search } = window.location;
    const intentUrl = `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;end`;
    window.location.href = intentUrl;
  };

  /**
   * 改善 15b-1: 統一ログイン handler (= 「ID もしくはメールアドレス」 + パスワード)。
   *
   * identifier に `@` が含まれていればメールアドレスログイン (= signIn) として処理、
   * 含まれていなければ ID ログイン (= signInWithId) として処理。
   *
   * ID のバリデーション (= 半角英数字 + アンダースコア + ハイフン、 既存の pattern) は
   * `@` を含まないため、 単純な `.includes('@')` で完全に区別可能。
   *
   * 成功時 else でも setLoading(false) を明示 (= 改善 14/15a パターンと整合、
   * 同一ページ内 router.replace で state リセットされない問題への保険)。
   */
  const handleUnifiedLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const isEmail = identifier.includes('@');
    const err = isEmail
      ? await signIn(identifier, password)
      : await signInWithId(identifier, password);

    if (err) {
      setError(err);
      setLoading(false);
    } else {
      setLoading(false);
      router.replace('/projects');
    }
  };

  /**
   * メールアドレス/パスワードのサインアップ + ログイン用 handler。
   * 改善 15b-1 (= ログインフォーム統一) 後、 ログインは handleUnifiedLogin が担当するため、
   * 本 handler の if (!isSignUp) 分岐は実質デッドコード (= mode === 'login' 時の JSX で
   * handleUnifiedLogin が onSubmit に指定されるため、 ここの else が呼ばれなくなる)。
   * 完全削除は commit 15b-2 のリファクタで対応予定。
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // 改善 15b-3: 確認入力チェック (= サインアップ専用化、 不一致なら error + return)
    if (email !== confirmEmail) {
      setError('メールアドレスが一致しません');
      return;
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    setLoading(true);

    // 改善 15b-2: ログイン分岐 (= else { signIn(...) }) は handleUnifiedLogin が
    // 担当するため削除。 本 handler はメアド/PW サインアップ専用 (= isSignUp 常に true)。
    const err = await signUp(email, password);

    if (err) {
      setError(err);
      setLoading(false);
    } else {
      // 改善 14: 同一ページ内 URL 変更で state 残存 → 明示的に loading リセット。
      setLoading(false);
      // 改善 15: サインアップ成功時はフォーム state を完全リセット + ログインモードに切替。
      setMode('login');
      setEmail('');
      setConfirmEmail('');
      setPassword('');
      setConfirmPassword('');
      setUsername('');
      setConfirmUsername('');
      setLastName('');
      setFirstName('');
      setBirthYear(currentYear - 30);
      setBirthMonth(1);
      setBirthDay(1);
      setPin('');
      setConfirmPin('');
      setAgreedToTerms(false);
      // 改善 11: サインアップ完了 → /auth?signup=success (= 完了 banner 表示)
      router.replace('/auth?signup=success');
    }
  };

  /** PIN-生年月日 同一警告判定 (= サーバー側と同じ 3 パターン: MMDD / DDMM / YYYY) */
  const isPinMatchingBirthDate = (pinValue: string, birthDateValue: string): boolean => {
    if (!/^\d{4}$/.test(pinValue) || !/^\d{4}-\d{2}-\d{2}$/.test(birthDateValue)) return false;
    const [y, m, d] = birthDateValue.split('-');
    return pinValue === `${m}${d}` || pinValue === `${d}${m}` || pinValue === y;
  };

  /** 月の日数を考慮した正規日付チェック (= 2 月 30 日 等を弾く) */
  const isValidDate = (y: number, m: number, d: number): boolean => {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  };

  /** 生年月日 state を 'YYYY-MM-DD' に整形 */
  const buildBirthDateStr = (y: number, m: number, d: number): string =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  /** ID/PW サインアップの実 submit (= 警告 Modal の「このまま登録」 でも呼ぶ) */
  const submitIdSignUp = async (acknowledgeWarning: boolean) => {
    const birthDateStr = buildBirthDateStr(birthYear, birthMonth, birthDay);
    setError('');
    setLoading(true);
    const err = await signUpWithId({
      username, password, lastName, firstName, birthDate: birthDateStr, pin,
      acknowledgePinWarning: acknowledgeWarning,
    });
    if (err === 'pin-matches-birthdate') {
      // サーバー側からの警告 (= クライアント検証をすり抜けたケースのフォールバック)
      setShowPinWarning(true);
      setLoading(false);
      return;
    }
    if (err) {
      setError(err);
      setLoading(false);
    } else {
      // 改善 14: 同一ページ内 URL 変更で state 残存 → 明示的に loading リセット。
      setLoading(false);
      // 改善 15: フォーム state 完全リセット + ログインモードに切替
      setMode('login');
      setEmail('');
      setConfirmEmail('');
      setPassword('');
      setConfirmPassword('');
      setUsername('');
      setConfirmUsername('');
      setLastName('');
      setFirstName('');
      setBirthYear(currentYear - 30);
      setBirthMonth(1);
      setBirthDay(1);
      setPin('');
      setConfirmPin('');
      setAgreedToTerms(false);
      // 改善 11: ID/PW サインアップ後も /auth?signup=success へ (= 完了 banner 表示)
      router.replace('/auth?signup=success');
    }
  };

  const handleIdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 改善 15b-3: ログイン分岐削除 (= mode === 'signup-id-form' でのみ呼ばれるサインアップ専用)。
    // 確認入力チェック (= 不一致なら error + submit ブロック、 ボタン無効化はしない)
    if (username !== confirmUsername) {
      setError('ID が一致しません');
      return;
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    if (pin !== confirmPin) {
      setError('PIN が一致しません');
      return;
    }
    // 生年月日 妥当性チェック (= 2 月 30 日 等を弾く)
    if (!isValidDate(birthYear, birthMonth, birthDay)) {
      setError('生年月日が正しくありません (= 月の日数を確認してください)');
      return;
    }
    // クライアント側 早期警告判定 (= サーバーラウンドトリップ削減)
    const birthDateStr = buildBirthDateStr(birthYear, birthMonth, birthDay);
    if (isPinMatchingBirthDate(pin, birthDateStr)) {
      setError('');
      setShowPinWarning(true);
      return;
    }
    await submitIdSignUp(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-accent mb-2">CAD パスポート</h1>
          <p className="text-dimension text-sm">{isSignUp ? 'アカウント作成' : '足場平面図アプリ'}</p>
        </div>

        {/* 改善 11: サインアップ完了 banner (= /auth?signup=success アクセス時のみ) */}
        {showSignupSuccess && (
          <div className="mb-5 bg-success/15 border border-success/40 rounded-lg p-3 text-center">
            <p className="text-sm font-bold text-success mb-1">✅ アカウント作成完了</p>
            <p className="text-xs text-dimension">続けてログインしてください</p>
          </div>
        )}

        {/* PW リセット 改善: PW 更新完了 banner (= /auth?reset=success アクセス時のみ) */}
        {showResetSuccess && (
          <div className="mb-5 bg-success/15 border border-success/40 rounded-lg p-3 text-center">
            <p className="text-sm font-bold text-success mb-1">✅ パスワードを変更しました</p>
            <p className="text-xs text-dimension">新しいパスワードでログインしてください</p>
          </div>
        )}

        {/* 改善 15b-1: ログイン時は統一フォーム (= ID もしくはメールアドレス + パスワード)。
            タブを廃止し、 identifier に @ を含むかで自動判別 (= handleUnifiedLogin)。 */}
        {mode === 'login' && (
          <>
            {isWebView ? (
              /* WebView 検知時: Google ボタン + 区切り線 を非表示にし、 警告メッセージ表示 */
              <div className="w-full mb-4 bg-dark-surface border border-yellow-400/40 rounded-lg p-3">
                <p className="text-xs text-canvas leading-relaxed">
                  ⚠ この画面では Google ログインができません。<br />
                  Chrome 等のブラウザで開き直すか、 メールアドレス・ID ログインをご利用ください。
                </p>
                {/* Phase 2: Android のみ intent:// で Chrome ワンタップ起動 (= iOS は非対応で非表示) */}
                {isAndroid && (
                  <button
                    type="button"
                    onClick={handleOpenInChrome}
                    className="w-full mt-2 py-2 bg-dark-bg border border-dark-border text-accent text-sm font-bold rounded-lg hover:bg-dark-border transition-colors"
                  >
                    Chrome で開く
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Google OAuth ログイン (= 既存と同じ実装、 統一フォームの上に配置) */}
                <button
                  type="button"
                  onClick={async () => {
                    setError('');
                    setLoading(true);
                    const err = await signInWithGoogle();
                    if (err) {
                      setError(err);
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="w-full py-3 mb-4 bg-white text-gray-700 font-bold rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Google でログイン
                </button>

                {/* 区切り線 */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-dark-border"></div>
                  <span className="text-xs text-dimension">または</span>
                  <div className="flex-1 h-px bg-dark-border"></div>
                </div>
              </>
            )}

            <form onSubmit={handleUnifiedLogin} className="space-y-4">
              <div>
                <label className="block text-sm text-dimension mb-1">ID もしくはメールアドレス</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                  placeholder="suwaniki01 もしくは suwaniki@mail.com"
                  autoComplete="username"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-dimension mb-1">パスワード</label>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder="パスワード"
                  required
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-accent text-white font-bold rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {loading ? '処理中...' : 'ログイン'}
              </button>
            </form>

            {/* ID / パスワードを忘れた → /auth/recover (= Day 4-5 Step 3) */}
            <button
              type="button"
              onClick={() => router.push('/auth/recover')}
              className="w-full mt-2 py-2 text-accent text-xs hover:underline"
            >
              ID / パスワードを忘れた
            </button>
          </>
        )}

        {/* 改善 15b-2: signup-method 画面 (= サインアップ方式選択) */}
        {mode === 'signup-method' && (
          <>
            <div className="text-center mb-6 text-sm text-dimension">
              アカウント作成方法を選択してください
            </div>
            <button
              type="button"
              onClick={() => { setMode('signup-email'); setError(''); }}
              className="w-full mb-3 py-3 bg-accent text-white font-bold rounded-lg hover:bg-blue-600 transition-colors"
            >
              メールアドレスでアカウントを作る
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup-id-intro'); setError(''); }}
              className="w-full mb-3 py-3 bg-dark-surface border border-dark-border text-canvas font-bold rounded-lg hover:bg-dark-border transition-colors"
            >
              メールアドレスを使わずにアカウントを作る
            </button>
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className="w-full mt-2 py-2 text-accent text-xs hover:underline"
            >
              ← ログインに戻る
            </button>
          </>
        )}

        {/* 改善 15b-2: signup-id-intro 画面 (= ID 説明文言、 確定済) */}
        {mode === 'signup-id-intro' && (
          <>
            <h2 className="text-lg font-bold mb-3">ID とは</h2>
            <div className="mb-5 text-sm text-dimension leading-relaxed space-y-2">
              <p>ご自身で決めるログイン用の名前です (= メールアドレスの代わり)。</p>
              <ul className="list-disc list-inside space-y-1">
                <li>半角の英字、 数字、 「_」 「-」 が使えます</li>
                <li>3〜32 文字</li>
                <li>例: yamada01、 suwagiken02</li>
              </ul>
              <p className="text-xs">
                ※ パスワードを忘れたときは、 ID + 姓 + 名 + 生年月日 + 4 桁 PIN で
                復旧できます。 メールアドレスの登録は不要です。
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setMode('signup-id-form'); setError(''); }}
              className="w-full mb-3 py-3 bg-accent text-white font-bold rounded-lg hover:bg-blue-600 transition-colors"
            >
              次へ
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup-method'); setError(''); }}
              className="w-full mt-2 py-2 text-accent text-xs hover:underline"
            >
              ← 戻る
            </button>
          </>
        )}

        {/* 改善 15b-3: 既存ラッパー削除、 個別 mode ラップに分解。
            ラッパー削除に伴うインデント整理は別タスク (= prettier 未設定のため)。 */}
        {/* 改善 15b-2: メアド/PW サインアップ詳細フォーム (= 旧 activeTab === 'email') */}
        {mode === 'signup-email' && (
          <>
            {/* 改善 15b-2: サインアップ画面の Google ボタン削除 (= 「Google でログイン」 文言が
                サインアップ画面で混乱招くため、 ログイン画面の統一フォーム上のみに残す)。 */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-dimension mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                  placeholder="suwaniki@mail.com"
                  required
                />
              </div>

              {isSignUp && (
                <div>
                  <label className="block text-sm text-dimension mb-1">メールアドレス (確認)</label>
                  <input
                    type="email"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    placeholder="もう一度入力"
                    required={isSignUp}
                  />
                  {confirmEmail && email !== confirmEmail && (
                    <p className="mt-1 text-[10px] text-red-400">⚠ メールアドレスが一致しません</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm text-dimension mb-1">パスワード</label>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder="6文字以上"
                  minLength={6}
                  required
                />
                <p className="mt-1 text-[10px] text-dimension">
                  6 文字以上の英数字を推奨
                </p>
              </div>

              {isSignUp && (
                <div>
                  <label className="block text-sm text-dimension mb-1">パスワード (確認)</label>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="もう一度入力"
                    minLength={6}
                    required={isSignUp}
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="mt-1 text-[10px] text-red-400">⚠ パスワードが一致しません</p>
                  )}
                </div>
              )}

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              {/* 利用規約 + プラポリ 同意チェック (= サインアップ必須、 mode === 'signup-email' / 'signup-id-form' 共通 state) */}
              <label className="flex items-start gap-2 text-sm text-dimension cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">利用規約</a>
                  と
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">プライバシーポリシー</a>
                  に同意します
                </span>
              </label>

              <button
                type="submit"
                disabled={loading || !agreedToTerms}
                className="w-full py-3 bg-accent text-white font-bold rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {loading ? '処理中...' : isSignUp ? 'アカウント作成' : 'ログイン'}
              </button>
            </form>
          </>
        )}

        {/* 改善 15b-2: ID/PW サインアップ詳細フォーム (= 旧 activeTab === 'id') */}
        {mode === 'signup-id-form' && (
          <form onSubmit={handleIdSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-dimension mb-1">ID</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                placeholder="suwaniki01"
                pattern="[a-zA-Z0-9_-]{3,32}"
                title="半角英数字 + アンダースコア + ハイフンの 3〜32 文字"
                required
              />
              <p className="mt-1 text-[10px] text-dimension">
                半角英数字、 アンダースコア (_)、 ハイフン (-) の 3〜32 文字
              </p>
            </div>

            {isSignUp && (
              <>
                <div>
                  <label className="block text-sm text-dimension mb-1">ID (確認)</label>
                  <input
                    type="text"
                    value={confirmUsername}
                    onChange={(e) => setConfirmUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    placeholder="もう一度入力"
                    required={isSignUp}
                  />
                  {confirmUsername && username !== confirmUsername && (
                    <p className="mt-1 text-[10px] text-red-400">⚠ ID が一致しません</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm text-dimension mb-1">姓</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                      placeholder="スワ"
                      maxLength={32}
                      required={isSignUp}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-dimension mb-1">名</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                      placeholder="ニキ"
                      maxLength={32}
                      required={isSignUp}
                    />
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-dimension">
                  漢字 / カタカナ どちらでも入力できます
                </p>

                <div>
                  <label className="block text-sm text-dimension mb-1">生年月日</label>
                  <div className="flex gap-2">
                    <select
                      value={birthYear}
                      onChange={(e) => setBirthYear(Number(e.target.value))}
                      className="flex-1 px-2 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    >
                      {Array.from({ length: currentYear - 1900 + 1 }, (_, i) => currentYear - i).map((y) => (
                        <option key={y} value={y}>{y} 年</option>
                      ))}
                    </select>
                    <select
                      value={birthMonth}
                      onChange={(e) => setBirthMonth(Number(e.target.value))}
                      className="flex-1 px-2 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{m} 月</option>
                      ))}
                    </select>
                    <select
                      value={birthDay}
                      onChange={(e) => setBirthDay(Number(e.target.value))}
                      className="flex-1 px-2 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d} 日</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm text-dimension mb-1">パスワード</label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="6文字以上"
                minLength={6}
                required
              />
              <p className="mt-1 text-[10px] text-dimension">
                6 文字以上の英数字を推奨
              </p>
            </div>

            {isSignUp && (
              <div>
                <label className="block text-sm text-dimension mb-1">パスワード (確認)</label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="もう一度入力"
                  minLength={6}
                  required={isSignUp}
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="mt-1 text-[10px] text-red-400">⚠ パスワードが一致しません</p>
                )}
              </div>
            )}

            {isSignUp && (
              <>
                <div>
                  <label className="block text-sm text-dimension mb-1">4 桁 PIN (= 復旧用)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    placeholder="0000"
                    pattern="\d{4}"
                    maxLength={4}
                    title="4 桁の数字"
                    required={isSignUp}
                  />
                  <p className="mt-1 text-[10px] text-dimension">
                    パスワードを忘れたとき、 ID + 姓 + 名 + 生年月日 + PIN で復旧できます
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-dimension mb-1">4 桁 PIN (確認)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    className="w-full px-4 py-3 bg-dark-surface border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                    placeholder="もう一度入力"
                    pattern="\d{4}"
                    maxLength={4}
                    required={isSignUp}
                  />
                  {confirmPin && pin !== confirmPin && (
                    <p className="mt-1 text-[10px] text-red-400">⚠ PIN が一致しません</p>
                  )}
                </div>
              </>
            )}

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-accent text-white font-bold rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {loading ? '処理中...' : isSignUp ? 'アカウント作成' : 'ログイン'}
            </button>

          </form>
        )}
        {/* 改善 15b-3: 既存ラッパー閉じ削除済 */}

        {/* 改善 15b-2: ログイン or サインアップ詳細フォーム時のみ表示。
            signup-method / signup-id-intro 画面では各画面内の「← 戻る」 リンクが担当。 */}
        {(mode === 'login' || isSignUp) && (
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            className="w-full mt-4 py-3 text-accent text-sm hover:underline"
          >
            {isSignUp ? 'アカウントをお持ちの方はログイン' : '新規アカウント作成'}
          </button>
        )}
      </div>

      {/* PIN-生年月日 同一警告 Modal (= showLockedAlert パターン、 z-[70]) */}
      {showPinWarning && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPinWarning(false)} />
          <div className="relative bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <p className="font-bold text-sm mb-2">PIN が生年月日と同じです</p>
            <p className="text-xs text-dimension leading-relaxed mb-4">
              セキュリティ上、 推奨されません。<br />
              生年月日から推測されやすいため、 別の 4 桁を選ぶことをお勧めします。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPinWarning(false)}
                className="flex-1 py-2.5 border border-dark-border text-dimension font-bold rounded-xl text-sm"
              >
                PIN を変更
              </button>
              <button
                onClick={async () => {
                  setShowPinWarning(false);
                  await submitIdSignUp(true);
                }}
                className="flex-1 py-2.5 bg-accent text-white font-bold rounded-xl text-sm"
              >
                このまま登録
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Vercel build fix: useSearchParams は Suspense boundary 内で実行する必要があるため、
// 関数本体を AuthPageInner に切り出し、 export default は Suspense wrapper に。
// 参照: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
export default function AuthPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen p-4" />}>
      <AuthPageInner />
    </Suspense>
  );
}
