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
import type { BuildingShape, HeightMarker, Point } from '@/types';
import { getFloor } from '@/types';
import { heightToFloors, LAYER_HEIGHT_MM } from '../calculator';
import { mmToGrid } from '../gridUtils';
import { getOutlinePolygon } from '../heightMarkerUtils';
import { getHeightAtPosition } from '../heightInterpolation';
import type { Face, FaceSpanColumn } from './faceReconstruction';

// ── 定数（1 箇所に集約）──
/** 足場 1 段の高さ(mm)。電卓と単一ソース（calculator.ts）を再 export。 */
export { LAYER_HEIGHT_MM };
/** 支柱コマピッチ(mm)。楔ポケット間隔（足場基礎仕様: 1800 = 4×450）。 */
export const KOMA_PITCH_MM = 450;
/**
 * ジャッキ上端の既定高さ(mm, GL 基準)。
 * ※現場確認要の仮値。実機ではジャッキ伸縮で 100〜350mm 程度可変。
 *   opts.jackMm で上書き可。定数はここ 1 箇所のみ。
 */
export const DEFAULT_JACK_MM = 150;

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
};

/** 建物高さ(mm) → 立面の段構成。heightToFloors と整合。 */
export function buildElevationLevels(
  buildingHeightMm: number,
  opts?: ElevationLevelsOpts,
): ElevationLevels {
  const layerMm = opts?.layerMm ?? LAYER_HEIGHT_MM;
  const jackTopMm = opts?.jackMm ?? DEFAULT_JACK_MM;
  const komaMm = opts?.komaMm ?? KOMA_PITCH_MM;

  const H = Math.round(buildingHeightMm);
  const { startMm, floors } = heightToFloors(H, layerMm);

  const levels: number[] = [];
  for (let i = 0; i < floors; i++) levels.push(startMm + layerMm * i);

  const topRailMm = startMm + layerMm * floors; // heightToFloors 定義上 = H
  const sagariMm = floors > 0 ? H - (startMm + layerMm * (floors - 1)) : 0;

  const komaGridMm: number[] = [];
  if (floors > 0 && komaMm > 0) {
    for (let h = jackTopMm; h <= topRailMm + 1e-6; h += komaMm) komaGridMm.push(Math.round(h));
  }

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
 * 高さは既存機能の getHeightAtPosition（getOutlinePolygon の辺 index 空間）で読む。
 * このため辺は getOutlinePolygon を直接走査し index を一致させる（時計回り並べ替え版の
 * getBuildingEdgesClockwise とは index 空間が異なる点に注意）。
 *
 * フォールバック:
 *   マーカー 0 個（getHeightAtPosition が null）→ opts.defaultHeightMm を使用。
 *   それも無指定 → その辺はスキップ（segments に含めない）。
 *
 * Phase 1 は上辺フラット（軒線まで）。屋根勾配は heightStart/heightEnd を
 * 別値にすることで表現可能（拡張点）。斜め壁・円形は非対応（軸並行前提）。
 */
export function buildBuildingOutline(
  building: BuildingShape,
  face: Face,
  markers?: HeightMarker[],
  opts?: BuildingOutlineOpts,
): BuildingOutline {
  const outline = getOutlinePolygon(building);
  const floor = getFloor(building);
  const result: BuildingOutline = { buildingId: building.id, floor, face, segments: [] };
  const n = outline.length;
  if (n < 3) return result;

  const ws = windingSign(outline);
  const ms = markers ?? [];
  const isHorizontal = face === 'north' || face === 'south';

  for (let i = 0; i < n; i++) {
    if (outlineEdgeFace(outline, i, ws) !== face) continue;
    const p1 = outline[i];
    const p2 = outline[(i + 1) % n];
    const a = isHorizontal ? p1.x : p1.y;
    const b = isHorizontal ? p2.x : p2.y;
    if (Math.abs(a - b) < 1e-6) continue; // 退化辺

    // t=0/1 の高さを読み、変軸昇順（xStart 側）に合わせて割り当てる
    let hAt0 = getHeightAtPosition(building, ms, i, 0);
    let hAt1 = getHeightAtPosition(building, ms, i, 1);
    if (hAt0 == null || hAt1 == null) {
      const def = opts?.defaultHeightMm;
      if (def == null) continue; // 高さ不明かつ既定無し → スキップ
      hAt0 = hAt0 ?? def;
      hAt1 = hAt1 ?? def;
    }
    const startIs0 = a <= b;
    result.segments.push({
      xStart: Math.min(a, b),
      xEnd: Math.max(a, b),
      heightStartMm: startIs0 ? hAt0 : hAt1,
      heightEndMm: startIs0 ? hAt1 : hAt0,
    });
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
};

export type FaceElevation = {
  face: Face;
  floor: number;
  /** 面から見た建物輪郭（多階は階ごとの矩形の重ね）。 */
  buildingOutlines: BuildingOutline[];
  /** 足場（同一面の複数列 = L 字は列ごとに別 scaffold）。 */
  scaffolds: ElevationScaffold[];
};

export type FaceElevationOpts = ElevationLevelsOpts & {
  /** 高さマーカー（既存 CanvasData.heightMarkers）。 */
  markers?: HeightMarker[];
  /** マーカー無し時のフォールバック高さ(mm)。 */
  defaultHeightMm?: number;
};

/** 列の代表建物高さ(mm)を求める。列 mid が乗るセグメント優先、無ければ最大、無ければ既定。 */
function sampleColumnHeightMm(
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
  const mid = (column.xStart + column.xEnd) / 2;
  const hit = outline.segments.find(s => mid >= s.xStart - 1e-6 && mid <= s.xEnd + 1e-6);
  if (hit) return Math.round((hit.heightStartMm + hit.heightEndMm) / 2);
  return Math.max(...outline.segments.map(s => Math.max(s.heightStartMm, s.heightEndMm)));
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
  const face: Face = faceColumns[0]?.face ?? 'north';
  const floor = faceColumns[0]?.floor ?? 1;

  // 建物輪郭（該当面のセグメントを持つ建物のみ、多階は重ね）
  const buildingOutlines: BuildingOutline[] = [];
  for (const b of buildings) {
    const o = buildBuildingOutline(b, face, opts?.markers, { defaultHeightMm: opts?.defaultHeightMm });
    if (o.segments.length > 0) buildingOutlines.push(o);
  }

  // 足場（列ごとに別 scaffold）
  const scaffolds: ElevationScaffold[] = faceColumns.map(column => {
    const { postXs } = buildElevationColumns(column);
    const heightMm = sampleColumnHeightMm(column, buildings, opts);
    const levels = buildElevationLevels(heightMm ?? 0, opts);

    const x0 = column.xStart;
    const x1 = column.xEnd;
    const boards: ElevationBoard[] = levels.levels.map(levelMm => ({ levelMm, x0, x1 }));
    const rails: ElevationRail[] = levels.komaGridMm.map(heightMmK => ({ heightMm: heightMmK, x0, x1 }));

    return { column, postXs, levels, boards, rails };
  });

  return { face, floor, buildingOutlines, scaffolds };
}
