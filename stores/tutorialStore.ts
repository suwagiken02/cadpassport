import { create } from 'zustand';

/**
 * インタラクティブ・チュートリアル state
 * デフォルト OFF (= 既存ユーザに勝手に出さない)。 設定メニューから手動起動。
 */
type TutorialState = {
  /** チュートリアル表示中 */
  isActive: boolean;
  /** 現在のステップ index (= 0 始まり) */
  currentStep: number;
  /**
   * 自動配置ステップ突入時の handrails.length スナップショット。
   * 足場開始でも自動配置でも handrails が増えるため、 自動配置ステップ突入時点の本数を保持し
   * 「それより増えた」 で自動配置完了を検知する (= Phase A)。
   */
  handrailsBeforeAutolayout: number | null;
  /**
   * step1 (= 設定) で設定パネルを一度でも開いたか (= showSettings が true になったら立てる once flag)。
   * 完了条件「開いて → 閉じた」 を判定するために使う。
   */
  settingsOpenedOnce: boolean;
  /** チュートリアル開始 (= step 0 から) */
  startTutorial: () => void;
  /** 次ステップへ */
  nextStep: () => void;
  /** スキップ (= isActive=false に戻す、 進捗破棄) */
  skipTutorial: () => void;
  /** 終了 (= 全ステップ完了時) */
  endTutorial: () => void;
  /** 自動配置 snapshot をセット */
  setHandrailsBeforeAutolayout: (n: number | null) => void;
  /** 設定を開いた once flag をセット */
  setSettingsOpenedOnce: (v: boolean) => void;
};

export const useTutorialStore = create<TutorialState>((set, get) => ({
  isActive: false,
  currentStep: 0,
  handrailsBeforeAutolayout: null,
  settingsOpenedOnce: false,
  startTutorial: () => set({ isActive: true, currentStep: 0, handrailsBeforeAutolayout: null, settingsOpenedOnce: false }),
  nextStep: () => set({ currentStep: get().currentStep + 1 }),
  skipTutorial: () => set({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null, settingsOpenedOnce: false }),
  endTutorial: () => set({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null, settingsOpenedOnce: false }),
  setHandrailsBeforeAutolayout: (n) => set({ handrailsBeforeAutolayout: n }),
  setSettingsOpenedOnce: (v) => set({ settingsOpenedOnce: v }),
}));
