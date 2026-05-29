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
  /** Phase 2 step 9 (= 平米計算) 完了検知用 */
  showAreaCalcModal: boolean;
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
 * Phase 1 (= 設定 / 躯体 / 障害物) + Phase 2 (= 屋根 / 高さ / 足場配置 / 入替 / 移動 / 平米) の計 9 ステップ。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'settings',
    targetSelector: '[data-tutorial-id="settings-button"]',
    title: '1. 設定を確認',
    description:
      'まずは右下の「設定」ボタンを押してみましょう。アプリの表示設定（ダークモード・寸法表示など）が確認できます。',
    completeWhen: undefined,
  },
  {
    id: 'kutai-building',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '2. 建物（躯体）を作る',
    description:
      '次は建物の形を作ります。「躯体」ボタン → 「建物1F」 → 「壁方向入力」で建物の輪郭を描いてみましょう。',
    completeWhen: (ctx) => ctx.canvasData.buildings.length > 0,
  },
  {
    id: 'obstacle',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '3. 障害物を配置',
    description:
      '次は障害物（エコキュート・室外機など）を置きます。「躯体」ボタン → 「障害物」 から選択して配置してみましょう。',
    completeWhen: (ctx) => ctx.canvasData.obstacles.length > 0,
  },
  {
    id: 'roof',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '4. 屋根を変更（任意）',
    description:
      '建物に屋根の出幅を設定できます。「躯体」 → 「屋根」 を選んでから建物をタップすると、屋根の種類や出幅を調整できます。終わったら「次へ」を押してください。',
    // 屋根は建物作成時に既に設定可能 + 変化検知が複雑なため「次へ」 フォールバック
    completeWhen: undefined,
  },
  {
    id: 'height-marker',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '5. 高さを設定',
    description:
      '建物外周に高さマーカーを立てます。「躯体」 → 「高さ」 を選んで建物の辺をタップし、軒高を入力してみましょう。',
    completeWhen: (ctx) => (ctx.canvasData.heightMarkers ?? []).length > 0,
  },
  {
    id: 'scaffold-auto',
    targetSelector: '[data-tutorial-id="ashiba-button"]',
    title: '6. 足場を配置',
    description:
      '「足場」メニューを開いて「自動配置」を選ぶと、建物の外周に手摺・支柱・踏板を一括配置できます。',
    completeWhen: (ctx) => ctx.canvasData.handrails.length > 0,
  },
  {
    id: 'scaffold-reorder',
    targetSelector: '[data-tutorial-id="ashiba-button"]',
    title: '7. 足場を入れ替え（任意）',
    description:
      '「足場」 → 「入れ替え」 で、同じラインの手摺の並び順を入れ替えられます。試したら「次へ」を押してください。',
    // 入れ替えモードは toggle で完了タイミングが曖昧なため「次へ」 フォールバック
    completeWhen: undefined,
  },
  {
    id: 'scaffold-move',
    targetSelector: '[data-tutorial-id="ashiba-button"]',
    title: '8. 足場を移動',
    description:
      '「足場」 → 「移動」 で、部材を範囲選択してまとめて動かせます。カテゴリ別に対象を絞れます。',
    completeWhen: (ctx) => ctx.mode === 'move-select',
  },
  {
    id: 'area-calc',
    targetSelector: '[data-tutorial-id="ashiba-button"]',
    title: '9. 平米計算',
    description:
      '最後に「足場」 → 「平米計算」 で、建物の延べ床㎡や足場の面積を確認できます。これでチュートリアルは完了です！',
    completeWhen: (ctx) => ctx.showAreaCalcModal === true,
  },
];

/** Phase 2 完成時の総ステップ数 (= UI に「N/9」 で表示) */
export const TOTAL_STEPS = 9;
