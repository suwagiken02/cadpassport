// ============================================================
// 立面図 E-2: 立面エンジン（縦×横の座標計算・pure・node 安全）
//
// E-1 の FaceSpanColumn（横方向のスパン列）＋ 高さ情報（縦方向）から、
// 1 つの面の立面図に描く要素の「座標リスト」を計算する。描画は E-3、
// ここは数字のみ。前後判定・入隅の切断は E-5。
//
// 座標系（E-1 と統一）:
//   水平（変軸）= グリッド単位（1 grid = 10mm、FaceSpanColumn.xStart/xEnd と同じ）。
//   垂直（高さ）= mm（GL 基準）。rails 部材長も mm。E-3 で px 換算する。
//
// 縦方向は電卓 heightToFloors（calculator.ts）と同じ思想:
//   floors = 段数 = floor((H-1)/1800)、startMm = H − 1800×floors（スタート端数）。
//   整合をテストで固定（5000 → スタート1400・2段・1800下がり）。
// ============================================================
import type { BuildingShape, HeightMarker, Point, RoofOverhang, RidgeLine, Roof } from '@/types';
import { getFloor } from '@/types';
import { projectRidgeLinesToFace, type ProjectedRidge } from './ridgeProjection';
import { heightToFloors, LAYER_HEIGHT_MM, PILLAR_START_MIN_MM, type PillarType } from '../calculator';
import { mmToGrid } from '../gridUtils';
import { computeOffsetPolygon } from '../roofUtils';
import { resolveBuildingOverhangsGrid } from '../roofResolve';
import { getRoofPolygon } from '../roofRegion';
import { getHeightAtPosition } from '../heightInterpolation';
import {
  assignRidgeLinesToRoofs,
  clipSegmentsToIntervals,
  roofEaveMm,
  roofExtXRange,
  roofFaceOverhangGrid,
  roofFaceWallIntervals,
  roofFrontness,
  roofMarkerMaxMm,
  roofRunMm,
  roofWallCoverages,
  variableCoord,
} from './roofBandSource';
import {
  applyBuildingOcclusion, buildingOccluders, frontStepsForFrontness, hiddenIntervalsAt,
  type Occluder,
} from './occlusion';
import type { Face, FaceSpanColumn } from './faceReconstruction';
import {
  FIRST_KOMA_OFFSET_MM, JACK_WIND_MAX_MM, JACK_WIND_MIN_MM, KOMA_PITCH_MM,
  jackTopForStartMm, komaLevelsFromJackMm, railKomaLevelsMm,
} from './komaGrid';

// ── 定数（1 箇所に集約）──
/** 足場 1 段の高さ(mm)。電卓と単一ソース（calculator.ts）を再 export。 */
export { LAYER_HEIGHT_MM };
/** 支柱コマピッチ(mm)。楔ポケット間隔（足場基礎仕様: 1800 = 4×450）。 */
export { KOMA_PITCH_MM, FIRST_KOMA_OFFSET_MM, JACK_WIND_MIN_MM, JACK_WIND_MAX_MM };
/**
 * 皿(ジャッキ上端)の高さ(mm, GL 基準)のフォールバック。
 * 通常はスタート端数から逆算する（jackTopForStartMm）。段が無い＝逆算できないときだけこれを使う。
 * ※旧実装はこれを固定値として使っていたが、実際はジャッキ巻き 40〜490 で可変（鮎澤氏）。
 */
export const DEFAULT_JACK_MM = 150;

/** 作業床から上方に手が届く範囲(mm)。これを超える屋根面はコマ嵩上げが必要（現場ルール・鮎澤氏確認）。 */
export const REACH_MM = 1900;

// ============================================================
// 1. 縦方向の段構成
// ============================================================
export type ElevationLevels = {
  /** 入力建物高さ(mm, GL 基準・軒高相当)。 */
  buildingHeightMm: number;
  /** ジャッキ上端(mm, GL 基準)。支柱の足元。※現場確認要。 */
  jackTopMm: number;
  /** スタート端数(mm)＝1 段目の高さ（heightToFloors と同値）。 */
  startMm: number;
  /** 段数（heightToFloors と同値）。 */
  floors: number;
  /** 下がり(mm)＝最上段から建物天端までの残り span。 */
  sagariMm: number;
  /** 各作業床の高さ[]（GL 基準・昇順）。length===floors。[startMm, +1800, …]。 */
  levels: number[];
  /** 最上部手摺 / 足場天端(mm, GL 基準)＝ startMm + 1800×floors（= 建物高さ）。 */
  topRailMm: number;
  /** 手摺が取り付く 450 刻み位置[]（ジャッキ上端〜天端・上さん/中さん表現用）。 */
  komaGridMm: number[];
};

export type ElevationLevelsOpts = {
  /** 段高さ(mm)。既定 1800。 */
  layerMm?: number;
  /** ジャッキ上端(mm)。既定 DEFAULT_JACK_MM。 */
  jackMm?: number;
  /** コマピッチ(mm)。既定 KOMA_PITCH_MM。 */
  komaMm?: number;
  /** 支柱種別。既定 'normal'（スタート下限 330 の正ルールが効く）。 */
  pillarType?: PillarType;
};

/** 建物高さ(mm) → 立面の段構成。heightToFloors と整合。 */
export function buildElevationLevels(
  buildingHeightMm: number,
  opts?: ElevationLevelsOpts,
): ElevationLevels {
  const layerMm = opts?.layerMm ?? LAYER_HEIGHT_MM;
  const komaMm = opts?.komaMm ?? KOMA_PITCH_MM;
  const pillarType = opts?.pillarType ?? 'normal';

  const H = Math.round(buildingHeightMm);
  const { startMm, floors } = heightToFloors(H, layerMm, PILLAR_START_MIN_MM[pillarType]);

  const levels: number[] = [];
  for (let i = 0; i < floors; i++) levels.push(startMm + layerMm * i);

  const topRailMm = startMm + layerMm * floors; // heightToFloors 定義上 = H
  const sagariMm = floors > 0 ? H - (startMm + layerMm * (floors - 1)) : 0;

  // 皿(ジャッキ上端)はスタート端数から逆算する（職人がジャッキを巻いて合わせる）。
  //   1 コマ目 = 皿+250、以降 450 刻み。作業床は必ずコマに乗るので皿が一意に決まる。
  //   段が無いときだけ既定値。opts.jackMm があればそれを優先（テスト・特殊ケース用）。
  const jackTopMm = opts?.jackMm
    ?? (floors > 0 ? jackTopForStartMm(startMm, komaMm) : DEFAULT_JACK_MM);

  // コマ列＝スタート基準の 450 刻み（皿+250 から天端まで）。作業床も手摺もこの列に乗る。
  const komaGridMm = floors > 0 ? komaLevelsFromJackMm(jackTopMm, topRailMm, komaMm) : [];

  return { buildingHeightMm: H, jackTopMm, startMm, floors, sagariMm, levels, topRailMm, komaGridMm };
}

// ============================================================
// 2. 横方向: スパン列 → 支柱 x 位置・区間
// ============================================================
export type ElevationSpan = {
  /** 区間開始 x（グリッド・変軸）。 */
  x0: number;
  /** 区間終了 x（グリッド・変軸）。 */
  x1: number;
  /** 部材長(mm)。 */
  lenMm: number;
};

export type ElevationColumns = {
  /** 支柱 x 位置[]（グリッド・変軸、昇順）＝ xStart から rails 累積。length===rails.length+1。 */
  postXs: number[];
  /** 各部材の区間。 */
  spans: ElevationSpan[];
};

/** FaceSpanColumn → 支柱 x 位置（rails 累積）と部材区間。 */
export function buildElevationColumns(faceColumn: FaceSpanColumn): ElevationColumns {
  const postXs: number[] = [faceColumn.xStart];
  const spans: ElevationSpan[] = [];
  let x = faceColumn.xStart;
  for (const lenMm of faceColumn.rails) {
    const x1 = x + mmToGrid(lenMm);
    spans.push({ x0: x, x1, lenMm });
    postXs.push(x1);
    x = x1;
  }
  return { postXs, spans };
}

// ============================================================
// 3. 建物シルエット（面から見た輪郭）
// ============================================================
export type BuildingOutlineSegment = {
  /** 変軸区間 開始（グリッド）。 */
  xStart: number;
  /** 変軸区間 終了（グリッド）。 */
  xEnd: number;
  /** 区間開始側の高さ(mm, GL 基準)。 */
  heightStartMm: number;
  /** 区間終了側の高さ(mm, GL 基準)。heightStart と異なれば妻/傾斜（拡張点）。 */
  heightEndMm: number;
  /**
   * 下端(mm, GL 基準) (= E-9)。未指定＝0＝GL から立ち上がる従来どおりのシルエット。
   * 手前の建物に隠れた区間は、その手前の上端が下端になる（はみ出した部分だけ描く）。
   */
  baseStartMm?: number;
  baseEndMm?: number;
  /**
   * 下端の折れ線 (= E-9-fix)。手前の建物の輪郭に沿って下端が上下するとき、
   * xStart→xEnd の下端をこの点列で表す（未指定＝baseStart/baseEnd の直線）。
   *
   * 遮蔽で見える範囲を細かい短冊に割って別々の四角形として描くと、短冊の左右の縦辺が
   * すべて線として出て「シマシマ」になる（実機症状）。**連続して見える範囲は 1 枚の
   * ポリゴン**にし、下端だけをこの折れ線で表す＝内部に線が出ない。
   */
  basePath?: { x: number; mm: number }[];
  /**
   * この壁の奥行き座標 (= E-9)。面に垂直な軸（N/S は y、E/W は x）。
   * 建物同士・同一建物の前後（L 字の手前の翼が奥の翼を隠す）の判定に使う。
   */
  depthCoord?: number;
};

export type BuildingOutline = {
  buildingId: string;
  floor: number;
  face: Face;
  /** 該当面の辺セグメント（L 字は複数）。空 = 該当面の辺なし or 高さ不明。 */
  segments: BuildingOutlineSegment[];
};

export type BuildingOutlineOpts = {
  /** マーカー無し時のフォールバック高さ(mm)。未指定なら高さ不明の辺はスキップ。 */
  defaultHeightMm?: number;
};

/** ポリゴンの winding（面法線の向き決定用）。area2>0 → 1。 */
function windingSign(pts: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area2 > 0 ? 1 : -1;
}

/** outline 辺 i の面（getFaceEdges と同一規約）。 */
function outlineEdgeFace(pts: Point[], i: number, ws: number): Face {
  const p1 = pts[i];
  const p2 = pts[(i + 1) % pts.length];
  const nx = ws * (p2.y - p1.y);
  const ny = -ws * (p2.x - p1.x);
  if (Math.abs(ny) >= Math.abs(nx)) return ny < 0 ? 'north' : 'south';
  return nx > 0 ? 'east' : 'west';
}

/**
 * 建物を指定面から見た輪郭を作る（矩形ベース: 幅=変軸範囲、高さ=高さマーカー or 既定）。
 *
 * シルエットは building.points（壁）を走査する。軒の出は屋根バンド(roofBands)側で
 * 壁より外へ張り出して表現するため、建物本体は壁位置で描く（建築立面図の標準）。
 * 高さは getHeightAtPosition（辺 index は building.points と同順）で読む。
 *
 * フォールバック:
 *   マーカー 0 個（getHeightAtPosition が null）→ opts.defaultHeightMm を使用。
 *   それも無指定 → その辺はスキップ（segments に含めない）。
 *
 * 辺の内部にある高さマーカー（0<t<1、建物マーカー 2 個以上時）で辺を分割し、
 * 各分割点の高さ（getHeightAtPosition）で折れ線化する＝妻（面中央が高い形）に対応。
 * マーカー 0/1 個は 1 辺 1 セグメント（従来どおり）。屋根勾配は heightStart/heightEnd の
 * 別値で表現（拡張点）。斜め壁・円形は非対応（軸並行前提）。
 */
export function buildBuildingOutline(
  building: BuildingShape,
  face: Face,
  markers?: HeightMarker[],
  opts?: BuildingOutlineOpts,
): BuildingOutline {
  const outline = building.points; // 壁シルエット（軒の出は roofBands で表現）
  const floor = getFloor(building);
  const result: BuildingOutline = { buildingId: building.id, floor, face, segments: [] };
  const n = outline.length;
  if (n < 3) return result;

  const ws = windingSign(outline);
  const ms = markers ?? [];
  const isHorizontal = face === 'north' || face === 'south';

  // 建物マーカー 2 個以上のときのみ辺内部で分割（1 個＝全周一定、0 個＝既定で従来どおり）。
  const buildingMarkerCount = ms.filter(m => m.buildingId === building.id).length;

  for (let i = 0; i < n; i++) {
    if (outlineEdgeFace(outline, i, ws) !== face) continue;
    const p1 = outline[i];
    const p2 = outline[(i + 1) % n];
    const a = isHorizontal ? p1.x : p1.y;
    const b = isHorizontal ? p2.x : p2.y;
    if (Math.abs(a - b) < 1e-6) continue; // 退化辺

    // この辺の内部マーカー t（0<t<1）を分割点にする（妻＝辺中央の高マーカー対応）。
    const innerTs = buildingMarkerCount >= 2
      ? ms
          // R-1n: roofId 付きは屋根 polygon 基準＝壁の辺 index ではないので分割に使わない。
          .filter(m => m.buildingId === building.id && !m.roofId
            && m.edgeIndex === i && m.t > 1e-6 && m.t < 1 - 1e-6)
          .map(m => m.t)
          .sort((x, y) => x - y)
      : [];
    const ts = [0, ...innerTs, 1];

    // 各分割点の高さを t で読む。null（＝マーカー 0 個）は既定へ、無ければ辺スキップ。
    const posAt = (t: number) => a + t * (b - a);
    const heights: number[] = [];
    let skip = false;
    for (const t of ts) {
      let h = getHeightAtPosition(building, ms, i, t);
      if (h == null) {
        const def = opts?.defaultHeightMm;
        if (def == null) { skip = true; break; }
        h = def;
      }
      heights.push(h);
    }
    if (skip) continue;

    // 連続する分割点ごとにサブセグメント（変軸昇順で xStart/xEnd と高さを対応付け）。
    for (let k = 0; k < ts.length - 1; k++) {
      const c0 = posAt(ts[k]);
      const c1 = posAt(ts[k + 1]);
      if (Math.abs(c0 - c1) < 1e-6) continue;
      const startIs0 = c0 <= c1;
      result.segments.push({
        xStart: Math.min(c0, c1),
        xEnd: Math.max(c0, c1),
        heightStartMm: startIs0 ? heights[k] : heights[k + 1],
        heightEndMm: startIs0 ? heights[k + 1] : heights[k],
        // E-9: この壁の奥行き（面に垂直な軸）。軸並行前提なので辺内で一定。
        depthCoord: isHorizontal ? p1.y : p1.x,
      });
    }
  }
  result.segments.sort((s1, s2) => s1.xStart - s2.xStart);
  return result;
}

// ============================================================
// 4. 1 面の立面モデル
// ============================================================
export type ElevationBoard = {
  /** 作業床の高さ(mm, GL 基準)。 */
  levelMm: number;
  x0: number;
  x1: number;
};

export type ElevationRail = {
  /** 横線の高さ(mm, GL 基準)＝コマ位置。 */
  heightMm: number;
  x0: number;
  x1: number;
};

/** 妻面のコマ嵩上げ（段違い作業床）。屋根まで届かないスパンにコマを追加して床を上げる。
 *  現場ルール(4+1分解): 基準階層は 4 コマ=1800 ピッチ。addKoma>=4 は通常段(1800)＋端数コマに分解。 */
export type SpanRaise = {
  /** スパン番号（postXs[spanIndex]〜postXs[spanIndex+1]）。 */
  spanIndex: number;
  /** スパンの変軸区間（グリッド、ElevationSpan と同じ座標系）。 */
  x0: number;
  x1: number;
  /** 追加コマ数（必要最小・450×addKoma だけ床を上げる）。 */
  addKoma: number;
  /** フル段(1800)分解数 = floor(addKoma/4)。 */
  fullLayers: number;
  /** 端数コマ数 = addKoma % 4。 */
  remKoma: number;
  /** 最終床より下の中間フル段の高さ[]（mm, GL 基準・昇順）。remKoma=0 なら最上フル段が最終床。 */
  intermediateFloorsMm: number[];
  /** 嵩上げした最終作業床の高さ(mm, GL 基準)＝最上段床 + 450×addKoma。 */
  raisedFloorMm: number;
};

export type ElevationScaffold = {
  /** 元の列（E-1）。 */
  column: FaceSpanColumn;
  /** 支柱 x 位置[]。 */
  postXs: number[];
  /** この列の縦段構成。 */
  levels: ElevationLevels;
  /** 踏板帯: 各 level の区間。 */
  boards: ElevationBoard[];
  /** 横線: コマ位置 × 区間。 */
  rails: ElevationRail[];
  /** 妻面のコマ嵩上げ（届かないスパンのみ・フラット面や届く面では空）。 */
  spanRaises: SpanRaise[];
};

/** 屋根投影バンド（屋根オブジェクトごと・R-1f。roofs[] が無い旧データは建物ごと）。
 *  外形上辺プロファイルを出幅ぶん傾き保存で延長したもの。
 *  樋面(フラット)は水平延長、妻面(三角)は斜辺(けらば)延長で軒先が勾配なり下がる。
 *  filledToRidge=true は樋面の切妻投影（軒→棟の台形を塗る）、false は延長プロファイルの
 *  線のみ（妻のけらば／棟マーカー無しのフラット軒）。 */
export type RoofBand = {
  buildingId: string;
  /** 屋根オブジェクト id（R-1f）。roofs[] 由来のバンドのみ。旧データの建物単位バンドは undefined。 */
  roofId?: string;
  /** 延長込みの変軸範囲（グリッド）。壁 ± 出幅。 */
  xStart: number;
  xEnd: number;
  /** 台形上端の棟高(mm)。filledToRidge=false のときは軒高(プロファイル最高)＝ラベル/viewBox 用。 */
  ridgeMm: number;
  /** 上辺プロファイル点列（grid x, mm h・GL 下限）。マーカー方式=延長軒、棟ライン方式=上側包絡線。 */
  profile: { x: number; mm: number }[];
  /** 塗るか。true: マーカー方式は軒→棟の台形、棟ライン方式(baseMm あり)は包絡線→軒。false: 線のみ。 */
  filledToRidge: boolean;
  /** 棟ライン方式のとき、包絡線(profile=上端)を塗り下げる軒基準高(mm)。マーカー方式は undefined。 */
  baseMm?: number;
  /**
   * 視点への近さ (= E-9)。大きいほど手前（roofFrontness と同じ規約）。
   * 建物同士の遮蔽で「どちらが手前か」を屋根ごとに判定するために持つ。
   */
  frontness?: number;
};

export type FaceElevation = {
  face: Face;
  floor: number;
  /** 面から見た建物輪郭（多階は階ごとの矩形の重ね）。 */
  buildingOutlines: BuildingOutline[];
  /** 足場（同一面の複数列 = L 字は列ごとに別 scaffold）。 */
  scaffolds: ElevationScaffold[];
  /** 屋根投影バンド（樋面のみ・屋根ごと・妻面では空）。 */
  roofBands: RoofBand[];
  /** 棟(建物最高点)の最大高さ(mm)。roofBands があるとき最大 ridge、無ければ null。
   *  主に viewBox スケール算入用。 */
  ridgeMaxMm: number | null;
};

export type FaceElevationOpts = ElevationLevelsOpts & {
  /** 高さマーカー（既存 CanvasData.heightMarkers）。 */
  markers?: HeightMarker[];
  /** マーカー無し時のフォールバック高さ(mm)。 */
  defaultHeightMm?: number;
  /** faceColumns が空のとき（足場なし・建物のみ表示）に使う対象面。 */
  face?: Face;
  /** faceColumns が空のときに使う階（既定 1）。 */
  floor?: number;
  /** @deprecated R-1g: エンジンは参照しない（出幅は roofs[] のみ）。旧データの互換は
   *  読み込み時の liftLegacyRoofs で roofs[] へ変換する一点に集約した。呼び出し側の
   *  受け渡しを消すまでの間だけ型を残置。 */
  roofOverhangs?: RoofOverhang[];
  /** 独立屋根オブジェクト（R-1d）。渡すと出幅解決を roofs[] 優先で行う。 */
  roofs?: Roof[];
  /** 棟ライン（E-3.8）。ある建物は屋根バンド上端を上側包絡線で生成。既定 undefined=従来挙動。 */
  ridgeLines?: RidgeLine[];
};

/** 建物の辺ごと出幅(グリッド)を解決。R-1g: 屋根オブジェクト(roofs[])のみを見る。
 *  旧 building.roof / roofOverhangs[] の互換は読み込み時の lift（liftLegacyRoofs）に一本化した。 */
function mergedRoofOverhangsGrid(
  building: BuildingShape, roofs?: Roof[],
): number[] {
  return resolveBuildingOverhangsGrid(building, roofs);
}

/** ポリゴンの、指定 face の辺の変軸範囲(グリッド)。該当辺なしは null。 */
function faceXRange(pts: Point[], face: Face): { xStart: number; xEnd: number } | null {
  if (pts.length < 3) return null;
  const ws = windingSign(pts);
  const isHorizontal = face === 'north' || face === 'south';
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (outlineEdgeFace(pts, i, ws) !== face) continue;
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    const a = isHorizontal ? p1.x : p1.y;
    const b = isHorizontal ? p2.x : p2.y;
    mn = Math.min(mn, a, b); mx = Math.max(mx, a, b);
  }
  return Number.isFinite(mn) ? { xStart: mn, xEnd: mx } : null;
}

/**
 * 屋根勾配(mm/mm・無次元) = ①②の高さ差 ÷ 水平 run 距離（pure・R-1c）。
 * ① eaveMm=軒高(水下・壁TOP)、② ridgeMm=棟高、runMm=樋面の壁から棟までの水平距離。
 * ②が無い/run≤0/棟が軒高以下 → 0（フラット＝軒先下がりなし＝従来挙動）。
 */
export function roofSlopePerMm(eaveMm: number, ridgeMm: number, runMm: number): number {
  if (runMm <= 1e-6 || ridgeMm <= eaveMm + 1e-6) return 0;
  return (ridgeMm - eaveMm) / runMm;
}

/** 指定 face の壁の出幅(グリッド)＝その面の軒の出（depth 方向）。face の辺の最大出幅。 */
function faceOverhangGrid(building: BuildingShape, face: Face, roofs?: Roof[]): number {
  const ohs = mergedRoofOverhangsGrid(building, roofs);
  const ws = windingSign(building.points);
  let mx = 0;
  for (let i = 0; i < building.points.length; i++) {
    if (outlineEdgeFace(building.points, i, ws) === face) mx = Math.max(mx, ohs[i] ?? 0);
  }
  return mx;
}

/**
 * 樋面の軒先下がり(mm)を ①②から算出（R-1c）。軒先 = 軒高 − slope × 出幅。
 * run = この面の壁から棟までの水平距離。棟位置は「面と平行な RidgeLine があればその垂直座標、
 *   無ければ建物 bbox 中央（妻の棟マーカー＝中央想定）」。棟が軒高以下 or 出幅0 → 0。
 * 面内で既に傾いている（への字＝妻面）ケースは呼び出し側が eaveMm=ridgeMm となり自然に 0。
 */
function faceEaveDropMm(
  building: BuildingShape, face: Face, eaveMm: number, ridgeMm: number,
  gutterOverhangGrid: number, ridgeLines: RidgeLine[],
): number {
  if (ridgeMm <= eaveMm + 1e-6 || gutterOverhangGrid <= 0) return 0;
  const isHorizontal = face === 'north' || face === 'south';
  const perp = building.points.map(p => (isHorizontal ? p.y : p.x));
  const minP = Math.min(...perp), maxP = Math.max(...perp);
  const wallPerp = (face === 'south' || face === 'east') ? maxP : minP; // 外向き側の壁
  let ridgePerp = (minP + maxP) / 2; // 既定: bbox 中央（妻の棟マーカー想定）
  for (const r of ridgeLines) {
    if (r.buildingId !== building.id) continue;
    const rp1 = isHorizontal ? r.p1.y : r.p1.x;
    const rp2 = isHorizontal ? r.p2.y : r.p2.x;
    if (Math.abs(rp1 - rp2) < 1e-6) { ridgePerp = rp1; break; } // 面と平行な棟の実位置
  }
  const runMm = Math.abs(ridgePerp - wallPerp) * 10;
  return Math.round(roofSlopePerMm(eaveMm, ridgeMm, runMm) * gutterOverhangGrid * 10);
}

/** 外形上辺プロファイル（セグメント上辺の折れ線）を、両端セグメントの傾きを保存して
 *  延長 x 範囲 [extXStart, extXEnd] まで伸ばす。延長点高さ = 端点高さ − 傾き×出幅。GL(0) 下限。
 *  フラット(傾き0)→水平延長、妻の三角→斜辺(けらば)延長で軒先が勾配なり下がる。
 *  R-1c: eaveDropMm を渡すと全プロファイルをその分だけ下げる。樋面は面内傾き0で軒先が下がらない
 *   ため、①②から算出した勾配×出幅の下がり(=軒先=軒高−slope×出幅)をここで一律に適用する。
 *   妻面は面内傾き(への字)で既に下がるので eaveDropMm=0 で従来どおり。 */
function extendedTopProfile(
  segments: BuildingOutlineSegment[],
  extXStart: number,
  extXEnd: number,
  eaveDropMm = 0,
): { x: number; mm: number }[] {
  const wall: { x: number; mm: number }[] = [];
  segments.forEach((s, k) => {
    if (k === 0) wall.push({ x: s.xStart, mm: s.heightStartMm });
    wall.push({ x: s.xEnd, mm: s.heightEndMm });
  });
  if (wall.length < 2) return wall;

  const out: { x: number; mm: number }[] = [];
  const first = wall[0], firstNext = wall[1];
  if (extXStart < first.x - 1e-6) {
    const slope = (firstNext.mm - first.mm) / ((firstNext.x - first.x) || 1);
    out.push({ x: extXStart, mm: Math.max(0, Math.round(first.mm - slope * (first.x - extXStart))) });
  }
  out.push(...wall);
  const last = wall[wall.length - 1], lastPrev = wall[wall.length - 2];
  if (extXEnd > last.x + 1e-6) {
    const slope = (last.mm - lastPrev.mm) / ((last.x - lastPrev.x) || 1);
    out.push({ x: extXEnd, mm: Math.max(0, Math.round(last.mm + slope * (extXEnd - last.x))) });
  }
  if (eaveDropMm > 1e-6) return out.map(p => ({ x: p.x, mm: Math.max(0, Math.round(p.mm - eaveDropMm)) }));
  return out;
}

/** 延長軒プロファイルと棟ライン投影（棟＋隅棟）の上側包絡線を、全ブレークポイントで標本化した
 *  折れ線で返す（pure）。各棟 {a,b,h}: 隅棟=軒端(extX,軒高)→棟端(a/b,h)、棟=水平(a→b)。
 *  寄棟(a≠b)→台形、妻側(a==b)→三角。複数棟は max 合成。座標は grid x / mm。 */
function composeUpperEnvelope(
  eaveProfile: { x: number; mm: number }[],
  ridges: ProjectedRidge[],
  extXStart: number,
  extXEnd: number,
): { x: number; mm: number }[] {
  if (ridges.length === 0 || eaveProfile.length < 2) return eaveProfile;
  const eaveLeft = eaveProfile[0];
  const eaveRight = eaveProfile[eaveProfile.length - 1];

  type Seg = { x0: number; h0: number; x1: number; h1: number };
  const segs: Seg[] = [];
  for (let i = 0; i < eaveProfile.length - 1; i++) {
    segs.push({ x0: eaveProfile[i].x, h0: eaveProfile[i].mm, x1: eaveProfile[i + 1].x, h1: eaveProfile[i + 1].mm });
  }
  const bps = new Set<number>([extXStart, extXEnd]);
  for (const p of eaveProfile) bps.add(p.x);
  for (const r of ridges) {
    segs.push({ x0: eaveLeft.x, h0: eaveLeft.mm, x1: r.a, h1: r.heightMm }); // 隅棟(左)
    if (r.b > r.a + 1e-6) segs.push({ x0: r.a, h0: r.heightMm, x1: r.b, h1: r.heightMm }); // 水平棟
    segs.push({ x0: r.b, h0: r.heightMm, x1: eaveRight.x, h1: eaveRight.mm }); // 隅棟(右)
    bps.add(r.a); bps.add(r.b);
  }

  // 谷/山: 2 セグメントの交点 x もブレークポイントに加える（複数棟の谷が線で潰れないように）。
  const crossX = (s1: Seg, s2: Seg): number | null => {
    const m1 = (s1.h1 - s1.h0) / ((s1.x1 - s1.x0) || 1e-9);
    const m2 = (s2.h1 - s2.h0) / ((s2.x1 - s2.x0) || 1e-9);
    if (Math.abs(m1 - m2) < 1e-9) return null;
    const x = (s2.h0 - m2 * s2.x0 - s1.h0 + m1 * s1.x0) / (m1 - m2);
    const inRange = (s: Seg) => x >= Math.min(s.x0, s.x1) - 1e-6 && x <= Math.max(s.x0, s.x1) + 1e-6;
    return inRange(s1) && inRange(s2) ? x : null;
  };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const x = crossX(segs[i], segs[j]);
      if (x != null && x > extXStart + 1e-6 && x < extXEnd - 1e-6) bps.add(Math.round(x));
    }
  }

  const heightAt = (s: Seg, x: number): number | null => {
    const lo = Math.min(s.x0, s.x1), hi = Math.max(s.x0, s.x1);
    if (x < lo - 1e-6 || x > hi + 1e-6) return null;
    if (Math.abs(s.x1 - s.x0) < 1e-9) return Math.max(s.h0, s.h1);
    return s.h0 + ((x - s.x0) / (s.x1 - s.x0)) * (s.h1 - s.h0);
  };

  const xs = Array.from(bps).filter(x => x >= extXStart - 1e-6 && x <= extXEnd + 1e-6).sort((p, q) => p - q);
  return xs.map(x => {
    let mx = -Infinity;
    for (const s of segs) { const h = heightAt(s, x); if (h != null) mx = Math.max(mx, h); }
    return { x, mm: Math.round(mx) };
  });
}

/** 列の基準建物高さ(mm)＝水下(樋面)。現場ルール(鮎澤氏確認): 段数・天端(建物高さ−1800)は
 *  「水下＝その範囲の最低高さ」を基準にする(1800下がりが最高の作業性。棟に合わせると妻中央
 *  1スパンのために他スパンの作業性が犠牲になる)。妻面では両端の軒高が基準となり、棟部分は
 *  建物外形が足場天端より上へ突き出て見えるのが正しい。
 *
 *  列区間[xStart,xEnd]と重なる全セグメントの端点高さの最小値(=水下)を返す。
 *  重なるセグメントが無い場合のフォールバックは従来挙動を維持(全セグメント最大端点高さ)。 */
function sampleColumnBaseHeightMm(
  column: FaceSpanColumn,
  buildings: BuildingShape[],
  opts?: FaceElevationOpts,
): number | null {
  const b = buildings.find(bb => getFloor(bb) === column.floor);
  const def = opts?.defaultHeightMm ?? null;
  if (!b) return def;
  const outline = buildBuildingOutline(b, column.face, opts?.markers, {
    defaultHeightMm: opts?.defaultHeightMm,
  });
  if (outline.segments.length === 0) return def;
  // 列の変軸区間と重なるセグメント → その端点高さの最小値(水下)。
  const overlapping = outline.segments.filter(
    s => s.xEnd >= column.xStart - 1e-6 && s.xStart <= column.xEnd + 1e-6,
  );
  if (overlapping.length > 0) {
    return Math.round(Math.min(...overlapping.map(s => Math.min(s.heightStartMm, s.heightEndMm))));
  }
  // 重なり無し → 従来フォールバック維持。
  return Math.max(...outline.segments.map(s => Math.max(s.heightStartMm, s.heightEndMm)));
}

/** セグメント上の変軸座標 x(グリッド)における高さ(mm)を線形補間。 */
function heightAtSeg(seg: BuildingOutlineSegment, x: number): number {
  const span = seg.xEnd - seg.xStart;
  if (Math.abs(span) < 1e-6) return seg.heightStartMm;
  const f = (x - seg.xStart) / span;
  return seg.heightStartMm + f * (seg.heightEndMm - seg.heightStartMm);
}

/** スパン区間[aG,bG](グリッド)と重なる壁外形セグメントの最高高さ(mm)。重なり無しは null。
 *  各セグメントは線形なので区間端(クリップ後)で最大になる。
 *  嵩上げの基準は「屋根の形」ではなく「壁の形」(鮎澤氏確定・R-1c-fix2): 壁が高く立ち上がる面
 *  (切妻の妻面・への字マーカーの三角壁)だけが評価対象。棟(RidgeLine 投影)は算入しない
 *  ── 寄棟は壁が全周軒高で一定=全面水下=嵩上げゼロが正。 */
function roofMaxOverSpan(segments: BuildingOutlineSegment[], aG: number, bG: number): number | null {
  let mx = -Infinity;
  for (const s of segments) {
    const lo = Math.max(aG, s.xStart);
    const hi = Math.min(bG, s.xEnd);
    if (hi < lo - 1e-6) continue;
    mx = Math.max(mx, heightAtSeg(s, lo), heightAtSeg(s, hi));
  }
  return mx === -Infinity ? null : mx;
}

/** 妻面のコマ嵩上げを計算。各スパンで壁最高点まで届かない(gap>REACH)分だけ 450 コマを
 *  必要最小数追加し、床を上げる。届く/フラットなスパンは対象外。 */
function computeSpanRaises(
  column: FaceSpanColumn,
  postXs: number[],
  levels: ElevationLevels,
  buildingOutlines: BuildingOutline[],
  opts?: ElevationLevelsOpts,
): SpanRaise[] {
  const komaMm = opts?.komaMm ?? KOMA_PITCH_MM;
  if (levels.floors === 0) return [];
  const topFloorMm = levels.levels[levels.floors - 1]; // 最上段作業床
  const outline = buildingOutlines.find(o => o.floor === column.floor);
  if (!outline) return [];

  const raises: SpanRaise[] = [];
  for (let si = 0; si < postXs.length - 1; si++) {
    const x0 = postXs[si];
    const x1 = postXs[si + 1];
    if (x1 - x0 < 1e-6) continue;
    const roofMax = roofMaxOverSpan(outline.segments, x0, x1);
    if (roofMax == null) continue;
    const gap = roofMax - topFloorMm;
    if (gap <= REACH_MM) continue; // 届く → 嵩上げ不要
    const addKoma = Math.ceil((gap - REACH_MM) / komaMm);
    if (addKoma <= 0) continue;
    // 4+1 分解: 4 コマ=1800 の通常段と端数コマに分ける。
    const fullLayers = Math.floor(addKoma / 4);
    const remKoma = addKoma % 4;
    const raisedFloorMm = topFloorMm + komaMm * addKoma;
    // 中間フル段（最終床より下）。remKoma=0 のときは最上フル段が最終床なので 1 つ少ない。
    const layersBelow = remKoma > 0 ? fullLayers : fullLayers - 1;
    const intermediateFloorsMm: number[] = [];
    for (let k = 1; k <= layersBelow; k++) intermediateFloorsMm.push(topFloorMm + LAYER_HEIGHT_MM * k);
    raises.push({ spanIndex: si, x0, x1, addKoma, fullLayers, remKoma, intermediateFloorsMm, raisedFloorMm });
  }
  return raises;
}

/** 区間 [x0,x1] から holes 群（各 [a,b]）の和を差し引いた残り小区間[]（pure・E-5）。 */
export function subtractIntervals(
  x0: number, x1: number, holes: [number, number][],
): [number, number][] {
  let segs: [number, number][] = [[Math.min(x0, x1), Math.max(x0, x1)]];
  for (const [h0raw, h1raw] of holes) {
    const h0 = Math.min(h0raw, h1raw), h1 = Math.max(h0raw, h1raw);
    const next: [number, number][] = [];
    for (const [a, b] of segs) {
      if (h1 <= a + 1e-6 || h0 >= b - 1e-6) { next.push([a, b]); continue; } // 重なりなし
      if (h0 > a + 1e-6) next.push([a, h0]); // 左の残り
      if (h1 < b - 1e-6) next.push([h1, b]); // 右の残り
      // それ以外は完全被覆 → 落とす
    }
    segs = next;
  }
  return segs.filter(([a, b]) => b - a > 1e-6);
}

/** 視覚ギャップの下限（グリッド）＝50mm。小物件は描画スケールが大きく 50mm でも十分視認できる。 */
const OCCLUSION_GAP_MIN_GRID = 5;
/** 同上限（グリッド）＝400mm。巨大物件でギャップが実測(奥列)を食い過ぎないよう頭打ち。 */
const OCCLUSION_GAP_MAX_GRID = 40;
/**
 * 面の変軸全幅に対するギャップ比（E-5-fix4）。
 * scale-to-fit 描画では gap_px = gapGrid×10×scale、scale ∝ 1/全幅 なので、固定 mm だと
 * 大物件でギャップが数 px に潰れて視認不能になる（E-5-fix3=50mm は 5400mm 面で約3.6px）。
 * 「全幅の一定割合」にすれば px 幅が物件サイズに依らずほぼ一定（1.5%≒描画幅の1.5%≒8〜9px）に見える。
 */
const OCCLUSION_GAP_RATIO = 0.015;

/** scaffolds の変軸全幅（グリッド）から視覚ギャップ（グリッド）を算出（E-5-fix4）。 */
function occlusionGapGrid(scaffolds: ElevationScaffold[]): number {
  let mn = Infinity, mx = -Infinity;
  for (const sc of scaffolds) {
    mn = Math.min(mn, sc.column.xStart, sc.column.xEnd);
    mx = Math.max(mx, sc.column.xStart, sc.column.xEnd);
  }
  const span = Number.isFinite(mn) ? mx - mn : 0;
  return Math.max(OCCLUSION_GAP_MIN_GRID, Math.min(OCCLUSION_GAP_MAX_GRID, Math.round(span * OCCLUSION_GAP_RATIO)));
}

/**
 * 入隅の前後（オクルージョン）で、奥列の横線（rails・boards）を手前列の x 区間で切る（pure・E-5）。
 * 手前 = 面の外向き法線方向で最も遠い列（視点に最も近い）。north/west→depthCoord 小、south/east→大。
 * 各列につき「自分より手前の全列の [xStart,xEnd]」を穴として横線を分割する。
 * E-5-fix3: 穴を両側 gapGrid だけ広げ、奥列の切断端が手前列端から離れて「見える切れ目」を作る
 *   （同一高さの隣接列が突き合って連続に見える問題の対策）。
 * E-5-fix4: gapGrid 未指定時は面の変軸全幅の比率で算出し、物件サイズに依らず切れ目が視認できる
 *   px 幅になるようにする（固定 50mm は大物件で潰れて見えないのが実機の症状だった）。
 * 支柱・ジャッキ・spanRaises は現状維持（v1）。dims 基準（column.rails/postXs）は不変。
 *
 * E-9c: 建物による遮蔽も同じ機構で行う。occluders（自分より手前の建物のシルエット）を
 *   渡すと、横線の高さごとに「手前の上端がその高さ以上の x 区間」を穴として足す
 *   （＝ x 区間 × 高さしきい値）。手前の建物に隠れる足場は描かれない。
 *   建物の穴は gap で広げない（建物の絵がそこにあるので切れ目を作る必要がない）。
 */
export function applyOcclusionCut(
  scaffolds: ElevationScaffold[], face: Face, gapGrid?: number, occluders?: Occluder[],
): ElevationScaffold[] {
  const gap = gapGrid ?? occlusionGapGrid(scaffolds);
  // 「手前度」= 大きいほど手前。north/west は depthCoord 小が手前なので符号反転。
  const frontness = (depthCoord: number) => (face === 'north' || face === 'west' ? -depthCoord : depthCoord);
  return scaffolds.map((sc) => {
    const myFront = frontness(sc.column.depthCoord);
    const holes: [number, number][] = scaffolds
      .filter((o) => o !== sc && frontness(o.column.depthCoord) > myFront + 1e-6)
      .map((o) => [
        Math.min(o.column.xStart, o.column.xEnd) - gap,
        Math.max(o.column.xStart, o.column.xEnd) + gap,
      ]);
    // E-9c: この列より手前の建物のシルエット（高さで効く穴）。
    const steps = frontStepsForFrontness(occluders, myFront);
    if (holes.length === 0 && steps.length === 0) return sc;
    const at = (hMm: number): [number, number][] =>
      steps.length === 0 ? holes : [...holes, ...hiddenIntervalsAt(steps, hMm)];
    const rails = sc.rails.flatMap((r) => subtractIntervals(r.x0, r.x1, at(r.heightMm)).map(([a, b]) => ({ ...r, x0: a, x1: b })));
    const boards = sc.boards.flatMap((b) => subtractIntervals(b.x0, b.x1, at(b.levelMm)).map(([a, c]) => ({ ...b, x0: a, x1: c })));
    return { ...sc, rails, boards };
  });
}

/**
 * 変軸(横)を左右反転した FaceElevation を返す（pure・E-5-fix）。
 * 立面図は「その面の外に立って建物を見た、見た目そのままの左右」で描く必要がある。
 * 現状の描画は「画面左＝変軸の小さい側」で、これは south/west は正しいが north/east は逆:
 *   ・北立面(南向きに見る): 画面左=東(大x) が正 ← 現状 西(小x) なので反転が必要。
 *   ・東立面(西向きに見る): 画面左=南(大y) が正 ← 現状 北(小y) なので反転が必要。
 * 反転は x→-x（開始/終了を持つ要素は入替えて左→右昇順を保つ）。深さ軸(depthCoord)・高さは不変。
 * エンジンの最終出力に対して1回かければ、建物外形・足場・屋根バンド・寸法・全描画に波及する。
 */
export function mirrorVariableAxis(fe: FaceElevation): FaceElevation {
  const nz = (x: number) => (x === 0 ? 0 : -x); // -0 を +0 に正規化
  const seg = (s: BuildingOutlineSegment): BuildingOutlineSegment => ({
    xStart: nz(s.xEnd), xEnd: nz(s.xStart),
    heightStartMm: s.heightEndMm, heightEndMm: s.heightStartMm,
    // E-9: 下端も左右反転（未指定＝GL のままなら持たせない）。
    ...(s.baseStartMm != null || s.baseEndMm != null
      ? { baseStartMm: s.baseEndMm ?? 0, baseEndMm: s.baseStartMm ?? 0 } : {}),
    // E-9-fix: 下端の折れ線も反転（x を反転して左→右の順に戻す）。
    ...(s.basePath
      ? { basePath: s.basePath.map((p) => ({ x: nz(p.x), mm: p.mm })).reverse() } : {}),
    ...(s.depthCoord != null ? { depthCoord: s.depthCoord } : {}),   // 奥行きは左右反転で不変
  });
  const buildingOutlines = fe.buildingOutlines.map(o => ({
    ...o,
    segments: o.segments.map(seg).sort((a, b) => a.xStart - b.xStart),
  }));
  const scaffolds = fe.scaffolds.map(sc => ({
    ...sc,
    column: {
      ...sc.column,
      xStart: nz(sc.column.xEnd), xEnd: nz(sc.column.xStart),
      rails: [...sc.column.rails].reverse(),
      handrailIds: [...sc.column.handrailIds].reverse(),
    },
    postXs: sc.postXs.map(nz).sort((a, b) => a - b),
    boards: sc.boards.map(b => ({ ...b, x0: nz(b.x1), x1: nz(b.x0) })),
    rails: sc.rails.map(r => ({ ...r, x0: nz(r.x1), x1: nz(r.x0) })),
    spanRaises: sc.spanRaises.map(r => ({ ...r, x0: nz(r.x1), x1: nz(r.x0) })),
  }));
  const roofBands = fe.roofBands.map(rb => ({
    ...rb,
    xStart: nz(rb.xEnd), xEnd: nz(rb.xStart),
    profile: rb.profile.map(p => ({ x: nz(p.x), mm: p.mm })).reverse(),
  }));
  return { ...fe, buildingOutlines, scaffolds, roofBands };
}

/**
 * 屋根オブジェクト(polygon)ごとの投影バンド[]（R-1f-2）。大屋根と下屋が別バンドになる。
 *
 *  ・x 範囲   = 壁重なり辺のみ出幅を出したオフセット polygon の変軸 bbox（その屋根だけの広がり）。
 *  ・軒プロファイル = 「その屋根が覆う壁区間」で建物外形の上辺を切り出し、出幅ぶん傾き保存で延長。
 *      切り出しにより下屋の壁区間に置いた低いマーカーがそのまま下屋の軒高になる（運用どおり）。
 *      その面に壁を持たない屋根（例: 東壁だけの下屋を北から見る）は屋根の軒高で水平プロファイル。
 *  ・棟       = 中点がその屋根 polygon 内の RidgeLine のみ（assignRidgeLinesToRoofs）。
 *  ・棟マーカー = その屋根の壁区間上のマーカー最高値のみ（大屋根の棟で下屋が持ち上がらない）。
 *  ・軒先下がり = 屋根 polygon の bbox を run にするので下屋の勾配が建物 bbox に引きずられない。
 *
 * バンドを出す条件（優先度順）は建物単位の従来経路と同一:
 *   棟ラインあり → 上側包絡線を軒まで塗る / 棟マーカーが軒より高い → 軒→棟の台形 / 軒の出あり → 線のみ。
 * polygon が建物外周と一致する屋根（旧データの lift）では従来経路と同じ数値になる。
 */
function buildRoofBandsForRoofs(
  building: BuildingShape,
  outline: BuildingOutline,
  roofs: Roof[],
  markers: HeightMarker[],
  ridgeLines: RidgeLine[],
  defaultHeightMm?: number,
): RoofBand[] {
  const face = outline.face;
  const ridgeByRoof = assignRidgeLinesToRoofs(ridgeLines, building, roofs);
  const bands: RoofBand[] = [];

  // 同一面で複数の屋根バンドが重なるときの描画順（R-1f-3）。描画側は配列順に重ねるので、
  // 奥→手前の順に並べると下屋が大屋根の手前に載り、建築立面図と同じ前後関係になる。
  const ordered = [...roofs].sort(
    (r1, r2) => roofFrontness(building, r1, face) - roofFrontness(building, r2, face),
  );

  for (const roof of ordered) {
    const ext = roofExtXRange(building, roof, face);
    if (!ext) continue;
    const coverages = roofWallCoverages(building, roof);
    const clipped = clipSegmentsToIntervals(outline.segments, roofFaceWallIntervals(building, roof, face));

    // この面に壁を持たない屋根は、屋根の軒高で水平プロファイル（壁範囲＝屋根 polygon の変軸 bbox）。
    let segs: BuildingOutlineSegment[] = clipped;
    if (segs.length === 0) {
      const eaveMm = roofEaveMm(building, coverages, markers) ?? defaultHeightMm;
      if (eaveMm == null) continue;
      const poly = getRoofPolygon(building, roof);
      const cs = poly.map(p => variableCoord(p, face));
      const wx0 = Math.min(...cs), wx1 = Math.max(...cs);
      if (!(wx1 > wx0 + 1e-6)) continue;
      segs = [{ xStart: wx0, xEnd: wx1, heightStartMm: eaveMm, heightEndMm: eaveMm }];
    }

    const wallXStart = segs[0].xStart;
    const wallXEnd = segs[segs.length - 1].xEnd;
    let outlineMax = -Infinity;
    for (const s of segs) outlineMax = Math.max(outlineMax, s.heightStartMm, s.heightEndMm);
    if (!Number.isFinite(outlineMax)) continue;

    const markerMax = roofMarkerMaxMm(building, coverages, markers, roof.id);
    const hasRidgeMarker = markerMax != null && markerMax > outlineMax + 1e-6;
    const hasOverhang = ext.xStart < wallXStart - 1e-6 || ext.xEnd > wallXEnd + 1e-6;
    const myRidgeLines = ridgeByRoof.get(roof.id) ?? [];
    const ridges = projectRidgeLinesToFace(myRidgeLines, building, face);

    // R-1c と同じ判定・同じ式。棟/出幅/run をこの屋根のものに差し替えただけ。
    const hasParallelRidge = ridges.some(r => r.b > r.a + 1e-6);
    const isGutterFace = ridges.length > 0 ? hasParallelRidge : hasRidgeMarker;
    const ridgeMmForDrop = ridges.length > 0
      ? ridges.reduce((m, r) => Math.max(m, r.heightMm), -Infinity)
      : (markerMax ?? outlineMax);
    const ohGrid = roofFaceOverhangGrid(building, roof, face);
    const eaveDropMm = (isGutterFace && ohGrid > 0)
      ? Math.round(roofSlopePerMm(outlineMax, ridgeMmForDrop, roofRunMm(getRoofPolygon(building, roof), face, myRidgeLines)) * ohGrid * 10)
      : 0;
    const eaveProfile = extendedTopProfile(segs, ext.xStart, ext.xEnd, eaveDropMm);
    if (eaveProfile.length < 2) continue;

    if (ridges.length > 0) {
      const profile = composeUpperEnvelope(eaveProfile, ridges, ext.xStart, ext.xEnd);
      const envMax = profile.reduce((m, p) => Math.max(m, p.mm), -Infinity);
      const baseMm = Math.min(profile[0].mm, profile[profile.length - 1].mm);
      bands.push({
        buildingId: building.id, roofId: roof.id, xStart: ext.xStart, xEnd: ext.xEnd,
        frontness: roofFrontness(building, roof, face),
        ridgeMm: Math.round(envMax), profile, filledToRidge: true, baseMm,
      });
    } else if (hasRidgeMarker) {
      bands.push({
        buildingId: building.id, roofId: roof.id, xStart: ext.xStart, xEnd: ext.xEnd,
        frontness: roofFrontness(building, roof, face),
        ridgeMm: Math.round(markerMax!), profile: eaveProfile, filledToRidge: true,
      });
    } else if (hasOverhang) {
      bands.push({
        buildingId: building.id, roofId: roof.id, xStart: ext.xStart, xEnd: ext.xEnd,
        frontness: roofFrontness(building, roof, face),
        ridgeMm: Math.round(outlineMax), profile: eaveProfile, filledToRidge: false,
      });
    }
  }
  return bands;
}

/**
 * 同一面・同一 floor の列群 → 1 面の立面モデル。
 * @param faceColumns 同 face・同 floor の FaceSpanColumn 群（E-1 出力を絞ったもの）。
 * @param buildings 建物（該当 floor + 重ねる下階を含めてよい）。
 * @param opts markers / defaultHeightMm / 段構成オプション。
 */
export function buildFaceElevation(
  faceColumns: FaceSpanColumn[],
  buildings: BuildingShape[],
  opts?: FaceElevationOpts,
): FaceElevation {
  // faceColumns 空（足場なし・建物のみ表示）でも対象面を描けるよう opts.face をフォールバックに。
  const face: Face = faceColumns[0]?.face ?? opts?.face ?? 'north';
  const floor = faceColumns[0]?.floor ?? opts?.floor ?? 1;

  // 建物輪郭（該当面のセグメントを持つ建物のみ、多階は重ね）
  const buildingOutlines: BuildingOutline[] = [];
  for (const b of buildings) {
    const o = buildBuildingOutline(b, face, opts?.markers, { defaultHeightMm: opts?.defaultHeightMm });
    if (o.segments.length > 0) buildingOutlines.push(o);
  }

  // 屋根投影バンド。roofs[] にその建物の屋根があれば「屋根ごとに 1 本」（大屋根＋下屋が別バンド・
  // R-1f-2）、無ければ従来どおり「建物ごとに 1 本」（旧データ互換・マーカー最高値がこの面外形の
  // 最高値を超える建物のみ帯を出す）。
  const ms = opts?.markers ?? [];
  const roofBands: RoofBand[] = [];
  for (const o of buildingOutlines) {
    const b = buildings.find(bb => bb.id === o.buildingId);
    const myRoofs = b ? (opts?.roofs ?? []).filter(r => r.buildingId === b.id) : [];
    if (b && myRoofs.length > 0) {
      roofBands.push(...buildRoofBandsForRoofs(b, o, myRoofs, ms, opts?.ridgeLines ?? [], opts?.defaultHeightMm));
      continue;
    }

    let markerMax = -Infinity;
    for (const m of ms) if (m.buildingId === o.buildingId) markerMax = Math.max(markerMax, m.heightMm);
    let outlineMax = -Infinity, xMin = Infinity, xMax = -Infinity;
    for (const s of o.segments) {
      outlineMax = Math.max(outlineMax, s.heightStartMm, s.heightEndMm);
      xMin = Math.min(xMin, s.xStart);
      xMax = Math.max(xMax, s.xEnd);
    }
    if (!Number.isFinite(outlineMax)) continue;

    // 軒の出: 出幅ぶん左右へ拡張した屋根 x 範囲（出幅なしなら壁範囲と一致）。
    let extXStart = xMin, extXEnd = xMax;
    if (b) {
      const ohs = mergedRoofOverhangsGrid(b, opts?.roofs);
      if (ohs.some(v => v > 0)) {
        const range = faceXRange(computeOffsetPolygon(b.points, ohs), o.face);
        if (range) { extXStart = range.xStart; extXEnd = range.xEnd; }
      }
    }
    const hasOverhang = extXStart < xMin - 1e-6 || extXEnd > xMax + 1e-6;
    const hasRidge = Number.isFinite(markerMax) && markerMax > outlineMax + 1e-6;
    const ridges = (b && opts?.ridgeLines) ? projectRidgeLinesToFace(opts.ridgeLines, b, o.face) : [];
    // R-1c: 樋面の軒先下がり。軒高(outlineMax)と棟(RidgeLine or 棟マーカー markerMax)の勾配 × この面の出幅で
    //   軒先=軒高−slope×出幅 に下げる。適用は「樋面」のみ:
    //    ・棟ラインが面と平行(投影 a≠b の水平棟)がある → 樋面。
    //    ・棟ラインが無く markerMax>軒高(hasRidge) → 妻の棟マーカーが別面にある樋面。
    //   妻面(への字＝outlineMax に棟が含まれる、または棟が面直交で点に潰れる a==b)は drop=0 で従来どおり
    //   （けらばは extendedTopProfile の面内傾きで別途下がる）。
    const hasParallelRidge = ridges.some(r => r.b > r.a + 1e-6);
    const isGutterFace = ridges.length > 0 ? hasParallelRidge : hasRidge;
    const ridgeMmForDrop = ridges.length > 0
      ? ridges.reduce((m, r) => Math.max(m, r.heightMm), -Infinity)
      : (Number.isFinite(markerMax) ? markerMax : outlineMax);
    const eaveDropMm = (b && isGutterFace)
      ? faceEaveDropMm(b, o.face, outlineMax, ridgeMmForDrop, faceOverhangGrid(b, o.face, opts?.roofs), opts?.ridgeLines ?? [])
      : 0;
    const eaveProfile = extendedTopProfile(o.segments, extXStart, extXEnd, eaveDropMm);

    // バンドを出す条件（優先度順）:
    //  ・棟ラインがある → 上端を上側包絡線（軒＋棟/隅棟の max）で生成し、軒まで塗る。
    //  ・棟マーカーが軒より高い（樋面の切妻投影）→ 軒→棟の台形を塗る。
    //  ・軒の出がある → 外形上辺を傾き保存で延長（樋面=水平／妻面=けらば斜辺）の線。
    // いずれも無ければバンドなし。
    if (ridges.length > 0) {
      const profile = composeUpperEnvelope(eaveProfile, ridges, extXStart, extXEnd);
      const envMax = profile.reduce((m, p) => Math.max(m, p.mm), -Infinity);
      const baseMm = Math.min(profile[0].mm, profile[profile.length - 1].mm);
      roofBands.push({
        buildingId: o.buildingId, xStart: extXStart, xEnd: extXEnd,
        ridgeMm: Math.round(envMax), profile, filledToRidge: true, baseMm,
      });
    } else if (hasRidge) {
      roofBands.push({
        buildingId: o.buildingId, xStart: extXStart, xEnd: extXEnd,
        ridgeMm: Math.round(markerMax), profile: eaveProfile, filledToRidge: true,
      });
    } else if (hasOverhang) {
      roofBands.push({
        buildingId: o.buildingId, xStart: extXStart, xEnd: extXEnd,
        ridgeMm: Math.round(outlineMax), profile: eaveProfile, filledToRidge: false,
      });
    }
  }
  const ridgeMaxMm = roofBands.length > 0 ? Math.max(...roofBands.map(b => b.ridgeMm)) : null;

  // 足場（列ごとに別 scaffold）
  const scaffolds: ElevationScaffold[] = faceColumns.map(column => {
    const { postXs, spans } = buildElevationColumns(column);
    const heightMm = sampleColumnBaseHeightMm(column, buildings, opts);
    const levels = buildElevationLevels(heightMm ?? 0, opts);

    // E-8-v2l: 踏板・手摺は「1 スパン 1 部材」で出す。
    //   実物は 1800 等の規格部材で、列の全幅 1 本ではない。ここを列全幅で作っていたため、
    //   立面で手摺を掴むと 6 スパンぶん(10800mm)が 1 本のモジュールとして動き、
    //   端の丸（→v2l で下向きフック）も列の左右端にしか出なかった（鮎澤氏・実機）。
    //   入隅の切断は後段の applyOcclusionCut が区間を引くので、切断スパンは切断後区間になる。
    const spanRanges = spans.length > 0
      ? spans.map(sp => ({ x0: sp.x0, x1: sp.x1 }))
      : [{ x0: column.xStart, x1: column.xEnd }];   // 部材長が無い列（退化）は従来どおり全幅 1 本
    const boards: ElevationBoard[] = levels.levels.flatMap(
      levelMm => spanRanges.map(sp => ({ levelMm, x0: sp.x0, x1: sp.x1 })));
    // E-8-v2j: 手摺が付くコマは決まっている（下端コマ・上端コマ・各作業床の +450/+900）。
    //   従来の「全コマに手摺」は誤り（鮎澤氏）。
    const rails: ElevationRail[] = railKomaLevelsMm(levels.komaGridMm, levels.levels, opts?.komaMm)
      .flatMap(heightMmK => spanRanges.map(sp => ({ heightMm: heightMmK, x0: sp.x0, x1: sp.x1 })));

    // 妻面のコマ嵩上げ: 各スパンで壁最高点まで届かない分だけ 450 コマを追加（基準=壁の形）。
    const spanRaises = computeSpanRaises(column, postXs, levels, buildingOutlines, opts);

    return { column, postXs, levels, boards, rails, spanRaises };
  });

  // E-9: 建物同士の遮蔽。手前の棟のシルエット（壁＋屋根）で奥の棟を切る
  //   （完全に隠れる部分は描かず、部分的なら はみ出しだけ描く）。単棟では不変。
  const occ = applyBuildingOcclusion(buildingOutlines, roofBands, buildings, face);
  // E-5: 入隅の前後判定で、奥列の横線を手前列の x 区間で切る。
  //   E-9c: 建物の遮蔽も同じ機構で（自分より手前の建物のシルエットで横線を切る）。
  const cutScaffolds = applyOcclusionCut(
    scaffolds, face, undefined, buildingOccluders(buildingOutlines, roofBands, buildings, face),
  );
  const fe: FaceElevation = {
    face, floor,
    buildingOutlines: occ.buildingOutlines, scaffolds: cutScaffolds, roofBands: occ.roofBands,
    ridgeMaxMm,
  };

  // E-5-fix: 北/東立面は視点方向が逆になるため変軸を左右反転（south/west はそのままが正）。
  return (face === 'north' || face === 'east') ? mirrorVariableAxis(fe) : fe;
}
