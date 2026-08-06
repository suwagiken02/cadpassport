'use client';

import { create } from 'zustand';
import {
  CanvasData,
  ModeType,
  BuildingShape,
  Handrail,
  Post,
  Anti,
  Obstacle,
  Memo,
  RoofOverhang,
  Roof,
  AntiWidth,
  HandrailLengthMm,
  HandrailDirection,
  BuildingInputMethod,
  ScaffoldStartConfig,
  MemoShape,
  MagnetPin,
  HeightMarker,
  RidgeLine,
  ElevationView,
  DimensionLineKey,
  DEFAULT_DIMENSION_OFFSETS_MM,
} from '@/types';
import { PinAnchor } from '@/lib/magnetPin/anchorPoints';
import { DEFAULT_COLS, DEFAULT_ROWS, INITIAL_GRID_PX, ZOOM_MIN, ZOOM_MAX } from '@/lib/konva/gridUtils';
// フェーズ0: 行動計測（非ブロッキング・本番のみ送信）。
import { track } from '@/lib/analytics';
import type { Point } from '@/types';
import {
  collectSelectionSubset, instantiateSubset, mergePayloadIntoCanvas, payloadCount, payloadIds,
  type CrossPagePayload,
} from '@/lib/pages/crossPageCopy';
import { computeContentBounds } from '@/lib/pages/contentBounds';
import { liftLegacyRoofs } from '@/lib/konva/roofResolve';
import { rematchElevationEdits } from '@/lib/konva/elevation/elevationRematch';
import { rematchElevationParts } from '@/lib/konva/elevation/elevationPartsRematch';
import { facePartsForCanvas } from '@/lib/konva/elevation/faceElevationForCanvas';
import { defaultPartSize, hasLegacyFullWidthParts } from '@/lib/konva/elevation/elevationParts';

/** スキーマ版数。R-1b: 高さマーカーを壁線基準に再解釈した節目として '2.0'。
 *  version は分岐に使わず記録のみ（旧データも normalize 時に '2.0' へ押し上げる）。 */
const CANVAS_SCHEMA_VERSION = '2.0';

const createEmptyCanvasData = (): CanvasData => ({
  version: CANVAS_SCHEMA_VERSION,
  grid: { unitMm: 10, cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
  buildings: [],
  roofOverhangs: [],
  roofs: [],
  obstacles: [],
  handrails: [],
  posts: [],
  antis: [],
  memos: [],
  compass: { angle: 0 },
  magnetPins: [],
  heightMarkers: [],
  ridgeLines: [],
  elevationViews: [],
});

/** 互換: 旧プロジェクトで欠落しているフィールドを補完する */
const normalizeCanvasData = (data: CanvasData): CanvasData => {
  const normalized: CanvasData = {
    ...data,
    version: CANVAS_SCHEMA_VERSION, // R-1b: 壁線基準への再解釈の目印（分岐処理はしない）
    // R-1d: roofs 未定義の旧データは building.roof / roofOverhangs[] から Roof へ lift（1回のみ）。
    //   既に roofs があれば尊重（再 lift しない）。building.roof は当面残す（R-1g で削除予定）。
    // R-1e-fix7: polygon 未設定（旧 span/edgeRange 方式）の roof は建物外周 polygon へ backfill。
    roofs: (data.roofs ?? liftLegacyRoofs(data.buildings, data.roofOverhangs ?? [])).map((r) => {
      if (r.polygon && r.polygon.length >= 3) return r;
      const b = data.buildings.find((bb) => bb.id === r.buildingId);
      return b ? { ...r, polygon: b.points.map((p) => ({ x: p.x, y: p.y })) } : r;
    }),
    magnetPins: data.magnetPins ?? [],
    heightMarkers: data.heightMarkers ?? [],
    ridgeLines: data.ridgeLines ?? [],
    elevationViews: data.elevationViews ?? [],
    dimensionOffsetsMm: data.dimensionOffsetsMm ?? { ...DEFAULT_DIMENSION_OFFSETS_MM },
  };
  // 旧 scaffoldStart → scaffoldStart1F / scaffoldStart2F への移行。
  // 既に 1F/2F 側が入っていればそちらを優先（二重上書きしない）。
  if (data.scaffoldStart) {
    const floor = data.scaffoldStart.floor ?? 1;
    if (floor === 1 && !normalized.scaffoldStart1F) {
      normalized.scaffoldStart1F = data.scaffoldStart;
    } else if (floor === 2 && !normalized.scaffoldStart2F) {
      normalized.scaffoldStart2F = data.scaffoldStart;
    }
  }
  return normalized;
};

type HistoryState = {
  past: CanvasData[];
  future: CanvasData[];
};

type CanvasStore = {
  // Drawing ID
  drawingId: string | null;
  projectId: string | null;
  setDrawingId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;

  // Canvas data
  canvasData: CanvasData;
  setCanvasData: (data: CanvasData, loadedDrawingId?: string | null) => void;
  /**
   * いま canvasData に入っているデータがどの図面のものか (E-7-fix2)。
   * ページ遷移直後は drawingId だけ先に新ページへ変わり、canvasData は非同期ロードが終わるまで
   * 前ページのものが残る。その窓で保存すると別ページの内容を書き込んでしまうため、
   * 保存側はこれと drawingId の一致を確認する。null = どの図面のものか不明(保存禁止)。
   */
  loadedDrawingId: string | null;
  /** 寸法線オフセット mm 更新 (= 寸法線移動、 種別ごと相対 delta) */
  setDimensionOffsetMm: (key: DimensionLineKey, mm: number) => void;
  /** 現場切替時の作業 state 一括リセット (= #5、 modal/mode/selection/preview/history 等を初期化、 表示トグル/部材選択値/zoom 等は維持) */
  resetForDrawingChange: () => void;

  // Mode
  mode: ModeType;
  setMode: (mode: ModeType) => void;
  buildingInputMethod: BuildingInputMethod;
  setBuildingInputMethod: (m: BuildingInputMethod) => void;
  /** マグネットピン配置モード（M-3a）: ModeType とは独立した副次フラグ */
  isMagnetPinMode: boolean;
  setMagnetPinMode: (v: boolean) => void;
  /** ピン配置の選択中起点（M-3b） */
  pinAnchor: PinAnchor | null;
  setPinAnchor: (anchor: PinAnchor | null) => void;
  /** ピン配置: anchor からの相対オフセット (mm)（M-3c） */
  pinDraftOffset: { dx: number; dy: number } | null;
  setPinDraftOffset: (offset: { dx: number; dy: number } | null) => void;
  /** ピン配置: 数値入力モーダルが開いてる方向（M-3c） */
  pinDirectionInput: 'up' | 'down' | 'left' | 'right' | null;
  setPinDirectionInput: (dir: 'up' | 'down' | 'left' | 'right' | null) => void;

  // Selection
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;

  // クリップボード（E-6c）: 選択オブジェクトのコピー/切り取り/貼り付け。
  //   subset は id 振り直し前の素の集合、origin は貼り付けオフセット基準（bbox 左上）。
  //   store は module singleton なのでタブ切替（router.push）を生き延びる。
  clipboard: { subset: CrossPagePayload; origin: Point } | null;
  copySelection: () => void;
  cutSelection: () => void;
  /** anchorGrid を基準に貼り付け（相対配置を保持。pushHistory で undo 可）。 */
  pasteClipboard: (anchorGrid: Point) => void;
  /** キャンバス右クリック/長押しのコンテキストメニュー（E-6c）。gridAnchor は貼り付け位置。 */
  contextMenu: { clientX: number; clientY: number; gridAnchor: Point } | null;
  openContextMenu: (cm: { clientX: number; clientY: number; gridAnchor: Point }) => void;
  closeContextMenu: () => void;
  selectedHandrailLength: HandrailLengthMm;
  setSelectedHandrailLength: (l: HandrailLengthMm) => void;
  selectedAntiWidth: AntiWidth;
  setSelectedAntiWidth: (w: AntiWidth) => void;
  selectedAntiLength: number;
  setSelectedAntiLength: (l: number) => void;

  // Handrail drag preview & snap
  handrailPreview: { x: number; y: number; lengthMm: number; direction: HandrailDirection } | null;
  setHandrailPreview: (p: { x: number; y: number; lengthMm: number; direction: HandrailDirection } | null) => void;
  snapPoint: { x: number; y: number } | null;
  setSnapPoint: (p: { x: number; y: number } | null) => void;

  // Obstacle drag preview
  obstaclePreview: { x: number; y: number; widthGrid: number; heightGrid: number; type: import('@/types').ObstacleType } | null;
  setObstaclePreview: (p: { x: number; y: number; widthGrid: number; heightGrid: number; type: import('@/types').ObstacleType } | null) => void;

  // 壁方向入力モード
  directionPoints: { x: number; y: number }[];
  directionPointsHistory: { x: number; y: number }[][];
  lastCompletedDirectionSession: { points: { x: number; y: number }[] } | null;
  addDirectionPoint: (p: { x: number; y: number }) => void;
  undoDirectionPoint: () => void;
  removeLastDirectionPoint: () => void;
  clearDirectionPoints: () => void;
  setDirectionPoints: (points: { x: number; y: number }[]) => void;
  setLastCompletedDirectionSession: (s: { points: { x: number; y: number }[] } | null) => void;
  // R-1g: autoOpenRoofForBuildingId（旧・屋根設定モーダルの自動オープン）は撤去。
  //   書き込み経路は R-1k で無くなり、旧モーダル自体も削除済み。
  pendingBuildingFloor: number;
  setPendingBuildingFloor: (f: number) => void;
  pendingTargetType: 'building' | 'obstacle' | 'roof';
  setPendingTargetType: (t: 'building' | 'obstacle' | 'roof') => void;
  pendingObstacleType: import('@/types').ObstacleType | null;
  setPendingObstacleType: (t: import('@/types').ObstacleType | null) => void;
  showDirectionInputModal: boolean;
  setShowDirectionInputModal: (show: boolean) => void;
  pendingDirection: 'up' | 'down' | 'left' | 'right' | null;
  setPendingDirection: (dir: 'up' | 'down' | 'left' | 'right' | null) => void;
  pendingDirectionTarget: { x: number; y: number } | null;
  setPendingDirectionTarget: (p: { x: number; y: number } | null) => void;
  /** 壁方向入力: キャラのみ移動した場合の現在位置 (= polygon 不変、 cursor のみ分離) */
  directionCursor: { x: number; y: number } | null;
  setDirectionCursor: (p: { x: number; y: number } | null) => void;
  /** 壁方向入力: トグル「壁を作らずキャラのみ移動」(= default false、 session 内保持、 clearDirectionPoints でリセット) */
  noWallMode: boolean;
  setNoWallMode: (v: boolean) => void;
  lastMoveDirection: 'up' | 'down' | 'left' | 'right';
  setLastMoveDirection: (dir: 'up' | 'down' | 'left' | 'right') => void;
  /** 方向入力モーダル 距離プリセット履歴 (= 直近 10 件 LRU、 hardcode 10 個で seed、 セッション内のみ) */
  directionDistanceHistory: number[];
  addDirectionDistanceHistory: (mm: number) => void;
  showDirectionGuide: boolean;
  toggleDirectionGuide: () => void;

  // Dimensions toggle
  showDimensions: boolean;
  toggleShowDimensions: () => void;
  setShowDimensions: (v: boolean) => void;
  showDimensionLines: boolean;
  toggleShowDimensionLines: () => void;
  setShowDimensionLines: (v: boolean) => void;
  /** キャンバス描画エリアのピクセルサイズ（EditorPage から同期） */
  canvasSize: { width: number; height: number };
  setCanvasSize: (size: { width: number; height: number }) => void;
  showGridGuide: boolean;
  toggleShowGridGuide: () => void;
  showPrintArea: boolean;
  toggleShowPrintArea: () => void;
  printPaperSize: import('@/types').PaperSize;
  printScale: import('@/types').ScaleOption;
  setPrintPaperSize: (s: import('@/types').PaperSize) => void;
  setPrintScale: (s: import('@/types').ScaleOption) => void;
  /** 印刷枠の中心位置（グリッド座標、null=建物中心に自動配置） */
  printAreaCenter: { x: number; y: number } | null;
  setPrintAreaCenter: (p: { x: number; y: number } | null) => void;
  /** 全ページ PDF の枠指定ウィザード (= E-7-fix3、 null=非実行)。ページ遷移をまたぐため store 管理。 */
  pdfWizard: import('@/lib/export/pdfWizard').PdfWizardState | null;
  setPdfWizard: (w: import('@/lib/export/pdfWizard').PdfWizardState | null) => void;
  updatePdfWizard: (patch: Partial<import('@/lib/export/pdfWizard').PdfWizardState>) => void;

  // Measurement
  isMeasuring: boolean;
  measurePoint1: { x: number; y: number } | null;
  measureCursor: { x: number; y: number } | null;
  measureResultMm: number | null;
  measurePoint2: { x: number; y: number } | null;
  measureAxisMode: 'free' | 'x' | 'y';
  setMeasureAxisMode: (mode: 'free' | 'x' | 'y') => void;
  toggleMeasuring: () => void;
  setMeasurePoint1: (p: { x: number; y: number } | null) => void;
  setMeasurePoint2: (p: { x: number; y: number } | null) => void;
  setMeasureCursor: (p: { x: number; y: number } | null) => void;
  setMeasureResultMm: (mm: number | null) => void;

  // Dark mode
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  initDarkMode: () => void;

  // Duplicate mode
  isDuplicateMode: boolean;
  toggleDuplicateMode: () => void;

  // Highlight (点滅表示)
  highlightIds: string[];
  setHighlightIds: (ids: string[]) => void;

  // 離れ表示
  showKidare: boolean;
  toggleShowKidare: () => void;

  // モーダル表示（ボトムナビから開く）
  showScaffoldStart: boolean;
  setShowScaffoldStart: (show: boolean) => void;
  showAutoLayout: boolean;
  setShowAutoLayout: (show: boolean) => void;
  /** 共通警告ダイアログのメッセージ (null=非表示) */
  alertMessage: string | null;
  setAlertMessage: (msg: string | null) => void;
  showBuildingModal: boolean;
  setShowBuildingModal: (show: boolean) => void;
  showBuilding2FModal: boolean;
  setShowBuilding2FModal: (show: boolean) => void;
  /** 電卓モーダル表示（ツールバー「電卓」ボタン） */
  showCalculator: boolean;
  setShowCalculator: (show: boolean) => void;
  /** 立面図モーダル表示（足場メニュー「立面図」ボタン・E-3） */
  showElevation: boolean;
  setShowElevation: (show: boolean) => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showPartSelector: boolean;
  togglePartSelector: () => void;
  showSettingsPanel: boolean;
  toggleSettingsPanel: () => void;

  // メモ作成
  memoDraft: { shape: MemoShape; text: string; angle: number; scaleX: number; scaleY: number } | null;
  setMemoDraft: (draft: { shape: MemoShape; text: string; angle: number; scaleX: number; scaleY: number } | null) => void;
  /** memoDraft の出所識別 (= 平米計算 Phase E-4a)。 'memo' = 既存 MemoCreateModal、 'area-calc' = 平米計算結果貼り付け */
  memoDraftSource: 'memo' | 'area-calc';
  setMemoDraftSource: (source: 'memo' | 'area-calc') => void;
  clearMemoDraft: () => void;
  showMemoCreateModal: boolean;
  setShowMemoCreateModal: (show: boolean) => void;
  lastMemoSettings: { shape: MemoShape; text: string; angle: number; scaleX: number; scaleY: number } | null;
  setLastMemoSettings: (s: { shape: MemoShape; text: string; angle: number; scaleX: number; scaleY: number } | null) => void;
  showInnerPost: boolean;
  setShowInnerPost: (show: boolean) => void;

  // グリッド強弱
  gridStrength: number;
  setGridStrength: (s: number) => void;

  // 手摺入れ替えモード
  isReorderMode: boolean;
  toggleReorderMode: () => void;
  reorderHandrails: (lineIds: string[], newOrder: string[]) => void;
  selectedLineIds: string[];
  setSelectedLineIds: (ids: string[]) => void;

  // 移動モード共通ステップ (選択移動の矢印ボタン step、mm 単位)
  moveSelectStepMm: 1 | 10 | 100;
  setMoveSelectStepMm: (s: 1 | 10 | 100) => void;

  // 選択移動モード (カテゴリ別 + 選択範囲の要素だけをまとめて移動)
  moveSelectMode: {
    active: boolean;
    /** 3 ステップフローの現在位置 */
    step: 'category' | 'select' | 'move';
    categories: {
      scaffold: boolean;   // handrails + posts + antis
      building: boolean;
      obstacle: boolean;
      memo: boolean;
    };
    selectedIds: string[];
    /** backup からの累積シフト量 (mm) */
    dxMm: number;
    dyMm: number;
    /** enter 時点の canvasData スナップショット (cancel 用) */
    backup: CanvasData | null;
  };
  enterMoveSelectMode: () => void;
  setMoveSelectStep: (step: 'category' | 'select' | 'move') => void;
  /** category → select */
  confirmCategorySelection: () => void;
  /** select → move */
  confirmRangeSelection: () => void;
  /** select → category (選択リセット + canvasData 復元) */
  backToCategory: () => void;
  /** move → select (移動をリセット、選択は維持) */
  backToSelect: () => void;
  setMoveSelectCategories: (categories: { scaffold: boolean; building: boolean; obstacle: boolean; memo: boolean }) => void;
  setMoveSelectIds: (ids: string[]) => void;
  toggleMoveSelectId: (id: string) => void;
  clearMoveSelectIds: () => void;
  /** backup からの絶対シフト量を指定し、選択要素のみ動かす（mm 単位） */
  shiftMoveSelected: (dxMm: number, dyMm: number) => void;
  commitMoveSelectMode: () => void;
  cancelMoveSelectMode: () => void;

  // 2F仮配置
  building2FDraft: {
    points: { x: number; y: number }[];
    anchorPoint: string;
    floor: 2;
    fill: string;
    roof?: import('@/types').RoofConfig;
    templateId?: string;
    templateDims?: Record<string, number>;
  } | null;
  setBuilding2FDraft: (draft: CanvasStore['building2FDraft']) => void;
  clearBuilding2FDraft: () => void;
  /** 編集対象の階 (= N階一般化 P2、 FloorSelector で切替、 非 active 階は薄表示)。default 1 */
  activeFloor: number;
  setActiveFloor: (f: number) => void;
  /** 階選択モーダルの対象ツール (= R-1k、 null=非表示)。複数階のときツール起動直後に出す。 */
  floorPromptTool: 'height' | 'ridge' | 'roof' | null;
  setFloorPromptTool: (t: 'height' | 'ridge' | 'roof' | null) => void;

  // Zoom & Pan
  zoom: number;
  panX: number;
  panY: number;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;

  // History
  history: HistoryState;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Save state
  isDirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  setSaveStatus: (s: 'idle' | 'saving' | 'saved' | 'error') => void;

  // Actions
  addBuilding: (b: BuildingShape) => void;
  updateBuilding: (id: string, points: { x: number; y: number }[]) => void;
  updateBuildingRoof: (id: string, roof: import('@/types').RoofConfig) => void;
  addRoofOverhang: (r: RoofOverhang) => void;
  addHandrail: (h: Handrail) => void;
  addHandrails: (hs: Handrail[]) => void;
  addPost: (p: Post) => void;
  addAnti: (a: Anti) => void;
  /** 足場系(手摺・支柱・アンチ)を全削除。建物・障害物・メモ・高さマーカーは残す。 */
  clearScaffold: () => void;
  addObstacle: (o: Obstacle) => void;
  addMemo: (m: Memo) => void;
  addMagnetPin: (pin: MagnetPin) => void;
  addMagnetPins: (pins: MagnetPin[]) => void;
  updateMagnetPin: (id: string, updates: Partial<MagnetPin>) => void;
  removeMagnetPin: (id: string) => void;
  removeMagnetPins: (ids: string[]) => void;
  // 高さマーカー (= Task #8 Phase B)
  isHeightMarkerMode: boolean;
  setHeightMarkerMode: (v: boolean) => void;
  /** 選択モードの ON/OFF トグル (= true: 触れる、 false: 全カテゴリ触れない、 default true、 session 内のみ) */
  selectActive: boolean;
  setSelectActive: (v: boolean) => void;
  /** カテゴリ別ロック (= true でそのカテゴリの listening を無効化、 全 false default、 localStorage 永続化)
   *  屋根は mode='roof' 限定で別経路のため将来用 placeholder (= UI 非表示) */
  selectLock: { parts: boolean; building: boolean; obstacle: boolean; roof: boolean; dimension: boolean };
  setSelectLock: (lock: { parts: boolean; building: boolean; obstacle: boolean; roof: boolean; dimension: boolean }) => void;
  heightInputMarkerId: string | null;
  setHeightInputMarkerId: (id: string | null) => void;
  /** 直前に入力した高さ (mm) (= 次回マーカー配置時の初期値、 セッション内のみ、 Issue 3) */
  lastHeightInputMm: number;
  addHeightMarker: (m: HeightMarker) => void;
  updateHeightMarker: (id: string, patch: Partial<HeightMarker>) => void;
  removeHeightMarker: (id: string) => void;
  moveHeightMarker: (id: string, edgeIndex: number, t: number) => void;
  // 棟ライン (= E-3.8)
  isRidgeLineMode: boolean;
  setRidgeLineMode: (v: boolean) => void;
  ridgeInputLineId: string | null;
  setRidgeInputLineId: (id: string | null) => void;
  /** 棟ライン配置の1点目ドラフト（2点目待ち状態）。操作ガイド(R-2)が段階を読むため store 管理。 */
  ridgeDraft: { buildingId: string; p1: Point } | null;
  setRidgeDraft: (d: { buildingId: string; p1: Point } | null) => void;
  /** 直前に入力した棟高 (mm) (= 次回棟ライン配置時の初期値、 セッション内のみ) */
  lastRidgeInputMm: number;
  addRidgeLine: (r: RidgeLine) => void;
  updateRidgeLine: (id: string, patch: Partial<RidgeLine>) => void;
  removeRidgeLine: (id: string) => void;
  /** 指定建物の棟ラインを全削除（屋根形状変更時の置換/削除・1 history）。 */
  removeRidgeLinesForBuilding: (buildingId: string) => void;
  moveRidgeLine: (id: string, p1: import('@/types').Point, p2: import('@/types').Point) => void;
  // 屋根オブジェクト (= R-1d)
  addRoof: (roof: Roof) => void;
  updateRoof: (id: string, patch: Partial<Roof>) => void;
  removeRoof: (id: string) => void;
  // 屋根領域入力 (= R-1e-fix7: 2F 作成と同じ領域描き。polygon)
  /** 屋根設定モーダルの対象。roofId 有=既存編集、無=新規追加。polygon=閉じた屋根領域。 */
  roofSettingsTarget: { buildingId: string; polygon: Point[]; roofId?: string } | null;
  setRoofSettingsTarget: (t: { buildingId: string; polygon: Point[]; roofId?: string } | null) => void;
  // 立面ビュー (= E-4)
  addElevationView: (v: ElevationView) => void;
  /** 複数ビューを 1 回の pushHistory で追加（4面一括配置用。同一面は置換）。 */
  addElevationViews: (views: ElevationView[]) => void;
  removeElevationView: (id: string) => void;
  moveElevationView: (id: string, originGrid: import('@/types').Point) => void;
  /** 旧ビュー(parts 無し)を選んだときに現在の平面から部材を再生成して移行する (= E-8-v2b)。 */
  ensureElevationParts: (viewId: string) => void;
  /** 選択中の立面部材(プリミティブ)の安定 id (= E-8-v2j で select モード直接選択に)。 */
  elevationEditSelectedId: string | null;
  setElevationEditSelectedId: (id: string | null) => void;
  /** 立面ビューの編集差分を差し替える (= E-8b、 履歴に積む)。 */
  setElevationEdits: (viewId: string, edits: import('@/types').ElevationEdit[]) => void;
  /** 文字編集モーダルの対象プリミティブ id (= E-8c、 null=非表示)。 */
  elevationTextEditTargetId: string | null;
  setElevationTextEditTargetId: (id: string | null) => void;
  /** 再配置(再生成)時に旧ビューの編集を新ビューへ引き継ぐ (= E-8d)。 */
  carryOverElevationEdits: (prev: ElevationView | undefined, next: ElevationView) => ElevationView;
  /** 孤立した編集の一覧を差し替える (= E-8d、 ユーザーが削除するとき)。 */
  setElevationOrphanEdits: (viewId: string, orphans: import('@/types').ElevationEdit[]) => void;
  /** 立面編集モードのパレット選択 (= E-8-v2c、 null=選択操作)。部材ブロックの種類＋文字。
   *  E-8-v2e: 自由線ツールは撤去（部材はパレット、文字は上書き/追加のみ）。 */
  elevationAddTool: import('@/lib/konva/elevation/elevationParts').ElevationPartKind | 'text' | null;
  setElevationAddTool: (t: import('@/lib/konva/elevation/elevationParts').ElevationPartKind | 'text' | null) => void;
  /**
   * 部材メニューのタブ (= E-8-v3c-fix2)。平面の部材か立面の部材か。
   * 文脈の推測に頼らず、ユーザーが明示的に選べるようにする。
   */
  partPaletteTab: 'plane' | 'elevation';
  setPartPaletteTab: (t: 'plane' | 'elevation') => void;
  /** 直近に触れた立面ビュー (= E-8-v3c-fix2)。部材メニューから立面へ入るときの既定の対象。 */
  lastElevationViewId: string | null;
  setLastElevationViewId: (id: string | null) => void;
  /** 立面パレットで選んでいる寸法 (= E-8-v3c)。支柱はコマ数、手摺・踏板・筋交は長さ(mm)。 */
  elevationAddSize: number;
  setElevationAddSize: (v: number) => void;
  /** 筋交など向きのある部材の反転 (= E-8-v3c)。配置前に切り替えられる。 */
  elevationAddFlip: boolean;
  toggleElevationAddFlip: () => void;
  /**
   * 立面パレットで選んでいる傾き（度・E-8-v3c-fix4）。平面部材の角度指定と同じ流儀。
   * 手摺・踏板は水平が 0°、支柱・ジャッキは垂直が 0°。置く前に決めてシャドーにも出す。
   */
  elevationAddAngle: number;
  setElevationAddAngle: (v: number) => void;
  /**
   * 立面パネル（パレット＋操作）の表示位置 (= E-8-v3c-fix5)。null＝既定（画面下・中央）。
   * 入口が 2 つ（立面タップ／部材メニュー）でもパネルは 1 つなので、位置も 1 つで共有する。
   * セッション内だけ覚える（図面の保存データには入れない）。
   */
  elevationPanelPos: { x: number; y: number } | null;
  setElevationPanelPos: (p: { x: number; y: number } | null) => void;
  /**
   * パレットからキャンバスへドロップした位置（クライアント座標）(= E-8-v3c)。
   * 平面の部材配置と同じ流儀で、パレットのボタンを掴んだままキャンバスで離すと置ける。
   * 立面レイヤーが拾って自分のローカル座標へ直し、置いたら null に戻す。
   */
  elevationDropAt: { clientX: number; clientY: number } | null;
  setElevationDropAt: (p: { clientX: number; clientY: number } | null) => void;
  /** 孤立部材の一覧を差し替える (= E-8-v2e、 ユーザーが削除するとき)。 */
  setElevationOrphanParts: (viewId: string, orphans: import('@/lib/konva/elevation/elevationParts').ElevationPart[]) => void;
  /** 部材ブロックを追加する (= E-8-v2c、 履歴に積む)。 */
  addElevationPart: (viewId: string, part: import('@/lib/konva/elevation/elevationParts').ElevationPart) => void;
  /** 部材ブロックを差し替える (= E-8-v2d、 移動/削除の一括更新)。 */
  setElevationParts: (viewId: string, parts: import('@/lib/konva/elevation/elevationParts').ElevationPart[]) => void;
  // 平米計算 modal (= 平米計算 Phase C)
  showAreaCalcModal: boolean;
  setShowAreaCalcModal: (v: boolean) => void;
  // 平米計算 modal: α offset + PDF flag (= 平米計算 Phase E-2)
  areaCalcOffsetMm: number;
  setAreaCalcOffsetMm: (v: number) => void;
  // 平米計算: 1F足場指定モード (= 平米計算 Phase D-2)
  isAreaDesignationMode: boolean;
  floorDesignation: Record<string, 1 | 2>;
  enterAreaDesignationMode: () => void;
  toggleHandrailFloor: (id: string) => void;
  toggleHandrailsBulk: (handrailIds: string[]) => void;
  commitAreaDesignation: () => void;
  cancelAreaDesignation: () => void;
  removeElement: (id: string) => void;
  removeElements: (ids: string[]) => void;
  moveElement: (id: string, dx: number, dy: number) => void;
  setCompassAngle: (angle: number) => void;
  setScaffoldStart: (config: ScaffoldStartConfig) => void;
  setScaffoldStart1F: (config: ScaffoldStartConfig | undefined) => void;
  setScaffoldStart2F: (config: ScaffoldStartConfig | undefined) => void;
  /** S-5c: N 階のスタート角を byFloor へ保存（floor 1/2 は既存2スロットへ両建て）。 */
  setScaffoldStartFloor: (floor: number, config: ScaffoldStartConfig | undefined) => void;
  removeScaffoldStart1F: () => void;
  removeScaffoldStart2F: () => void;
  zoomToFitBuildings: (viewportWidth: number, viewportHeight: number, marginMm?: number) => void;
  /** 全コンテンツ(建物・立面・メモ等)の bbox にフィット。空ページは原点・zoom=1 に戻す（E-6f）。 */
  zoomToFitContent: (viewportWidth: number, viewportHeight: number, marginMm?: number) => void;
  zoomToFitPrintArea: (viewportWidth: number, viewportHeight: number, marginMm?: number) => void;
  resetCanvas: () => void;
};

const MAX_HISTORY = 40;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  drawingId: null,
  projectId: null,
  setDrawingId: (id) => set({ drawingId: id }),
  setProjectId: (id) => set({ projectId: id }),

  canvasData: createEmptyCanvasData(),
  loadedDrawingId: null,
  // E-7-fix2: 第2引数でこのデータの所属図面を宣言する。省略時は null=所属不明(保存ガードが働く)。
  setCanvasData: (data, loadedDrawingId = null) => set({
    canvasData: normalizeCanvasData(data), isDirty: false, loadedDrawingId,
  }),
  setDimensionOffsetMm: (key, mm) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    const current = canvasData.dimensionOffsetsMm ?? DEFAULT_DIMENSION_OFFSETS_MM;
    set({
      canvasData: { ...canvasData, dimensionOffsetsMm: { ...current, [key]: mm } },
      isDirty: true,
    });
  },
  resetForDrawingChange: () => set((s) => ({
    // E-7-fix2: 遷移を始めた時点で「メモリ上のデータは新ページのものではない」と宣言する。
    //   ロード完了(setCanvasData)まで保存が走っても別ページの内容を書き込まない。
    loadedDrawingId: null,
    // E-7-fix3: 全ページ PDF のウィザード中はページを渡り歩いて枠を指定するので、
    //   印刷枠の表示だけは維持する（通常のページ切替では従来どおり消す・E-7-fix）。
    showPrintArea: s.pdfWizard != null,
    // modal フラグ
    showAreaCalcModal: false,
    showMemoCreateModal: false,
    showDirectionInputModal: false,
    showScaffoldStart: false,
    showAutoLayout: false,
    showBuildingModal: false,
    showBuilding2FModal: false,
    showCalculator: false,
    showSettings: false,
    showInnerPost: false,
    alertMessage: null,
    // selection のみリセット。mode は維持（E-6c-fix: ページ切替後もアクティブツールを引き継ぐ。
    // 図面の作業 state はクリアするので、mode を残しても各ツールは初期状態から開始される）。
    selectedIds: [],
    selectedLineIds: [],
    highlightIds: [],
    contextMenu: null,
    // 壁方向入力 / 建物配置
    directionPoints: [],
    directionPointsHistory: [],
    directionCursor: null,
    noWallMode: false,
    pendingDirection: null,
    pendingDirectionTarget: null,
    pendingTargetType: 'building',
    pendingObstacleType: null,
    pendingBuildingFloor: 1,
    lastCompletedDirectionSession: null,
    buildingInputMethod: 'template',
    // 計測
    isMeasuring: false,
    measurePoint1: null,
    measurePoint2: null,
    measureCursor: null,
    measureResultMm: null,
    measureAxisMode: 'free',
    // 特殊モード
    isReorderMode: false,
    isDuplicateMode: false,
    isMagnetPinMode: false,
    isAreaDesignationMode: false,
    floorDesignation: {},
    isHeightMarkerMode: false,
    heightInputMarkerId: null,
    isRidgeLineMode: false,
    ridgeInputLineId: null,
    ridgeDraft: null,
    roofSettingsTarget: null,
    pinAnchor: null,
    pinDraftOffset: null,
    pinDirectionInput: null,
    // preview / draft
    handrailPreview: null,
    obstaclePreview: null,
    snapPoint: null,
    memoDraft: null,
    memoDraftSource: 'memo',
    building2FDraft: null,
    // 移動モード
    moveSelectMode: {
      active: false,
      step: 'category',
      categories: { scaffold: true, building: false, obstacle: false, memo: false },
      selectedIds: [],
      dxMm: 0,
      dyMm: 0,
      backup: null,
    },
    // history
    history: { past: [], future: [] },
    // 平米計算 offset / 印刷枠
    areaCalcOffsetMm: 900,
    printAreaCenter: null,
    // E-7-fix: 印刷枠の表示は原則消す（store は SPA セッション中ずっと生きているため、
    //   範囲指定中に離脱すると showPrintArea が true のまま残り、別の現場・新規現場にも
    //   赤破線が出続けていた）。ウィザード中だけは上の showPrintArea で維持する。
  })),

  mode: 'view',  // 図面を開いた直後は閲覧モード (= 何も触れない)、 ユーザが明示的にボタン押下で遷移
  // R-1k: 建物モードを離れるときは方向入力の対象種別を既定へ戻す。屋根描きを他ボタンで中断すると
  //   pendingTargetType が 'roof' のまま残り、以後の選択モードで屋根点線が触れなくなる/非 active 階が
  //   減光したままになる、といった「モード抜けの取りこぼし」が起きていた。
  setMode: (mode) => set(
    mode === 'building'
      ? { mode, selectedIds: [] }
      : { mode, selectedIds: [], pendingTargetType: 'building' as const },
  ),
  buildingInputMethod: 'template',
  setBuildingInputMethod: (m) => set({ buildingInputMethod: m }),
  isMagnetPinMode: false,
  setMagnetPinMode: (v) => set(
    v
      ? { isMagnetPinMode: true }
      : { isMagnetPinMode: false, pinAnchor: null, pinDraftOffset: null, pinDirectionInput: null },
  ),
  pinAnchor: null,
  setPinAnchor: (anchor) => set({ pinAnchor: anchor, pinDraftOffset: null, pinDirectionInput: null }),
  pinDraftOffset: null,
  setPinDraftOffset: (offset) => set({ pinDraftOffset: offset }),
  pinDirectionInput: null,
  setPinDirectionInput: (dir) => set({ pinDirectionInput: dir }),

  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),

  // === クリップボード（E-6c） ===
  clipboard: null,
  copySelection: () => {
    const { canvasData, selectedIds } = get();
    const { subset, origin } = collectSelectionSubset(canvasData, selectedIds);
    if (payloadCount(subset) === 0) return;
    set({ clipboard: { subset, origin } });
  },
  cutSelection: () => {
    const { canvasData, selectedIds } = get();
    const { subset, sourceIds, origin } = collectSelectionSubset(canvasData, selectedIds);
    if (payloadCount(subset) === 0) return;
    set({ clipboard: { subset, origin } });
    // 削除は removeElements 経由（pushHistory で undo 可能）。
    get().removeElements(sourceIds);
  },
  pasteClipboard: (anchorGrid) => {
    const { clipboard, canvasData, pushHistory } = get();
    if (!clipboard) return;
    const offset = { x: anchorGrid.x - clipboard.origin.x, y: anchorGrid.y - clipboard.origin.y };
    const payload = instantiateSubset(clipboard.subset, offset);
    if (payloadCount(payload) === 0) return;
    pushHistory();
    set({
      canvasData: mergePayloadIntoCanvas(canvasData, payload),
      selectedIds: payloadIds(payload),
      isDirty: true,
    });
  },
  contextMenu: null,
  openContextMenu: (cm) => set({ contextMenu: cm }),
  closeContextMenu: () => set({ contextMenu: null }),

  selectedHandrailLength: 1800,
  setSelectedHandrailLength: (l) => set({ selectedHandrailLength: l }),
  selectedAntiWidth: 400,
  setSelectedAntiWidth: (w) => set({ selectedAntiWidth: w }),
  selectedAntiLength: 1800,
  setSelectedAntiLength: (l) => set({ selectedAntiLength: l }),

  handrailPreview: null,
  setHandrailPreview: (p) => set({ handrailPreview: p }),
  snapPoint: null,
  setSnapPoint: (p) => set({ snapPoint: p }),

  obstaclePreview: null,
  setObstaclePreview: (p) => set({ obstaclePreview: p }),

  directionPoints: [],
  directionPointsHistory: [],
  lastCompletedDirectionSession: null,
  addDirectionPoint: (p) => set((s) => ({
    directionPointsHistory: [...s.directionPointsHistory, [...s.directionPoints]],
    directionPoints: [...s.directionPoints, p],
  })),
  undoDirectionPoint: () => set((s) => {
    if (s.directionPointsHistory.length === 0) return { directionPoints: [] };
    const newHistory = [...s.directionPointsHistory];
    const prevPoints = newHistory.pop()!;
    return { directionPoints: prevPoints, directionPointsHistory: newHistory };
  }),
  removeLastDirectionPoint: () => set((s) => ({ directionPoints: s.directionPoints.slice(0, -1) })),
  clearDirectionPoints: () => set({
    directionPoints: [], directionPointsHistory: [],
    directionCursor: null, noWallMode: false,
  }),
  setDirectionPoints: (points) => set({ directionPoints: points }),
  directionCursor: null,
  setDirectionCursor: (p) => set({ directionCursor: p }),
  noWallMode: false,
  setNoWallMode: (v) => set({ noWallMode: v }),
  setLastCompletedDirectionSession: (s) => set({ lastCompletedDirectionSession: s }),
  pendingBuildingFloor: 1,
  setPendingBuildingFloor: (f) => set({ pendingBuildingFloor: f }),
  pendingTargetType: 'building',
  setPendingTargetType: (t) => set({ pendingTargetType: t }),
  pendingObstacleType: null,
  setPendingObstacleType: (t) => set({ pendingObstacleType: t }),
  showDirectionInputModal: false,
  setShowDirectionInputModal: (show) => set({ showDirectionInputModal: show }),
  pendingDirection: null,
  setPendingDirection: (dir) => set({ pendingDirection: dir }),
  pendingDirectionTarget: null,
  setPendingDirectionTarget: (p) => set({ pendingDirectionTarget: p }),
  lastMoveDirection: 'down',
  setLastMoveDirection: (dir) => set({ lastMoveDirection: dir }),
  directionDistanceHistory: [1000, 1800, 2000, 3000, 3640, 4000, 5000, 6000, 7280, 9100],
  addDirectionDistanceHistory: (mm) => set((state) => {
    const filtered = state.directionDistanceHistory.filter((v) => v !== mm);
    return { directionDistanceHistory: [mm, ...filtered].slice(0, 10) };
  }),
  showDirectionGuide: true,
  toggleDirectionGuide: () => set({ showDirectionGuide: !get().showDirectionGuide }),

  showDimensions: true,
  toggleShowDimensions: () => set({ showDimensions: !get().showDimensions }),
  setShowDimensions: (v) => set({ showDimensions: v }),
  showDimensionLines: false,
  toggleShowDimensionLines: () => set({ showDimensionLines: !get().showDimensionLines }),
  setShowDimensionLines: (v) => set({ showDimensionLines: v }),
  canvasSize: { width: 0, height: 0 },
  setCanvasSize: (size) => set({ canvasSize: size }),
  showGridGuide: false,
  toggleShowGridGuide: () => set({ showGridGuide: !get().showGridGuide }),
  showPrintArea: false,
  toggleShowPrintArea: () => set({ showPrintArea: !get().showPrintArea }),
  printPaperSize: 'A4_landscape' as import('@/types').PaperSize,
  printScale: '1/100' as import('@/types').ScaleOption,
  setPrintPaperSize: (s) => set({ printPaperSize: s }),
  setPrintScale: (s) => set({ printScale: s }),
  printAreaCenter: null,
  setPrintAreaCenter: (p) => set({ printAreaCenter: p }),
  pdfWizard: null,
  setPdfWizard: (w) => set({ pdfWizard: w }),
  updatePdfWizard: (patch) => set((s) => (s.pdfWizard ? { pdfWizard: { ...s.pdfWizard, ...patch } } : {})),

  isMeasuring: false,
  measurePoint1: null,
  measurePoint2: null,
  measureCursor: null,
  measureResultMm: null,
  measureAxisMode: 'free',
  setMeasureAxisMode: (mode) => set({ measureAxisMode: mode }),
  toggleMeasuring: () => {
    const { isMeasuring } = get();
    set({
      isMeasuring: !isMeasuring,
      measurePoint1: null,
      measurePoint2: null,
      measureCursor: null,
      measureResultMm: null,
    });
  },
  setMeasurePoint1: (p) => set({ measurePoint1: p }),
  setMeasurePoint2: (p) => set({ measurePoint2: p }),
  setMeasureCursor: (p) => set({ measureCursor: p }),
  setMeasureResultMm: (mm) => set({ measureResultMm: mm }),

  isDarkMode: false,
  toggleDarkMode: () => {
    const next = !get().isDarkMode;
    set({ isDarkMode: next });
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('dark-mode', next);
      try { localStorage.setItem('ashiba:darkMode', next ? '1' : '0'); } catch {}
    }
  },
  /** アプリ起動時に localStorage から dark mode を復元する */
  initDarkMode: () => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('ashiba:darkMode');
      const dark = saved === '1';
      set({ isDarkMode: dark });
      document.body.classList.toggle('dark-mode', dark);
    } catch {
      // アクセス不可環境は無視
    }
  },

  isDuplicateMode: false,
  toggleDuplicateMode: () => set({ isDuplicateMode: !get().isDuplicateMode }),

  highlightIds: [],
  setHighlightIds: (ids) => set({ highlightIds: ids }),

  showKidare: false,
  toggleShowKidare: () => set({ showKidare: !get().showKidare }),

  showScaffoldStart: false,
  setShowScaffoldStart: (show) => set({ showScaffoldStart: show }),
  showAutoLayout: false,
  setShowAutoLayout: (show) => set({ showAutoLayout: show }),
  alertMessage: null,
  setAlertMessage: (msg) => set({ alertMessage: msg }),
  showBuildingModal: false,
  setShowBuildingModal: (show) => set({ showBuildingModal: show }),
  showCalculator: false,
  setShowCalculator: (show) => set({ showCalculator: show }),
  showElevation: false,
  setShowElevation: (show) => set({ showElevation: show }),
  showBuilding2FModal: false,
  setShowBuilding2FModal: (show) => set({ showBuilding2FModal: show }),
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),
  showPartSelector: false,
  togglePartSelector: () => set({ showPartSelector: !get().showPartSelector }),
  showSettingsPanel: true,
  toggleSettingsPanel: () => set({ showSettingsPanel: !get().showSettingsPanel }),

  memoDraft: null,
  setMemoDraft: (draft) => set({ memoDraft: draft }),
  clearMemoDraft: () => set({ memoDraft: null, memoDraftSource: 'memo' }),
  memoDraftSource: 'memo',
  setMemoDraftSource: (source) => set({ memoDraftSource: source }),
  showMemoCreateModal: false,
  setShowMemoCreateModal: (show) => set({ showMemoCreateModal: show }),
  lastMemoSettings: null,
  setLastMemoSettings: (s) => set({ lastMemoSettings: s }),
  showInnerPost: false,
  setShowInnerPost: (show) => set({ showInnerPost: show }),

  gridStrength: 1,
  setGridStrength: (s) => set({ gridStrength: s }),

  isReorderMode: false,
  toggleReorderMode: () => {
    const next = !get().isReorderMode;
    set({ isReorderMode: next });
    if (next) {
      // 入替モードON時はselectモードに切り替え + selectActive=false
      // (= selectLock を無効化し、部材を選択 / 入替可能にする)
      get().setMode('select');
      get().setSelectActive(false);
    } else {
      // 入替モード終了時は通常の選択モードへ戻す (= selectActive 復帰)
      get().setSelectActive(true);
    }
  },
  selectedLineIds: [],
  setSelectedLineIds: (ids) => set({ selectedLineIds: ids }),

  // --- 移動モード共通 step (mm) ---
  moveSelectStepMm: 10,
  setMoveSelectStepMm: (s) => set({ moveSelectStepMm: s }),

  // --- 選択移動モード ---
  moveSelectMode: {
    active: false,
    step: 'category',
    categories: { scaffold: true, building: false, obstacle: false, memo: false },
    selectedIds: [],
    dxMm: 0,
    dyMm: 0,
    backup: null,
  },
  enterMoveSelectMode: () => {
    const { canvasData } = get();
    // 現在の（pre-move）状態を履歴に積む → commit 後に undo で戻せる
    get().pushHistory();
    set({
      moveSelectMode: {
        active: true,
        step: 'category',
        categories: { scaffold: true, building: false, obstacle: false, memo: false },
        selectedIds: [],
        dxMm: 0,
        dyMm: 0,
        backup: JSON.parse(JSON.stringify(canvasData)),
      },
      mode: 'move-select',
      selectedIds: [],
    });
  },
  setMoveSelectStep: (step) => {
    const { moveSelectMode } = get();
    set({ moveSelectMode: { ...moveSelectMode, step } });
  },
  confirmCategorySelection: () => {
    const { moveSelectMode } = get();
    set({ moveSelectMode: { ...moveSelectMode, step: 'select' } });
  },
  confirmRangeSelection: () => {
    const { moveSelectMode } = get();
    set({ moveSelectMode: { ...moveSelectMode, step: 'move' } });
  },
  backToCategory: () => {
    const { moveSelectMode } = get();
    const backup = moveSelectMode.backup;
    // 既に何か動かしていたら backup に戻す（念のため）
    if (backup) {
      set({ canvasData: JSON.parse(JSON.stringify(backup)) });
    }
    set({
      moveSelectMode: {
        ...moveSelectMode,
        step: 'category',
        selectedIds: [],
        dxMm: 0,
        dyMm: 0,
      },
    });
  },
  backToSelect: () => {
    const { moveSelectMode } = get();
    const backup = moveSelectMode.backup;
    // 移動は巻き戻すが selectedIds は維持（再調整を想定）
    if (backup) {
      set({ canvasData: JSON.parse(JSON.stringify(backup)) });
    }
    set({
      moveSelectMode: {
        ...moveSelectMode,
        step: 'select',
        dxMm: 0,
        dyMm: 0,
      },
    });
  },
  setMoveSelectCategories: (categories) => {
    const { moveSelectMode } = get();
    set({ moveSelectMode: { ...moveSelectMode, categories } });
  },
  setMoveSelectIds: (ids) => {
    const { moveSelectMode } = get();
    set({ moveSelectMode: { ...moveSelectMode, selectedIds: ids } });
  },
  toggleMoveSelectId: (id) => {
    const { moveSelectMode } = get();
    const exists = moveSelectMode.selectedIds.includes(id);
    const selectedIds = exists
      ? moveSelectMode.selectedIds.filter(x => x !== id)
      : [...moveSelectMode.selectedIds, id];
    set({ moveSelectMode: { ...moveSelectMode, selectedIds } });
  },
  clearMoveSelectIds: () => {
    const { moveSelectMode } = get();
    set({ moveSelectMode: { ...moveSelectMode, selectedIds: [] } });
  },
  shiftMoveSelected: (dxMm, dyMm) => {
    const { moveSelectMode } = get();
    const backup = moveSelectMode.backup;
    if (!backup) return;
    const sel = new Set(moveSelectMode.selectedIds);
    const cats = moveSelectMode.categories;
    const dx = dxMm / 10; // mm → grid
    const dy = dyMm / 10;

    const shifted: CanvasData = {
      ...backup,
      buildings: backup.buildings.map(b =>
        cats.building && sel.has(b.id)
          ? { ...b, points: b.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
          : b
      ),
      handrails: backup.handrails.map(h =>
        cats.scaffold && sel.has(h.id) ? { ...h, x: h.x + dx, y: h.y + dy } : h
      ),
      posts: backup.posts.map(p =>
        cats.scaffold && sel.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p
      ),
      antis: backup.antis.map(a =>
        cats.scaffold && sel.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a
      ),
      obstacles: backup.obstacles.map(o =>
        cats.obstacle && sel.has(o.id)
          ? {
              ...o,
              x: o.x + dx,
              y: o.y + dy,
              ...(o.points ? { points: o.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}),
            }
          : o
      ),
      memos: backup.memos.map(m =>
        cats.memo && sel.has(m.id) ? { ...m, x: m.x + dx, y: m.y + dy } : m
      ),
    };

    set({
      canvasData: shifted,
      moveSelectMode: { ...moveSelectMode, dxMm, dyMm },
      isDirty: true,
    });
  },
  commitMoveSelectMode: () => {
    set({
      moveSelectMode: {
        active: false,
        step: 'category',
        categories: { scaffold: true, building: false, obstacle: false, memo: false },
        selectedIds: [],
        dxMm: 0,
        dyMm: 0,
        backup: null,
      },
      mode: 'select',
      isDirty: true,
    });
  },
  cancelMoveSelectMode: () => {
    const { moveSelectMode } = get();
    const backup = moveSelectMode.backup;
    if (backup) {
      set({ canvasData: backup });
    }
    set({
      moveSelectMode: {
        active: false,
        step: 'category',
        categories: { scaffold: true, building: false, obstacle: false, memo: false },
        selectedIds: [],
        dxMm: 0,
        dyMm: 0,
        backup: null,
      },
      mode: 'select',
    });
  },

  reorderHandrails: (lineIds: string[], newOrder: string[]) => {
    const { canvasData } = get();
    const lineGroup = canvasData.handrails.filter(h => lineIds.includes(h.id));
    const others = canvasData.handrails.filter(h => !lineIds.includes(h.id));
    const isHoriz = lineGroup[0]?.direction === 'horizontal';
    const sorted = [...lineGroup].sort((a, b) =>
      isHoriz ? a.x - b.x : a.y - b.y
    );
    // 先頭の開始座標を固定
    const startCoord = isHoriz ? sorted[0].x : sorted[0].y;
    // newOrderの順番で手摺を取り出してcursorで詰める
    const reordered: typeof lineGroup = [];
    let cursor = startCoord;
    for (const id of newOrder) {
      const handrail = lineGroup.find(h => h.id === id)!;
      if (isHoriz) {
        reordered.push({ ...handrail, x: cursor });
      } else {
        reordered.push({ ...handrail, y: cursor });
      }
      cursor += Math.round(handrail.lengthMm / 10);
    }
    get().pushHistory();
    set({
      canvasData: { ...canvasData, handrails: [...others, ...reordered] },
      isDirty: true,
    });
  },

  building2FDraft: null,
  setBuilding2FDraft: (draft) => set({ building2FDraft: draft }),
  clearBuilding2FDraft: () => set({ building2FDraft: null }),
  activeFloor: 1,
  setActiveFloor: (f) => set({ activeFloor: f }),
  floorPromptTool: null,
  setFloorPromptTool: (t) => set({ floorPromptTool: t }),

  zoom: 1.0,
  panX: 0,
  panY: 0,
  setZoom: (z) => set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),

  history: { past: [], future: [] },
  pushHistory: () => {
    const { canvasData, history } = get();
    const past = [...history.past, JSON.parse(JSON.stringify(canvasData))].slice(-MAX_HISTORY);
    set({ history: { past, future: [] }, isDirty: true, lastCompletedDirectionSession: null });
  },
  undo: () => {
    const { canvasData, history } = get();
    if (history.past.length === 0) return;
    track('manual_edit', { kind: 'undo' });
    const past = [...history.past];
    const prev = past.pop()!;
    set({
      canvasData: prev,
      history: {
        past,
        future: [JSON.parse(JSON.stringify(canvasData)), ...history.future],
      },
      isDirty: true,
    });
  },
  redo: () => {
    const { canvasData, history } = get();
    if (history.future.length === 0) return;
    const future = [...history.future];
    const next = future.shift()!;
    set({
      canvasData: next,
      history: {
        past: [...history.past, JSON.parse(JSON.stringify(canvasData))],
        future,
      },
      isDirty: true,
    });
  },

  isDirty: false,
  saveStatus: 'idle',
  setSaveStatus: (s) => set({ saveStatus: s }),

  addBuilding: (b) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, buildings: [...canvasData.buildings, b] },
      isDirty: true,
    });
  },
  updateBuilding: (id, points) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        buildings: canvasData.buildings.map((b) =>
          b.id === id ? { ...b, points } : b
        ),
      },
      isDirty: true,
    });
  },
  updateBuildingRoof: (id, roof) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        buildings: canvasData.buildings.map((b) =>
          b.id === id ? { ...b, roof } : b
        ),
      },
      isDirty: true,
    });
  },
  addRoofOverhang: (r) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        roofOverhangs: [...canvasData.roofOverhangs, r],
      },
      isDirty: true,
    });
  },
  addHandrail: (h) => {
    const { canvasData, pushHistory } = get();
    track('manual_edit', { kind: 'add_handrail' });
    pushHistory();
    set({
      canvasData: { ...canvasData, handrails: [...canvasData.handrails, h] },
      isDirty: true,
    });
  },
  addHandrails: (hs) => {
    if (hs.length === 0) return;
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, handrails: [...canvasData.handrails, ...hs] },
      isDirty: true,
    });
  },
  addPost: (p) => {
    track('manual_edit', { kind: 'add_post' });
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, posts: [...canvasData.posts, p] },
      isDirty: true,
    });
  },
  addAnti: (a) => {
    track('manual_edit', { kind: 'add_anti' });
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, antis: [...canvasData.antis, a] },
      isDirty: true,
    });
  },
  clearScaffold: () => {
    const { canvasData, pushHistory } = get();
    if (canvasData.handrails.length === 0 && canvasData.posts.length === 0 && canvasData.antis.length === 0) return;
    pushHistory();
    set({
      canvasData: { ...canvasData, handrails: [], posts: [], antis: [] },
      isDirty: true,
      selectedIds: [],
    });
  },
  addObstacle: (o) => {
    track('manual_edit', { kind: 'add_obstacle' });
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, obstacles: [...canvasData.obstacles, o] },
      isDirty: true,
    });
  },
  addMemo: (m) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, memos: [...canvasData.memos, m] },
      isDirty: true,
    });
  },
  addMagnetPin: (pin) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, magnetPins: [...(canvasData.magnetPins ?? []), pin] },
      isDirty: true,
    });
  },
  addMagnetPins: (pins) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, magnetPins: [...(canvasData.magnetPins ?? []), ...pins] },
      isDirty: true,
    });
  },
  updateMagnetPin: (id, updates) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        magnetPins: (canvasData.magnetPins ?? []).map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
      },
      isDirty: true,
    });
  },
  removeMagnetPin: (id) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        magnetPins: (canvasData.magnetPins ?? []).filter((p) => p.id !== id),
      },
      isDirty: true,
    });
  },
  removeMagnetPins: (ids) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    const idSet = new Set(ids);
    set({
      canvasData: {
        ...canvasData,
        magnetPins: (canvasData.magnetPins ?? []).filter((p) => !idSet.has(p.id)),
      },
      isDirty: true,
    });
  },

  // === 高さマーカー (= Task #8 Phase B) ===
  isHeightMarkerMode: false,
  setHeightMarkerMode: (v) => set({ isHeightMarkerMode: v }),
  selectActive: true,
  setSelectActive: (v) => set({ selectActive: v }),
  selectLock: { parts: true, building: false, obstacle: false, roof: false, dimension: false },
  setSelectLock: (lock) => {
    set({ selectLock: lock });
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('ashiba-plan:selectLock', JSON.stringify(lock)); } catch {}
    }
  },
  heightInputMarkerId: null,
  setHeightInputMarkerId: (id) => set({ heightInputMarkerId: id }),
  // 直前入力値の保持 (= セッション内のみ、 Issue 3 修正)
  lastHeightInputMm: 0,
  addHeightMarker: (m) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, heightMarkers: [...(canvasData.heightMarkers ?? []), m] },
      isDirty: true,
    });
  },
  updateHeightMarker: (id, patch) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    // patch に heightMm が含まれていれば lastHeightInputMm を更新 (= Issue 3、 次回配置時の初期値)
    const next: Partial<{ lastHeightInputMm: number }> = {};
    if (typeof patch.heightMm === 'number' && patch.heightMm > 0) {
      next.lastHeightInputMm = patch.heightMm;
    }
    set({
      canvasData: {
        ...canvasData,
        heightMarkers: (canvasData.heightMarkers ?? []).map((m) =>
          m.id === id ? { ...m, ...patch } : m
        ),
      },
      isDirty: true,
      ...next,
    });
  },
  removeHeightMarker: (id) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        heightMarkers: (canvasData.heightMarkers ?? []).filter((m) => m.id !== id),
      },
      isDirty: true,
    });
  },
  moveHeightMarker: (id, edgeIndex, t) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        heightMarkers: (canvasData.heightMarkers ?? []).map((m) =>
          m.id === id ? { ...m, edgeIndex, t } : m
        ),
      },
      isDirty: true,
    });
  },

  // === 棟ライン (= E-3.8) ===
  isRidgeLineMode: false,
  setRidgeLineMode: (v) => set(v ? { isRidgeLineMode: true } : { isRidgeLineMode: false, ridgeDraft: null }),
  ridgeInputLineId: null,
  setRidgeInputLineId: (id) => set({ ridgeInputLineId: id }),
  ridgeDraft: null,
  setRidgeDraft: (d) => set({ ridgeDraft: d }),
  lastRidgeInputMm: 5000,
  addRidgeLine: (r) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, ridgeLines: [...(canvasData.ridgeLines ?? []), r] },
      isDirty: true,
    });
  },
  updateRidgeLine: (id, patch) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    // patch に heightMm があれば lastRidgeInputMm を更新 (= 次回配置時の初期値)
    const next: Partial<{ lastRidgeInputMm: number }> = {};
    if (typeof patch.heightMm === 'number' && patch.heightMm > 0) next.lastRidgeInputMm = patch.heightMm;
    set({
      canvasData: {
        ...canvasData,
        ridgeLines: (canvasData.ridgeLines ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
      isDirty: true,
      ...next,
    });
  },
  removeRidgeLine: (id) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, ridgeLines: (canvasData.ridgeLines ?? []).filter((r) => r.id !== id) },
      isDirty: true,
    });
  },
  removeRidgeLinesForBuilding: (buildingId) => {
    const { canvasData, pushHistory } = get();
    if (!(canvasData.ridgeLines ?? []).some((r) => r.buildingId === buildingId)) return;
    pushHistory();
    set({
      canvasData: { ...canvasData, ridgeLines: (canvasData.ridgeLines ?? []).filter((r) => r.buildingId !== buildingId) },
      isDirty: true,
    });
  },
  moveRidgeLine: (id, p1, p2) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        ridgeLines: (canvasData.ridgeLines ?? []).map((r) => (r.id === id ? { ...r, p1, p2 } : r)),
      },
      isDirty: true,
    });
  },

  // === 屋根オブジェクト（R-1d） ===
  addRoof: (roof) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, roofs: [...(canvasData.roofs ?? []), roof] },
      isDirty: true,
    });
  },
  updateRoof: (id, patch) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        roofs: (canvasData.roofs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
      isDirty: true,
    });
  },
  removeRoof: (id) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, roofs: (canvasData.roofs ?? []).filter((r) => r.id !== id) },
      isDirty: true,
    });
  },
  roofSettingsTarget: null,
  setRoofSettingsTarget: (t) => set({ roofSettingsTarget: t }),

  // === 立面ビュー (= E-4) ===
  /** E-8d/E-8-v2e: 同じ面の旧ビューの手当て（編集差分・部材）を新ビューへ引き継ぐ。
   *  引き継げない分は勝手に消さず孤立として保持し、UI で一覧提示する。 */
  carryOverElevationEdits: (prev: ElevationView | undefined, next: ElevationView): ElevationView => {
    const hasManualParts = (prev?.parts ?? []).some((p) => p.origin === 'manual');
    if (!prev || ((prev.edits?.length ?? 0) === 0 && (prev.orphanEdits?.length ?? 0) === 0
      && (prev.orphanParts?.length ?? 0) === 0 && !hasManualParts)) return next;
    const r = rematchElevationEdits(prev.primitives, next.primitives, prev.edits);
    const orphans = [...(prev.orphanEdits ?? []), ...r.orphans];
    // E-8-v2e: 部材の手当て（追加・移動・削除の墓標）は意味データで引き継ぐ。
    let parts = next.parts;
    let orphanParts = prev.orphanParts ?? [];
    if (next.parts && next.geom) {
      const pr = rematchElevationParts(prev.parts, { parts: next.parts, geom: next.geom });
      parts = pr.parts;
      orphanParts = [...orphanParts, ...pr.orphans];
    }
    return {
      ...next,
      parts,
      edits: r.edits.length > 0 ? r.edits : undefined,
      orphanEdits: orphans.length > 0 ? orphans : undefined,
      orphanParts: orphanParts.length > 0 ? orphanParts : undefined,
    };
  },
  addElevationView: (v) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    // 同じ面の既存ビューは置換（1 面 1 ビュー）。E-8d: 旧ビューの編集を新ビューへ引き継ぐ。
    const all = canvasData.elevationViews ?? [];
    const prev = all.find((e) => e.face === v.face);
    const kept = all.filter((e) => e.face !== v.face);
    set({
      canvasData: { ...canvasData, elevationViews: [...kept, get().carryOverElevationEdits(prev, v)] },
      isDirty: true,
    });
  },
  addElevationViews: (views) => {
    if (views.length === 0) return;
    const { canvasData, pushHistory } = get();
    pushHistory();
    // 追加する面の既存ビューをまとめて置換（1 面 1 ビュー）。
    const placedFaces = new Set(views.map((v) => v.face));
    const all = canvasData.elevationViews ?? [];
    const kept = all.filter((e) => !placedFaces.has(e.face));
    // E-8d: 面ごとに旧ビューの編集を引き継ぐ（引き継げない分は孤立として保持）。
    const carried = views.map((v) => get().carryOverElevationEdits(all.find((e) => e.face === v.face), v));
    set({
      canvasData: { ...canvasData, elevationViews: [...kept, ...carried] },
      isDirty: true,
    });
  },
  removeElevationView: (id) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, elevationViews: (canvasData.elevationViews ?? []).filter((e) => e.id !== id) },
      isDirty: true,
    });
  },
  ensureElevationParts: (viewId) => {
    const { canvasData } = get();
    const view = (canvasData.elevationViews ?? []).find((v) => v.id === viewId);
    if (!view) return;
    // E-8-v2l: 「parts が無い(旧 primitives のみ)」に加えて、「列全幅 1 本の旧世代 parts」も
    //   作り直しの対象にする（配置済みの立面が古い姿のまま残っていたため）。
    //   手で足した/動かした部材や編集差分があるビューは対象外＝作り直して失わない。
    //   作り直すとスパン幅ぴったりになるので判定は false に落ちる＝再入しない。
    const legacy = hasLegacyFullWidthParts(view.parts, view.geom, (view.edits?.length ?? 0) > 0);
    if (view.parts && view.geom && !legacy) return;
    // 現在の平面から同じ面の立面を作り直し、その部材を採用する（絵は保存済みのものを背景に使う）。
    const bundle = facePartsForCanvas(canvasData, view.face);
    if (bundle.parts.length === 0) return;
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((v) =>
          (v.id === viewId ? { ...v, parts: bundle.parts, geom: bundle.geom } : v)),
      },
      isDirty: true,
    });
  },
  elevationEditSelectedId: null,
  setElevationEditSelectedId: (id) => set({ elevationEditSelectedId: id }),
  elevationTextEditTargetId: null,
  setElevationTextEditTargetId: (id) => set({ elevationTextEditTargetId: id }),
  setElevationOrphanEdits: (viewId, orphans) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((e) =>
          (e.id === viewId ? { ...e, orphanEdits: orphans.length > 0 ? orphans : undefined } : e)),
      },
      isDirty: true,
    });
  },
  elevationAddTool: null,
  setElevationAddTool: (t) => set({
    elevationAddTool: t,
    elevationEditSelectedId: null,
    // 種類を変えたら寸法も既定へ戻す（支柱=コマ数 / 手摺・踏板=長さ mm）
    elevationAddSize: t && t !== 'text'
      ? defaultPartSize(t) : get().elevationAddSize,
  }),
  partPaletteTab: 'plane',
  setPartPaletteTab: (t) => set({ partPaletteTab: t }),
  lastElevationViewId: null,
  setLastElevationViewId: (id) => set({ lastElevationViewId: id }),
  elevationAddSize: 1800,
  setElevationAddSize: (v) => set({ elevationAddSize: v }),
  elevationAddFlip: false,
  toggleElevationAddFlip: () => set({ elevationAddFlip: !get().elevationAddFlip }),
  elevationAddAngle: 0,
  setElevationAddAngle: (v) => set({ elevationAddAngle: v }),
  elevationPanelPos: null,
  setElevationPanelPos: (p) => set({ elevationPanelPos: p }),
  elevationDropAt: null,
  setElevationDropAt: (p) => set({ elevationDropAt: p }),
  setElevationOrphanParts: (viewId, orphans) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((e) =>
          (e.id === viewId ? { ...e, orphanParts: orphans.length > 0 ? orphans : undefined } : e)),
      },
      isDirty: true,
    });
  },
  addElevationPart: (viewId, part) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((v) =>
          (v.id === viewId ? { ...v, parts: [...(v.parts ?? []), part] } : v)),
      },
      isDirty: true,
    });
  },
  setElevationParts: (viewId, parts) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((v) =>
          (v.id === viewId ? { ...v, parts } : v)),
      },
      isDirty: true,
    });
  },
  setElevationEdits: (viewId, edits) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((e) => (e.id === viewId ? { ...e, edits } : e)),
      },
      isDirty: true,
    });
  },
  moveElevationView: (id, originGrid) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        elevationViews: (canvasData.elevationViews ?? []).map((e) => (e.id === id ? { ...e, originGrid } : e)),
      },
      isDirty: true,
    });
  },

  // === 平米計算 modal (= 平米計算 Phase C) ===
  showAreaCalcModal: false,
  setShowAreaCalcModal: (v) => set({ showAreaCalcModal: v }),

  // === 平米計算 modal: α offset + PDF flag (= 平米計算 Phase E-2) ===
  areaCalcOffsetMm: 900,
  setAreaCalcOffsetMm: (v) => set({ areaCalcOffsetMm: v }),

  // === 平米計算: 1F足場指定モード (= 平米計算 Phase D-2) ===
  isAreaDesignationMode: false,
  floorDesignation: {},
  enterAreaDesignationMode: () => set({ isAreaDesignationMode: true, floorDesignation: {} }),
  toggleHandrailFloor: (id) => {
    const { floorDesignation } = get();
    const current = floorDesignation[id];
    // 1 なら 2 に、 それ以外 (= undefined / 2) なら 1 に
    const next: 1 | 2 = current === 1 ? 2 : 1;
    set({ floorDesignation: { ...floorDesignation, [id]: next } });
  },
  toggleHandrailsBulk: (handrailIds) => {
    const { floorDesignation } = get();
    // 個別反転: 範囲内の各 Handrail を 1F ↔ 2F それぞれ反転 (= 平米計算 Phase D-2-c)
    const next = { ...floorDesignation };
    for (const id of handrailIds) {
      const current = next[id];
      next[id] = current === 1 ? 2 : 1;
    }
    set({ floorDesignation: next });
  },
  commitAreaDesignation: () => set({ isAreaDesignationMode: false, showAreaCalcModal: true }),
  cancelAreaDesignation: () => set({ isAreaDesignationMode: false, floorDesignation: {} }),

  removeElement: (id) => {
    const { canvasData, pushHistory } = get();
    track('manual_edit', { kind: 'delete', n: 1 });
    pushHistory();
    set({
      canvasData: {
        ...canvasData,
        buildings: canvasData.buildings.filter((b) => b.id !== id),
        roofOverhangs: canvasData.roofOverhangs.filter((r) => r.id !== id),
        handrails: canvasData.handrails.filter((h) => h.id !== id),
        posts: canvasData.posts.filter((p) => p.id !== id),
        antis: canvasData.antis.filter((a) => a.id !== id),
        obstacles: canvasData.obstacles.filter((o) => o.id !== id),
        memos: canvasData.memos.filter((m) => m.id !== id),
        magnetPins: (canvasData.magnetPins ?? []).filter((p) => p.id !== id),
        ridgeLines: (canvasData.ridgeLines ?? []).filter((r) => r.id !== id),
        heightMarkers: (canvasData.heightMarkers ?? []).filter((h) => h.id !== id),
        elevationViews: (canvasData.elevationViews ?? []).filter((e) => e.id !== id),
        // R-1d: 屋根オブジェクト自身の削除＋建物削除時の子屋根の除去（孤児防止）。
        roofs: (canvasData.roofs ?? []).filter((r) => r.id !== id && r.buildingId !== id),
      },
      isDirty: true,
    });
  },
  removeElements: (ids) => {
    const { canvasData, pushHistory } = get();
    track('manual_edit', { kind: 'delete', n: ids.length });
    pushHistory();
    const idSet = new Set(ids);
    set({
      canvasData: {
        ...canvasData,
        buildings: canvasData.buildings.filter((b) => !idSet.has(b.id)),
        roofOverhangs: canvasData.roofOverhangs.filter((r) => !idSet.has(r.id)),
        handrails: canvasData.handrails.filter((h) => !idSet.has(h.id)),
        posts: canvasData.posts.filter((p) => !idSet.has(p.id)),
        antis: canvasData.antis.filter((a) => !idSet.has(a.id)),
        obstacles: canvasData.obstacles.filter((o) => !idSet.has(o.id)),
        memos: canvasData.memos.filter((m) => !idSet.has(m.id)),
        magnetPins: (canvasData.magnetPins ?? []).filter((p) => !idSet.has(p.id)),
        ridgeLines: (canvasData.ridgeLines ?? []).filter((r) => !idSet.has(r.id)),
        heightMarkers: (canvasData.heightMarkers ?? []).filter((h) => !idSet.has(h.id)),
        elevationViews: (canvasData.elevationViews ?? []).filter((e) => !idSet.has(e.id)),
        // R-1d: 屋根オブジェクト自身の削除＋建物削除時の子屋根の除去（孤児防止）。
        roofs: (canvasData.roofs ?? []).filter((r) => !idSet.has(r.id) && !idSet.has(r.buildingId)),
      },
      selectedIds: [],
      isDirty: true,
    });
  },
  moveElement: (id, dx, dy) => {
    track('manual_edit', { kind: 'move' });
    const { canvasData } = get();
    set({
      canvasData: {
        ...canvasData,
        buildings: canvasData.buildings.map((b) =>
          b.id === id
            ? { ...b, points: b.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : b
        ),
        handrails: canvasData.handrails.map((h) =>
          h.id === id ? { ...h, x: h.x + dx, y: h.y + dy } : h
        ),
        posts: canvasData.posts.map((p) =>
          p.id === id ? { ...p, x: p.x + dx, y: p.y + dy } : p
        ),
        antis: canvasData.antis.map((a) =>
          a.id === id ? { ...a, x: a.x + dx, y: a.y + dy } : a
        ),
        obstacles: canvasData.obstacles.map((o) =>
          o.id === id
            ? { ...o, x: o.x + dx, y: o.y + dy, ...(o.points ? { points: o.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}) }
            : o
        ),
        memos: canvasData.memos.map((m) =>
          m.id === id ? { ...m, x: m.x + dx, y: m.y + dy } : m
        ),
      },
      isDirty: true,
    });
  },
  setCompassAngle: (angle) => {
    const { canvasData } = get();
    // 0-360 にクランプ (= 360 超 / 負数 / NaN を normalize)
    const normalized = ((angle % 360) + 360) % 360;
    const safe = Number.isFinite(normalized) ? normalized : 0;
    set({ canvasData: { ...canvasData, compass: { angle: safe } } });
  },
  setScaffoldStart: (config) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    // 後方互換: scaffoldStart 本体を更新しつつ、floor に応じて
    // scaffoldStart1F / scaffoldStart2F にも同じ値を振り分ける。
    const floor = config.floor ?? 1;
    const next: CanvasData = { ...canvasData, scaffoldStart: config };
    if (floor === 1) {
      next.scaffoldStart1F = config;
    } else {
      next.scaffoldStart2F = config;
    }
    set({ canvasData: next, isDirty: true });
  },
  setScaffoldStart1F: (config) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, scaffoldStart1F: config },
      isDirty: true,
    });
  },
  setScaffoldStart2F: (config) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, scaffoldStart2F: config },
      isDirty: true,
    });
  },
  setScaffoldStartFloor: (floor, config) => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    // S-5c: byFloor(新) に保存。floor 1/2 は既存2スロットへも両建て
    //   （ModeToolbar/tutorial 等の直読み consumer が floor 1/2 を直接参照するため）。
    //   合成アクセサ getScaffoldStartByFloor は byFloor 優先なので {1,2} は従来と同値。
    const nextByFloor = { ...(canvasData.scaffoldStartByFloor ?? {}) };
    if (config) nextByFloor[floor] = config; else delete nextByFloor[floor];
    const next: CanvasData = { ...canvasData, scaffoldStartByFloor: nextByFloor };
    if (floor === 1) next.scaffoldStart1F = config;
    else if (floor === 2) next.scaffoldStart2F = config;
    set({ canvasData: next, isDirty: true });
  },
  removeScaffoldStart1F: () => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, scaffoldStart1F: undefined },
      isDirty: true,
    });
  },
  removeScaffoldStart2F: () => {
    const { canvasData, pushHistory } = get();
    pushHistory();
    set({
      canvasData: { ...canvasData, scaffoldStart2F: undefined },
      isDirty: true,
    });
  },
  zoomToFitBuildings: (viewportWidth, viewportHeight, marginMm = 2000) => {
    const { canvasData } = get();
    if (canvasData.buildings.length === 0) return;

    // 全建物の頂点からバウンディングボックスを計算
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of canvasData.buildings) {
      for (const p of b.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const buildingW = maxX - minX;
    const buildingH = maxY - minY;
    if (buildingW <= 0 || buildingH <= 0) return;

    // 建物の周囲に指定mmの余白を含めてフィット
    const marginGrid = marginMm / 10;
    const fitW = buildingW + marginGrid * 2;
    const fitH = buildingH + marginGrid * 2;
    const zoomX = viewportWidth / (fitW * INITIAL_GRID_PX);
    const zoomY = viewportHeight / (fitH * INITIAL_GRID_PX);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(zoomX, zoomY)));

    // 建物中心が画面中央に来るようにパンを計算
    const centerGridX = (minX + maxX) / 2;
    const centerGridY = (minY + maxY) / 2;
    const newPanX = viewportWidth / 2 - centerGridX * INITIAL_GRID_PX * newZoom;
    const newPanY = viewportHeight / 2 - centerGridY * INITIAL_GRID_PX * newZoom;

    set({ zoom: newZoom, panX: newPanX, panY: newPanY });
  },
  zoomToFitContent: (viewportWidth, viewportHeight, marginMm = 2000) => {
    const { canvasData } = get();
    const b = computeContentBounds(canvasData);
    if (!b) {
      // 空ページ: 原点(0,0)を画面中央・デフォルトズームに戻す。
      set({ zoom: 1, panX: viewportWidth / 2, panY: viewportHeight / 2 });
      return;
    }
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const marginGrid = marginMm / 10;
    const fitW = Math.max(w, 1) + marginGrid * 2;
    const fitH = Math.max(h, 1) + marginGrid * 2;
    const zoomX = viewportWidth / (fitW * INITIAL_GRID_PX);
    const zoomY = viewportHeight / (fitH * INITIAL_GRID_PX);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(zoomX, zoomY)));
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    set({
      zoom: newZoom,
      panX: viewportWidth / 2 - cx * INITIAL_GRID_PX * newZoom,
      panY: viewportHeight / 2 - cy * INITIAL_GRID_PX * newZoom,
    });
  },
  zoomToFitPrintArea: (viewportWidth, viewportHeight, marginMm = 500) => {
    const { canvasData, printPaperSize, printScale, printAreaCenter } = get();
    // 用紙寸法 (mm) と縮尺係数 (= getPrintAreaGrid 相当をインライン化、
    // pdf-lib + Konva を bundle に巻き込まないため pdfExport.ts から import しない)
    const PAPER_MM: Record<string, { width: number; height: number }> = {
      A4_portrait: { width: 210, height: 297 },
      A4_landscape: { width: 297, height: 210 },
      A3_portrait: { width: 297, height: 420 },
      A3_landscape: { width: 420, height: 297 },
    };
    const SCALE_FACTORS: Record<string, number> = {
      '1/50': 50, '1/100': 100, '1/200': 200, '1/300': 300,
    };
    const paper = PAPER_MM[printPaperSize];
    const factor = SCALE_FACTORS[printScale];
    if (!paper || !factor) return;
    const areaWidthGrid = (paper.width * factor) / 10;
    const areaHeightGrid = (paper.height * factor) / 10;

    // 中心座標 (= GridCanvas の印刷枠ロジックと同等)
    let centerGridX: number, centerGridY: number;
    if (printAreaCenter) {
      centerGridX = printAreaCenter.x;
      centerGridY = printAreaCenter.y;
    } else if (canvasData.buildings.length > 0) {
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const b of canvasData.buildings) {
        for (const p of b.points) {
          if (p.x < bMinX) bMinX = p.x; if (p.y < bMinY) bMinY = p.y;
          if (p.x > bMaxX) bMaxX = p.x; if (p.y > bMaxY) bMaxY = p.y;
        }
      }
      centerGridX = (bMinX + bMaxX) / 2;
      centerGridY = (bMinY + bMaxY) / 2;
    } else {
      centerGridX = 0;
      centerGridY = 0;
    }

    // 印刷範囲 + 余白を画面に収めるズーム計算
    const marginGrid = marginMm / 10;
    const fitW = areaWidthGrid + marginGrid * 2;
    const fitH = areaHeightGrid + marginGrid * 2;
    const zoomX = viewportWidth / (fitW * INITIAL_GRID_PX);
    const zoomY = viewportHeight / (fitH * INITIAL_GRID_PX);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(zoomX, zoomY)));

    // 中心が画面中央に来るようパン
    const newPanX = viewportWidth / 2 - centerGridX * INITIAL_GRID_PX * newZoom;
    const newPanY = viewportHeight / 2 - centerGridY * INITIAL_GRID_PX * newZoom;

    set({ zoom: newZoom, panX: newPanX, panY: newPanY });
  },
  resetCanvas: () => {
    set({
      canvasData: createEmptyCanvasData(),
      history: { past: [], future: [] },
      isDirty: false,
      selectedIds: [],
    });
  },
}));
