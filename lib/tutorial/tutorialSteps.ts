import type { CanvasData } from '@/types';

/**
 * チュートリアル 1 ステップの完了判定に使う context。
 * useCanvasStore の subset (= テストしやすいよう純データのみ)。
 */
export type TutorialContext = {
  canvasData: CanvasData;
  mode: string;
  showSettings: boolean;
  showSettingsPanel: boolean;
};

/**
 * チュートリアル 1 ステップの定義。
 * - id: ステップ識別子
 * - targetSelector: ハイライト対象 (= data-tutorial-id 属性で指定する CSS セレクタ)
 * - title / description: 吹き出しの文言 (= CAD 初心者向け平易な日本語)
 * - completeWhen: 完了条件 (= true で自動次ステップへ)。 undefined なら「次へ」 ボタンで進む
 */
export type TutorialStep = {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  completeWhen?: (ctx: TutorialContext) => boolean;
};

/**
 * Phase 1: 最初の 3 ステップ。
 * Phase 2 で 6 ステップ追加し、 計 9 ステップ完成予定。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'settings',
    targetSelector: '[data-tutorial-id="settings-button"]',
    title: '1. 設定を確認',
    description:
      'まずは右下の「設定」ボタンを押してみましょう。アプリの表示設定（ダークモード・寸法表示など）が確認できます。',
    // 設定 UI の toggle 状態は不確定なため、 手動「次へ」 で進む
    completeWhen: undefined,
  },
  {
    id: 'kutai-building',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '2. 建物（躯体）を作る',
    description:
      '次は建物の形を作ります。「躯体」ボタン → 「建物1F」 → 「壁方向入力」で建物の輪郭を描いてみましょう。',
    // 建物が 1 つ以上できたら完了
    completeWhen: (ctx) => ctx.canvasData.buildings.length > 0,
  },
  {
    id: 'obstacle',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '3. 障害物を配置',
    description:
      '次は障害物（エコキュート・室外機など）を置きます。「躯体」ボタン → 「障害物」 から選択して配置してみましょう。',
    // 障害物が 1 つ以上配置されたら完了
    completeWhen: (ctx) => ctx.canvasData.obstacles.length > 0,
  },
];

/** Phase 2 完成時の総ステップ数 (= UI に「N/9」 で表示) */
export const TOTAL_STEPS = 9;
