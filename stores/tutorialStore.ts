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
  /** チュートリアル開始 (= step 0 から) */
  startTutorial: () => void;
  /** 次ステップへ */
  nextStep: () => void;
  /** スキップ (= isActive=false に戻す、 進捗破棄) */
  skipTutorial: () => void;
  /** 終了 (= 全ステップ完了時) */
  endTutorial: () => void;
};

export const useTutorialStore = create<TutorialState>((set, get) => ({
  isActive: false,
  currentStep: 0,
  startTutorial: () => set({ isActive: true, currentStep: 0 }),
  nextStep: () => set({ currentStep: get().currentStep + 1 }),
  skipTutorial: () => set({ isActive: false, currentStep: 0 }),
  endTutorial: () => set({ isActive: false, currentStep: 0 }),
}));
