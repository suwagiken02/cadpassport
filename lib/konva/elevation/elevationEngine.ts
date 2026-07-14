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
import { heightToFloors, LAYER_HEIGHT_MM, PILLAR_START_MIN_MM, type PillarType } from '../calculator';
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
  const jackTopMm = opts?.jackMm ?? DEFAULT_JACK_MM;
  const komaMm = opts?.komaMm ?? KOMA_PITCH_MM;
  const pillarType = opts?.pillarType ?? 'normal';

  const H = Math.round(buildingHeightMm);
  const { startMm, floors } = heightToFloors(H, layerMm, PILLAR_START_MIN_MM[pillarType]);

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
  const outline = getOutlinePolygon(building);
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
          .filter(m => m.buildingId === building.id && m.edgeIndex === i && m.t > 1e-6 && m.t < 1 - 1e-6)
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

/** 屋根投影バンド（樋面から見た屋根: 軒プロファイル〜棟の帯）。建物ごと。
 *  対象は「その建物のマーカー最高値 > その建物のこの面外形の最高値」の建物のみ
 *  （妻面など外形が棟に達する面では出ない）。実線＋薄塗りで描く（隠れ線ではない）。 */
export type RoofBand = {
  buildingId: string;
  /** その建物の外形の変軸範囲（グリッド）。左右の縦線位置。 */
  xStart: number;
  xEnd: number;
  /** 棟＝その建物の最高点(mm, GL 基準)。帯の上端。 */
  ridgeMm: number;
};

export type FaceElevation = {
  face: Face;
  floor: number;
  /** 面から見た建物輪郭（多階は階ごとの矩形の重ね）。 */
  buildingOutlines: BuildingOutline[];
  /** 足場（同一面の複数列 = L 字は列ごとに別 scaffold）。 */
  scaffolds: ElevationScaffold[];
  /** 屋根投影バンド（樋面のみ・建物ごと・妻面では空）。 */
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
};

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

/** スパン区間[aG,bG](グリッド)と重なる全セグメントの最高高さ(mm)。重なり無しは null。
 *  各セグメントは線形なので区間端(クリップ後)で最大になる。 */
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

/** 妻面のコマ嵩上げを計算。各スパンで屋根最高点まで届かない(gap>REACH)分だけ 450 コマを
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

  // 屋根投影バンド: 建物ごとに、マーカー最高値がこの面外形の最高値を超える建物のみ帯を出す。
  const ms = opts?.markers ?? [];
  const roofBands: RoofBand[] = [];
  for (const o of buildingOutlines) {
    let markerMax = -Infinity;
    for (const m of ms) if (m.buildingId === o.buildingId) markerMax = Math.max(markerMax, m.heightMm);
    if (!Number.isFinite(markerMax)) continue;
    let outlineMax = -Infinity, xMin = Infinity, xMax = -Infinity;
    for (const s of o.segments) {
      outlineMax = Math.max(outlineMax, s.heightStartMm, s.heightEndMm);
      xMin = Math.min(xMin, s.xStart);
      xMax = Math.max(xMax, s.xEnd);
    }
    if (markerMax > outlineMax + 1e-6) {
      roofBands.push({ buildingId: o.buildingId, xStart: xMin, xEnd: xMax, ridgeMm: Math.round(markerMax) });
    }
  }
  const ridgeMaxMm = roofBands.length > 0 ? Math.max(...roofBands.map(b => b.ridgeMm)) : null;

  // 足場（列ごとに別 scaffold）
  const scaffolds: ElevationScaffold[] = faceColumns.map(column => {
    const { postXs } = buildElevationColumns(column);
    const heightMm = sampleColumnBaseHeightMm(column, buildings, opts);
    const levels = buildElevationLevels(heightMm ?? 0, opts);

    const x0 = column.xStart;
    const x1 = column.xEnd;
    const boards: ElevationBoard[] = levels.levels.map(levelMm => ({ levelMm, x0, x1 }));
    const rails: ElevationRail[] = levels.komaGridMm.map(heightMmK => ({ heightMm: heightMmK, x0, x1 }));

    // 妻面のコマ嵩上げ: 各スパンで屋根最高点まで届かない分だけ 450 コマを追加。
    const spanRaises = computeSpanRaises(column, postXs, levels, buildingOutlines, opts);

    return { column, postXs, levels, boards, rails, spanRaises };
  });

  return { face, floor, buildingOutlines, scaffolds, roofBands, ridgeMaxMm };
}
