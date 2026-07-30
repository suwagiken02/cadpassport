// === 座標（グリッド単位、1単位=10mm） ===
export type Point = { x: number; y: number };

// === 操作モード ===
// R-1g: 'roof' モードは撤去（setMode('roof') の呼び出しが無く未到達だった）。
//   屋根の作成/編集は「躯体 → 屋根」の領域描きと、平面の出幅点線タップに一本化済み。
export type ModeType = 'view' | 'building' | 'handrail' | 'post' | 'anti' | 'select' | 'erase' | 'memo' | 'obstacle' | 'move-select';

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
  /** 屋根形状 (= E-3.12、 立面の見え方のヒント。undefined は旧データ互換)
   *  hip:寄棟 / gable:切妻 / flat:水平 / shed:片流れ */
  roofShape?: 'hip' | 'gable' | 'flat' | 'shed';
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

// === 屋根（独立オブジェクト・R-1d / R-1e-fix） ===
/**
 * 壁外周上の連続区間（周方向 forward = 辺 index 増加・arc 増加方向に start→end）。
 * 辺の途中で始まり/終われる（下屋が壁の途中で切れるケース）。R-1e-fix のキャラ歩き入力の結果。
 * (startEdge,startT) から周方向に (endEdge,endT) までの弧を屋根区間とする。full=全周。
 */
export type WallSpan = {
  startEdge: number;
  startT: number;
  endEdge: number;
  endT: number;
  /** 全周（start==end の縮退回避）。true のとき start/end は無視して外周一周。 */
  full?: boolean;
};

/**
 * 独立した屋根オブジェクト。1 建物に複数（大屋根＋下屋）持てる。
 * polygon = 閉じた屋根領域（グリッド座標の頂点列。2F 作成と同じ領域描き入力の結果・R-1e-fix7）。
 * 出幅は「polygon の辺のうち建物の壁と重なる辺」にのみ uniformMm を適用（建物内部を横切る境界辺は
 * 出幅なし）。旧 BuildingShape.roof(RoofConfig)/span/edgeRange は normalize 時に polygon へ変換。
 */
export type Roof = {
  id: string;
  buildingId: string;
  /** 閉じた屋根領域（グリッド座標）。未設定の旧データは normalize で建物外周へ変換。 */
  polygon?: Point[];
  /** @deprecated R-1e-fix の壁外周区間。R-1e-fix7 で polygon に統合。読み込み互換のため残置。 */
  span?: WallSpan;
  /** @deprecated R-1e の辺 index 列。読み込み互換のため残置。 */
  edgeRange?: number[];
  /** 屋根形状（立面の見え方ヒント）。 */
  roofShape: 'hip' | 'gable' | 'flat' | 'shed';
  /** 全辺共通の出幅(mm)。 */
  uniformMm: number;
  /** 辺別の出幅(mm)。指定辺は uniformMm より優先。 */
  edgeOverhangsMm?: Record<number, number>;
  /** 片流れの軒側（表示ヒント）。 */
  katanagareDirection?: 'north' | 'south' | 'east' | 'west';
  /** 切妻の妻面方向（表示ヒント）。 */
  kirizumaGableFace?: 'ew' | 'ns';
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
 * 高さマーカー: 建物の壁外周線 (building.points) 上の指定位置に立つ、 高さ (mm) 情報を持つマーカー。
 * R-1b: 常に building.points の辺を基準にする (getOutlinePolygon が壁線を返す)。
 *   heightMm の意味は「壁位置の高さ (= 軒高)」。軒先の下がりは勾配×出幅でシステムが計算する (R-1c)。
 *   ※旧データ (version <'2.0') のマーカーは屋根破線基準で置かれており、同じ t が壁の短い辺上では
 *     別位置に着地する (角付近ほど差が大)。分岐再配置はせず再解釈のみ (canvasStore CANVAS_SCHEMA_VERSION)。
 * heightMm は 1mm 精度内部保持 (= 仕様通り、 UI 表示は m 換算)。
 */
export type HeightMarker = {
  id: string;
  /** 紐づく建物 ID */
  buildingId: string;
  /** 壁外周線 building.points の辺の index (= 0..n-1) */
  edgeIndex: number;
  /** 辺上の位置 (= 0.0 = p1 端、 1.0 = p2 端) */
  t: number;
  /** 高さ (mm 単位、 = 壁位置の軒高) */
  heightMm: number;
  /** 階指定 (= undefined は全階共通、 既存 MagnetPin と同パターン) */
  floor?: number;
};

// === 棟ライン (= 寄棟対応・E-3.8) ===
/**
 * 棟ライン: 建物内部に引く水平な棟(むね)の線分。立面の屋根バンド上端(隅棟・寄棟)生成に使う。
 * p1/p2 はグリッド座標 (= 1グリッド=10mm)。heightMm は棟高 (= GL 基準)。
 * CanvasData への追加は E-3.8c で行う (= ここでは型定義のみ)。
 */
export type RidgeLine = {
  id: string;
  /** 紐づく建物 ID (= 内部にある建物) */
  buildingId: string;
  /** 棟線の端点 (= グリッド座標) */
  p1: Point;
  p2: Point;
  /** 棟高 (= mm 単位・GL 基準) */
  heightMm: number;
  /** 階指定 (= undefined は全階共通、 既存 HeightMarker/MagnetPin と同パターン) */
  floor?: number;
};

// === 立面図のキャンバス配置 (= E-4) ===
/**
 * 立面プリミティブ: 立面ビューを構成する描画要素。座標はグループローカル・グリッド単位
 * (= 左端=0、 GL=0、 上方向は負)。線幅/文字サイズは px。ElevationModal の SVG と同等内容。
 */
/**
 * 立面プリミティブの意味タグ (= E-8a)。図形種別(kind: line/rect/…)とは別に「何を描いた線か」を持つ。
 * 部材単位の編集（選択・削除・移動）と、平面変更で立面を再生成したときの差分再マッチに使う。
 */
export type ElevationPrimitiveKind =
  | 'building'   // 建物シルエット
  | 'roof'       // 屋根投影バンド
  | 'ridge'      // 棟線
  | 'gl'         // GL 線
  | 'board'      // 作業床(踏板)
  | 'rail'       // 手摺・コマ横線
  | 'post'       // 支柱
  | 'jack'       // ジャッキ
  | 'raise'      // 妻面のコマ嵩上げ(段違い作業床)
  | 'dim'        // 寸法線
  | 'dimText'    // 寸法値の文字
  | 'text';      // その他の文字(GL ラベル・棟ラベル等)

/**
 * 再マッチ用ヒント (= E-8a)。再生成で id が変わっても kind + ヒントで対応付ける。
 * heightMm(GL 基準)とスパン/支柱の index は平面を編集しても比較的安定した鍵になる。
 */
export type ElevationPrimitiveMeta = {
  kind: ElevationPrimitiveKind;
  /** 安定 id。同じ図なら再生成しても同じ値になるよう kind＋高さ/添字/座標から組み立てる。 */
  id: string;
  /** 高さ (= mm、 GL 基準)。board/rail/dim/ridge 等の同定用 */
  heightMm?: number;
  /** 添字 (= 支柱番号・スパン番号・段番号など) */
  index?: number;
  /** 面軸座標 (= グループローカル・グリッド)。post/jack の横位置 */
  x?: number;
  /** 紐づく建物 id (= building/roof) */
  buildingId?: string;
};

export type ElevationPrimitive =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: number[]; opacity?: number; meta?: ElevationPrimitiveMeta }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; fillOpacity?: number; stroke?: string; width?: number; meta?: ElevationPrimitiveMeta }
  | { kind: 'polygon'; points: number[]; fill?: string; fillOpacity?: number; stroke?: string; width?: number; meta?: ElevationPrimitiveMeta }
  | { kind: 'text'; x: number; y: number; text: string; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; meta?: ElevationPrimitiveMeta };

/**
 * 立面の編集差分 (= E-8a、 案B)。生成された primitives は書き換えず、差分だけを積む。
 * 元データが保護され、undo は edits 配列の履歴でそのまま扱える。
 *   hide : 部材を消す（削除マーク）
 *   move : ローカル座標(グリッド)のオフセット
 *   text : 文字の上書き（元へ戻すときはこの edit を外す）
 *   add  : ユーザーが描き足したプリミティブ（meta.id は追加時に採番）
 */
export type ElevationEdit =
  | { op: 'hide'; targetId: string }
  | { op: 'move'; targetId: string; dx: number; dy: number }
  | { op: 'text'; targetId: string; text: string }
  | { op: 'add'; primitive: ElevationPrimitive };

/**
 * 立面ビュー: 1 面の立面を面グループ単位でキャンバスに配置したもの (= E-4)。
 * originGrid はグループのローカル原点(左下=GL・左端)のキャンバス配置位置(グリッド)。
 * scale はローカル座標(グリッド)への倍率(既定 1 = 平面と同縮尺)。
 */
export type ElevationView = {
  id: string;
  face: 'north' | 'south' | 'east' | 'west';
  originGrid: Point;
  scale: number;
  primitives: ElevationPrimitive[];
  /**
   * 部材ブロック (= E-8-v2)。立面編集の一次データ。
   * これがあるビューは「背景プリミティブ＋parts から都度生成した部材」で描く。
   * 旧ビュー(undefined)は primitives をそのまま描き、編集を開いたときに再生成して移行する。
   */
  parts?: import('@/lib/konva/elevation/elevationParts').ElevationPart[];
  /** 部材を実座標へ戻すための幾何(支柱位置・段構成)。parts とセット。 */
  geom?: import('@/lib/konva/elevation/elevationParts').ElevationPartGeometry;
  /** ユーザー編集の差分 (= E-8a)。未編集は undefined。primitives は再生成で入れ替わるが差分は残る。 */
  edits?: ElevationEdit[];
  /** 再生成で引き継げなかった編集 (= E-8d)。勝手に消さず一覧提示し、ユーザーが削除する。 */
  orphanEdits?: ElevationEdit[];
};

// === 寸法線オフセット (= 寸法線移動 Phase 1) ===
/** 寸法線の種別キー。S-4 で N 階へ template literal 拡張 (`${cat}${floor}F`)。
 *  {1,2} では従来 6 key と一致。DEFAULT_DIMENSION_OFFSETS_MM は 6 key のまま維持し、
 *  3F+ は読取側の `?? 0` フォールバックで吸収する (DB は jsonb で無改修)。 */
export type DimensionLineKey = `${'scaffold' | 'wall' | 'roof'}${number}F`;

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
  /** 独立屋根オブジェクト（R-1d）。undefined は旧データ互換 → normalize で building.roof から lift。 */
  roofs?: Roof[];
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
  /** N 階のスタート角（S-5c）。floor→config。3F 以上はここにのみ保存。
   *  floor 1/2 は既存 scaffoldStart1F/2F へ両建て（後方互換の直読み consumer 用）。 */
  scaffoldStartByFloor?: Record<number, ScaffoldStartConfig>;
  /** マグネットピン（undefined は既存プロジェクト互換、実行時は [] に正規化）*/
  magnetPins?: MagnetPin[];
  /** 高さマーカー (= undefined は既存プロジェクト互換、 normalize で [] に正規化) */
  heightMarkers?: HeightMarker[];
  /** 棟ライン (= E-3.8、 undefined は既存プロジェクト互換、 normalize で [] に正規化) */
  ridgeLines?: RidgeLine[];
  /** 立面ビュー (= E-4、 キャンバスに配置した立面。undefined は既存互換、 normalize で [] に正規化) */
  elevationViews?: ElevationView[];
  /** 寸法線オフセット mm (= 既存 hardcoded からの delta、 ドラッグで更新、 normalize で default 補完) */
  dimensionOffsetsMm?: DimensionOffsetsMm;
};

/**
 * スタート角を階番号キーの record に射影する派生アクセサ。
 * S-5c: scaffoldStartByFloor(新・N階) を優先し、floor 1/2 は既存 scaffoldStart1F/2F を
 * フォールバックとして合成する。3F 以上は byFloor から取得。
 *
 * - {1, 2} で byFloor 未設定なら {1: scaffoldStart1F, 2: scaffoldStart2F} を返し、従来と完全同一。
 * - deprecated な全体 legacy `scaffoldStart` はここに畳み込まない（consumer 側が「全階に星が無い
 *   ときのみ」の粗いフォールバックとして扱うため。畳み込むと {1,2} の読取値が変わり byte 不変を破る）。
 * - 返り値は常に key 1/2 を含む（値は undefined 可）＋ byFloor の全 floor key。
 */
export function getScaffoldStartByFloor(
  data: Pick<CanvasData, 'scaffoldStart1F' | 'scaffoldStart2F' | 'scaffoldStartByFloor'>,
): Record<number, ScaffoldStartConfig | undefined> {
  const out: Record<number, ScaffoldStartConfig | undefined> = { ...(data.scaffoldStartByFloor ?? {}) };
  if (out[1] === undefined) out[1] = data.scaffoldStart1F;
  if (out[2] === undefined) out[2] = data.scaffoldStart2F;
  return out;
}

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

