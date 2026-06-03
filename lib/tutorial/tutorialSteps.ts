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
  showAreaCalcModal: boolean;
  showBuildingModal: boolean;
  autoOpenRoofForBuildingId: string | null;
  handrailsBeforeAutolayout: number | null;
  settingsOpenedOnce: boolean;
  /** 壁方向入力の頂点数 (= 最初のタップでスタート位置決定 → 1 になる) */
  directionPointsLength: number;
  /** 高さマーカーモード中か (= 躯体→高さ で true) */
  isHeightMarkerMode: boolean;
  /** 高さ入力モーダルの対象 marker id (= 破線タップで non-null、 OK で null) */
  heightInputMarkerId: string | null;
  /** 足場開始モーダル表示中か */
  showScaffoldStart: boolean;
  /** 自動配置モーダル表示中か */
  showAutoLayout: boolean;
};

/**
 * チュートリアル 1 ステップの定義。
 * - targetSelector: ハイライト対象 (= data-tutorial-id セレクタ)。 null は Konva/canvas 操作で枠なし。
 * - fallbackTargetSelector: primary 不在時の代替ハイライト (= submenu 項目の親ボタン)。
 * - completeWhen: store ベース完了条件。 completeWhenDom: DOM 値ベース完了条件 (500ms 評価)。
 *   両方 undefined + autoAdvance=true は「次ステップ target が DOM 出現」で進む (= submenu 開く誘導)。
 * - autoAdvance: true で「次へ」を隠し操作完了でのみ進行。
 * - dimmed: false で暗幕を薄く (= Konva/モーダル操作で図面を見せる)。 省略時 true (= 濃い暗幕)。
 */
export type TutorialStep = {
  id: string;
  targetSelector: string | null;
  fallbackTargetSelector?: string | null;
  title: string;
  description: string;
  completeWhen?: (ctx: TutorialContext) => boolean;
  completeWhenDom?: () => boolean;
  autoAdvance: boolean;
  dimmed?: boolean;
};

const KUTAI_BUTTON = '[data-tutorial-id="kutai-button"]';
const ASHIBA_BUTTON = '[data-tutorial-id="ashiba-button"]';

/**
 * Phase A.3: モーダル内操作を独立ステップに細分化 (= fallback 誤点滅の解消) +
 * スタート位置タップ / 障害物2段階 / 高さ3分割 / 足場開始・自動配置のモーダル確定 + 暗幕調整。 計 23 ステップ。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'settings',
    targetSelector: '[data-tutorial-id="settings-button"]',
    title: '1. 設定を開いて閉じる',
    description:
      '右下の「設定」ボタンを押して設定パネルを開いてみましょう。確認したら ✕ で閉じてください（閉じると次へ進みます）。',
    completeWhen: (ctx) => ctx.settingsOpenedOnce === true && ctx.showSettings === false,
    autoAdvance: true,
  },
  {
    id: 'kutai-open',
    targetSelector: KUTAI_BUTTON,
    title: '2. 躯体メニューを開く',
    description: '下の「躯体」ボタン（光っています）を押して、メニューを開いてください。',
    completeWhen: undefined,
    autoAdvance: true,
  },
  {
    id: 'building-select',
    targetSelector: '[data-tutorial-id="kutai-building1f"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '3. 建物1Fを選ぶ',
    description: 'メニュー内の「建物1F」を押してください。建物作成のモーダルが開きます。',
    completeWhen: (ctx) => ctx.showBuildingModal === true,
    autoAdvance: true,
  },
  {
    id: 'wallinput-tab',
    targetSelector: '[data-tutorial-id="building-wallinput-tab"]',
    title: '4. 壁方向入力に切り替え',
    description: 'モーダル上部の「壁方向入力」タブを押してください。キャンバスで建物を描くモードになります。',
    completeWhen: (ctx) => ctx.mode === 'building',
    autoAdvance: true,
  },
  {
    id: 'build-start',
    targetSelector: null,
    title: '5. スタート位置を決める',
    description: 'キャンバスをタップして、建物の最初の角（スタート位置）を決めてください。',
    completeWhen: (ctx) => ctx.directionPointsLength > 0,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'build-canvas',
    targetSelector: null,
    title: '6. 建物の外周を描く',
    description:
      '数値ボタンで長さ（例: 3000）を選び、方向ボタン（↑→↓←）で壁を伸ばします。繰り返して、最後に開始点（オレンジの交点）をタップすると建物が閉じて完成します。',
    completeWhen: (ctx) => ctx.canvasData.buildings.length > 0,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'roof-input',
    targetSelector: '[data-tutorial-id="roof-overhang-input"]',
    title: '7. 軒の出を変更',
    description:
      '建物を作ると屋根設定が自動で開きます。「出幅(mm)」を 600 から 500 に変更してください。',
    completeWhenDom: () => {
      const el = document.querySelector('[data-tutorial-id="roof-overhang-input"] input') as HTMLInputElement | null;
      return el?.value === '500';
    },
    autoAdvance: true,
  },
  {
    id: 'roof-confirm',
    targetSelector: '[data-tutorial-id="roof-confirm"]',
    title: '8. 屋根設定を確定',
    description: '「設定する」ボタン（光っています）を押して、屋根の変更を確定してください。',
    completeWhen: (ctx) => ctx.canvasData.buildings.some((b) => b.roof?.uniformMm === 500),
    autoAdvance: true,
  },
  {
    id: 'obstacle-select',
    targetSelector: '[data-tutorial-id="kutai-obstacle"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '9. 障害物モードにする',
    description: '「躯体」ボタンを押してメニューを開き、「障害物」を押してください。',
    completeWhen: (ctx) => ctx.mode === 'obstacle',
    autoAdvance: true,
  },
  {
    id: 'obstacle-type',
    targetSelector: '[data-tutorial-id="obstacle-type-ecocute"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '10. 障害物の種類を選ぶ',
    description: 'パレットから種類（エコキュート等）を選んでください。選ぶと配置用のプレビューが出ます。',
    completeWhen: undefined,
    autoAdvance: true,
  },
  {
    id: 'obstacle-place',
    targetSelector: '[data-tutorial-id="obstacle-place-area"]',
    title: '11. 障害物を配置',
    description: 'プレビュー部分（光っています）をキャンバスにドラッグして配置してください。',
    completeWhen: (ctx) => ctx.canvasData.obstacles.length > 0,
    autoAdvance: true,
  },
  {
    id: 'obstacle-close',
    targetSelector: null,
    title: '12. 障害物パレットを閉じる',
    description: '配置できたら「選択」ボタンを押して、障害物パレットを閉じてください。',
    completeWhen: (ctx) => ctx.mode !== 'obstacle',
    autoAdvance: true,
  },
  {
    id: 'height-open',
    targetSelector: '[data-tutorial-id="kutai-height"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '13. 高さモードにする',
    description: '「躯体」ボタンを押してメニューを開き、「高さ」を押してください。',
    completeWhen: (ctx) => ctx.isHeightMarkerMode === true,
    autoAdvance: true,
  },
  {
    id: 'height-tap',
    targetSelector: null,
    title: '14. 高さの位置をタップ',
    description: '屋根の破線（建物の外周）をタップしてください。高さ入力欄が開きます。',
    completeWhen: (ctx) => ctx.heightInputMarkerId != null,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'height-input',
    targetSelector: '[data-tutorial-id="height-input"]',
    title: '15. 軒高を入力',
    description:
      '軒高（例: 6000）を入力してください。※すべて同じ高さなら1か所でOK。切妻などは頂点と下端を入力すると、その間は斜めに保持されます。',
    completeWhenDom: () => {
      const el = document.querySelector('[data-tutorial-id="height-input"] input') as HTMLInputElement | null;
      return !!el && el.value !== '' && Number(el.value) > 0;
    },
    autoAdvance: true,
  },
  {
    id: 'height-ok',
    targetSelector: '[data-tutorial-id="height-ok"]',
    title: '16. 高さを確定',
    description: '「OK」ボタンを押して、高さを確定してください。',
    completeWhen: (ctx) => ctx.heightInputMarkerId == null,
    autoAdvance: true,
  },
  {
    id: 'scaffold-start-open',
    targetSelector: '[data-tutorial-id="ashiba-start"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '17. 足場開始を開く',
    description: '「足場」ボタンを押してメニューを開いてください。メニューをスクロールして「足場開始」を押します。',
    completeWhen: (ctx) => ctx.showScaffoldStart === true,
    autoAdvance: true,
  },
  {
    id: 'scaffold-start-confirm',
    targetSelector: '[data-tutorial-id="scaffold-start-confirm"]',
    title: '18. 足場開始位置を確定',
    description: '開始する頂点を選び、離れを入力して「足場開始」ボタンで確定してください。',
    completeWhen: (ctx) => !!ctx.canvasData.scaffoldStart1F || !!ctx.canvasData.scaffoldStart2F,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'autolayout-open',
    targetSelector: '[data-tutorial-id="ashiba-autolayout"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '19. 自動配置を開く',
    description: '「足場」ボタンを押してメニューを開き、「自動配置」を押してください。',
    completeWhen: (ctx) => ctx.showAutoLayout === true,
    autoAdvance: true,
  },
  {
    id: 'autolayout-calc',
    targetSelector: '[data-tutorial-id="autolayout-calc"]',
    title: '20. 足場を計算',
    description: '各辺の離れを設定して「計算する」ボタンを押してください。',
    completeWhen: undefined,
    autoAdvance: true,
  },
  {
    id: 'autolayout-place',
    targetSelector: '[data-tutorial-id="autolayout-place"]',
    title: '21. 足場を配置',
    description:
      '「配置する」ボタンを押して足場を配置してください。干渉の警告が出たら「削除して配置」を押してください。',
    completeWhen: (ctx) =>
      ctx.handrailsBeforeAutolayout != null &&
      ctx.canvasData.handrails.length > ctx.handrailsBeforeAutolayout,
    autoAdvance: true,
  },
  {
    id: 'reorder',
    targetSelector: '[data-tutorial-id="ashiba-reorder"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '22. 足場の入れ替え（任意）',
    description:
      '「足場」→「入れ替え」で、色分けされた手摺ライン（同一直線上に2本以上ある辺）をタップすると並べ替えモーダルが開きます。順番を入れ替えて確定し「終了」してから「次へ」を押してください。（任意）',
    completeWhen: undefined,
    autoAdvance: false,
  },
  {
    id: 'areacalc',
    targetSelector: '[data-tutorial-id="ashiba-areacalc"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '23. 平米を計算',
    description: '「足場」ボタンを押してメニューを開き、「平米計算」を押すと面積を確認できます。これで完了です！',
    completeWhen: (ctx) => ctx.showAreaCalcModal === true,
    autoAdvance: true,
  },
];

/** Phase A.3 完成時の総ステップ数 (= UI に「N/23」 で表示) */
export const TOTAL_STEPS = TUTORIAL_STEPS.length;
