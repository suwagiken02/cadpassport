// ============================================================
// 機能変更のお知らせ（自動割付ルール変更 v20260704）の既読フラグ。
//   localStorage(per-device・ashiba-plan:* パターン)で「今後表示しない」を永続化。
//   バージョンをキーに含めるため、次回の大型変更は NOTICE_VERSION を差し替えるだけで再表示できる。
// ============================================================

/** お知らせのバージョン。次回の大型変更時はここを差し替える（旧フラグと衝突せず再表示）。 */
export const NOTICE_VERSION = 'v20260704';

/** 既読フラグの localStorage キー。 */
export const NOTICE_KEY = `ashiba-plan:noticeDismissed:${NOTICE_VERSION}`;

/** 「今後表示しない」が保存済みか。localStorage 不可/例外時は false（＝表示する側）に倒す。 */
export function isNoticeDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 「今後表示しない」を保存。例外は握りつぶす（保存できなくても次回また出るだけ）。 */
export function dismissNotice(): void {
  try {
    window.localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // localStorage 不可（プライベートブラウズ等）は無視
  }
}
