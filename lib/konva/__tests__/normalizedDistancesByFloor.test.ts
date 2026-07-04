import { describe, it, expect } from 'vitest';
import { normalizeBuildingsByFloor } from '../autolayout/cascade';
import {
  splitBuilding2FAt1FVertices,
  getEdgesNotCoveredBy,
  getBuildingEdgesClockwise,
} from '../autoLayoutUtils';
import { getNormalizedDistances } from '../labelUtils';
import type { BuildingShape } from '@/types';

// ============================================================
// S-5d: cascadeInput.distances の per-floor 一様正規化が {1,2} で byte 不変であることを固定。
//   OLD: { 1: distancesByFloor[1](=distances1F, 生 normalized-keyed),
//          2: getNormalizedDistances(building2F, norm2F, distancesByFloor[2]) }
//   NEW(一様ループ): 各階 f で rawB=(f===primaryFloor? raw building : normB) として
//          getNormalizedDistances(rawB, normB, distancesByFloor[f])
//   → floor 1 は getNormalizedDistances(norm1F, norm1F, d)=identity で distances1F と一致。
// ============================================================

const REP = 825; // band[700,950] center 相当

// 実物件フィクスチャ: 1F=下屋つき / 2F=矩形
const L1: BuildingShape = {
  id: 'l1', type: 'polygon', fill: '#000', floor: 1,
  points: [
    { x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 2000 },
    { x: 12000, y: 2000 }, { x: 12000, y: 7000 }, { x: 0, y: 7000 }, // せり出し L字
  ],
};
const L2: BuildingShape = {
  id: 'l2', type: 'polygon', fill: '#000', floor: 2,
  points: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 7000 }, { x: 0, y: 7000 }],
};

// U字物件（両袖に下屋）
const U1: BuildingShape = {
  id: 'u1', type: 'polygon', fill: '#000', floor: 1,
  points: [
    { x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 8000 },
    { x: 10000, y: 8000 }, { x: 10000, y: 3000 }, { x: 4000, y: 3000 },
    { x: 4000, y: 8000 }, { x: 0, y: 8000 },
  ],
};
const U2: BuildingShape = {
  id: 'u2', type: 'polygon', fill: '#000', floor: 2,
  points: [{ x: 0, y: 0 }, { x: 14000, y: 0 }, { x: 14000, y: 3000 }, { x: 0, y: 3000 }],
};

/** distancesByFloor を実状態と同じ流儀で seed する。
 *  [2]=raw building2F 辺 index キー、[1]=uncovered(norm1F 辺) index キー。 */
function seed(b1: BuildingShape, b2: BuildingShape) {
  const norm = normalizeBuildingsByFloor({ 1: b1, 2: b2 });
  const d2: Record<number, number> = {};
  for (const e of getBuildingEdgesClockwise(b2)) d2[e.index] = REP;
  const uncovered = getEdgesNotCoveredBy(norm[1], norm[2]);
  const d1: Record<number, number> = {};
  for (const e of uncovered) d1[e.index] = REP;
  return { norm, distancesByFloor: { 1: d1, 2: d2 } as Record<number, Record<number, number>> };
}

// OLD の distancesRec 構築
function oldDistancesRec(b1: BuildingShape, b2: BuildingShape) {
  const { norm, distancesByFloor } = seed(b1, b2);
  const normalizedDistances = getNormalizedDistances(b2, norm[2], distancesByFloor[2]);
  return { 1: distancesByFloor[1], 2: normalizedDistances };
}

// NEW の一様ループ
function newDistancesRec(b1: BuildingShape, b2: BuildingShape) {
  const { norm, distancesByFloor } = seed(b1, b2);
  const buildingByFloor: Record<number, BuildingShape> = { 1: b1, 2: b2 };
  const primaryFloor = 2;
  const presentFloors = [1, 2];
  const rec: Record<number, Record<number, number>> = {};
  for (const f of presentFloors) {
    const normB = norm[f];
    const rawD = distancesByFloor[f] ?? {};
    const rawB = (f === primaryFloor ? buildingByFloor[f] : normB) ?? normB;
    rec[f] = getNormalizedDistances(rawB, normB, rawD);
  }
  return rec;
}

describe('getNormalizedDistances identity（floor 1 の byte 不変根拠）', () => {
  it('source===target building なら d をそのまま返す（B の辺 index キーの d）', () => {
    const { norm, distancesByFloor } = seed(L1, L2);
    const id = getNormalizedDistances(norm[1], norm[1], distancesByFloor[1]);
    expect(id).toEqual(distancesByFloor[1]);
  });
  it('U字でも identity', () => {
    const { norm, distancesByFloor } = seed(U1, U2);
    const id = getNormalizedDistances(norm[1], norm[1], distancesByFloor[1]);
    expect(id).toEqual(distancesByFloor[1]);
  });
});

describe('cascadeInput.distances: NEW 一様正規化 === OLD 2分岐（{1,2} deep equal）', () => {
  it('下屋L字・せり出し物件', () => {
    expect(newDistancesRec(L1, L2)).toEqual(oldDistancesRec(L1, L2));
  });
  it('U字物件', () => {
    expect(newDistancesRec(U1, U2)).toEqual(oldDistancesRec(U1, U2));
  });
  it('floor 2 は raw→normalized 再キー・floor 1 は identity（中身の健全性）', () => {
    const rec = newDistancesRec(L1, L2);
    expect(Object.keys(rec).map(Number).sort()).toEqual([1, 2]);
    expect(Object.keys(rec[1]).length).toBeGreaterThan(0); // 下屋辺に離れ
    expect(Object.keys(rec[2]).length).toBeGreaterThan(0); // 2F 全辺に離れ
    for (const v of Object.values(rec[1])) expect(v).toBe(REP);
    for (const v of Object.values(rec[2])) expect(v).toBe(REP);
  });
});
