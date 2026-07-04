import { describe, it, expect } from 'vitest';
import {
  flattenFocusList,
  selfRelabeledEdge,
  computeNextFaceLabel,
  type FocusEntry,
} from '../focusList';
import { computeCascadeLayout, normalizeBuildingsByFloor } from '../cascade';
import type { FloorEdgeSegment, FloorLayoutResult } from '../cascade';
import {
  splitBuilding2FAt1FVertices,
  splitBuilding1FAtBuilding2FVertices,
  getEdgesNotCoveredBy,
  getBuildingEdgesClockwise,
  type EdgeInfo,
} from '../../autoLayoutUtils';
import { relabelByFace2F, relabelByFace1F } from '../../labelUtils';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';

// ============================================================
// S-5b-1: reader/render の per-floor 一般化が N=2({1,2}) で byte 不変であることを固定。
//   (1) flattenFocusList === 従来 allSegments(2F→1F 順)
//   (2) selfRelabeledEdge / computeNextFaceLabel === 従来ハードコード(edges2FAll/subEdgesRelabeled
//       + prefix "2"/"1")
// ============================================================

const b1F: BuildingShape = {
  id: 'b1', type: 'polygon', fill: '#000', floor: 1,
  points: [
    { x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 2000 },
    { x: 12000, y: 2000 }, { x: 12000, y: 7000 }, { x: 0, y: 7000 }, // 下屋せり出し L字
  ],
};
const b2F: BuildingShape = {
  id: 'b2', type: 'polygon', fill: '#000', floor: 2,
  points: [
    { x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 },
  ],
};
const ss: ScaffoldStartConfig = {
  corner: 'nw', startVertexIndex: 0,
  face1DistanceMm: 900, face2DistanceMm: 900,
  face1FirstHandrail: 1800, face2FirstHandrail: 1800,
};

// --- {1,2} の layoutByFloor と relabel マップを実物件で用意 ---
const layoutByFloor = computeCascadeLayout(
  { 1: b1F, 2: b2F },
  { 1: { 0: 900, 1: 900, 2: 900, 3: 900, 4: 900, 5: 900 }, 2: { 0: 900, 1: 900, 2: 900, 3: 900 } },
  ss, DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG,
) as Record<number, FloorLayoutResult>;

const norm = normalizeBuildingsByFloor({ 1: b1F, 2: b2F });
// 従来の 2 固定リスト
const edges2FAll = relabelByFace2F(getBuildingEdgesClockwise(splitBuilding2FAt1FVertices(b1F, b2F)), 0);
const legacy1F = splitBuilding1FAtBuilding2FVertices(b1F, b2F);
const uncoveredLegacy = getEdgesNotCoveredBy(legacy1F, splitBuilding2FAt1FVertices(b1F, b2F));
const subEdgesRelabeled = relabelByFace1F(
  getBuildingEdgesClockwise(legacy1F), new Set(uncoveredLegacy.map(e => e.index)), null,
);
// per-floor 版
const relabeledEdgesByFloor: Record<number, EdgeInfo[]> = {
  2: relabelByFace2F(getBuildingEdgesClockwise(norm[2]), 0),
  1: relabelByFace1F(
    getBuildingEdgesClockwise(norm[1]),
    new Set(getEdgesNotCoveredBy(norm[1], norm[2]).map(e => e.index)), null,
  ),
};

// --- 従来ハードコードのラベル解決を丸写しで再現 ---
function legacySelf(floor: number, edgeIndex: number): EdgeInfo | undefined {
  return floor === 2
    ? edges2FAll.find(e => e.index === edgeIndex)
    : subEdgesRelabeled.find(e => e.index === edgeIndex);
}
function legacyNextFace(seg: FloorEdgeSegment, floor: number): string {
  if (floor === 2) {
    const src = seg.desiredEndSource;
    if (src?.kind === 'next-face') return `2${edges2FAll.find(e => e.index === src.edgeIndex)?.label ?? '?'}`;
    if (src?.kind === 'lower-face-pillar') return `1${subEdgesRelabeled.find(e => e.index === src.lowerEdgeIndex)?.label ?? '?'}`;
    return '?';
  }
  const ec = seg.endConstraint;
  if (ec?.kind === 'collinear-with-upper') return `2${edges2FAll.find(e => e.index === ec.upperEdgeIndex)?.label ?? '?'}`;
  if (ec?.kind === 'next-face') return `1${subEdgesRelabeled.find(e => e.index === ec.edgeIndex)?.label ?? '?'}`;
  if (ec?.kind === 'pillar-to-upper') {
    const pp = ec.pillarPoint;
    const s2 = layoutByFloor[2].edgeSegments.find(x =>
      Math.abs(x.startPoint.x - pp.x) < 0.001 && Math.abs(x.startPoint.y - pp.y) < 0.001);
    if (s2) return `2${edges2FAll.find(e => e.index === s2.edgeIndex)?.label ?? '?'}`;
  }
  return '?';
}

// 従来 allSegments 構築（2F 全 seg → 1F 全 seg）
function legacyAllSegments(): FocusEntry[] {
  const out: FocusEntry[] = [];
  for (const s of layoutByFloor[2].edgeSegments) out.push({ seg: s, floor: 2, edgeIndex: s.edgeIndex });
  for (const s of layoutByFloor[1].edgeSegments) out.push({ seg: s, floor: 1, edgeIndex: s.edgeIndex });
  return out;
}

describe('flattenFocusList', () => {
  it('{1,2}: 従来 allSegments(2F→1F) と deep equal', () => {
    expect(flattenFocusList(layoutByFloor)).toEqual(legacyAllSegments());
  });
  it('null は空配列', () => {
    expect(flattenFocusList(null)).toEqual([]);
  });
});

describe('ラベル解決 per-floor 一般化の byte 不変', () => {
  const topFloor = 2;
  it('selfRelabeledEdge === 従来 self（全 seg）', () => {
    for (const { floor, edgeIndex } of flattenFocusList(layoutByFloor)) {
      expect(selfRelabeledEdge(floor, edgeIndex, relabeledEdgesByFloor))
        .toEqual(legacySelf(floor, edgeIndex));
    }
  });
  it('computeNextFaceLabel === 従来 nextFaceLabel（全 seg）', () => {
    for (const { seg, floor } of flattenFocusList(layoutByFloor)) {
      expect(computeNextFaceLabel(seg, floor, floor === topFloor, relabeledEdgesByFloor, layoutByFloor))
        .toBe(legacyNextFace(seg, floor));
    }
  });
  it('少なくとも下屋 pillar / collinear の実ラベルが出る（? だけでない）ことを確認', () => {
    const labels = flattenFocusList(layoutByFloor).map(({ seg, floor }) =>
      computeNextFaceLabel(seg, floor, floor === topFloor, relabeledEdgesByFloor, layoutByFloor));
    expect(labels.some(l => /^[12][A-Z]/.test(l))).toBe(true);
  });
});
