// ============================================================
// N階一般化 P3-1: 統合フロア関数のスケルトン＋統一セグメント型（"器"のみ）
// ------------------------------------------------------------
// 本ファイルは P3-2 以降で「上→下の N 階カスケード割付」本体を載せるための器。
// この時点ではロジックを書かず、型と関数シグネチャだけを定義する。
// どこにも import / 配線しない（既存の computeBothmode2FLayout / computeBothmode1FLayout
// と Bothmode2F/1FEdgeSegment は無改変のまま残し、P3-2 で parity 比較する）。
//
// ── 統合フロア関数の役割（computeFloorLayout）──
//   ・buildingAbove === null … 最上階。上に階が無いので全周を自前で割付（= 現 computeBothmode2FLayout の全周 walk 相当）。
//   ・buildingBelow === null … 最下階（= 現 computeBothmode1FLayout 相当。直下は地面）。
//   ・both 有り             … 中間階。上階結果を継承しつつ、直下階向けの段差（柱）も仕込む。
//
// ── 共有ルール（Q2 確定）──
//   隣接階との関係で各辺を分類し、
//     ・面一（collinear / 同一直線）            → 上階の足場ラインと共有（自前セグメントを持たない）
//     ・それ以外（引っ込み＝下屋 / 出っ張り＝せり出し）→ 自前の足場ラインを持つ
//   引っ込み・出っ張りは「同じ段差・向きが逆」なので、P3-2 では
//   edgesNotCoveredBy / collinearPairs（P3-0 で用意した上下中立ヘルパ）を
//   上下両方向に対称適用して扱う。
// ============================================================

import {
  Point,
  BuildingShape,
  HandrailLengthMm,
  ScaffoldStartConfig,
  PriorityConfig,
} from '@/types';
import {
  computeBothmode2FLayout,
  getBuildingEdgesClockwise,
  findCollinearEdgePairs,
  isConvexCorner,
  isWallContinuation,
  isPointInPolygon,
  generateSequentialCandidates,
  splitLowerAtUpper,
  DEFAULT_EDGE_ADJUSTMENT,
  HANDRAIL_SIZES,
} from '../autoLayoutUtils';
import type {
  FaceDir,
  EdgeAdjustment,
  Bothmode2FEdgeSegment,
} from '../autoLayoutUtils';
import { mmToGrid } from '../gridUtils';
import type { SequentialCandidate } from './candidates';

/**
 * 階セグメントの始点制約（= 旧 Bothmode1FSegmentStartConstraint の上下中立版）。
 *  - pillar-from-upper      : 上階が仕込んだ柱点から 90° 接続して始まる
 *  - cascade-from-prev-segment: 同じ階の前セグメントから cascade 継承
 *  - collinear-with-upper    : 上階辺と面一連動（共有ライン）
 */
export type FloorSegmentStartConstraint =
  | { kind: 'pillar-from-upper'; pillarPoint: Point }
  | { kind: 'cascade-from-prev-segment' }
  | { kind: 'collinear-with-upper'; upperEdgeIndex: number };

/**
 * 階セグメントの終点制約（= 旧 Bothmode1FSegmentEndConstraint の上下中立版）。
 *  - pillar-to-upper    : 上階の柱点へ 90° 接続して終わる
 *  - collinear-with-upper: 上階辺と面一連動（共有ライン）
 *  - next-face          : 同じ階の次辺へ続く
 */
export type FloorSegmentEndConstraint =
  | { kind: 'pillar-to-upper'; pillarPoint: Point }
  | { kind: 'collinear-with-upper'; upperEdgeIndex: number }
  | { kind: 'next-face'; edgeIndex: number };

/**
 * 統一セグメント型。
 * Bothmode2FEdgeSegment と Bothmode1FEdgeSegment の共通フィールドに、
 * 上方向参照（desiredEndSource・旧 2F 側）と隣接階境界制約（start/endConstraint・旧 1F 側）を
 * "任意" で持たせ、最上階・中間階・最下階のどのセグメントも 1 つの型で表現する。
 */
export type FloorEdgeSegment = {
  /** このセグメントが属する物理階番号 */
  floor: number;
  /** この階のポリゴン上の辺 index（= 旧 edge2FIndex / edge1FIndex を中立化） */
  edgeIndex: number;
  segmentIndex: number;
  segmentCount: number;

  // ── セグメント自体の物理情報（2F/1F 共通）──
  startPoint: Point;
  endPoint: Point;
  segmentLengthMm: number;
  face: FaceDir;
  handrailDir: 'horizontal' | 'vertical';
  nx: number;
  ny: number;

  // ── 離れ情報（2F/1F 共通）──
  startDistanceMm: number;
  desiredEndDistanceMm: number;

  // ── 上方向の終点参照（任意・旧 2F の desiredEndSource を中立化）──
  //   ・next-face          : 同じ階の次辺の希望離れを使う
  //   ・lower-face-pillar   : 直下階の独立辺（下屋境界）に柱を仕込む
  //   ・upper-face-pillar   : 直上階のはみ出し辺（せり出し境界）に柱を仕込む（P3-2 せり出し対称化用）
  desiredEndSource?:
    | { kind: 'next-face'; edgeIndex: number }
    | { kind: 'lower-face-pillar'; lowerEdgeIndex: number }
    | { kind: 'upper-face-pillar'; upperEdgeIndex: number };

  // ── 隣接階との境界制約（任意・旧 1F の start/endConstraint を中立化）──
  startConstraint?: FloorSegmentStartConstraint;
  endConstraint?: FloorSegmentEndConstraint;

  // ── 候補と選択（2F/1F 共通）──
  candidates: SequentialCandidate[];
  selectedIndex: number;
  isLocked: boolean;
  isAutoProgress: boolean;
  prevCornerIsConvex: boolean;
  nextCornerIsConvex: boolean;

  // ── 描画用座標（2F/1F 共通）──
  scaffoldCoord: number;
  cursorStart: number;
  cursorEnd: number;
  effectiveMm: number;
};

/** 1 階分の割付結果。 */
export type FloorLayoutResult = {
  floor: number;
  edgeSegments: FloorEdgeSegment[];
  hasUnresolved: boolean;
};

/**
 * 統合フロア関数（スケルトン）。
 * 1 つの階 `buildingThis` を、上階（`buildingAbove` / `resultAbove`）と
 * 直下階（`buildingBelow`）の文脈で割付する。N 階カスケードのドライバ（P3-3）は
 * これを最上階→最下階の順に呼び、各回 `resultAbove` に前回（上階）の結果を渡す。
 *
 * @param floor            この階の物理階番号
 * @param buildingThis     この階のポリゴン（呼び出し側で splitLowerAtUpper / splitUpperAtLower 適用済み想定）
 * @param buildingAbove    直上階のポリゴン。null なら最上階（全周自前割付）
 * @param buildingBelow    直下階のポリゴン。null なら最下階（柱仕込み不要）
 * @param resultAbove      直上階の割付結果。null なら最上階。面一/柱の境界継承に使う
 * @param distancesByFloor 階ごと・辺ごとの希望離れ mm（this と below の双方を参照する）
 * @param scaffoldStart    最上階のスタート角。下階は上階から継承するため null
 * @returns                この階のセグメント列（+ 直下階が継承に使える境界情報を内包）
 *
 * P3-2(1/3): above===null（最上階）ブランチを実装。安全のため既存 computeBothmode2FLayout に
 * 委譲し、その結果を FloorEdgeSegment へマッピングして返す（ロジック重複ゼロ＝parity 自動保証）。
 * above non-null（中間階/最下階）と せり出し対称化は後続ステップで実装する。
 */

/** Bothmode2FEdgeSegment → FloorEdgeSegment へのマッピング（最上階用、委譲 parity の橋渡し）。
 *  S5-c: 旧 bothmode 結果を layoutByFloor へ詰める一時 adapter からも再利用するため export。*/
export function bothmode2FSegToFloorSeg(seg: Bothmode2FEdgeSegment, floor: number): FloorEdgeSegment {
  return {
    floor,
    edgeIndex: seg.edge2FIndex,
    segmentIndex: seg.segmentIndex,
    segmentCount: seg.segmentCount,
    startPoint: seg.startPoint,
    endPoint: seg.endPoint,
    segmentLengthMm: seg.segmentLengthMm,
    face: seg.face,
    handrailDir: seg.handrailDir,
    nx: seg.nx,
    ny: seg.ny,
    startDistanceMm: seg.startDistanceMm,
    desiredEndDistanceMm: seg.desiredEndDistanceMm,
    // 旧 2F の desiredEndSource を中立名へ写像。
    //   next-2F-face   → next-face（同じ階の次辺）
    //   1F-face-pillar → lower-face-pillar（直下階の独立辺=下屋境界に柱）
    desiredEndSource:
      seg.desiredEndSource.kind === 'next-2F-face'
        ? { kind: 'next-face', edgeIndex: seg.desiredEndSource.edge2FIndex }
        : { kind: 'lower-face-pillar', lowerEdgeIndex: seg.desiredEndSource.edge1FIndex },
    // 最上階は隣接階境界制約（start/endConstraint）を持たない
    candidates: seg.candidates,
    selectedIndex: seg.selectedIndex,
    isLocked: seg.isLocked,
    isAutoProgress: seg.isAutoProgress,
    prevCornerIsConvex: seg.prevCornerIsConvex,
    nextCornerIsConvex: seg.nextCornerIsConvex,
    scaffoldCoord: seg.scaffoldCoord,
    cursorStart: seg.cursorStart,
    cursorEnd: seg.cursorEnd,
    effectiveMm: seg.effectiveMm,
  };
}

export function computeFloorLayout(
  floor: number,
  buildingThis: BuildingShape,
  buildingAbove: BuildingShape | null,
  buildingBelow: BuildingShape | null,
  resultAbove: FloorLayoutResult | null,
  distancesByFloor: Record<number, Record<number, number>>,
  scaffoldStart: ScaffoldStartConfig | null,
  enabledSizes?: HandrailLengthMm[],
  priorityConfig?: PriorityConfig,
  userSelections?: Record<string, number>,
  userAdjustments?: Record<string, EdgeAdjustment>,
): FloorLayoutResult {
  if (buildingAbove === null) {
    // ── 最上階ブランチ（全周スパイン）──
    // 既存 computeBothmode2FLayout に委譲して parity を自動保証する。
    // （せり出し対称化や above non-null は本ステップでは未実装）
    if (buildingBelow === null) {
      // 単一階（below 無し）の最上階は現状 bothmode ではなく別経路。後続ステップで対応。
      throw new Error('computeFloorLayout: 単一階（below 無し）の最上階は本ステップ未対応');
    }
    if (!scaffoldStart) {
      throw new Error('computeFloorLayout: 最上階には scaffoldStart が必要');
    }
    // 連続積層前提: 直下階の物理階番号 = floor - 1
    const distancesThis = distancesByFloor[floor] ?? {};
    const distancesBelow = distancesByFloor[floor - 1] ?? {};
    const r2 = computeBothmode2FLayout(
      buildingThis,
      buildingBelow,
      distancesThis,
      distancesBelow,
      scaffoldStart,
      enabledSizes,
      priorityConfig,
      userSelections,
      userAdjustments,
    );
    return {
      floor,
      edgeSegments: r2.edgeSegments.map((seg) => bothmode2FSegToFloorSeg(seg, floor)),
      hasUnresolved: r2.hasUnresolved,
    };
  }

  // ── above 有り・below 無し = 最下階ブランチ ──
  // native walkFloorLowerRole に配線（下端 parity 済み＝下屋/面一は byte 不変）。
  // ※増分2b-ii: Q2(covered→自前) を最下階にも効かせるため委譲ではなく native を使う。
  //   1F が上階の下に引っ込むせり出しでも、その引っ込んだ壁に足場を出す。
  if (buildingBelow === null) {
    if (resultAbove === null) {
      throw new Error('computeFloorLayout: 最下階（above 有り）には resultAbove が必要');
    }
    const distancesThis = distancesByFloor[floor] ?? {};
    return walkFloorLowerRole(
      floor,
      buildingThis,
      buildingAbove,
      resultAbove,
      distancesThis,
      enabledSizes,
      priorityConfig,
      userSelections,
      userAdjustments,
    );
  }

  // ── 中間階（above も below も非 null）= 上階継承＋下階柱マーカー（下屋/面一のみ）──
  // せり出し対称化（Q2: covered も自前ライン）は増分2b-ii で導入する。
  if (resultAbove === null) {
    throw new Error('computeFloorLayout: 中間階には resultAbove が必要');
  }
  const distancesThisMid = distancesByFloor[floor] ?? {};
  return walkFloorMiddle(
    floor,
    buildingThis,
    buildingAbove,
    resultAbove,
    buildingBelow,
    distancesThisMid,
    enabledSizes,
    priorityConfig,
    userSelections,
    userAdjustments,
  );
}

// ============================================================
// N階カスケード割付ドライバ（純関数）
// ============================================================

/**
 * N階カスケード割付ドライバ。各階を最上階→最下階の順に computeFloorLayout で割付し、
 * resultAbove を上から順に継承する。scaffoldStart は最上階のみ渡し、下階は継承（null）。
 * 連続積層前提（階番号は連続・飛びなし）。モーダルには配線しない純関数層。
 *
 * 前処理: 各階ポリゴンを「他の全階の頂点」で分割して整合させる（純幾何の頂点挿入）。
 * 隣接階だけの分割では、上位階の頂点で割れた共有壁の collinear 判定を取りこぼすため全階で割る。
 *
 * @returns 階番号 → その階の FloorLayoutResult
 */
export function computeCascadeLayout(
  buildingsByFloor: Record<number, BuildingShape>,
  distancesByFloor: Record<number, Record<number, number>>,
  scaffoldStartTop: ScaffoldStartConfig,
  enabledSizes?: HandrailLengthMm[],
  priorityConfig?: PriorityConfig,
  userSelectionsByFloor?: Record<number, Record<string, number>>,
  userAdjustmentsByFloor?: Record<number, Record<string, EdgeAdjustment>>,
): Record<number, FloorLayoutResult> {
  // 降順（最上階→最下階）
  const floors = Object.keys(buildingsByFloor).map(Number).sort((a, b) => b - a);
  if (floors.length === 0) return {};
  // 連続積層チェック（飛びなし）
  if (floors[0] - floors[floors.length - 1] + 1 !== floors.length) {
    throw new Error('computeCascadeLayout: 階は連続積層（飛びなし）である必要があります');
  }

  // 前処理: 各階を他の全階の頂点で分割（純幾何の頂点挿入）。
  const normalized: Record<number, BuildingShape> = {};
  for (const f of floors) {
    let poly = buildingsByFloor[f];
    for (const g of floors) {
      if (g === f) continue;
      poly = splitLowerAtUpper(poly, buildingsByFloor[g]); // poly に g の頂点を挿入
    }
    normalized[f] = poly;
  }

  const results: Record<number, FloorLayoutResult> = {};
  let resultAbove: FloorLayoutResult | null = null;
  for (let idx = 0; idx < floors.length; idx++) {
    const f = floors[idx];
    const buildingAbove = idx > 0 ? normalized[floors[idx - 1]] : null;
    const buildingBelow = idx < floors.length - 1 ? normalized[floors[idx + 1]] : null;
    const scaffoldStart = idx === 0 ? scaffoldStartTop : null;
    const r = computeFloorLayout(
      f,
      normalized[f],
      buildingAbove,
      buildingBelow,
      resultAbove,
      distancesByFloor,
      scaffoldStart,
      enabledSizes,
      priorityConfig,
      userSelectionsByFloor?.[f],
      userAdjustmentsByFloor?.[f],
    );
    results[f] = r;
    resultAbove = r;
  }
  return results;
}

// ============================================================
// 統合フロア walk（A: 上下端 parity アンカー）
// ============================================================

/**
 * 統合フロア walk の「上階ロール」= 全周スパイン部分。
 * computeBothmode2FLayout の論理を中立名で移植した独立実装（挙動完全一致を parity で固定）。
 *
 *  - buildingThis を scaffoldStart から時計回りに全周 walk し、各辺 1 セグメント。
 *  - buildingBelow の下屋境界（below 独立辺の端点と一致・非連動）に下階向け柱点
 *    （desiredEndSource='lower-face-pillar'）を仕込む。
 *  - 上階からの継承（中間階の上向きグラフト）は本関数では扱わない（後続増分で追加）。
 *
 * 既存 computeBothmode2FLayout は無改変。これは N 階 walk の土台で、最上階(above=null)で
 * 既存 2F と byte 一致することを cascade.test.ts で固定する（A の上端 parity アンカー）。
 */
export function walkFloorUpperRole(
  floor: number,
  buildingThis: BuildingShape,
  buildingBelow: BuildingShape,
  distancesThis: Record<number, number>,
  distancesBelow: Record<number, number>,
  scaffoldStart: ScaffoldStartConfig,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  userSelections?: Record<string, number>,
  userAdjustments?: Record<string, EdgeAdjustment>,
): FloorLayoutResult {
  const edgesThis = getBuildingEdgesClockwise(buildingThis);
  const edgesBelow = getBuildingEdgesClockwise(buildingBelow);
  // 連動ペア {edge1FIndex(=below), edge2FIndex(=this)}（findCollinearEdgePairs(下,上) と同義）
  const pairs = findCollinearEdgePairs(buildingBelow, buildingThis);

  const nThis = edgesThis.length;
  if (nThis < 3) return { floor, edgeSegments: [], hasUnresolved: false };

  const startIdx = (scaffoldStart.startVertexIndex ?? 0) % nThis;

  const cornerConvexity: boolean[] = [];
  for (let i = 0; i < nThis; i++) {
    cornerConvexity.push(isConvexCorner(edgesThis[i], edgesThis[(i + 1) % nThis]));
  }

  const eqPt = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
  // this 辺終点が「below 下屋境界（below 独立辺の端点・非連動）」か検出
  const findPillarEdgeBelowAtEndpoint = (
    endPoint: Point,
    thisEdgeIndex: number,
    nextEdgeIndex: number,
  ): number | null => {
    for (const eb of edgesBelow) {
      if (!eqPt(eb.p1, endPoint) && !eqPt(eb.p2, endPoint)) continue;
      const collWithThis = pairs.some(p => p.edge1FIndex === eb.index && p.edge2FIndex === thisEdgeIndex);
      if (collWithThis) continue;
      const collWithNext = pairs.some(p => p.edge1FIndex === eb.index && p.edge2FIndex === nextEdgeIndex);
      if (collWithNext) continue;
      return eb.index;
    }
    return null;
  };

  const intermediate: FloorEdgeSegment[] = [];
  let prevEndDistanceMm: number | undefined = undefined;
  let prevSegmentStartDist: number | undefined = undefined;
  let hasUnresolved = false;

  for (let k = 0; k < nThis; k++) {
    const i = (startIdx + k) % nThis;
    const edge = edgesThis[i];
    const nextEdge = edgesThis[(i + 1) % nThis];
    const isFirstInLoop = k === 0;

    const prevEdge = edgesThis[(i - 1 + nThis) % nThis];
    const isPrevStraight = prevEdge.face === edge.face && prevEdge.handrailDir === edge.handrailDir;
    const isNextStraight = nextEdge.face === edge.face && nextEdge.handrailDir === edge.handrailDir;
    const isStraightContinuation = isPrevStraight;

    const pillarBelowIdx = findPillarEdgeBelowAtEndpoint(edge.p2, edge.index, nextEdge.index);
    const desiredEndSource: FloorEdgeSegment['desiredEndSource'] = pillarBelowIdx !== null
      ? { kind: 'lower-face-pillar', lowerEdgeIndex: pillarBelowIdx }
      : { kind: 'next-face', edgeIndex: nextEdge.index };
    const desiredEndDistanceMm = pillarBelowIdx !== null
      ? (distancesBelow[pillarBelowIdx] ?? 900)
      : (distancesThis[nextEdge.index] ?? 900);

    const prevCornerIsConvex = (isPrevStraight && intermediate.length > 0)
      ? !intermediate[intermediate.length - 1].nextCornerIsConvex
      : (cornerConvexity[(i - 1 + nThis) % nThis] || isPrevStraight);
    let nextCornerIsConvex: boolean;
    if (desiredEndSource.kind === 'lower-face-pillar') {
      const pillarEdgeBelow = edgesBelow.find(e => e.index === desiredEndSource.lowerEdgeIndex);
      if (pillarEdgeBelow && isWallContinuation(edge, pillarEdgeBelow)) {
        nextCornerIsConvex = true;
      } else if (pillarEdgeBelow) {
        const ax = edge.p2.x - edge.p1.x;
        const ay = edge.p2.y - edge.p1.y;
        const bx = pillarEdgeBelow.p2.x - pillarEdgeBelow.p1.x;
        const by = pillarEdgeBelow.p2.y - pillarEdgeBelow.p1.y;
        nextCornerIsConvex = (ax * by - ay * bx) > 0;
      } else {
        nextCornerIsConvex = cornerConvexity[i] || isNextStraight;
      }
    } else {
      nextCornerIsConvex = cornerConvexity[i] || isNextStraight;
    }

    let startDistanceMm: number;
    if (isFirstInLoop) {
      startDistanceMm = edge.handrailDir === 'horizontal'
        ? scaffoldStart.face1DistanceMm
        : scaffoldStart.face2DistanceMm;
    } else if (isStraightContinuation) {
      startDistanceMm = prevSegmentStartDist ?? distancesThis[edge.index] ?? 900;
    } else {
      startDistanceMm = prevEndDistanceMm ?? distancesThis[edge.index] ?? 900;
    }

    const prevEdgeStartDistanceMm = prevSegmentStartDist
      ?? (distancesThis[edgesThis[(i - 1 + nThis) % nThis].index] ?? 900);

    const segKey = `${edge.index}-0`;
    const adj = userAdjustments?.[segKey] ?? DEFAULT_EDGE_ADJUSTMENT;

    const candidates = generateSequentialCandidates(
      edge.lengthMm,
      startDistanceMm,
      desiredEndDistanceMm,
      prevCornerIsConvex,
      nextCornerIsConvex,
      prevEdgeStartDistanceMm,
      enabledSizes,
      priorityConfig,
      adj.larger.offsetIdx,
      adj.smaller.offsetIdx,
      adj.larger.variationIdx,
      adj.smaller.variationIdx,
    );

    let selectedIndex = userSelections?.[segKey] ?? 0;
    if (selectedIndex >= candidates.length) selectedIndex = 0;

    const isAutoProgress = candidates.length === 1
      && candidates[0].diffFromDesired === 0
      && (candidates[0].remainder ?? 0) === 0;
    const isLocked = false;
    if (!isAutoProgress) hasUnresolved = true;

    const distGrid = mmToGrid(startDistanceMm);
    const scaffoldCoord = edge.handrailDir === 'horizontal'
      ? edge.p1.y + edge.ny * distGrid
      : edge.p1.x + edge.nx * distGrid;
    const dx = edge.p2.x - edge.p1.x;
    const dy = edge.p2.y - edge.p1.y;
    const sign = edge.handrailDir === 'horizontal' ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);
    const cursorStart = edge.handrailDir === 'horizontal' ? edge.p1.x : edge.p1.y;
    const railsTotal = candidates[selectedIndex]?.totalMm ?? edge.lengthMm;
    const cursorEnd = cursorStart + sign * (railsTotal / 10);
    const effectiveMm = railsTotal;

    intermediate.push({
      floor,
      edgeIndex: edge.index,
      segmentIndex: 0,
      segmentCount: 1,
      startPoint: edge.p1,
      endPoint: edge.p2,
      segmentLengthMm: edge.lengthMm,
      face: edge.face,
      handrailDir: edge.handrailDir,
      nx: edge.nx,
      ny: edge.ny,
      startDistanceMm,
      desiredEndDistanceMm,
      desiredEndSource,
      candidates,
      selectedIndex,
      isLocked,
      isAutoProgress,
      prevCornerIsConvex,
      nextCornerIsConvex,
      scaffoldCoord,
      cursorStart,
      cursorEnd,
      effectiveMm,
    });

    if (candidates.length > 0) {
      prevEndDistanceMm = candidates[selectedIndex].actualEndDistanceMm;
    } else {
      prevEndDistanceMm = desiredEndDistanceMm;
    }
    prevSegmentStartDist = startDistanceMm;
  }

  // 2nd pass: cursor 再計算（corner-aware、rails 合計と一致する形）。computeBothmode2FLayout と同一。
  const nIntm = intermediate.length;
  for (let k = 0; k < nIntm; k++) {
    const s = intermediate[k];
    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    const sign = s.handrailDir === 'horizontal' ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);
    const wallStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    const wallEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
    const prevSeg = intermediate[(k - 1 + nIntm) % nIntm];
    const prevDistGrid = mmToGrid(prevSeg.startDistanceMm);
    const startDistGrid = mmToGrid(s.startDistanceMm);
    const actualEndMm = s.candidates[s.selectedIndex]?.actualEndDistanceMm ?? s.desiredEndDistanceMm;
    const endDistGrid = mmToGrid(actualEndMm);
    const cursorStart = s.prevCornerIsConvex
      ? wallStart - sign * prevDistGrid
      : wallStart + sign * startDistGrid;
    const cursorEnd = s.nextCornerIsConvex
      ? wallEnd + sign * endDistGrid
      : wallEnd - sign * endDistGrid;
    intermediate[k] = {
      ...s,
      cursorStart,
      cursorEnd,
      effectiveMm: Math.max(0, Math.round(Math.abs(cursorEnd - cursorStart) * 10)),
    };
  }

  return { floor, edgeSegments: intermediate, hasUnresolved };
}

/** 下階ロール: this 辺を above に対して分類した結果（covered/collinear/independent）。 */
type LowerEdgeClassification =
  | { kind: 'covered' }
  | { kind: 'collinear'; upperEdgeIndex: number; fixedDistanceMm: number }
  | { kind: 'independent' };

/**
 * 統合フロア walk の「下階ロール」= 上階継承部分。
 * computeBothmode1FLayout の論理を中立名で移植した独立実装（挙動完全一致を parity で固定）。
 *
 *  - buildingThis 各辺を above に対して covered/collinear/independent 分類。
 *    collinear/covered はセグメントを出さず（covered=上階下に隠れる・collinear=上階ラインと共有）、
 *    independent（下屋）のみ自前セグメント。※Q2（covered も自前ライン）は中間階用で本関数では未適用。
 *  - resultAbove（上階結果）から柱点（desiredEndSource='lower-face-pillar'）・seg 境界
 *    （startDistanceMm/scaffoldCoord/cursor 等）を読み、始点制約・cursor 整合に使う。
 *
 * 既存 computeBothmode1FLayout は無改変。最下階(below=null)で既存 1F と byte 一致することを
 * cascade.test.ts で固定する（A の下端 parity アンカー）。
 */
export function walkFloorLowerRole(
  floor: number,
  buildingThis: BuildingShape,
  buildingAbove: BuildingShape,
  resultAbove: FloorLayoutResult,
  distancesThis: Record<number, number>,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  userSelections?: Record<string, number>,
  userAdjustments?: Record<string, EdgeAdjustment>,
): FloorLayoutResult {
  const edgesThis = getBuildingEdgesClockwise(buildingThis);
  const edgesAbove = getBuildingEdgesClockwise(buildingAbove);
  const nThis = edgesThis.length;
  if (nThis < 3) return { floor, edgeSegments: [], hasUnresolved: false };

  // 連動ペア {edge1FIndex(=this/下), edge2FIndex(=above/上)}
  const pairs = findCollinearEdgePairs(buildingThis, buildingAbove);

  // resultAbove から下階向け柱点を抽出（desiredEndSource='lower-face-pillar'）。
  const pillarPoints: Array<{ point: Point; lowerEdgeIndex: number; upperEdgeIndex: number }> = [];
  for (const seg of resultAbove.edgeSegments) {
    if (seg.desiredEndSource?.kind === 'lower-face-pillar') {
      pillarPoints.push({
        point: seg.endPoint,
        lowerEdgeIndex: seg.desiredEndSource.lowerEdgeIndex,
        upperEdgeIndex: seg.edgeIndex,
      });
    }
  }

  // this 開始辺: 進行順最初の柱点が指す this 辺、なければ 0
  const startEdgeThisIndex = pillarPoints.length > 0 ? pillarPoints[0].lowerEdgeIndex % nThis : 0;

  // 各 this 辺を分類
  const classifications: LowerEdgeClassification[] = edgesThis.map((edge): LowerEdgeClassification => {
    const cp = pairs.find(p => p.edge1FIndex === edge.index);
    if (cp) {
      const matchSeg = resultAbove.edgeSegments.find(s => s.edgeIndex === cp.edge2FIndex);
      const fixedDistanceMm = matchSeg?.startDistanceMm ?? 900;
      return { kind: 'collinear', upperEdgeIndex: cp.edge2FIndex, fixedDistanceMm };
    }
    // Q2(増分2b-ii): 面一(collinear)以外は、引っ込み(covered=上階の下に隠れる辺) も
    // 出っ張り(independent=下屋) も「自前ライン」にする確定物理（せり出しで下の壁にも足場が要る）。
    // 旧「covered→スキップ」を廃止し independent に統一。引っ込み判定だけ残す（将来のせり出し端点整合の足掛かり）。
    const midX = (edge.p1.x + edge.p2.x) / 2;
    const midY = (edge.p1.y + edge.p2.y) / 2;
    if (isPointInPolygon(midX + edge.nx * 1, midY + edge.ny * 1, buildingAbove.points)) {
      return { kind: 'independent' };
    }
    return { kind: 'independent' };
  });

  // チェイン look-ahead（1 段限定）
  const chainedFixedEnd = (startIdx: number): number | undefined => {
    const c0 = classifications[startIdx];
    if (c0.kind === 'collinear') return c0.fixedDistanceMm;
    if (c0.kind === 'independent') {
      const c1 = classifications[(startIdx + 1) % nThis];
      if (c1.kind === 'collinear') return c1.fixedDistanceMm;
    }
    return undefined;
  };

  const cornerConvexity: boolean[] = [];
  for (let i = 0; i < nThis; i++) {
    cornerConvexity.push(isConvexCorner(edgesThis[i], edgesThis[(i + 1) % nThis]));
  }

  const pointsMatch = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;

  const intermediate: FloorEdgeSegment[] = [];
  let prevEndDistanceMm: number | undefined = undefined;
  let prevSegmentStartDist: number | undefined = undefined;

  for (let k = 0; k < nThis; k++) {
    const i = (startEdgeThisIndex + k) % nThis;
    const edge = edgesThis[i];
    const cls = classifications[i];
    if (cls.kind === 'covered') continue;

    const prevEdge = edgesThis[(i - 1 + nThis) % nThis];
    const nextEdge = edgesThis[(i + 1) % nThis];
    const isPrevStraight = prevEdge.face === edge.face && prevEdge.handrailDir === edge.handrailDir;
    const isNextStraight = nextEdge.face === edge.face && nextEdge.handrailDir === edge.handrailDir;
    const isStraightContinuation = isPrevStraight;

    let prevCornerIsConvex = cornerConvexity[(i - 1 + nThis) % nThis] || isPrevStraight;
    let nextCornerIsConvex = cornerConvexity[i] || isNextStraight;
    const segKey = `${i}-0`;
    const adj = userAdjustments?.[segKey] ?? DEFAULT_EDGE_ADJUSTMENT;

    const prevPillarMatchForDist = pillarPoints.find(p => pointsMatch(p.point, edge.p1) && p.lowerEdgeIndex === i);
    const contEdgeAboveForDist = prevPillarMatchForDist
      ? edgesAbove.find(e => e.index === prevPillarMatchForDist.upperEdgeIndex)
      : undefined;
    const isContinuationStart = !!(contEdgeAboveForDist && isWallContinuation(contEdgeAboveForDist, edge));
    const contSegAbove = isContinuationStart && prevPillarMatchForDist
      ? resultAbove.edgeSegments.find(s => s.edgeIndex === prevPillarMatchForDist.upperEdgeIndex)
      : undefined;
    if (isContinuationStart) prevCornerIsConvex = false;
    const prevEdgeStartDist: number = isContinuationStart
      ? (contSegAbove?.desiredEndDistanceMm ?? distancesThis[edge.index] ?? 900)
      : prevPillarMatchForDist
      ? (resultAbove.edgeSegments.find(s => s.edgeIndex === prevPillarMatchForDist.upperEdgeIndex)
          ?.startDistanceMm ?? distancesThis[edge.index] ?? 900)
      : (prevSegmentStartDist ?? distancesThis[edgesThis[(i - 1 + nThis) % nThis].index] ?? 900);

    if (cls.kind === 'collinear') {
      prevEndDistanceMm = cls.fixedDistanceMm;
      prevSegmentStartDist = cls.fixedDistanceMm;
      continue;
    }

    // cls.kind === 'independent'
    let startConstraint: FloorSegmentStartConstraint;
    let startDist: number;
    const prevPillarMatch = pillarPoints.find(p => pointsMatch(p.point, edge.p1) && p.lowerEdgeIndex === i);
    if (prevPillarMatch) {
      startConstraint = { kind: 'pillar-from-upper', pillarPoint: prevPillarMatch.point };
      const segA = resultAbove.edgeSegments.find(s => s.edgeIndex === prevPillarMatch.upperEdgeIndex);
      startDist = segA?.startDistanceMm ?? distancesThis[edge.index] ?? 900;
    } else if (isStraightContinuation) {
      startConstraint = { kind: 'cascade-from-prev-segment' };
      startDist = prevSegmentStartDist ?? distancesThis[edge.index] ?? 900;
    } else {
      startConstraint = { kind: 'cascade-from-prev-segment' };
      startDist = prevEndDistanceMm ?? distancesThis[edge.index] ?? 900;
    }

    const nextEdgeIdx = (i + 1) % nThis;
    const nextCls = classifications[nextEdgeIdx];
    let endConstraint: FloorSegmentEndConstraint;
    let desiredEndDist: number;
    if (nextCls.kind === 'collinear') {
      endConstraint = { kind: 'collinear-with-upper', upperEdgeIndex: nextCls.upperEdgeIndex };
      desiredEndDist = nextCls.fixedDistanceMm;
    } else if (nextCls.kind === 'covered') {
      const endPillarMatch = pillarPoints.find(p => pointsMatch(p.point, edge.p2) && p.lowerEdgeIndex === nextEdgeIdx);
      if (endPillarMatch) {
        endConstraint = { kind: 'pillar-to-upper', pillarPoint: endPillarMatch.point };
        const segA = resultAbove.edgeSegments.find(s => s.edgeIndex === endPillarMatch.upperEdgeIndex);
        desiredEndDist = segA?.startDistanceMm ?? distancesThis[nextEdgeIdx] ?? 900;
      } else {
        endConstraint = { kind: 'next-face', edgeIndex: nextEdgeIdx };
        desiredEndDist = distancesThis[nextEdgeIdx] ?? 900;
      }
    } else {
      endConstraint = { kind: 'next-face', edgeIndex: nextEdgeIdx };
      const chained = chainedFixedEnd(nextEdgeIdx);
      desiredEndDist = chained ?? distancesThis[nextEdgeIdx] ?? 900;
    }

    // 面一終端の凹ラップ（末端の凸+900突出を潰し effective=壁長へ揃える）は、始点が凸(出隅,+900)で
    // 突出している辺だけに限定する。始点が入隅(凹,-900)の辺（せり出し入隅の面一終端側壁＝西）で潰すと
    // -900-900 で壁長より1800縮むため、始点凹のときは終点コーナーの幾何上の凸を残す（-900+L+900=壁長）。
    if (endConstraint.kind === 'collinear-with-upper' && prevCornerIsConvex) nextCornerIsConvex = false;

    const candidates = generateSequentialCandidates(
      edge.lengthMm, startDist, desiredEndDist,
      prevCornerIsConvex, nextCornerIsConvex,
      prevEdgeStartDist,
      enabledSizes, priorityConfig,
      adj.larger.offsetIdx, adj.smaller.offsetIdx,
      adj.larger.variationIdx, adj.smaller.variationIdx,
    );

    let selectedIndex = userSelections?.[segKey] ?? 0;
    if (selectedIndex >= candidates.length) selectedIndex = 0;
    const isAutoProgress = candidates.length === 1
      && candidates[0].diffFromDesired === 0
      && (candidates[0].remainder ?? 0) === 0;
    const isLocked = false;

    const railsTotal = candidates[selectedIndex]?.totalMm ?? edge.lengthMm;
    // 1st pass 描画座標（computeDrawCoords 相当）
    const distGrid = mmToGrid(startDist);
    const scaffoldCoord1 = edge.handrailDir === 'horizontal'
      ? edge.p1.y + edge.ny * distGrid
      : edge.p1.x + edge.nx * distGrid;
    const dx1 = edge.p2.x - edge.p1.x;
    const dy1 = edge.p2.y - edge.p1.y;
    const sign1 = edge.handrailDir === 'horizontal' ? (dx1 >= 0 ? 1 : -1) : (dy1 >= 0 ? 1 : -1);
    const cursorStart1 = edge.handrailDir === 'horizontal' ? edge.p1.x : edge.p1.y;
    const cursorEnd1 = cursorStart1 + sign1 * (railsTotal / 10);

    intermediate.push({
      floor,
      edgeIndex: i,
      segmentIndex: 0,
      segmentCount: 1,
      startPoint: edge.p1,
      endPoint: edge.p2,
      segmentLengthMm: edge.lengthMm,
      face: edge.face,
      handrailDir: edge.handrailDir,
      nx: edge.nx,
      ny: edge.ny,
      startDistanceMm: startDist,
      desiredEndDistanceMm: desiredEndDist,
      startConstraint,
      endConstraint,
      candidates,
      selectedIndex,
      isLocked,
      isAutoProgress,
      prevCornerIsConvex,
      nextCornerIsConvex,
      scaffoldCoord: scaffoldCoord1,
      cursorStart: cursorStart1,
      cursorEnd: cursorEnd1,
      effectiveMm: railsTotal,
    });

    if (candidates.length > 0) {
      prevEndDistanceMm = candidates[selectedIndex].actualEndDistanceMm;
    } else {
      prevEndDistanceMm = desiredEndDist;
    }
    prevSegmentStartDist = startDist;
  }

  // 2nd pass: cursor 整合（startConstraint/endConstraint に応じて resultAbove の
  // scaffoldCoord/cursor へ揃える）。computeBothmode1FLayout の cursor 修正と同一。
  for (let k = 0; k < intermediate.length; k++) {
    const s = intermediate[k];
    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    const sign = s.handrailDir === 'horizontal' ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);

    let cursorStart: number;
    const scStart = s.startConstraint;
    if (scStart?.kind === 'pillar-from-upper') {
      const pp = scStart.pillarPoint;
      const segA = resultAbove.edgeSegments.find(seg2 =>
        Math.abs(seg2.endPoint.x - pp.x) < 0.001 && Math.abs(seg2.endPoint.y - pp.y) < 0.001);
      if (segA && segA.handrailDir !== s.handrailDir) cursorStart = segA.scaffoldCoord;
      else if (segA) cursorStart = segA.cursorEnd;
      else cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    } else if (scStart?.kind === 'cascade-from-prev-segment') {
      const prev = k > 0 ? intermediate[k - 1] : undefined;
      if (prev && prev.handrailDir !== s.handrailDir) cursorStart = prev.scaffoldCoord;
      else cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    } else if (scStart?.kind === 'collinear-with-upper') {
      const segA = resultAbove.edgeSegments.find(seg2 => seg2.edgeIndex === scStart.upperEdgeIndex);
      if (segA && segA.handrailDir !== s.handrailDir) cursorStart = segA.scaffoldCoord;
      else cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    } else {
      cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    }

    let cursorEnd: number;
    const ecEnd = s.endConstraint;
    if (ecEnd?.kind === 'pillar-to-upper') {
      const pp = ecEnd.pillarPoint;
      const segA = resultAbove.edgeSegments.find(seg2 =>
        Math.abs(seg2.startPoint.x - pp.x) < 0.001 && Math.abs(seg2.startPoint.y - pp.y) < 0.001);
      if (segA && segA.handrailDir !== s.handrailDir) cursorEnd = segA.scaffoldCoord;
      else cursorEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
    } else if (ecEnd?.kind === 'collinear-with-upper') {
      const segA = resultAbove.edgeSegments.find(seg2 => seg2.edgeIndex === ecEnd.upperEdgeIndex);
      if (segA && segA.handrailDir !== s.handrailDir) cursorEnd = segA.scaffoldCoord;
      else if (segA) {
        const endVar = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
        cursorEnd = Math.abs(segA.cursorStart - endVar) <= Math.abs(segA.cursorEnd - endVar)
          ? segA.cursorStart : segA.cursorEnd;
      } else cursorEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
    } else {
      // next-face: 次の this segment との接続
      const next = k < intermediate.length - 1 ? intermediate[k + 1] : undefined;
      if (next && next.handrailDir !== s.handrailDir) {
        if (s.nextCornerIsConvex) {
          const nextDistGrid = mmToGrid(next.startDistanceMm);
          const endVar = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
          cursorEnd = endVar + sign * nextDistGrid;
        } else cursorEnd = next.scaffoldCoord;
      } else cursorEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
    }

    intermediate[k] = {
      ...s,
      cursorStart,
      cursorEnd,
      effectiveMm: Math.max(0, Math.round(Math.abs(cursorEnd - cursorStart) * 10)),
    };
  }

  const hasUnresolved = intermediate.some(s => !s.isLocked && !s.isAutoProgress);
  return { floor, edgeSegments: intermediate, hasUnresolved };
}

/**
 * 統合フロア walk の「中間階」= 上階継承（下階ロール）＋ 下階向け柱マーカー生成。
 *
 * walkFloorLowerRole（上階継承・無改変）で this のセグメントを作り、その各セグメントへ
 * 直下階の下屋境界の柱マーカー（desiredEndSource='lower-face-pillar'）を後段で graft する。
 * 中間階の自前ジオメトリ（離れ/凸凹/cursor）は上階由来のまま。下階は this の実セグメント位置を
 * 読んで追従するため、柱マーカー（メタ情報）の付与だけで下階継承が成立する。
 *
 * ※本増分(2b-i)は下屋/面一のみ（既存分類: covered→スキップ / collinear→共有 / independent→自前）。
 *   せり出し対称化（Q2: covered も自前ライン）は増分2b-ii で導入する。
 */
export function walkFloorMiddle(
  floor: number,
  buildingThis: BuildingShape,
  buildingAbove: BuildingShape,
  resultAbove: FloorLayoutResult,
  buildingBelow: BuildingShape,
  distancesThis: Record<number, number>,
  enabledSizes?: HandrailLengthMm[],
  priorityConfig?: PriorityConfig,
  userSelections?: Record<string, number>,
  userAdjustments?: Record<string, EdgeAdjustment>,
): FloorLayoutResult {
  // 1) 上階継承で this のセグメントを作る（下階ロールを無改変で利用）。
  const base = walkFloorLowerRole(
    floor, buildingThis, buildingAbove, resultAbove, distancesThis,
    enabledSizes, priorityConfig, userSelections, userAdjustments,
  );

  // 2) 直下階向けの柱マーカーを graft（upper-role の柱検出を流用）。
  const edgesThis = getBuildingEdgesClockwise(buildingThis);
  const edgesBelow = getBuildingEdgesClockwise(buildingBelow);
  const nThis = edgesThis.length;
  // 連動ペア {edge1FIndex(=below/下), edge2FIndex(=this/上)}
  const pairsBelow = findCollinearEdgePairs(buildingBelow, buildingThis);
  const eqPt = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
  // this 辺終点が「below 下屋境界（below 独立辺の端点・非連動）」か検出
  const findPillarEdgeBelowAtEndpoint = (
    endPoint: Point, thisEdgeIndex: number, nextThisEdgeIndex: number,
  ): number | null => {
    for (const eb of edgesBelow) {
      if (!eqPt(eb.p1, endPoint) && !eqPt(eb.p2, endPoint)) continue;
      if (pairsBelow.some(p => p.edge1FIndex === eb.index && p.edge2FIndex === thisEdgeIndex)) continue;
      if (pairsBelow.some(p => p.edge1FIndex === eb.index && p.edge2FIndex === nextThisEdgeIndex)) continue;
      return eb.index;
    }
    return null;
  };

  const edgeSegments = base.edgeSegments.map((seg) => {
    const nextThisEdgeIndex = (seg.edgeIndex + 1) % nThis;
    const pillarBelowIdx = findPillarEdgeBelowAtEndpoint(seg.endPoint, seg.edgeIndex, nextThisEdgeIndex);
    // 下階消費（floorResultToBothmode2FResult / walkFloorLowerRole）が読めるよう、全セグメントに
    // desiredEndSource を付与（下屋境界=lower-face-pillar、それ以外=next-face）。最上階結果と同じ形。
    const des: FloorEdgeSegment['desiredEndSource'] = pillarBelowIdx !== null
      ? { kind: 'lower-face-pillar', lowerEdgeIndex: pillarBelowIdx }
      : { kind: 'next-face', edgeIndex: nextThisEdgeIndex };
    return { ...seg, desiredEndSource: des };
  });

  return { floor, edgeSegments, hasUnresolved: base.hasUnresolved };
}
