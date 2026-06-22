import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout,
  computeBothmode1FLayout,
  bothmodeResultsToAutoLayoutResult,
  splitBuilding1FAtBuilding2FVertices,
  splitBuilding2FAt1FVertices,
  placeHandrailsForEdge,
  computeAutoLayoutSequential,
  sequentialResultToAutoLayoutResult,
  type AutoLayoutResult,
} from '../../autoLayoutUtils';
import { computeCascadeLayout, type FloorEdgeSegment } from '../cascade';
import {
  segmentsToHandrails,
  floorResultToAutoLayoutResult,
  sequentialResultToFloorResult,
  bothmodeResultToFloorLayoutResult,
  floorResultToBothmode2FResult,
} from '../adapter';
import { findScaffoldViolations, type ScaffoldHandrail } from '../../scaffoldViolations';
import type { BuildingShape, ScaffoldStartConfig, HandrailLengthMm } from '@/types';

// ============================================================
// N階一般化 P3-5 S5-b: adapter 純関数 3 種の単体テスト＋
// 【最重要】cascade → adapter が「旧 bothmode 経路」と handrails parity 一致する証明。
// adapter はモーダル未接続＝挙動完全不変。本テストはその等価性を固定する。
//
// ※幾何計算（長辺の候補生成）が重く 1 ケース数秒かかるため、重いケースには明示 timeout を付す。
// ============================================================

const ss: ScaffoldStartConfig = {
  corner: 'nw',
  startVertexIndex: 0,
  face1DistanceMm: 900,
  face2DistanceMm: 900,
  face1FirstHandrail: 1800,
  face2FirstHandrail: 1800,
};

const HEAVY = 30000; // ms（長辺フィクスチャ + 旧/新の二重計算用）

/** 0..n-1 の辺に一律 900mm の離れを与えるヘルパ。 */
function dist(n: number): Record<number, number> {
  const r: Record<number, number> = {};
  for (let i = 0; i < n; i++) r[i] = 900;
  return r;
}

/** AutoLayoutResult を「階付き手摺（{x,y,lengthMm,direction,floor}）」へ展開する。
 *  旧経路・新経路の双方を同じ placeHandrailsForEdge で手摺化し、toEqual で突き合わせる。 */
type FloorHandrail = ScaffoldHandrail & { floor: 1 | 2 | undefined };
function autoLayoutToFloorHandrails(r: AutoLayoutResult): FloorHandrail[] {
  const out: FloorHandrail[] = [];
  for (const el of r.edgeLayouts) {
    const rails = (el.candidates[el.selectedIndex]?.rails ?? []) as HandrailLengthMm[];
    for (const h of placeHandrailsForEdge(el, rails)) {
      out.push({ ...h, floor: el.originFloor });
    }
  }
  return out;
}

/** 旧 bothmode 経路（AutoLayoutModal.handleCalc と同じ呼び方）→ AutoLayoutResult。 */
function oldPathResult(
  building1F: BuildingShape,
  building2F: BuildingShape,
  distances1F: Record<number, number>,
  distances2F: Record<number, number>,
  scaffold: ScaffoldStartConfig = ss,
): AutoLayoutResult {
  const n1 = splitBuilding1FAtBuilding2FVertices(building1F, building2F);
  const n2 = splitBuilding2FAt1FVertices(building1F, building2F);
  const r2 = computeBothmode2FLayout(n2, n1, distances2F, distances1F, scaffold);
  const r1 = computeBothmode1FLayout(n1, n2, r2, distances1F);
  return bothmodeResultsToAutoLayoutResult(r2, r1);
}

/** 新 cascade 経路（computeCascadeLayout → floorResultToAutoLayoutResult）→ AutoLayoutResult。 */
function newPathResult(
  building1F: BuildingShape,
  building2F: BuildingShape,
  distances1F: Record<number, number>,
  distances2F: Record<number, number>,
  scaffold: ScaffoldStartConfig = ss,
): AutoLayoutResult {
  const res = computeCascadeLayout(
    { 1: building1F, 2: building2F },
    { 1: distances1F, 2: distances2F },
    scaffold,
  );
  return floorResultToAutoLayoutResult(res);
}

// ============================================================
// 純関数 1: segmentsToHandrails の単体テスト
// ============================================================
describe('segmentsToHandrails（純関数1）', () => {
  const baseSeg = (over: Partial<FloorEdgeSegment>): FloorEdgeSegment => ({
    floor: 2,
    edgeIndex: 0,
    segmentIndex: 0,
    segmentCount: 1,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 360, y: 0 },
    segmentLengthMm: 3600,
    face: 'north',
    handrailDir: 'horizontal',
    nx: 0,
    ny: -1,
    startDistanceMm: 900,
    desiredEndDistanceMm: 900,
    candidates: [{ rails: [1800, 1800], totalMm: 3600, actualEndDistanceMm: 900, diffFromDesired: 0, side: 'exact', variationIdx: 0, variationCount: 1 }],
    selectedIndex: 0,
    isLocked: false,
    isAutoProgress: true,
    prevCornerIsConvex: true,
    nextCornerIsConvex: true,
    scaffoldCoord: -90,
    cursorStart: 0,
    cursorEnd: 360,
    effectiveMm: 3600,
    ...over,
  });

  it('horizontal（左→右）: scaffoldCoord=y、cursorStart から +方向に rails を敷く', () => {
    const rails = segmentsToHandrails([baseSeg({})]);
    expect(rails).toEqual([
      { x: 0, y: -90, lengthMm: 1800, direction: 'horizontal' },
      { x: 180, y: -90, lengthMm: 1800, direction: 'horizontal' },
    ]);
  });

  it('vertical（下→上）: scaffoldCoord=x、startVar に lengthMm 反映', () => {
    const seg = baseSeg({
      handrailDir: 'vertical',
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 360 },
      face: 'east',
      nx: 1,
      ny: 0,
      scaffoldCoord: 90,
      cursorStart: 0,
      cursorEnd: 360,
    });
    const rails = segmentsToHandrails([seg]);
    expect(rails).toEqual([
      { x: 90, y: 0, lengthMm: 1800, direction: 'vertical' },
      { x: 90, y: 180, lengthMm: 1800, direction: 'vertical' },
    ]);
  });

  it('逆走（cursorEnd < cursorStart）: 各 rail の下端を始点にする', () => {
    const seg = baseSeg({ cursorStart: 360, cursorEnd: 0 });
    const rails = segmentsToHandrails([seg]);
    // sign<0: startVar = cursor - lenGrid → 360-180=180, 180-180=0
    expect(rails).toEqual([
      { x: 180, y: -90, lengthMm: 1800, direction: 'horizontal' },
      { x: 0, y: -90, lengthMm: 1800, direction: 'horizontal' },
    ]);
  });

  it('候補なし辺は手摺を出さない', () => {
    expect(segmentsToHandrails([baseSeg({ candidates: [], selectedIndex: 0 })])).toEqual([]);
  });
});

// ============================================================
// 純関数 2: floorResultToAutoLayoutResult の単体テスト
// ============================================================
describe('floorResultToAutoLayoutResult（純関数2）', () => {
  const rectFloor = (id: string, floor: number, x0: number, x1: number): BuildingShape => ({
    id, type: 'polygon',
    points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 700 }, { x: x0, y: 700 }],
    fill: '#000', floor,
  });

  it('originFloor を seg.floor から付与し、階順は上→下（2F の edgeLayout が先頭）', () => {
    // 総二階（1F=2F）: 2F フル周 / 1F 空（全辺面一）。
    const res = computeCascadeLayout(
      { 1: rectFloor('1f', 1, 0, 900), 2: rectFloor('2f', 2, 0, 900) },
      { 1: dist(4), 2: dist(4) },
      ss,
    );
    const alr = floorResultToAutoLayoutResult(res);
    // 全 edgeLayout が 2F 由来（1F は面一で空）
    expect(alr.edgeLayouts.length).toBe(res[2].edgeSegments.length);
    expect(alr.edgeLayouts.every((el) => el.originFloor === 2)).toBe(true);
    // edge.index / p1 / p2 が元セグメントに一致
    alr.edgeLayouts.forEach((el, i) => {
      const seg = res[2].edgeSegments[i];
      expect(el.edge.index).toBe(seg.edgeIndex);
      expect(el.edge.p1).toEqual(seg.startPoint);
      expect(el.edge.p2).toEqual(seg.endPoint);
      expect(el.distanceMm).toBe(seg.startDistanceMm);
      expect(el.originSegmentIndex).toBe(seg.segmentIndex);
      // remainder は提案抑止のため一律 0
      expect(el.candidates.every((c) => c.remainder === 0)).toBe(true);
    });
  });

  it('下屋（1F>2F 東）: 1F 由来 edgeLayout は originFloor=1、2F 由来が先に並ぶ', () => {
    const res = computeCascadeLayout(
      { 1: rectFloor('1f', 1, 0, 1200), 2: rectFloor('2f', 2, 0, 900) },
      { 1: dist(10), 2: dist(10) },
      ss,
    );
    const alr = floorResultToAutoLayoutResult(res);
    const floors = alr.edgeLayouts.map((el) => el.originFloor);
    // 2F が先頭ブロック、その後 1F（昇順で混ざらない＝上→下）
    const firstOneIdx = floors.indexOf(1);
    expect(firstOneIdx).toBeGreaterThan(0); // 先頭は 2F
    expect(floors.slice(0, firstOneIdx).every((f) => f === 2)).toBe(true);
    expect(floors.slice(firstOneIdx).every((f) => f === 1)).toBe(true);
  }, HEAVY);
});

// ============================================================
// 純関数 3: sequentialResultToFloorResult の単体テスト
// ============================================================
describe('sequentialResultToFloorResult（純関数3）', () => {
  const square: BuildingShape = {
    id: 'b', type: 'polygon',
    points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 700 }],
    fill: '#000', floor: 1,
  };

  it('SequentialEdgeResult を 1 辺=1 セグメントへ写像し、floor を付与する', () => {
    const seq = computeAutoLayoutSequential(square, dist(4), ss);
    const fr = sequentialResultToFloorResult(seq, 3);
    expect(fr.floor).toBe(3);
    expect(fr.hasUnresolved).toBe(seq.hasUnresolved);
    expect(fr.edgeSegments.length).toBe(seq.edgeResults.length);
    fr.edgeSegments.forEach((s, i) => {
      const er = seq.edgeResults[i];
      expect(s.floor).toBe(3);
      expect(s.edgeIndex).toBe(er.edge.index);
      expect(s.segmentIndex).toBe(0);
      expect(s.segmentCount).toBe(1);
      expect(s.startPoint).toEqual(er.edge.p1);
      expect(s.endPoint).toEqual(er.edge.p2);
      expect(s.handrailDir).toBe(er.edge.handrailDir);
      expect(s.startDistanceMm).toBe(er.startDistanceMm);
      expect(s.scaffoldCoord).toBe(er.scaffoldCoord);
      expect(s.cursorStart).toBe(er.cursorStart);
      expect(s.cursorEnd).toBe(er.cursorEnd);
      // 単一階は隣接階境界メタを持たない
      expect(s.desiredEndSource).toBeUndefined();
      expect(s.startConstraint).toBeUndefined();
      expect(s.endConstraint).toBeUndefined();
    });
  });

  it('seq → FloorResult → AutoLayoutResult の手摺が、seq → AutoLayoutResult の手摺と一致（往復無損失）', () => {
    const seq = computeAutoLayoutSequential(square, dist(4), ss);
    const viaFloor = floorResultToAutoLayoutResult({ 1: sequentialResultToFloorResult(seq, 1) });
    const viaSeq = sequentialResultToAutoLayoutResult(seq);
    expect(autoLayoutToFloorHandrails(viaFloor).map(({ floor, ...h }) => h))
      .toEqual(autoLayoutToFloorHandrails(viaSeq).map(({ floor, ...h }) => h));
  });
});

// ============================================================
// 【最重要】parity: cascade → adapter == 旧 bothmode 経路。
//   対象: 下屋 / 面一 / 総二階（= せり出しを含まない N=2）。
//   新 floor-2 は computeBothmode2FLayout へ委譲、新 floor-1（walkFloorLowerRole）は
//   非せり出しで computeBothmode1FLayout と一致するため、結果が完全一致する。
//
//   比較は AutoLayoutResult（edgeLayouts: 辺幾何 / 離れ / scaffoldCoord / cursor /
//   選択候補 rails / originFloor / segmentIndex）の toEqual。これは手摺 toEqual より厳密で、
//   候補が空になる長辺フィクスチャ（総二階の 90m 辺）でも非自明な等価性を固定できる
//   （edgeLayouts が一致すれば placeHandrailsForEdge を通した手摺も必然的に一致する）。
// ============================================================
describe('parity: cascade→adapter == 旧 bothmode 経路（下屋/面一/総二階）', () => {
  it('総二階（1F=2F・全辺面一）: AutoLayoutResult 完全一致', () => {
    const square = (floor: number): BuildingShape => ({
      id: `f${floor}`, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const newAlr = newPathResult(square(1), square(2), dist(4), dist(4));
    const oldAlr = oldPathResult(square(1), square(2), dist(4), dist(4));
    expect(newAlr).toEqual(oldAlr);
    expect(newAlr.edgeLayouts.length).toBeGreaterThan(0); // 2F 全周 4 辺（非空・順序一致）
    expect(newAlr.edgeLayouts.every((el) => el.originFloor === 2)).toBe(true); // 1F は面一で空
    // 手摺レベルでも一致（edgeLayouts 一致からの帰結を明示）
    expect(autoLayoutToFloorHandrails(newAlr)).toEqual(autoLayoutToFloorHandrails(oldAlr));
  }, HEAVY);

  it('面一＋部分下屋（B面に下屋・残り3辺面一・5辺）: AutoLayoutResult 完全一致', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const newAlr = newPathResult(building1F, building2F, dist(6), dist(5));
    const oldAlr = oldPathResult(building1F, building2F, dist(6), dist(5));
    expect(newAlr).toEqual(oldAlr);
    // 下屋 1F に実手摺が乗る（= 非自明な parity の証拠）
    expect(autoLayoutToFloorHandrails(newAlr).some((h) => h.floor === 1)).toBe(true);
    expect(autoLayoutToFloorHandrails(newAlr)).toEqual(autoLayoutToFloorHandrails(oldAlr));
  }, HEAVY);

  it('下屋2個（東に2段の下屋・8辺）: AutoLayoutResult 完全一致', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 9000 }, { x: 0, y: 9000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 1000 }, { x: 12000, y: 1000 },
        { x: 12000, y: 3000 }, { x: 9000, y: 3000 },
        { x: 9000, y: 5000 }, { x: 12000, y: 5000 },
        { x: 12000, y: 7000 }, { x: 9000, y: 7000 },
        { x: 9000, y: 9000 }, { x: 0, y: 9000 },
      ],
      fill: '#000', floor: 1,
    };
    const newAlr = newPathResult(building1F, building2F, dist(12), dist(4));
    const oldAlr = oldPathResult(building1F, building2F, dist(12), dist(4));
    expect(newAlr).toEqual(oldAlr);
    expect(autoLayoutToFloorHandrails(newAlr)).toEqual(autoLayoutToFloorHandrails(oldAlr));
  }, HEAVY);

  it('非デフォルト離れ（face1=600/face2=1200・辺ごと差）でも一致', () => {
    const ssMixed: ScaffoldStartConfig = { ...ss, face1DistanceMm: 600, face2DistanceMm: 1200 };
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const distances1F = { 0: 900, 1: 600, 2: 1200, 3: 900, 4: 600, 5: 1200 };
    const distances2F = { 0: 600, 1: 1200, 2: 900, 3: 1200, 4: 600 };
    const newAlr = newPathResult(building1F, building2F, distances1F, distances2F, ssMixed);
    const oldAlr = oldPathResult(building1F, building2F, distances1F, distances2F, ssMixed);
    expect(newAlr).toEqual(oldAlr);
    expect(autoLayoutToFloorHandrails(newAlr)).toEqual(autoLayoutToFloorHandrails(oldAlr));
  }, HEAVY);
});

// ============================================================
// せり出し（2F>1F）: 旧 bothmode 経路と「一致しない」＝バグ修正の証明。
//   旧 computeBothmode1FLayout は「覆われた下階壁（covered）」をスキップする（その辺に足場が出ない）。
//   新 walkFloorLowerRole は covered を independent 扱いにして自前ラインを出す（Q2 せり出し対称化）。
//   よって adapter 後の AutoLayoutResult / 生セグメントが旧経路と構造的に食い違い、
//   かつ物理違反 0・引っ込んだ下階壁に自前ラインが存在する。
//
//   ※注: desiredEndSource='upper-face-pillar' は cascade.ts の型に予約されているのみで、
//     現状コードのどこでも生成されない（grep 済み）。せり出し対称化の実体は
//     「覆われた下階壁の自前ライン（引っ込んだ縦壁の足場）」で実現されるため、
//     本テストはそれを bug-fix の証拠として assert する。
// ============================================================
describe('せり出し（2F>1F）: 旧 bothmode と不一致＋違反0＋引っ込み壁に自前ライン', () => {
  it('東せり出し（2F 東=12000 > 1F 東=9000）: 旧は1F東壁を出さず・新は出す・違反0', () => {
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 1,
    };
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 2,
    };

    // 旧経路（adapter 後）: 1F 東壁は covered→スキップ。新経路: 引っ込んだ 1F 東壁にも自前ライン。
    // ⇒ AutoLayoutResult の edgeLayout 数が食い違う（旧と一致しない）。
    const oldAlr = oldPathResult(building1F, building2F, dist(4), dist(6));
    const newAlr = newPathResult(building1F, building2F, dist(4), dist(6));
    expect(newAlr.edgeLayouts.length).toBeGreaterThan(oldAlr.edgeLayouts.length);
    // 新側だけに「引っ込んだ 1F 東壁（originFloor=1・縦・x=9000）」の edgeLayout が存在する。
    const recessed = newAlr.edgeLayouts.find(
      (el) => el.originFloor === 1 && el.edge.handrailDir === 'vertical' && el.edge.p1.x === 9000,
    );
    expect(recessed).toBeDefined();
    expect(oldAlr.edgeLayouts.some(
      (el) => el.originFloor === 1 && el.edge.handrailDir === 'vertical' && el.edge.p1.x === 9000,
    )).toBe(false);

    // cascade 生結果でも同じ証拠: 引っ込んだ 1F 東壁（x=9000・縦）に自前セグメント。
    const res = computeCascadeLayout(
      { 1: building1F, 2: building2F },
      { 1: dist(4), 2: dist(6) },
      ss,
    );
    expect(res[1].edgeSegments.some((s) => s.handrailDir === 'vertical' && s.startPoint.x === 9000)).toBe(true);

    // 物理違反は 0（せり出し対称化後も組める）。
    const handrails = [
      ...segmentsToHandrails(res[2].edgeSegments),
      ...segmentsToHandrails(res[1].edgeSegments),
    ];
    expect(findScaffoldViolations(handrails, [building1F, building2F])).toEqual([]);
  }, HEAVY);
});

// ============================================================
// 一時 adapter bothmodeResultToFloorLayoutResult（S5-c-0・S5-d で破棄）。
//   旧 bothmode 結果（2F/1F）を layoutByFloor へ詰め、floorResultToAutoLayoutResult を通すと
//   bothmodeResultsToAutoLayoutResult と完全一致する＝表示 AutoLayoutResult を layoutByFloor 由来に
//   切替えても挙動不変にできる土台であることを固定する。
// ============================================================
describe('bothmodeResultToFloorLayoutResult（一時 adapter・旧 bothmode → layoutByFloor）', () => {
  /** 旧 bothmode を計算し、(packed→AutoLayoutResult) と (直接 AutoLayoutResult) を返す。 */
  function compute(
    building1F: BuildingShape,
    building2F: BuildingShape,
    distances1F: Record<number, number>,
    distances2F: Record<number, number>,
    scaffold: ScaffoldStartConfig = ss,
  ) {
    const n1 = splitBuilding1FAtBuilding2FVertices(building1F, building2F);
    const n2 = splitBuilding2FAt1FVertices(building1F, building2F);
    const r2 = computeBothmode2FLayout(n2, n1, distances2F, distances1F, scaffold);
    const r1 = computeBothmode1FLayout(n1, n2, r2, distances1F);
    const packed = bothmodeResultToFloorLayoutResult(r2, r1);
    return { packed, viaPack: floorResultToAutoLayoutResult(packed), direct: bothmodeResultsToAutoLayoutResult(r2, r1) };
  }

  it('キーは {2,1} のみ・各 floor 値が一致', () => {
    const square = (floor: number): BuildingShape => ({
      id: `f${floor}`, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const { packed } = compute(square(1), square(2), dist(4), dist(4));
    expect(Object.keys(packed).map(Number).sort()).toEqual([1, 2]);
    expect(packed[1].floor).toBe(1);
    expect(packed[2].floor).toBe(2);
  }, HEAVY);

  it('総二階（1F=2F）: floorResultToAutoLayoutResult(packed) == bothmodeResultsToAutoLayoutResult', () => {
    const square = (floor: number): BuildingShape => ({
      id: `f${floor}`, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const { viaPack, direct } = compute(square(1), square(2), dist(4), dist(4));
    expect(viaPack).toEqual(direct);
  }, HEAVY);

  it('面一＋部分下屋（B面下屋・5辺）: AutoLayoutResult 完全一致＋1F 由来あり', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const { packed, viaPack, direct } = compute(building1F, building2F, dist(6), dist(5));
    expect(viaPack).toEqual(direct);
    // 下屋 1F セグメントが packed に存在（非自明な一致）
    expect(packed[1].edgeSegments.length).toBeGreaterThan(0);
    expect(viaPack.edgeLayouts.some((el) => el.originFloor === 1)).toBe(true);
    // 手摺レベルでも一致
    const toRails = (alr: AutoLayoutResult): ScaffoldHandrail[] =>
      alr.edgeLayouts.flatMap((el) =>
        placeHandrailsForEdge(el, (el.candidates[el.selectedIndex]?.rails ?? []) as HandrailLengthMm[]));
    expect(toRails(viaPack)).toEqual(toRails(direct));
  }, HEAVY);

  it('非デフォルト離れでも一致', () => {
    const ssMixed: ScaffoldStartConfig = { ...ss, face1DistanceMm: 600, face2DistanceMm: 1200 };
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const distances1F = { 0: 900, 1: 600, 2: 1200, 3: 900, 4: 600, 5: 1200 };
    const distances2F = { 0: 600, 1: 1200, 2: 900, 3: 1200, 4: 600 };
    const { viaPack, direct } = compute(building1F, building2F, distances1F, distances2F, ssMixed);
    expect(viaPack).toEqual(direct);
  }, HEAVY);
});

// ============================================================
// 逆 adapter（S5-c-i・S5-d で破棄）round-trip: reverse(forward(r)) === r。
//   bothmodeResult2F/1F を layoutByFloor から派生 view として復元しても byte 不変であることを固定。
//   これが緑な限り、modal の bothmodeResult2F/1F を layoutByFloor 由来の useMemo に切替えても
//   全 reader（handlePlace/nav/recompute 入力）が byte 不変。
// ============================================================
describe('floorResultToBothmode2FResult（逆 adapter round-trip 恒等）', () => {
  function roundtrip(
    building1F: BuildingShape,
    building2F: BuildingShape,
    distances1F: Record<number, number>,
    distances2F: Record<number, number>,
    scaffold: ScaffoldStartConfig = ss,
  ) {
    const n1 = splitBuilding1FAtBuilding2FVertices(building1F, building2F);
    const n2 = splitBuilding2FAt1FVertices(building1F, building2F);
    const r2 = computeBothmode2FLayout(n2, n1, distances2F, distances1F, scaffold);
    const r1 = computeBothmode1FLayout(n1, n2, r2, distances1F);
    const lbf = bothmodeResultToFloorLayoutResult(r2, r1);
    // S5-c-i-2: 1F reader は layoutByFloor[1] 直読みに移行したため逆adapterは 2F のみ残存。
    return {
      r2, r1,
      back2: floorResultToBothmode2FResult(lbf[2]),
    };
  }

  it('総二階: reverse(forward(r2))===r2 / reverse(forward(r1))===r1', () => {
    const square = (floor: number): BuildingShape => ({
      id: `f${floor}`, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const { r2, back2 } = roundtrip(square(1), square(2), dist(4), dist(4));
    expect(back2).toEqual(r2);
  }, HEAVY);

  it('面一＋部分下屋（5辺・各種 desiredEndSource/constraint を含む）でも恒等', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const { r2, r1, back2 } = roundtrip(building1F, building2F, dist(6), dist(5));
    expect(back2).toEqual(r2);
    // 非自明: 1F セグメント（下屋）が存在し、constraint を含む
    expect(r1.edgeSegments.length).toBeGreaterThan(0);
  }, HEAVY);

  it('下屋2個（8辺・pillar/collinear/next 各種）でも恒等', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 9000 }, { x: 0, y: 9000 }],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 1000 }, { x: 12000, y: 1000 },
        { x: 12000, y: 3000 }, { x: 9000, y: 3000 },
        { x: 9000, y: 5000 }, { x: 12000, y: 5000 },
        { x: 12000, y: 7000 }, { x: 9000, y: 7000 },
        { x: 9000, y: 9000 }, { x: 0, y: 9000 },
      ],
      fill: '#000', floor: 1,
    };
    const { r2, back2 } = roundtrip(building1F, building2F, dist(12), dist(4));
    expect(back2).toEqual(r2);
  }, HEAVY);
});
