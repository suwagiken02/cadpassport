// === 座標（グリッド単位、1単位=10mm） ===
export type Point = { x: number; y: number };

// === 操作モード ===
export type ModeType = 'view' | 'building' | 'handrail' | 'post' | 'anti' | 'select' | 'erase' | 'memo' | 'obstacle' | 'move-select' | 'roof';

// === 建物入力方式 ===
export type BuildingInputMethod = 'template' | 'direction';

// === 屋根タイプ ===
export type RoofType = 'kirizuma' | 'yosemune' | 'katanagare' | 'none';

// === 屋根出幅設定 ===
export type RoofConfig = {
  roofType: RoofType;
  /** 全面同じ出幅の場合の値(mm) */
  uniformMm: number;
  /** 面ごとの出幅(mm)。null=全面同じ */
  northMm: number | null;
  southMm: number | null;
  eastMm: number | null;
  westMm: number | null;
  /** 片流れの軒側 */
  katanagareDirection?: 'north' | 'south' | 'east' | 'west';
  /** 切妻の妻面方向 */
  kirizumaGableFace?: 'ew' | 'ns';
  /** 辺ごとの出幅(mm)。L字など多辺ポリゴン用 */
  edgeOverhangsMm?: Record<number, number>;
};

// === 建物外形 ===
export type BuildingShape = {
  id: string;
  type: 'polygon';
  points: Point[];
  fill: string;
  roof?: RoofConfig;
  floor?: number;
  templateId?: string;
  templateDims?: Record<string, number>;
};

// === 屋根の出幅 ===
export type RoofOverhang = {
  id: string;
  buildingId: string;
  faceIndex: number;
  overhangMm: number;
};

// === 障害物 ===
export type ObstacleType = 'ecocute' | 'aircon' | 'bay_window' | 'carport' | 'sunroom' | 'balcony' | 'custom_rect' | 'custom_circle';

export type Obstacle = {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Point[];
  label?: string;
  memo?: string;
};

// === 手摺 ===
// メートル規格: 1800〜100。 インチ規格(CAD パスポート規格切替): 1829/1524/1219/914/610/410/305/200。
// union は両規格の全長さを含む（保存済みデータの後方互換も兼ねる）。
export type HandrailLengthMm =
  | 1829 | 1800 | 1524 | 1500 | 1219 | 1200 | 1000 | 914 | 900 | 800
  | 610 | 600 | 500 | 410 | 400 | 305 | 300 | 200 | 150 | 100;

/** 部材設定で選択できる全サイズ（メートル規格・降順） */
export const ALL_HANDRAIL_SIZES: HandrailLengthMm[] = [1800, 1500, 1200, 1000, 900, 800, 600, 500, 400, 300, 200, 150, 100];

/** デフォルトで ON のサイズ（メートル規格） */
export const DEFAULT_ENABLED_SIZES: HandrailLengthMm[] = [1800, 1200, 900, 600, 400, 300, 200];

// === インチ規格（CAD パスポート: メートル/インチ規格切替） ===
/** インチ規格で選択できる全サイズ（降順・全 8 種） */
export const INCH_ALL_HANDRAIL_SIZES: HandrailLengthMm[] = [1829, 1524, 1219, 914, 610, 410, 305, 200];

/** インチ規格でデフォルト ON のサイズ（全 8 種を既定 ON） */
export const INCH_DEFAULT_ENABLED_SIZES: HandrailLengthMm[] = [1829, 1524, 1219, 914, 610, 410, 305, 200];

export type HandrailSettings = {
  enabledSizes: HandrailLengthMm[];
  priorityConfig: PriorityConfig;
};

/** 優先部材リスト設定 */
export type PriorityConfig = {
  /** 部材の並び順（上が第1優先） */
  order: HandrailLengthMm[];
  /** 先頭 N 個がメイン部材 */
  mainCount: number;
  /** 次の N 個がサブ部材 */
  subCount: number;
  /** 次の N 個が調整部材 */
  adjustCount: number;
  // 残りは除外（自動割付では使わない）
};

/** 新規ユーザー向けデフォルト優先設定 */
export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  order: [1800, 1500, 1200, 1000, 900, 800, 600, 500, 400, 300, 200, 150, 100],
  mainCount: 1,
  subCount: 6,
  adjustCount: 5,
};

export type HandrailDirection = 'horizontal' | 'vertical' | number;

export type Handrail = {
  id: string;
  x: number;
  y: number;
  lengthMm: HandrailLengthMm;
  direction: HandrailDirection;
  color: string;
  /** 所属階。undefined は 1F 相当（既存データ後方互換） */
  floor?: number;
};

// === 支柱 ===
export type Post = {
  id: string;
  x: number;
  y: number;
  /** 所属階。undefined は 1F 相当 */
  floor?: number;
};

/** インチ規格向けデフォルト優先設定（全 8 種を順位付け：メイン1・サブ6・調整1） */
export const INCH_DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  order: [1829, 1524, 1219, 914, 610, 410, 305, 200],
  mainCount: 1,
  subCount: 6,
  adjustCount: 1,
};

// === アンチ（踏板） ===
// メートル規格: 幅 400/250、 インチ規格: 幅 500/240。
export type AntiWidth = 400 | 250 | 500 | 240;

export type Anti = {
  id: string;
  x: number;
  y: number;
  width: AntiWidth;
  lengthMm: number;
  direction: 'horizontal' | 'vertical';
  /** 所属階。undefined は 1F 相当 */
  floor?: number;
};

/** 部材の所属階を取得。floor 未設定は 1F 扱い（既存データ後方互換）。*/
export function getFloor(item: { floor?: number }): number {
  return item.floor ?? 1;
}

// === メモ ===
export type MemoShape = 'rect' | 'cloud' | 'circle' | 'speech';
export type Memo = {
  id: string;
  x: number;
  y: number;
  text: string;
  style: string;
  shape?: MemoShape;
  angle?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  arrowTo?: Point;
};

// === マグネットピン ===
/**
 * マグネットピン: 既存頂点から方向と距離を指定して立てるガイドピン。
 * 自由移動オブジェクト（障害物/メモ/外壁）を吸着する。
 * floor === undefined の場合は全階共通で表示される。
 */
export type MagnetPin = {
  id: string;
  /** グリッド座標（1グリッド=10mm）*/
  x: number;
  y: number;
  /** 階指定（undefined なら全階共通、スタート角★と同じ扱い）*/
  floor?: number;
  /** 基準点の情報（履歴として保持、表示には使わない）
   * undefined なら任意位置から作成
   */
  sourceInfo?: {
    /** 基準点の種類 */
    type: 'buildingCorner' | 'roofCorner' | 'handrailEnd' | 'obstacleCorner' | 'free';
    /** 参照元の ID（buildingCorner なら buildingId、handrailEnd なら handrailId など）*/
    refId?: string;
    /** 基準点のグリッド座標 */
    baseX: number;
    baseY: number;
    /** 基準点から現在位置までの累積オフセット履歴 */
    offsets: Array<{ dx: number; dy: number }>;
  };
};

// === 高さマーカー (= Task #8) ===
/**
 * 高さマーカー: 建物外周/屋根破線上の指定位置に立つ、 高さ (mm) 情報を持つマーカー。
 * 屋根あり → computeOffsetPolygon 上の辺、 屋根なし → building.points 上の辺、
 * どちらも辺数 n は同じなので edgeIndex で統一参照可能。
 * heightMm は 1mm 精度内部保持 (= 仕様通り、 UI 表示は m 換算)。
 */
export type HeightMarker = {
  id: string;
  /** 紐づく建物 ID */
  buildingId: string;
  /** 建物 outline 辺の index (= 0..n-1) */
  edgeIndex: number;
  /** 辺上の位置 (= 0.0 = p1 端、 1.0 = p2 端) */
  t: number;
  /** 高さ (mm 単位) */
  heightMm: number;
  /** 階指定 (= undefined は全階共通、 既存 MagnetPin と同パターン) */
  floor?: number;
};

// === 寸法線オフセット (= 寸法線移動 Phase 1) ===
/** 寸法線の種別キー (= handrailSettingsStore の DimensionVisibility と同 6 key) */
export type DimensionLineKey = 'scaffold1F' | 'scaffold2F' | 'wall1F' | 'wall2F' | 'roof1F' | 'roof2F';

/** 種別ごとの外向き mm offset (= 既存 hardcoded px からの相対 delta、 default 0 で挙動完全維持) */
export type DimensionOffsetsMm = Record<DimensionLineKey, number>;

export const DEFAULT_DIMENSION_OFFSETS_MM: DimensionOffsetsMm = {
  scaffold1F: 0, scaffold2F: 0, wall1F: 0, wall2F: 0, roof1F: 0, roof2F: 0,
};

// === キャンバスデータ（保存用） ===
export type CanvasData = {
  version: string;
  grid: {
    unitMm: 10;
    cols: number;
    rows: number;
  };
  buildings: BuildingShape[];
  roofOverhangs: RoofOverhang[];
  obstacles: Obstacle[];
  handrails: Handrail[];
  posts: Post[];
  antis: Anti[];
  memos: Memo[];
  compass: { angle: number };
  /** @deprecated 後方互換。新規は scaffoldStart1F / scaffoldStart2F を使用。
   *  normalize 時に scaffoldStart1F / 2F と同期される。 */
  scaffoldStart?: ScaffoldStartConfig;
  /** 1F のスタート角（1F+2F 両方保持可能）*/
  scaffoldStart1F?: ScaffoldStartConfig;
  /** 2F のスタート角（1F+2F 両方保持可能）*/
  scaffoldStart2F?: ScaffoldStartConfig;
  /** マグネットピン（undefined は既存プロジェクト互換、実行時は [] に正規化）*/
  magnetPins?: MagnetPin[];
  /** 高さマーカー (= undefined は既存プロジェクト互換、 normalize で [] に正規化) */
  heightMarkers?: HeightMarker[];
  /** 寸法線オフセット mm (= 既存 hardcoded からの delta、 ドラッグで更新、 normalize で default 補完) */
  dimensionOffsetsMm?: DimensionOffsetsMm;
};

// === 建物テンプレート ===
export type BuildingTemplateId =
  | 'rect'
  | 'l_ne' | 'l_nw' | 'l_se' | 'l_sw'
  | 'convex_s' | 'convex_n' | 'convex_e' | 'convex_w'
  | 'u_s' | 'u_n'
  | 't_cross'
  | 'circle';

export type TemplateDimension = {
  key: string;
  label: string;
  defaultMm: number;
};

export type BuildingTemplate = {
  id: BuildingTemplateId;
  name: string;
  icon: string;
  dimensions: TemplateDimension[];
  buildPoints: (dims: Record<string, number>) => Point[];
};

// === 足場開始設定 ===
export type StartCorner = 'ne' | 'nw' | 'se' | 'sw';

export type ScaffoldStartConfig = {
  corner: StartCorner;
  /** 選択した頂点のインデックス（getBuildingEdgesClockwise の辺順） */
  startVertexIndex?: number;
  /** 角に接する2面の離れ(mm) - face1は水平面、face2は垂直面 */
  face1DistanceMm: number;
  face2DistanceMm: number;
  /** 角に接する2面の最初の手摺の長さ(mm) */
  face1FirstHandrail: HandrailLengthMm;
  face2FirstHandrail: HandrailLengthMm;
  /** 対象階。undefined は 1F 相当（既存データ後方互換） */
  floor?: number;
};

// === 出力設定 ===
export type PaperSize = 'A4_portrait' | 'A4_landscape' | 'A3_portrait' | 'A3_landscape';
export type ScaleOption = '1/50' | '1/100' | '1/200' | '1/300' | 'auto';

export type ExportSettings = {
  format: 'pdf' | 'png' | 'dxf';
  paperSize: PaperSize;
  scale: ScaleOption;
  companyName: string;
  companyLogoUrl?: string;
  siteName: string;
  date: string;
};

// === プロジェクト ===
export type Project = {
  id: string;
  owner_id: string;
  name: string;
  address?: string;
  contractor_name?: string;
  created_at: string;
  updated_at: string;
};

export type Drawing = {
  id: string;
  project_id: string;
  title: string;
  canvas_data: CanvasData;
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
};

// === Phase D: 順次決定フロー ===

/** Phase D: 1辺の候補1つ分 */
export type PhaseDCandidate = {
  /** 割付合計 mm（sum of rails）*/
  railsTotalMm: number;
  /** 計算された終点離れ mm */
  endDistanceMm: number;
  /** 希望離れとの差（mm、符号付き、正=希望より大きい側、負=小さい側）*/
  diffFromDesired: number;
  /** priorityConfig による平均スコア（priorityConfig なしなら 0）*/
  score: number;
  /** 候補の割付（既存の LayoutCombination.rails と同じ）*/
  rails: HandrailLengthMm[];
};

/** Phase D: 1辺の候補群（exact / larger / smaller の3枠） */
export type PhaseDEdgeCandidates = {
  /** 模範解（希望にぴったり）。存在しない場合は null */
  exact: PhaseDCandidate | null;
  /** 希望より大きい側の代表候補。存在しない場合は null */
  larger: PhaseDCandidate | null;
  /** 希望より小さい側の代表候補。存在しない場合は null */
  smaller: PhaseDCandidate | null;
};

