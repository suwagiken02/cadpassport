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
  /** 壁方向入力の頂点数 (= 最初のタップでスタート位置決定 → 1、 壁を追加ごとに +1) */
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

/** grid 座標の点 */
export type GridPoint = { x: number; y: number };

/**
 * チュートリアル 1 ステップの定義。
 * - targetSelector: ハイライト対象 (= data-tutorial-id セレクタ)。 null は Konva/canvas 操作で枠なし。
 * - priorityTargetSelector / fallbackTargetSelector: 優先 / 代替ハイライト。
 * - iconHint: balloon に大きく点滅表示する誘導アイコン (= ↑ → 👆 等。 方向ボタン誘導用)。
 * - arrowTarget: canvas 上の交点を 👇 で指す対象 (= grid 座標)。 directionPoints から算出。 null で矢印なし。
 * - completeWhen / completeWhenDom: 完了条件。 autoAdvance: true で「次へ」を隠す。 dimmed: false で暗幕を薄く。
 */
export type TutorialStep = {
  id: string;
  targetSelector: string | null;
  priorityTargetSelector?: string | null;
  fallbackTargetSelector?: string | null;
  iconHint?: string;
  arrowTarget?: (directionPoints: GridPoint[]) => GridPoint | null;
  title: string;
  description: string;
  completeWhen?: (ctx: TutorialContext) => boolean;
  completeWhenDom?: () => boolean;
  autoAdvance: boolean;
  dimmed?: boolean;
};

const KUTAI_BUTTON = '[data-tutorial-id="kutai-button"]';
const ASHIBA_BUTTON = '[data-tutorial-id="ashiba-button"]';
const ADD_WALL = '[data-tutorial-id="building-add-wall"]';

/** build-wall-down: 下タップで進む「次の交点」 = 現在の列 × 始点の行 (= 正方形の 3 つ目の角) */
export function downTapTarget(dp: GridPoint[]): GridPoint | null {
  if (dp.length < 3) return null;
  const last = dp[dp.length - 1];
  const start = dp[0];
  return { x: last.x, y: start.y };
}

/** build-close: 始点 (= 赤い点) に戻って閉じる */
export function startPointTarget(dp: GridPoint[]): GridPoint | null {
  return dp[0] ?? null;
}

/**
 * Phase A.6: 建物作成を「操作の性質の違い」で 5 分割
 * (始点タップ / 方向ボタン↑ / 方向ボタン→ / 交点タップ↓ / 始点で閉じる)。 計 26 ステップ。
 * 交点タップ (build-wall-down) と閉じ (build-close) は canvas 上の交点を 👇 矢印で指す。
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
    iconHint: '👆',
    title: '5. スタート位置を決める',
    description: 'キャンバスをタップして、建物の最初の角（スタート位置）を決めてください。赤い「始点」が置かれます。',
    completeWhen: (ctx) => ctx.directionPointsLength > 0,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'build-wall-up',
    targetSelector: null,
    iconHint: '↑',
    title: '6. 上に1辺（方向ボタン）',
    description:
      'キャンバスの「↑（上）」方向ボタンを押し、長さ（例: 3000）を選んで「壁を追加」を押してください。これが「方向ボタンで引く」操作です。',
    completeWhen: (ctx) => ctx.directionPointsLength >= 2,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'build-wall-right',
    targetSelector: null,
    iconHint: '→',
    title: '7. 右に1辺（方向ボタン）',
    description: '同じく「→（右）」方向ボタンを押し、長さを選んで「壁を追加」を押してください。',
    completeWhen: (ctx) => ctx.directionPointsLength >= 3,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'build-wall-down',
    targetSelector: null,
    arrowTarget: downTapTarget,
    title: '8. 下に1辺（交点をタップ）',
    description:
      '今度は方向ボタンではなく、👇 が指す「交点」を直接タップしてみましょう。長さを選んで「壁を追加」を押すと、その交点まで壁が引けます（交点タップで進む操作）。',
    completeWhen: (ctx) => ctx.directionPointsLength >= 4,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'build-close',
    targetSelector: null,
    arrowTarget: startPointTarget,
    title: '9. 始点をタップして閉じる',
    description: '最後に 👇 が指す「赤い始点」をタップすると、建物が閉じて完成します（始点で閉じる操作）。',
    completeWhen: (ctx) => ctx.canvasData.buildings.length > 0,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'roof-input',
    targetSelector: '[data-tutorial-id="roof-overhang-input"]',
    title: '10. 軒の出を変更',
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
    title: '11. 屋根設定を確定',
    description: '「設定する」ボタン（光っています）を押して、屋根の変更を確定してください。',
    completeWhen: (ctx) => ctx.canvasData.buildings.some((b) => b.roof?.uniformMm === 500),
    autoAdvance: true,
  },
  {
    id: 'obstacle-select',
    targetSelector: '[data-tutorial-id="kutai-obstacle"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '12. 障害物モードにする',
    description: '「躯体」ボタンを押してメニューを開き、「障害物」を押してください。',
    completeWhen: (ctx) => ctx.mode === 'obstacle',
    autoAdvance: true,
  },
  {
    id: 'obstacle-type',
    targetSelector: '[data-tutorial-id="obstacle-type-ecocute"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '13. 障害物の種類を選ぶ',
    description: 'パレットから種類（エコキュート等）を選んでください。選ぶと配置用のプレビューが出ます。',
    completeWhen: undefined,
    autoAdvance: true,
  },
  {
    id: 'obstacle-place',
    targetSelector: '[data-tutorial-id="obstacle-place-area"]',
    title: '14. 障害物を配置',
    description: 'プレビュー部分（光っています）をキャンバスにドラッグして配置してください。',
    completeWhen: (ctx) => ctx.canvasData.obstacles.length > 0,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'obstacle-close',
    targetSelector: KUTAI_BUTTON,
    title: '15. 障害物パレットを閉じる',
    description: '配置できたら「躯体」ボタンを押して、障害物パレットを閉じてください。',
    completeWhen: (ctx) => ctx.mode !== 'obstacle',
    autoAdvance: true,
  },
  {
    id: 'height-open',
    targetSelector: '[data-tutorial-id="kutai-height"]',
    fallbackTargetSelector: KUTAI_BUTTON,
    title: '16. 高さモードにする',
    description: '「躯体」ボタンを押してメニューを開き、「高さ」を押してください。',
    completeWhen: (ctx) => ctx.isHeightMarkerMode === true,
    autoAdvance: true,
  },
  {
    id: 'height-tap',
    targetSelector: null,
    iconHint: '👆',
    title: '17. 高さの位置をタップ',
    description: '屋根の破線（建物の外周）をタップしてください。高さ入力欄が開きます。',
    completeWhen: (ctx) => ctx.heightInputMarkerId != null,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'height-input',
    targetSelector: '[data-tutorial-id="height-input"]',
    title: '18. 軒高を入力',
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
    title: '19. 高さを確定',
    description: '「OK」ボタンを押して、高さを確定してください。',
    completeWhen: (ctx) => ctx.heightInputMarkerId == null,
    autoAdvance: true,
  },
  {
    id: 'scaffold-start-open',
    targetSelector: '[data-tutorial-id="ashiba-start"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '20. 足場開始を開く',
    description: '「足場」ボタンを押してメニューを開いてください。メニューをスクロールして「足場開始」を押します。',
    completeWhen: (ctx) => ctx.showScaffoldStart === true,
    autoAdvance: true,
  },
  {
    id: 'scaffold-start-confirm',
    targetSelector: '[data-tutorial-id="scaffold-start-confirm"]',
    title: '21. 足場開始位置を確定',
    description: '開始する頂点を選び、離れを入力して「足場開始」ボタンで確定してください。',
    completeWhen: (ctx) => !!ctx.canvasData.scaffoldStart1F || !!ctx.canvasData.scaffoldStart2F,
    autoAdvance: true,
    dimmed: false,
  },
  {
    id: 'autolayout-open',
    targetSelector: '[data-tutorial-id="ashiba-autolayout"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '22. 自動配置を開く',
    description: '「足場」ボタンを押してメニューを開き、「自動配置」を押してください。',
    completeWhen: (ctx) => ctx.showAutoLayout === true,
    autoAdvance: true,
  },
  {
    id: 'autolayout-calc',
    targetSelector: '[data-tutorial-id="autolayout-calc"]',
    title: '23. 足場を計算',
    description: '各辺の離れを設定して「計算する」ボタンを押してください。',
    completeWhen: undefined,
    autoAdvance: true,
  },
  {
    id: 'autolayout-place',
    targetSelector: '[data-tutorial-id="autolayout-place"]',
    priorityTargetSelector: '[data-tutorial-id="autolayout-conflict-ok"]',
    title: '24. 足場を配置',
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
    title: '25. 足場の入れ替え（任意）',
    description:
      '「足場」→「入れ替え」で、色分けされた手摺ライン（同一直線上に2本以上ある辺）をタップすると並べ替えモーダルが開きます。順番を入れ替えて確定し「終了」してから「次へ」を押してください。（任意）',
    completeWhen: undefined,
    autoAdvance: false,
  },
  {
    id: 'areacalc',
    targetSelector: '[data-tutorial-id="ashiba-areacalc"]',
    fallbackTargetSelector: ASHIBA_BUTTON,
    title: '26. 平米を計算',
    description: '「足場」ボタンを押してメニューを開き、「平米計算」を押すと面積を確認できます。これで完了です！',
    completeWhen: (ctx) => ctx.showAreaCalcModal === true,
    autoAdvance: true,
  },
];

/** Phase A.6 完成時の総ステップ数 (= UI に「N/26」 で表示) */
export const TOTAL_STEPS = TUTORIAL_STEPS.length;
