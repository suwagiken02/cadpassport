// ============================================================
// N階一般化 P3-5 S5-b: cascade 統合層 ↔ 既存「描画 / 物理検証」層を繋ぐ純関数アダプタ。
// ------------------------------------------------------------
// 本ファイルはモーダル（AutoLayoutModal.tsx）には一切配線しない＝挙動完全不変の純追加。
// cascade.ts の FloorLayoutResult / FloorEdgeSegment を、既存の描画系（AutoLayoutResult /
// placeHandrailsForEdge / handlePlace）と物理検証系（ScaffoldHandrail / findScaffoldViolations）に
// 載せ替えるための 3 純関数だけを置く。
//
//   1. segmentsToHandrails
//        FloorEdgeSegment[] → ScaffoldHandrail[]（findScaffoldViolations 用）。
//        cascade.test.ts のローカル実装を lib に昇格（DRY）。cascade.test.ts は本 lib を import する。
//   2. floorResultToAutoLayoutResult
//        Record<floor, FloorLayoutResult> → AutoLayoutResult（描画 / handlePlace 用）。
//        bothmodeResultsToAutoLayoutResult と同形（originFloor を seg.floor から付与、上→下順）。
//   3. sequentialResultToFloorResult
//        SequentialLayoutResult + floor → FloorLayoutResult（単一階の順次決定結果を統合器に載せる橋）。
// ============================================================

import type {
  AutoLayoutResult,
  EdgeLayout,
  EdgeInfo,
  LayoutCombination,
  SequentialLayoutResult,
  Bothmode2FResult,
  Bothmode1FResult,
  Bothmode2FEdgeSegment,
  Bothmode1FEdgeSegment,
} from '../autoLayoutUtils';
import type { ScaffoldHandrail } from '../scaffoldViolations';
import type { FloorEdgeSegment, FloorLayoutResult } from './cascade';
import { bothmode2FSegToFloorSeg } from './cascade';

// ============================================================
// 1. segmentsToHandrails: FloorEdgeSegment[] → ScaffoldHandrail[]
//    rails を cursor span に沿って敷き詰める。cascade.test.ts のローカル実装を lib に昇格。
//    （findScaffoldViolations が読む {x,y,lengthMm,direction} の物理手摺へ展開する。）
// ============================================================
export function segmentsToHandrails(segs: FloorEdgeSegment[]): ScaffoldHandrail[] {
  const out: ScaffoldHandrail[] = [];
  for (const s of segs) {
    const rails = s.candidates[s.selectedIndex]?.rails ?? [];
    const sign = s.cursorEnd >= s.cursorStart ? 1 : -1;
    let cursor = s.cursorStart;
    for (const lenMm of rails) {
      const lenGrid = lenMm / 10;
      const startVar = sign > 0 ? cursor : cursor - lenGrid; // toSeg は +lengthMm 方向のため下端を始点に
      out.push(
        s.handrailDir === 'horizontal'
          ? { x: startVar, y: s.scaffoldCoord, lengthMm: lenMm, direction: 'horizontal' }
          : { x: s.scaffoldCoord, y: startVar, lengthMm: lenMm, direction: 'vertical' },
      );
      cursor += sign * lenGrid;
    }
  }
  return out;
}

// ============================================================
// 2. floorResultToAutoLayoutResult: Record<floor, FloorLayoutResult> → AutoLayoutResult
// ============================================================

/**
 * FloorEdgeSegment 1 つを EdgeLayout へ写像する。
 * bothmodeSegmentToEdgeLayout（autoLayoutUtils 内・private）と同じ規則：
 *   - cursorEnd は rails 合計ベースに再計算（cursor 由来 effectiveMm と乖離しても配置が崩れない）
 *   - 提案モーダル抑止のため remainder=0
 *   - originFloor は seg.floor（N階化で number。EdgeLayout 側の 1|2 へキャスト）
 */
function floorSegToEdgeLayout(seg: FloorEdgeSegment): EdgeLayout {
  const selected = seg.candidates[seg.selectedIndex];
  const railsTotal = selected
    ? selected.rails.reduce((a, b) => a + b, 0)
    : 0;

  const railsTotalGrid = railsTotal / 10;
  const sign = seg.handrailDir === 'horizontal'
    ? (seg.endPoint.x > seg.startPoint.x ? 1 : -1)
    : (seg.endPoint.y > seg.startPoint.y ? 1 : -1);
  const cursorEndAdjusted = seg.cursorStart + sign * railsTotalGrid;

  const edge: EdgeInfo = {
    index: seg.edgeIndex,
    originalIndex: seg.edgeIndex,
    // 中間層では label を生成しない（表示時に edge.index 経由で lookup する方針）。
    label: '',
    p1: seg.startPoint,
    p2: seg.endPoint,
    lengthMm: seg.segmentLengthMm,
    face: seg.face,
    handrailDir: seg.handrailDir,
    nx: seg.nx,
    ny: seg.ny,
  };

  const candidates: LayoutCombination[] = seg.candidates.map((c) => ({
    rails: c.rails,
    remainder: 0,
    count: c.rails.length,
  }));

  return {
    edge,
    distanceMm: seg.startDistanceMm,
    edgeLengthMm: seg.segmentLengthMm,
    effectiveMm: railsTotal,
    scaffoldCoord: seg.scaffoldCoord,
    cursorStart: seg.cursorStart,
    cursorEnd: cursorEndAdjusted,
    candidates,
    selectedIndex: seg.selectedIndex,
    locked: seg.isLocked,
    originFloor: seg.floor as 1 | 2,
    originSegmentIndex: seg.segmentIndex,
  };
}

/**
 * N 階分の FloorLayoutResult を 1 つの AutoLayoutResult（描画 / handlePlace 用）へ束ねる。
 * 階順は上→下（降順）。これは bothmodeResultsToAutoLayoutResult（2F→1F の順で push）と同じ並びで、
 * 手摺の生成順・originFloor 付与が旧経路と一致する。
 */
export function floorResultToAutoLayoutResult(
  resultsByFloor: Record<number, FloorLayoutResult>,
): AutoLayoutResult {
  const floors = Object.keys(resultsByFloor)
    .map(Number)
    .sort((a, b) => b - a); // 上→下
  const edgeLayouts: EdgeLayout[] = [];
  for (const f of floors) {
    for (const seg of resultsByFloor[f].edgeSegments) {
      edgeLayouts.push(floorSegToEdgeLayout(seg));
    }
  }
  return { edgeLayouts };
}

// ============================================================
// 3. sequentialResultToFloorResult: SequentialLayoutResult + floor → FloorLayoutResult
//    単一階（computeAutoLayoutSequential の出力）を統合コンテナ FloorLayoutResult に載せる橋。
//    各 SequentialEdgeResult は 1 辺 = 1 セグメント（segmentIndex=0 / segmentCount=1）。
//    隣接階境界メタ（desiredEndSource / start・endConstraint）は単一階では持たない。
// ============================================================
export function sequentialResultToFloorResult(
  seqResult: SequentialLayoutResult,
  floor: number,
): FloorLayoutResult {
  const edgeSegments: FloorEdgeSegment[] = seqResult.edgeResults.map((er) => ({
    floor,
    edgeIndex: er.edge.index,
    segmentIndex: 0,
    segmentCount: 1,
    startPoint: er.edge.p1,
    endPoint: er.edge.p2,
    segmentLengthMm: er.edge.lengthMm,
    face: er.edge.face,
    handrailDir: er.edge.handrailDir,
    nx: er.edge.nx,
    ny: er.edge.ny,
    startDistanceMm: er.startDistanceMm,
    desiredEndDistanceMm: er.desiredEndDistanceMm,
    candidates: er.candidates,
    selectedIndex: er.selectedIndex,
    isLocked: er.isLocked,
    isAutoProgress: er.isAutoProgress,
    prevCornerIsConvex: er.prevCornerIsConvex,
    nextCornerIsConvex: er.nextCornerIsConvex,
    scaffoldCoord: er.scaffoldCoord,
    cursorStart: er.cursorStart,
    cursorEnd: er.cursorEnd,
    effectiveMm: er.effectiveMm,
  }));
  return { floor, edgeSegments, hasUnresolved: seqResult.hasUnresolved };
}

// ============================================================
// 一時 adapter（S5-c / S5-d で破棄）: 旧 bothmode 結果（2F/1F）を layoutByFloor 形式
// （Record<floor, FloorLayoutResult>）へ詰め替える橋。
//   cascade を使わず旧 compute 結果をそのまま FloorEdgeSegment 化するため、
//   floorResultToAutoLayoutResult を通すと bothmodeResultsToAutoLayoutResult と一致する
//   （= 表示 AutoLayoutResult を layoutByFloor 由来に切替えても挙動不変にできる土台）。
//   S5-d で cascade 本接続に置き換わったら本関数ごと削除する。
// ============================================================

/** Bothmode1FEdgeSegment → FloorEdgeSegment（最下階用、start/endConstraint を上下中立名へ写像）。
 *  cascade.test.ts の expectLowerParity と同じ中立写像。 */
function bothmode1FSegToFloorSeg(seg: Bothmode1FEdgeSegment, floor: number): FloorEdgeSegment {
  const sc = seg.startConstraint;
  const startConstraint: FloorEdgeSegment['startConstraint'] =
    sc.kind === 'pillar-from-2F'
      ? { kind: 'pillar-from-upper', pillarPoint: sc.pillarPoint }
      : sc.kind === 'collinear-with-2F'
      ? { kind: 'collinear-with-upper', upperEdgeIndex: sc.edge2FIndex }
      : { kind: 'cascade-from-prev-segment' };
  const ec = seg.endConstraint;
  const endConstraint: FloorEdgeSegment['endConstraint'] =
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
    // 最下階セグメントは上方向の終点参照（desiredEndSource）を持たない
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

/** 旧 Bothmode2FResult → 単一階 FloorLayoutResult（floor=2）。 */
export function bothmode2FResultToFloorResult(result2F: Bothmode2FResult): FloorLayoutResult {
  return {
    floor: 2,
    edgeSegments: result2F.edgeSegments.map((seg) => bothmode2FSegToFloorSeg(seg, 2)),
    hasUnresolved: result2F.hasUnresolved,
  };
}

/** 旧 Bothmode1FResult → 単一階 FloorLayoutResult（floor=1）。 */
export function bothmode1FResultToFloorResult(result1F: Bothmode1FResult): FloorLayoutResult {
  return {
    floor: 1,
    edgeSegments: result1F.edgeSegments.map((seg) => bothmode1FSegToFloorSeg(seg, 1)),
    hasUnresolved: result1F.hasUnresolved,
  };
}

/**
 * 旧 bothmode 結果（2F・1F）を Record<floor, FloorLayoutResult> へ詰める一時 adapter。
 * キーは常に {2,1}（連続積層 1F/2F）。floorResultToAutoLayoutResult を通すと
 * bothmodeResultsToAutoLayoutResult(result2F, result1F) と一致する。
 */
export function bothmodeResultToFloorLayoutResult(
  result2F: Bothmode2FResult,
  result1F: Bothmode1FResult,
): Record<number, FloorLayoutResult> {
  return {
    2: bothmode2FResultToFloorResult(result2F),
    1: bothmode1FResultToFloorResult(result1F),
  };
}

// ============================================================
// 逆 adapter（S5-c-i / S5-d で破棄）: layoutByFloor（FloorLayoutResult）から
// 旧 Bothmode2FResult / Bothmode1FResult を復元する橋。
//   cascade 未接続のため computeBothmode1FLayout（Bothmode2FResult 型を要求）が現行 compute 経路。
//   layoutByFloor を単一の真実源にしつつ、bothmodeResult2F/1F を派生 view として供給するために使う。
//   bothmode*SegToFloorSeg の完全な逆写像（中立名 → 旧 bothmode 名）。round-trip は恒等
//   （reverse(forward(seg)) === seg）であることを adapter.test.ts で固定する。
//   S5-d で cascade 本接続後に本ブロックごと削除する。
// ============================================================

/** FloorEdgeSegment → Bothmode2FEdgeSegment（最上階セグメント・desiredEndSource を旧名へ逆写像）。 */
function floorSegToBothmode2FSeg(seg: FloorEdgeSegment): Bothmode2FEdgeSegment {
  const des = seg.desiredEndSource;
  if (!des || des.kind === 'upper-face-pillar') {
    throw new Error('floorSegToBothmode2FSeg: 2F セグメントの desiredEndSource が不正');
  }
  const desiredEndSource: Bothmode2FEdgeSegment['desiredEndSource'] =
    des.kind === 'next-face'
      ? { kind: 'next-2F-face', edge2FIndex: des.edgeIndex }
      : { kind: '1F-face-pillar', edge1FIndex: des.lowerEdgeIndex };
  return {
    edge2FIndex: seg.edgeIndex,
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
    desiredEndSource,
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

/** FloorEdgeSegment → Bothmode1FEdgeSegment（最下階セグメント・start/endConstraint を旧名へ逆写像）。 */
function floorSegToBothmode1FSeg(seg: FloorEdgeSegment): Bothmode1FEdgeSegment {
  const sc = seg.startConstraint;
  const ec = seg.endConstraint;
  if (!sc || !ec) {
    throw new Error('floorSegToBothmode1FSeg: 1F セグメントの start/endConstraint が不正');
  }
  const startConstraint: Bothmode1FEdgeSegment['startConstraint'] =
    sc.kind === 'pillar-from-upper'
      ? { kind: 'pillar-from-2F', pillarPoint: sc.pillarPoint }
      : sc.kind === 'collinear-with-upper'
      ? { kind: 'collinear-with-2F', edge2FIndex: sc.upperEdgeIndex }
      : { kind: 'cascade-from-prev-1F-segment' };
  const endConstraint: Bothmode1FEdgeSegment['endConstraint'] =
    ec.kind === 'pillar-to-upper'
      ? { kind: 'pillar-to-2F', pillarPoint: ec.pillarPoint }
      : ec.kind === 'collinear-with-upper'
      ? { kind: 'collinear-with-2F', edge2FIndex: ec.upperEdgeIndex }
      : { kind: 'next-1F-face', edge1FIndex: ec.edgeIndex };
  return {
    edge1FIndex: seg.edgeIndex,
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

/** layoutByFloor[2]（FloorLayoutResult）→ Bothmode2FResult を復元（派生 view 供給用）。 */
export function floorResultToBothmode2FResult(fr: FloorLayoutResult): Bothmode2FResult {
  return {
    edgeSegments: fr.edgeSegments.map(floorSegToBothmode2FSeg),
    hasUnresolved: fr.hasUnresolved,
  };
}

/** layoutByFloor[1]（FloorLayoutResult）→ Bothmode1FResult を復元（派生 view 供給用）。 */
export function floorResultToBothmode1FResult(fr: FloorLayoutResult): Bothmode1FResult {
  return {
    edgeSegments: fr.edgeSegments.map(floorSegToBothmode1FSeg),
    hasUnresolved: fr.hasUnresolved,
  };
}
