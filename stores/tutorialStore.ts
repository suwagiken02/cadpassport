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
};

export const useTutorialStore = create<TutorialState>((set, get) => ({
  isActive: false,
  currentStep: 0,
  handrailsBeforeAutolayout: null,
  startTutorial: () => set({ isActive: true, currentStep: 0, handrailsBeforeAutolayout: null }),
  nextStep: () => set({ currentStep: get().currentStep + 1 }),
  skipTutorial: () => set({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null }),
  endTutorial: () => set({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null }),
  setHandrailsBeforeAutolayout: (n) => set({ handrailsBeforeAutolayout: n }),
}));
