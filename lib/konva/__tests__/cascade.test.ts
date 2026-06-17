import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout,
  computeBothmode1FLayout,
  splitBuilding2FAt1FVertices,
  type Bothmode2FResult,
} from '../autoLayoutUtils';
import { computeFloorLayout } from '../autolayout/cascade';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';

// ============================================================
// N階一般化 P3-2(1/3) parity テスト。
// computeFloorLayout の最上階ブランチ (above=null, below=下階) の出力が、
// 同入力での既存 computeBothmode2FLayout と等価であることを固定する。
// これが緑な限り、1F/2F 現場の 2F 割付は不変。
// ============================================================

const ss: ScaffoldStartConfig = {
  corner: 'nw',
  startVertexIndex: 0,
  face1DistanceMm: 900,
  face2DistanceMm: 900,
  face1FirstHandrail: 1800,
  face2FirstHandrail: 1800,
};

/** 最上階(floor=2)を computeFloorLayout で計算した結果が、computeBothmode2FLayout と等価か検証する。 */
function expectParity(
  norm2F: BuildingShape,
  building1F: BuildingShape,
  distances2F: Record<number, number>,
  distances1F: Record<number, number>,
) {
  const ref: Bothmode2FResult = computeBothmode2FLayout(
    norm2F, building1F, distances2F, distances1F, ss,
  );
  const got = computeFloorLayout(
    2,                       // floor
    norm2F,                  // buildingThis
    null,                    // buildingAbove（最上階）
    building1F,              // buildingBelow
    null,                    // resultAbove
    { 1: distances1F, 2: distances2F },
    ss,                      // scaffoldStart
  );

  expect(got.floor).toBe(2);
  expect(got.hasUnresolved).toBe(ref.hasUnresolved);
  expect(got.edgeSegments.length).toBe(ref.edgeSegments.length);

  got.edgeSegments.forEach((fs, i) => {
    const bs = ref.edgeSegments[i];
    // 中立識別子
    expect(fs.edgeIndex).toBe(bs.edge2FIndex);
    expect(fs.segmentIndex).toBe(bs.segmentIndex);
    expect(fs.segmentCount).toBe(bs.segmentCount);
    // 物理情報
    expect(fs.startPoint).toEqual(bs.startPoint);
    expect(fs.endPoint).toEqual(bs.endPoint);
    expect(fs.segmentLengthMm).toBe(bs.segmentLengthMm);
    expect(fs.face).toBe(bs.face);
    expect(fs.handrailDir).toBe(bs.handrailDir);
    expect(fs.nx).toBe(bs.nx);
    expect(fs.ny).toBe(bs.ny);
    // 離れ
    expect(fs.startDistanceMm).toBe(bs.startDistanceMm);
    expect(fs.desiredEndDistanceMm).toBe(bs.desiredEndDistanceMm);
    // 描画座標
    expect(fs.scaffoldCoord).toBe(bs.scaffoldCoord);
    expect(fs.cursorStart).toBe(bs.cursorStart);
    expect(fs.cursorEnd).toBe(bs.cursorEnd);
    expect(fs.effectiveMm).toBe(bs.effectiveMm);
    // 候補と選択（選択中 rails が一致）
    expect(fs.selectedIndex).toBe(bs.selectedIndex);
    expect(fs.isAutoProgress).toBe(bs.isAutoProgress);
    expect(fs.candidates[fs.selectedIndex]?.rails)
      .toEqual(bs.candidates[bs.selectedIndex]?.rails);
    // desiredEndSource の中立写像
    if (bs.desiredEndSource.kind === 'next-2F-face') {
      expect(fs.desiredEndSource)
        .toEqual({ kind: 'next-face', edgeIndex: bs.desiredEndSource.edge2FIndex });
    } else {
      expect(fs.desiredEndSource)
        .toEqual({ kind: 'lower-face-pillar', lowerEdgeIndex: bs.desiredEndSource.edge1FIndex });
    }
    // 最上階セグメントは隣接階境界制約を持たない
    expect(fs.startConstraint).toBeUndefined();
    expect(fs.endConstraint).toBeUndefined();
  });
}

describe('computeFloorLayout 最上階ブランチ（above=null）= computeBothmode2FLayout parity', () => {
  it('下屋なし（1F=2F）正方形: 4 辺', () => {
    const square: BuildingShape = {
      id: 'b', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 900, y: 0 },
        { x: 900, y: 900 }, { x: 0, y: 900 },
      ],
      fill: '#000', floor: 1,
    };
    const distances = { 0: 900, 1: 900, 2: 900, 3: 900 };
    const norm2F = splitBuilding2FAt1FVertices(square, square);
    expectParity(norm2F, square, distances, distances);
  });

  it('B 面側下屋（連動なし）: 分割後 5 辺・ピラーあり', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
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
    const distances2F = { 0: 900, 1: 900, 2: 900, 3: 900, 4: 900 };
    const distances1F = { 0: 900, 1: 900, 2: 900, 3: 900, 4: 900, 5: 900 };
    const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
    expectParity(norm2F, building1F, distances2F, distances1F);
  });

  it('B 面側に中央のみ下屋: 分割後 6 辺・ピラー 2 本', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 5000 }, { x: 9000, y: 5000 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const distances2F: Record<number, number> = {};
    for (let i = 0; i < 6; i++) distances2F[i] = 900;
    const distances1F: Record<number, number> = {};
    for (let i = 0; i < 8; i++) distances1F[i] = 900;
    const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
    expectParity(norm2F, building1F, distances2F, distances1F);
  });

  it('B 面側に下屋 2 個: 分割後 8 辺・ピラー 4 本', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 9000 }, { x: 0, y: 9000 },
      ],
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
    const distances2F: Record<number, number> = {};
    for (let i = 0; i < 8; i++) distances2F[i] = 900;
    const distances1F: Record<number, number> = {};
    for (let i = 0; i < 12; i++) distances1F[i] = 900;
    const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
    expectParity(norm2F, building1F, distances2F, distances1F);
  });

  it('非デフォルト離れ（face1=600/face2=1200・辺ごと差）でも parity', () => {
    const ssMixed: ScaffoldStartConfig = {
      ...ss, face1DistanceMm: 600, face2DistanceMm: 1200,
    };
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
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
    const distances2F = { 0: 600, 1: 1200, 2: 900, 3: 1200, 4: 600 };
    const distances1F = { 0: 900, 1: 600, 2: 1200, 3: 900, 4: 600, 5: 1200 };
    const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
    const ref = computeBothmode2FLayout(norm2F, building1F, distances2F, distances1F, ssMixed);
    const got = computeFloorLayout(
      2, norm2F, null, building1F, null,
      { 1: distances1F, 2: distances2F }, ssMixed,
    );
    expect(got.edgeSegments.length).toBe(ref.edgeSegments.length);
    got.edgeSegments.forEach((fs, i) => {
      const bs = ref.edgeSegments[i];
      expect(fs.startDistanceMm).toBe(bs.startDistanceMm);
      expect(fs.cursorStart).toBe(bs.cursorStart);
      expect(fs.cursorEnd).toBe(bs.cursorEnd);
      expect(fs.candidates[fs.selectedIndex]?.rails)
        .toEqual(bs.candidates[bs.selectedIndex]?.rails);
    });
  });
});

// ============================================================
// P3-2(2/3): 最下階ブランチ parity（往復無損失 + 既存 1F 割付一致）
// ============================================================

/**
 * cascade 本番フローと同じ流れで最下階(1F)を計算し、既存 2 関数フローと一致するか照合する。
 *  1) computeFloorLayout(最上階, above=null, below=1F) → resultAbove(FloorLayoutResult)
 *  2) computeFloorLayout(最下階=1F, above=2F, below=null, resultAbove) を計算
 *  ref) computeBothmode1FLayout(1F, 2F, computeBothmode2FLayout(...))
 * これで「FloorLayoutResult を入力にしても、往復無損失で既存 1F 割付と一致」を担保する。
 */
function expectLowerParity(
  building1F: BuildingShape,
  building2F: BuildingShape,
  distances1F: Record<number, number>,
  distances2F: Record<number, number>,
  scaffold: ScaffoldStartConfig = ss,
) {
  const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
  const distByFloor = { 1: distances1F, 2: distances2F };

  // reference: 既存 2 関数フロー
  const ref2F = computeBothmode2FLayout(norm2F, building1F, distances2F, distances1F, scaffold);
  const ref1F = computeBothmode1FLayout(building1F, norm2F, ref2F, distances1F);

  // cascade フロー（FloorLayoutResult を往復）
  const resultAbove = computeFloorLayout(2, norm2F, null, building1F, null, distByFloor, scaffold);
  const got1F = computeFloorLayout(1, building1F, norm2F, null, resultAbove, distByFloor, null);

  expect(got1F.floor).toBe(1);
  expect(got1F.hasUnresolved).toBe(ref1F.hasUnresolved);
  expect(got1F.edgeSegments.length).toBe(ref1F.edgeSegments.length);

  got1F.edgeSegments.forEach((fs, i) => {
    const bs = ref1F.edgeSegments[i];
    expect(fs.edgeIndex).toBe(bs.edge1FIndex);
    expect(fs.segmentIndex).toBe(bs.segmentIndex);
    expect(fs.segmentCount).toBe(bs.segmentCount);
    expect(fs.startPoint).toEqual(bs.startPoint);
    expect(fs.endPoint).toEqual(bs.endPoint);
    expect(fs.segmentLengthMm).toBe(bs.segmentLengthMm);
    expect(fs.face).toBe(bs.face);
    expect(fs.handrailDir).toBe(bs.handrailDir);
    expect(fs.nx).toBe(bs.nx);
    expect(fs.ny).toBe(bs.ny);
    expect(fs.startDistanceMm).toBe(bs.startDistanceMm);
    expect(fs.desiredEndDistanceMm).toBe(bs.desiredEndDistanceMm);
    expect(fs.scaffoldCoord).toBe(bs.scaffoldCoord);
    expect(fs.cursorStart).toBe(bs.cursorStart);
    expect(fs.cursorEnd).toBe(bs.cursorEnd);
    expect(fs.effectiveMm).toBe(bs.effectiveMm);
    expect(fs.selectedIndex).toBe(bs.selectedIndex);
    expect(fs.isAutoProgress).toBe(bs.isAutoProgress);
    expect(fs.candidates[fs.selectedIndex]?.rails)
      .toEqual(bs.candidates[bs.selectedIndex]?.rails);

    // start/endConstraint の中立写像（旧 1F 名 → 上下中立名）
    const sc = bs.startConstraint;
    const expectedSC =
      sc.kind === 'pillar-from-2F'
        ? { kind: 'pillar-from-upper', pillarPoint: sc.pillarPoint }
        : sc.kind === 'collinear-with-2F'
        ? { kind: 'collinear-with-upper', upperEdgeIndex: sc.edge2FIndex }
        : { kind: 'cascade-from-prev-segment' };
    expect(fs.startConstraint).toEqual(expectedSC);

    const ec = bs.endConstraint;
    const expectedEC =
      ec.kind === 'pillar-to-2F'
        ? { kind: 'pillar-to-upper', pillarPoint: ec.pillarPoint }
        : ec.kind === 'collinear-with-2F'
        ? { kind: 'collinear-with-upper', upperEdgeIndex: ec.edge2FIndex }
        : { kind: 'next-face', edgeIndex: ec.edge1FIndex };
    expect(fs.endConstraint).toEqual(expectedEC);

    // 最下階セグメントは desiredEndSource を持たない
    expect(fs.desiredEndSource).toBeUndefined();
  });
}

/** 0..n-1 の辺に一律 900mm の離れを与えるヘルパ。 */
function dist(n: number): Record<number, number> {
  const r: Record<number, number> = {};
  for (let i = 0; i < n; i++) r[i] = 900;
  return r;
}

describe('computeFloorLayout 最下階ブランチ（above有り,below=null）= computeBothmode1FLayout parity', () => {
  it('下屋なし（1F=2F）: 全辺 collinear → edgeSegments=0', () => {
    const square: BuildingShape = {
      id: 'b', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 900, y: 0 },
        { x: 900, y: 900 }, { x: 0, y: 900 },
      ],
      fill: '#000', floor: 1,
    };
    expectLowerParity(square, square, dist(4), dist(4));
  });

  it('凸型1F（B面側下屋）: pillar-from-2F 始点・collinear/next-1F-face 終点を含む', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
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
    expectLowerParity(building1F, building2F, dist(6), dist(8));
  });

  it('B面側に中央のみ下屋: independent 3 辺・各種終点制約', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 2,
    };
    const building1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 5000 }, { x: 9000, y: 5000 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    expectLowerParity(building1F, building2F, dist(8), dist(8));
  });

  it('B面側に下屋 2 個: independent 6 辺', () => {
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 9000 }, { x: 0, y: 9000 },
      ],
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
    expectLowerParity(building1F, building2F, dist(12), dist(12));
  });

  it('非デフォルト離れ（face1=600/face2=1200・辺ごと差）でも往復一致', () => {
    const ssMixed: ScaffoldStartConfig = { ...ss, face1DistanceMm: 600, face2DistanceMm: 1200 };
    const building2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
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
    const distances2F = { 0: 600, 1: 1200, 2: 900, 3: 1200, 4: 600, 5: 900 };
    expectLowerParity(building1F, building2F, distances1F, distances2F, ssMixed);
  });
});
