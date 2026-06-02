import type { CanvasData } from '@/types';

/**
 * チュートリアル 1 ステップの完了判定に使う context。
 * useCanvasStore + useTutorialStore の subset (= テストしやすいよう純データのみ)。
 */
export type TutorialContext = {
  canvasData: CanvasData;
  mode: string;
  showSettings: boolean;
  showSettingsPanel: boolean;
  /** step 平米計算 完了検知用 */
  showAreaCalcModal: boolean;
  /** step 建物 (= 躯体メニュー「建物1F」押下で建物モーダルが開く) 検知用 */
  showBuildingModal: boolean;
  /** step 屋根 (= 建物作成時に自動で屋根設定が開く) 検知の補助。 完了は uniformMm で判定 */
  autoOpenRoofForBuildingId: string | null;
  /** step 自動配置 完了検知用 (= 自動配置ステップ突入時の handrails 本数 snapshot) */
  handrailsBeforeAutolayout: number | null;
  /** step1 設定 完了検知用 (= 設定を一度開いた once flag) */
  settingsOpenedOnce: boolean;
};

/**
 * チュートリアル 1 ステップの定義。
 * - id: ステップ識別子
 * - targetSelector: ハイライト対象 (= data-tutorial-id 属性の CSS セレクタ)。
 *   null の場合は Konva canvas 操作など DOM ハイライト不可のステップ (= balloon テキストで誘導)。
 * - title / description: 吹き出しの文言 (= CAD 初心者向け平易な日本語)
 * - completeWhen: 完了条件 (= true で自動次ステップへ)。 undefined なら DOM ポーリング or「次へ」で進む
 * - autoAdvance: 操作で進行するステップ (= true なら「次へ」ボタンを隠し、 操作完了でのみ進行)。
 *   false なら解説ステップ (=「次へ」ボタンで進める)。
 *   completeWhen=undefined かつ autoAdvance=true のステップは、 次ステップの target が DOM 出現したら自動進行 (= submenu を開く誘導)。
 */
export type TutorialStep = {
  id: string;
  targetSelector: string | null;
  title: string;
  description: string;
  completeWhen?: (ctx: TutorialContext) => boolean;
  autoAdvance: boolean;
};

/**
 * Phase A.1 + B: submenu 親ボタン誘導を細分化 + DOM ポーリング自動進行 + 操作完了強制。
 * 計 13 ステップ (= 移動 (move-select) は複雑度が高いため Phase B 以降)。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'settings',
    targetSelector: '[data-tutorial-id="settings-button"]',
    title: '1. 設定を開いて閉じる',
    description:
      '右下の「設定」ボタンを押して設定パネルを開いてみましょう。ダークモードや寸法表示などを切り替えられます。確認したら ✕ で閉じてください（閉じると次へ進みます）。',
    completeWhen: (ctx) => ctx.settingsOpenedOnce === true && ctx.showSettings === false,
    autoAdvance: true,
  },
  {
    id: 'kutai-open',
    targetSelector: '[data-tutorial-id="kutai-button"]',
    title: '2. 躯体メニューを開く',
    description:
      '下の「躯体」ボタン（光っています）を押して、メニューを開いてください。',
    completeWhen: undefined,
    autoAdvance: true,
  },
  {
    id: 'building-select',
    targetSelector: '[data-tutorial-id="kutai-building1f"]',
    title: '3. 建物1Fを選ぶ',
    description:
      'メニュー内の「建物1F」を押してください。建物作成のモーダルが開きます。',
    completeWhen: (ctx) => ctx.showBuildingModal === true,
    autoAdvance: true,
  },
  {
    id: 'wallinput-tab',
    targetSelector: '[data-tutorial-id="building-wallinput-tab"]',
    title: '4. 壁方向入力に切り替え',
    description:
      'モーダル上部の「壁方向入力」タブを押してください。キャンバスで方向と長さを指定して建物を描くモードになります。',
    completeWhen: (ctx) => ctx.mode === 'building',
    autoAdvance: true,
  },
  {
    id: 'build-canvas',
    targetSelector: null,
    title: '5. 建物の外周を描く',
    description:
      '画面下の数値ボタンで長さ（例: 3000）を選び、方向ボタン（↑→↓←）で壁を伸ばします。これを繰り返し、最後に開始点（オレンジの交点マーカー）をタップすると建物が閉じて完成します。',
    completeWhen: (ctx) => ctx.canvasData.buildings.length > 0,
    autoAdvance: true,
  },
  {
    id: 'roof',
    targetSelector: '[data-tutorial-id="roof-overhang-input"]',
    title: '6. 屋根の軒の出を変更',
    description:
      '建物を作ると屋根設定が自動で開きます。「出幅(mm)」を 600 から 500 に変更して「設定する」を押してください。（開いていない場合は躯体メニューの「屋根」→建物をタップ）',
    completeWhen: (ctx) => ctx.canvasData.buildings.some((b) => b.roof?.uniformMm === 500),
    autoAdvance: true,
  },
  {
    id: 'obstacle-select',
    targetSelector: '[data-tutorial-id="kutai-obstacle"]',
    title: '7. 障害物モードにする',
    description:
      '「躯体」ボタンを押してメニューを開き、「障害物」を押してください。エコキュートや室外機などを配置できるモードになります。',
    completeWhen: (ctx) => ctx.mode === 'obstacle',
    autoAdvance: true,
  },
  {
    id: 'obstacle-place',
    targetSelector: null,
    title: '8. 障害物を配置',
    description:
      '画面下のパレットから種類（エコキュート等）を選び、キャンバスにドラッグして配置してください。',
    completeWhen: (ctx) => ctx.canvasData.obstacles.length > 0,
    autoAdvance: true,
  },
  {
    id: 'height',
    targetSelector: '[data-tutorial-id="kutai-height"]',
    title: '9. 高さを設定',
    description:
      '「躯体」ボタンを押してメニューを開き、「高さ」を押します。建物の辺をタップして軒高（例: 6000）を入力してください。',
    completeWhen: (ctx) => (ctx.canvasData.heightMarkers ?? []).length > 0,
    autoAdvance: true,
  },
  {
    id: 'scaffold-start',
    targetSelector: '[data-tutorial-id="ashiba-start"]',
    title: '10. 足場開始位置を設定',
    description:
      '「足場」ボタンを押してメニューを開き、「足場開始」を押します。開始する頂点を選んで離れを入力し「足場開始」で確定してください。',
    completeWhen: (ctx) => !!ctx.canvasData.scaffoldStart1F || !!ctx.canvasData.scaffoldStart2F,
    autoAdvance: true,
  },
  {
    id: 'autolayout',
    targetSelector: '[data-tutorial-id="ashiba-autolayout"]',
    title: '11. 自動配置で足場を組む',
    description:
      '「足場」ボタンを押してメニューを開き、「自動配置」を押します。各辺の離れを設定して「配置する」を押すと、外周に手摺・支柱が一括配置されます。',
    completeWhen: (ctx) =>
      ctx.handrailsBeforeAutolayout != null &&
      ctx.canvasData.handrails.length > ctx.handrailsBeforeAutolayout,
    autoAdvance: true,
  },
  {
    id: 'reorder',
    targetSelector: '[data-tutorial-id="ashiba-reorder"]',
    title: '12. 足場の入れ替え（任意）',
    description:
      '「足場」ボタン → 「入れ替え」で、同じラインの手摺の並び順を入れ替えられます。試したら「終了」して「次へ」を押してください。（任意のためスキップ可）',
    // 入れ替えは任意 + toggle で完了タイミングが曖昧なため「次へ」 フォールバック
    completeWhen: undefined,
    autoAdvance: false,
  },
  {
    id: 'areacalc',
    targetSelector: '[data-tutorial-id="ashiba-areacalc"]',
    title: '13. 平米を計算',
    description:
      '「足場」ボタンを押してメニューを開き、「平米計算」を押すと、建物の延べ床㎡や足場の面積を確認できます。これでチュートリアルは完了です！',
    completeWhen: (ctx) => ctx.showAreaCalcModal === true,
    autoAdvance: true,
  },
];

/** Phase A.1+B 完成時の総ステップ数 (= UI に「N/13」 で表示) */
export const TOTAL_STEPS = TUTORIAL_STEPS.length;
