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
  computeBothmode1FLayout,
  getBuildingEdgesClockwise,
  findCollinearEdgePairs,
  isConvexCorner,
  isWallContinuation,
  generateSequentialCandidates,
  DEFAULT_EDGE_ADJUSTMENT,
  HANDRAIL_SIZES,
} from '../autoLayoutUtils';
import type {
  FaceDir,
  EdgeAdjustment,
  Bothmode2FEdgeSegment,
  Bothmode2FResult,
  Bothmode1FEdgeSegment,
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

/** Bothmode2FEdgeSegment → FloorEdgeSegment へのマッピング（最上階用、委譲 parity の橋渡し）。*/
function bothmode2FSegToFloorSeg(seg: Bothmode2FEdgeSegment, floor: number): FloorEdgeSegment {
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
  // 既存 computeBothmode1FLayout に委譲して parity を保証する。
  // resultAbove(FloorLayoutResult) を computeBothmode1FLayout が必要とする
  // Bothmode2FResult 相当へ往復復元してから渡す（往復無損失が肝）。
  if (buildingBelow === null) {
    if (resultAbove === null) {
      throw new Error('computeFloorLayout: 最下階（above 有り）には resultAbove が必要');
    }
    const distancesThis = distancesByFloor[floor] ?? {};
    const result2F = floorResultToBothmode2FResult(resultAbove);
    const r1 = computeBothmode1FLayout(
      buildingThis,
      buildingAbove,
      result2F,
      distancesThis,
      enabledSizes,
      priorityConfig,
      userSelections,
      userAdjustments,
    );
    return {
      floor,
      edgeSegments: r1.edgeSegments.map((seg) => bothmode1FSegToFloorSeg(seg, floor)),
      hasUnresolved: r1.hasUnresolved,
    };
  }

  // ── 中間階（above も below も非 null）と せり出し対称化は P3-2(3/3) で実装 ──
  throw new Error(`computeFloorLayout(floor=${floor}, 中間階): P3-2(3/3) で実装予定`);
}

// ============================================================
// 委譲 parity 用の往復マッピング（最下階ブランチ）
// ============================================================

/**
 * FloorLayoutResult → Bothmode2FResult への復元（最上階ブランチの forward マッピングの逆）。
 * computeBothmode1FLayout は上階結果から柱点(desiredEndSource='1F-face-pillar')・各 seg の
 * startDistanceMm/scaffoldCoord/cursorStart/End/desiredEndDistanceMm/endPoint 等を読むため、
 * 無損失で戻す必要がある。forward(bothmode2FSegToFloorSeg) と完全対称。
 */
function floorResultToBothmode2FResult(fr: FloorLayoutResult): Bothmode2FResult {
  return {
    hasUnresolved: fr.hasUnresolved,
    edgeSegments: fr.edgeSegments.map((fs): Bothmode2FEdgeSegment => {
      // desiredEndSource を旧 2F 名へ逆写像。
      //   next-face         → next-2F-face
      //   lower-face-pillar → 1F-face-pillar
      const des = fs.desiredEndSource;
      let desiredEndSource: Bothmode2FEdgeSegment['desiredEndSource'];
      if (des?.kind === 'lower-face-pillar') {
        desiredEndSource = { kind: '1F-face-pillar', edge1FIndex: des.lowerEdgeIndex };
      } else if (des?.kind === 'next-face') {
        desiredEndSource = { kind: 'next-2F-face', edge2FIndex: des.edgeIndex };
      } else {
        // 最上階セグメントは forward マッピング不変で必ず next-face / lower-face-pillar のいずれか。
        throw new Error('floorResultToBothmode2FResult: 想定外の desiredEndSource（最上階結果ではない）');
      }
      return {
        edge2FIndex: fs.edgeIndex,
        segmentIndex: fs.segmentIndex,
        segmentCount: fs.segmentCount,
        startPoint: fs.startPoint,
        endPoint: fs.endPoint,
        segmentLengthMm: fs.segmentLengthMm,
        face: fs.face,
        handrailDir: fs.handrailDir,
        nx: fs.nx,
        ny: fs.ny,
        startDistanceMm: fs.startDistanceMm,
        desiredEndDistanceMm: fs.desiredEndDistanceMm,
        desiredEndSource,
        candidates: fs.candidates,
        selectedIndex: fs.selectedIndex,
        isLocked: fs.isLocked,
        isAutoProgress: fs.isAutoProgress,
        prevCornerIsConvex: fs.prevCornerIsConvex,
        nextCornerIsConvex: fs.nextCornerIsConvex,
        scaffoldCoord: fs.scaffoldCoord,
        cursorStart: fs.cursorStart,
        cursorEnd: fs.cursorEnd,
        effectiveMm: fs.effectiveMm,
      };
    }),
  };
}

/** Bothmode1FEdgeSegment → FloorEdgeSegment へのマッピング（最下階用、委譲 parity の橋渡し）。*/
function bothmode1FSegToFloorSeg(seg: Bothmode1FEdgeSegment, floor: number): FloorEdgeSegment {
  // 旧 1F の start/endConstraint を上下中立名へ写像。
  const sc = seg.startConstraint;
  const startConstraint: FloorSegmentStartConstraint =
    sc.kind === 'pillar-from-2F'
      ? { kind: 'pillar-from-upper', pillarPoint: sc.pillarPoint }
      : sc.kind === 'collinear-with-2F'
      ? { kind: 'collinear-with-upper', upperEdgeIndex: sc.edge2FIndex }
      : { kind: 'cascade-from-prev-segment' };
  const ec = seg.endConstraint;
  const endConstraint: FloorSegmentEndConstraint =
    ec.kind === 'pillar-to-2F'
      ? { kind: 'pillar-to-upper', pillarPoint: ec.pillarPoint }
      : ec.kind === 'collinear-with-2F'
      ? { kind: 'collinear-with-upper', upperEdgeIndex: ec.edge2FIndex }
      : { kind: 'next-face', edgeIndex: ec.edge1FIndex };
  return {
    floor,
    edgeIndex: seg.edge1FIndex,
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
    // 最下階は隣接「上」階制約を持つ（desiredEndSource は持たない）
    startConstraint,
    endConstraint,
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
