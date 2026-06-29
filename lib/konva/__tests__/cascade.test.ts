import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout,
  computeBothmode1FLayout,
  splitBuilding2FAt1FVertices,
  splitLowerAtUpper,
  type Bothmode2FResult,
} from '../autoLayoutUtils';
import {
  computeFloorLayout,
  computeCascadeLayout,
  walkFloorUpperRole,
  walkFloorLowerRole,
} from '../autolayout/cascade';
import { findScaffoldViolations, type ScaffoldHandrail } from '../scaffoldViolations';
import { segmentsToHandrails } from '../autolayout/adapter';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';

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

// ============================================================
// P3-2(3/3) A 上端 parity: walkFloorUpperRole = computeBothmode2FLayout（byte 一致）
// ============================================================

/**
 * walkFloorUpperRole の出力が、最上階委譲経路 computeFloorLayout(above=null) と完全一致するか。
 * computeFloorLayout(above=null) は computeBothmode2FLayout のマッピングなので、これが
 * walkFloorUpperRole == computeBothmode2FLayout の byte parity を意味する（統合walk上端アンカー）。
 */
function expectUpperWalkParity(
  building1F: BuildingShape,
  building2F: BuildingShape,
  distances1F: Record<number, number>,
  distances2F: Record<number, number>,
  scaffold: ScaffoldStartConfig = ss,
) {
  const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
  const viaDelegate = computeFloorLayout(
    2, norm2F, null, building1F, null, { 1: distances1F, 2: distances2F }, scaffold,
  );
  const viaWalk = walkFloorUpperRole(2, norm2F, building1F, distances2F, distances1F, scaffold);
  expect(viaWalk).toEqual(viaDelegate);
}

describe('walkFloorUpperRole（A 上階ロール移植）= computeBothmode2FLayout parity', () => {
  it('下屋なし正方形', () => {
    const square: BuildingShape = {
      id: 'b', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }],
      fill: '#000', floor: 1,
    };
    expectUpperWalkParity(square, square, dist(4), dist(4));
  });

  it('B面側下屋（5辺・ピラーあり）', () => {
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
    expectUpperWalkParity(building1F, building2F, dist(6), dist(8));
  });

  it('下屋2個（8辺・ピラー4）', () => {
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
    expectUpperWalkParity(building1F, building2F, dist(12), dist(12));
  });

  it('非デフォルト離れ', () => {
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
    const distances2F = { 0: 600, 1: 1200, 2: 900, 3: 1200, 4: 600, 5: 900 };
    expectUpperWalkParity(building1F, building2F, distances1F, distances2F, ssMixed);
  });
});

// ============================================================
// P3-2(3/3) A 下端 parity: walkFloorLowerRole = computeBothmode1FLayout（byte 一致）
// ============================================================

/**
 * walkFloorLowerRole の出力が、最下階委譲経路 computeFloorLayout(below=null) と完全一致するか。
 * 委譲経路は computeBothmode1FLayout のマッピングなので、これが byte parity を意味する。
 * cascade 本番と同じく resultAbove(FloorLayoutResult) を継承する流れで照合する（統合walk下端アンカー）。
 */
function expectLowerWalkParity(
  building1F: BuildingShape,
  building2F: BuildingShape,
  distances1F: Record<number, number>,
  distances2F: Record<number, number>,
  scaffold: ScaffoldStartConfig = ss,
) {
  const norm2F = splitBuilding2FAt1FVertices(building1F, building2F);
  const distByFloor = { 1: distances1F, 2: distances2F };
  const resultAbove = computeFloorLayout(2, norm2F, null, building1F, null, distByFloor, scaffold);
  const viaDelegate = computeFloorLayout(1, building1F, norm2F, null, resultAbove, distByFloor, null);
  const viaWalk = walkFloorLowerRole(1, building1F, norm2F, resultAbove, distances1F);
  expect(viaWalk).toEqual(viaDelegate);
}

describe('walkFloorLowerRole（A 下階ロール移植）= computeBothmode1FLayout parity', () => {
  it('下屋なし（1F=2F）: edgeSegments=0', () => {
    const square: BuildingShape = {
      id: 'b', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }],
      fill: '#000', floor: 1,
    };
    expectLowerWalkParity(square, square, dist(4), dist(4));
  });

  it('凸型1F（B面側下屋）: pillar-from-upper / collinear / next-face', () => {
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
    expectLowerWalkParity(building1F, building2F, dist(6), dist(8));
  });

  it('B面側に中央のみ下屋: independent 3 辺・各種終点制約', () => {
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
        { x: 12000, y: 5000 }, { x: 9000, y: 5000 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    expectLowerWalkParity(building1F, building2F, dist(8), dist(8));
  });

  it('B面側に下屋 2 個: independent 6 辺', () => {
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
    expectLowerWalkParity(building1F, building2F, dist(12), dist(12));
  });

  it('非デフォルト離れ（face1=600/face2=1200・辺ごと差）', () => {
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
    const distances2F = { 0: 600, 1: 1200, 2: 900, 3: 1200, 4: 600, 5: 900 };
    expectLowerWalkParity(building1F, building2F, distances1F, distances2F, ssMixed);
  });
});

// ============================================================
// P3-2(3/3) 増分2b-i: 中間階（下屋/面一）の N=3 検証
// ============================================================

/** target を others 全ての頂点で分割（= cascade ドライバの前処理相当。純幾何 splitLowerAtUpper を流用）。*/
function splitAtAll(target: BuildingShape, others: BuildingShape[]): BuildingShape {
  let result = target;
  for (const o of others) result = splitLowerAtUpper(result, o);
  return result;
}

describe('computeFloorLayout 中間階 N=3（下屋/面一・増分2b-i）', () => {
  it('(a) 総3階・全辺面一: 最上階のみフル周、中下階は共有で空、findScaffoldViolations=0', () => {
    const sq = (id: string, floor: number): BuildingShape => ({
      id, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const f3 = sq('3f', 3), f2 = sq('2f', 2), f1 = sq('1f', 1);
    const D = { 1: dist(4), 2: dist(4), 3: dist(4) };

    const r3 = computeFloorLayout(3, f3, null, f2, null, D, ss);
    const r2 = computeFloorLayout(2, f2, f3, f1, r3, D, null);
    const r1 = computeFloorLayout(1, f1, f2, null, r2, D, null);

    expect(r3.edgeSegments.length).toBe(4); // 最上階フル周
    expect(r2.edgeSegments.length).toBe(0); // 中間階は全面一→共有→空
    expect(r1.edgeSegments.length).toBe(0); // 最下階も全面一→空

    const handrails = [
      ...segmentsToHandrails(r3.edgeSegments),
      ...segmentsToHandrails(r2.edgeSegments),
      ...segmentsToHandrails(r1.edgeSegments),
    ];
    expect(findScaffoldViolations(handrails, [f1, f2, f3])).toEqual([]);
  });

  it('(b) 下屋積層（1F>2F>3F 東に階段状）: 各段差で自前ライン・中間階が下階へ柱・findScaffoldViolations=0', () => {
    const mk = (id: string, floor: number, east: number): BuildingShape => ({
      id, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: east, y: 0 }, { x: east, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const f3 = mk('3f', 3, 6000);
    const f2 = mk('2f', 2, 9000);
    const f1 = mk('1f', 1, 12000);
    // 各階を他の全階の頂点で分割（cascade ドライバ相当の前処理＝多階で整合）
    const n3 = splitAtAll(f3, [f2, f1]);
    const n2 = splitAtAll(f2, [f3, f1]);
    const n1 = splitAtAll(f1, [f3, f2]);
    const D = { 1: dist(10), 2: dist(10), 3: dist(10) };

    const r3 = computeFloorLayout(3, n3, null, n2, null, D, ss);
    const r2 = computeFloorLayout(2, n2, n3, n1, r3, D, null);
    const r1 = computeFloorLayout(1, n1, n2, null, r2, D, null);

    // 中間階(2F)は east 下屋部に自前セグメントを持ち、1F へ柱マーカーを出す
    expect(r2.edgeSegments.length).toBeGreaterThan(0);
    expect(r2.edgeSegments.some(s => s.desiredEndSource?.kind === 'lower-face-pillar')).toBe(true);
    // 最下階(1F)も east 下屋部に自前セグメント
    expect(r1.edgeSegments.length).toBeGreaterThan(0);

    const handrails = [
      ...segmentsToHandrails(r3.edgeSegments),
      ...segmentsToHandrails(r2.edgeSegments),
      ...segmentsToHandrails(r1.edgeSegments),
    ];
    expect(findScaffoldViolations(handrails, [f1, f2, f3])).toEqual([]);
  });
});

// ============================================================
// P3-2(3/3) 増分2b-ii: せり出し（Q2 covered→自前）の N=3 検証
// ============================================================

describe('computeFloorLayout せり出し N=3（Q2 covered→自前・増分2b-ii）', () => {
  it('(c) せり出し積層（1F<2F<3F 上が東に張り出す）: 引っ込んだ下階壁に自前ライン・findScaffoldViolations=0', () => {
    // upper ほど東に大きい（張り出し）。1F=6000, 2F=9000, 3F=12000、全て y[0..7000]。
    const mk = (id: string, floor: number, east: number): BuildingShape => ({
      id, type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: east, y: 0 }, { x: east, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor,
    });
    const f3 = mk('3f', 3, 12000);
    const f2 = mk('2f', 2, 9000);
    const f1 = mk('1f', 1, 6000);
    const n3 = splitAtAll(f3, [f2, f1]);
    const n2 = splitAtAll(f2, [f3, f1]);
    const n1 = splitAtAll(f1, [f3, f2]);
    const D = { 1: dist(10), 2: dist(10), 3: dist(10) };

    const r3 = computeFloorLayout(3, n3, null, n2, null, D, ss);
    const r2 = computeFloorLayout(2, n2, n3, n1, r3, D, null);
    const r1 = computeFloorLayout(1, n1, n2, null, r2, D, null);

    // Q2: 上階の下に引っ込んだ east 壁にも自前ラインが出る（旧仕様ならスキップ＝空だった）。
    // 1F east は x=6000 の縦壁、2F east は x=9000 の縦壁。
    expect(r1.edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 6000)).toBe(true);
    expect(r2.edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 9000)).toBe(true);

    const handrails = [
      ...segmentsToHandrails(r3.edgeSegments),
      ...segmentsToHandrails(r2.edgeSegments),
      ...segmentsToHandrails(r1.edgeSegments),
    ];
    expect(findScaffoldViolations(handrails, [f1, f2, f3])).toEqual([]);
  });

  it('(d) 混在（中間階が上階に対し西=引っ込み・東=下屋）: 両側に自前ライン・findScaffoldViolations=0', () => {
    // 3F[0..8000], 2F[4000..12000](西は3F下に引っ込み/東は3Fより張り出す), 1F[4000..16000]
    const f3: BuildingShape = {
      id: '3f', type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 7000 }, { x: 0, y: 7000 }],
      fill: '#000', floor: 3,
    };
    const f2: BuildingShape = {
      id: '2f', type: 'polygon',
      points: [{ x: 4000, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 7000 }, { x: 4000, y: 7000 }],
      fill: '#000', floor: 2,
    };
    const f1: BuildingShape = {
      id: '1f', type: 'polygon',
      points: [{ x: 4000, y: 0 }, { x: 16000, y: 0 }, { x: 16000, y: 7000 }, { x: 4000, y: 7000 }],
      fill: '#000', floor: 1,
    };
    const n3 = splitAtAll(f3, [f2, f1]);
    const n2 = splitAtAll(f2, [f3, f1]);
    const n1 = splitAtAll(f1, [f3, f2]);
    const D = { 1: dist(12), 2: dist(12), 3: dist(12) };

    const r3 = computeFloorLayout(3, n3, null, n2, null, D, ss);
    const r2 = computeFloorLayout(2, n2, n3, n1, r3, D, null);
    const r1 = computeFloorLayout(1, n1, n2, null, r2, D, null);

    // 中間階(2F): 西=引っ込み(covered→自前, x=4000 縦壁) と 東=下屋(x=12000 縦壁) の両方に自前ライン。
    expect(r2.edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 4000)).toBe(true);
    expect(r2.edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 12000)).toBe(true);

    const handrails = [
      ...segmentsToHandrails(r3.edgeSegments),
      ...segmentsToHandrails(r2.edgeSegments),
      ...segmentsToHandrails(r1.edgeSegments),
    ];
    expect(findScaffoldViolations(handrails, [f1, f2, f3])).toEqual([]);
  });
});

// ============================================================
// P3-3: N階ドライバ computeCascadeLayout の端から端まで検証
// ============================================================

/** 全階の FloorLayoutResult を結合して手摺化（ドライバ出力の検査用）。*/
function allHandrails(results: ReturnType<typeof computeCascadeLayout>): ScaffoldHandrail[] {
  return Object.values(results).flatMap(r => segmentsToHandrails(r.edgeSegments));
}

describe('computeCascadeLayout N=3 端到端（ドライバ・P3-3）', () => {
  const rectFloor = (id: string, floor: number, x0: number, x1: number): BuildingShape => ({
    id, type: 'polygon',
    points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 7000 }, { x: x0, y: 7000 }],
    fill: '#000', floor,
  });

  it('(a) 総3階・全辺面一: 最上階のみフル周(4)、中下階は空、違反0', () => {
    const buildings = {
      3: rectFloor('3f', 3, 0, 9000),
      2: rectFloor('2f', 2, 0, 9000),
      1: rectFloor('1f', 1, 0, 9000),
    };
    const D = { 1: dist(4), 2: dist(4), 3: dist(4) };
    const res = computeCascadeLayout(buildings, D, ss);
    expect(res[3].edgeSegments.length).toBe(4);
    expect(res[2].edgeSegments.length).toBe(0);
    expect(res[1].edgeSegments.length).toBe(0);
    expect(findScaffoldViolations(allHandrails(res), Object.values(buildings))).toEqual([]);
  });

  it('(b) 下屋積層（1F>2F>3F 東に階段状）: 中間階に柱マーカー・各段差で自前ライン・違反0', () => {
    const buildings = {
      3: rectFloor('3f', 3, 0, 6000),
      2: rectFloor('2f', 2, 0, 9000),
      1: rectFloor('1f', 1, 0, 12000),
    };
    const D = { 1: dist(10), 2: dist(10), 3: dist(10) };
    const res = computeCascadeLayout(buildings, D, ss);
    expect(res[2].edgeSegments.length).toBeGreaterThan(0);
    expect(res[2].edgeSegments.some(s => s.desiredEndSource?.kind === 'lower-face-pillar')).toBe(true);
    expect(res[1].edgeSegments.length).toBeGreaterThan(0);
    expect(findScaffoldViolations(allHandrails(res), Object.values(buildings))).toEqual([]);
  });

  it('(c) せり出し積層（1F<2F<3F 上が東に張り出す）: 引っ込んだ下階壁に自前ライン・違反0', () => {
    const buildings = {
      3: rectFloor('3f', 3, 0, 12000),
      2: rectFloor('2f', 2, 0, 9000),
      1: rectFloor('1f', 1, 0, 6000),
    };
    const D = { 1: dist(10), 2: dist(10), 3: dist(10) };
    const res = computeCascadeLayout(buildings, D, ss);
    expect(res[1].edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 6000)).toBe(true);
    expect(res[2].edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 9000)).toBe(true);
    expect(findScaffoldViolations(allHandrails(res), Object.values(buildings))).toEqual([]);
  });

  it('(d) 混在（中間階が上階に対し 西=引っ込み・東=下屋）: 両側に自前ライン・違反0', () => {
    const buildings = {
      3: rectFloor('3f', 3, 0, 8000),
      2: rectFloor('2f', 2, 4000, 12000),
      1: rectFloor('1f', 1, 4000, 16000),
    };
    const D = { 1: dist(12), 2: dist(12), 3: dist(12) };
    const res = computeCascadeLayout(buildings, D, ss);
    expect(res[2].edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 4000)).toBe(true);
    expect(res[2].edgeSegments.some(s => s.handrailDir === 'vertical' && s.startPoint.x === 12000)).toBe(true);
    expect(findScaffoldViolations(allHandrails(res), Object.values(buildings))).toEqual([]);
  });

  it('N=2 下屋もドライバで回せて違反0', () => {
    const building2F = rectFloor('2f', 2, 0, 9000);
    const building1F: BuildingShape = {
      id: '1f', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 2000 }, { x: 12000, y: 2000 },
        { x: 12000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const res = computeCascadeLayout({ 2: building2F, 1: building1F }, { 1: dist(8), 2: dist(8) }, ss);
    expect(res[2].edgeSegments.length).toBeGreaterThan(0);
    expect(findScaffoldViolations(allHandrails(res), [building1F, building2F])).toEqual([]);
  });

  it('連続積層でない（飛び階）はエラー', () => {
    const buildings = {
      3: rectFloor('3f', 3, 0, 9000),
      1: rectFloor('1f', 1, 0, 9000),
    };
    expect(() => computeCascadeLayout(buildings, { 1: dist(4), 3: dist(4) }, ss)).toThrow();
  });
});

// ============================================================
// せり出し入隅: 面一終端辺の「有効長」非対称バグ（cascade.ts:746 凹ラップ）
//   2F=全体を覆う矩形 / 1F=NW角を辺長3000(=300grid)でカットしたL字。
//   入隅[300,300]で隣り合う covered 2辺（北=横/西=縦, 各3000mm, 外周側は面一）の
//   有効長(=選択candidate rails合計, 表示の「有効」)が、北=3000(正) / 西=1200(誤) と非対称になる。
//   西は collinear-with-upper 終端で出隅(+900)が凹ラップに潰され -900-900 で1800縮む。
//   正: 北・西とも有効=辺長3000・同本数（外周の出隅と同じおさまり）。
// ============================================================
describe('せり出し入隅: 面一終端辺の有効長（北=西=辺長で対称）', () => {
  // grid 単位（lengthMm = grid×10）。辺長3000mm = 300grid。
  const f2: BuildingShape = {
    id: '2f', type: 'polygon',
    points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }],
    fill: '#000', floor: 2,
  };
  // 1F = NW角を 300x300 でカットした L字（時計回り）。入隅は [300,300]。
  const f1: BuildingShape = {
    id: '1f', type: 'polygon',
    points: [
      { x: 300, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 },
      { x: 0, y: 600 }, { x: 0, y: 300 }, { x: 300, y: 300 },
    ],
    fill: '#000', floor: 1,
  };
  const railsSum = (s: { candidates: { rails: number[] }[]; selectedIndex: number }) =>
    s.candidates[s.selectedIndex]?.rails.reduce((a, b) => a + b, 0) ?? 0;
  const railsLen = (s: { candidates: { rails: number[] }[]; selectedIndex: number }) =>
    s.candidates[s.selectedIndex]?.rails.length ?? 0;

  it('入隅で隣接する北辺(横)と西辺(縦)が両方とも有効=辺長3000・同本数', () => {
    const res = computeCascadeLayout({ 1: f1, 2: f2 }, { 1: dist(8), 2: dist(8) }, ss);
    // 北 = y=300 の covered 横辺 [0,300]→[300,300]
    const north = res[1].edgeSegments.find(
      s => s.handrailDir === 'horizontal' && Math.abs(s.startPoint.y - 300) < 1,
    );
    // 西 = x=300 の covered 縦辺 [300,300]→[300,0]
    const west = res[1].edgeSegments.find(
      s => s.handrailDir === 'vertical' && Math.abs(s.startPoint.x - 300) < 1,
    );
    expect(north).toBeDefined();
    expect(west).toBeDefined();

    // 北は元々正しい: 有効=辺長3000（例 1800+1200 = 2本）
    expect(railsSum(north!)).toBe(3000);
    // 西は現状 1200/1本で赤 → 修正後 北と同じ 3000・同本数
    expect(railsSum(west!)).toBe(3000);
    expect(railsLen(west!)).toBe(railsLen(north!));

    // 入隅内角(2100,2100)で北辺端点と西辺端点が一致しL字接合（T字違反なし）。
    expect(findScaffoldViolations(allHandrails(res), [f1, f2])).toEqual([]);
    // 西辺の実描画手摺が入隅端で離れ分(900)引っ込む: y=-900..2100mm（生角3000mmまで突き出さない）。
    const westRails = segmentsToHandrails(res[1].edgeSegments)
      .filter(h => h.direction === 'vertical' && Math.abs(h.x - 210) < 1);
    expect(westRails.length).toBeGreaterThan(0);
    expect(Math.min(...westRails.map(h => h.y))).toBeCloseTo(-90, 1);
    expect(Math.max(...westRails.map(h => h.y + h.lengthMm / 10))).toBeCloseTo(210, 1);
  });
});

// ============================================================
// せり出し入隅: 角・処理順に依存せず、入隅で隣接する covered 2辺が L字接合する。
//   2F=全体被覆 / 1F=各角を300grid(3000mm)カットしたL字。入隅は常に[300,300]。
//   入隅始点の covered辺が k=0 で処理されると 2nd-pass cursor が生角へフォールバックし
//   足場線が突き出して隣辺と T字違反になる（NW角で発現）。SW/NE/SE では prev 経由で
//   正しく引っ込む。角に依らず一律 findScaffoldViolations===[] を固定する。
// ============================================================
describe('せり出し入隅: 角非依存で covered 2辺がL字接合（T字違反なし）', () => {
  const f2: BuildingShape = {
    id: '2f', type: 'polygon',
    points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }],
    fill: '#000', floor: 2,
  };
  const variants: Array<{ name: string; pts: { x: number; y: number }[] }> = [
    { name: 'NW', pts: [{ x: 300, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }, { x: 0, y: 300 }, { x: 300, y: 300 }] },
    { name: 'SW', pts: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 300, y: 600 }, { x: 300, y: 300 }, { x: 0, y: 300 }] },
    { name: 'NE', pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 600 }, { x: 0, y: 600 }] },
    { name: 'SE', pts: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }] },
  ];
  variants.forEach(v => {
    it(`${v.name}角カット入隅: findScaffoldViolations===[]（L字接合）`, () => {
      const f1: BuildingShape = { id: '1f', type: 'polygon', points: v.pts, fill: '#000', floor: 1 };
      const res = computeCascadeLayout({ 1: f1, 2: f2 }, { 1: dist(8), 2: dist(8) }, ss);
      expect(findScaffoldViolations(allHandrails(res), [f1, f2])).toEqual([]);
    });
  });
});

// ============================================================
// 範囲離れ S-4b-2: 最上階(2F全周)へ band を渡して帯探索を有効化。
//   band探索は priorityConfig 経路でのみ動くため、テストは DEFAULT_PRIORITY_CONFIG を渡す。
//   band 指定でのみ 2F全周の候補が帯[lo,hi]内の割れ位置になる。band未指定は従来一致(parity)。
// ============================================================
describe('範囲離れ S-4b-2: 最上階(2F全周)の帯探索', () => {
  const rectN = (id: string, floor: number, x1: number, y1: number): BuildingShape => ({
    id, type: 'polygon',
    points: [{ x: 0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: y1 }, { x: 0, y: y1 }],
    fill: '#000', floor,
  });
  const M = DEFAULT_ENABLED_SIZES;
  const PC = DEFAULT_PRIORITY_CONFIG;

  it('(A) 総二階(2F=1F)で band を 2F全周へ届け、帯内へ離れが動く＋findScaffoldViolations=0', () => {
    // 2F===1F → 1F全辺は面一で空、2F全周のみ。priorityConfig+band[400,800] で 2F全周が帯探索。
    const f2 = rectN('2f', 2, 600, 400); // 6000×4000
    const f1 = rectN('1f', 1, 600, 400);
    const D = { 1: dist(4), 2: dist(4) };
    const resBand = computeCascadeLayout({ 1: f1, 2: f2 }, D, ss, M, PC, undefined, undefined, { lo: 400, hi: 800, mode: 'center' });
    const resNo = computeCascadeLayout({ 1: f1, 2: f2 }, D, ss, M, PC);
    // band が 2F全周に届いた: 帯[400,800]内へ動いた 2F辺が存在(no-band の窓~900 中心より小)
    const band2FEnds = resBand[2].edgeSegments.map(s => s.candidates[s.selectedIndex]?.actualEndDistanceMm ?? 0);
    expect(band2FEnds.some(e => e > 0 && e <= 800)).toBe(true);
    // band有無で 2F全周結果が変化(帯探索が効いている)
    expect(JSON.stringify(resBand[2].edgeSegments)).not.toEqual(JSON.stringify(resNo[2].edgeSegments));
    // 物理安全: 2F全周に帯探索が効いても違反0
    expect(findScaffoldViolations(allHandrails(resBand), [f1, f2])).toEqual([]);
  });

  it('(B) せり出し(2F>1F)で band を渡しても 2F全周＋1F追従で findScaffoldViolations=0', () => {
    const f2 = rectN('2f', 2, 900, 700); // 9000×7000（上が大きい=せり出し）
    const f1 = rectN('1f', 1, 600, 700); // 6000×7000（east が 2F 下に引っ込む）
    const D = { 1: dist(4), 2: dist(4) };
    const resBand = computeCascadeLayout({ 1: f1, 2: f2 }, D, ss, M, PC, undefined, undefined, { lo: 800, hi: 1000, mode: 'center' });
    expect(findScaffoldViolations(allHandrails(resBand), [f1, f2])).toEqual([]);
  });

  it('(C) band未指定(priorityConfig)は 2F全周が従来どおり(帯探索なし)・違反0', () => {
    const f2 = rectN('2f', 2, 600, 400);
    const f1 = rectN('1f', 1, 600, 400);
    const D = { 1: dist(4), 2: dist(4) };
    const res = computeCascadeLayout({ 1: f1, 2: f2 }, D, ss, M, PC);
    expect(findScaffoldViolations(allHandrails(res), [f1, f2])).toEqual([]);
  });
});
