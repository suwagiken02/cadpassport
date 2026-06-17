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
import { computeBothmode2FLayout, computeBothmode1FLayout } from '../autoLayoutUtils';
import type {
  FaceDir,
  EdgeAdjustment,
  Bothmode2FEdgeSegment,
  Bothmode2FResult,
  Bothmode1FEdgeSegment,
} from '../autoLayoutUtils';
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
