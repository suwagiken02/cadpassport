import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import {
  OTHER_FLOOR_OPACITY,
  OTHER_FLOOR_OPACITY_TOOL,
  buildingsOnFloor,
  hasFloorBuildings,
  maxBuildingFloor,
  isMultiFloor,
  resolveFloorScope,
  floorOfBuildingId,
  buildingAtPointOnFloor,
  buildingIdForPolygonOnFloor,
} from '../floorScope';

// ============================================================
// R-1h-1: 階スコープ。総二階（1F と 2F の外壁が平面上で重なる）で、
// 高さマーカー・棟ライン・屋根領域の対象建物が「配列順」ではなく「対象階」で決まることを固定する。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];

/** 1F（floor 未設定＝1F 扱いの既存データ形）。配列の先に置く＝従来は常にこちらが選ばれていた。 */
const B1F: BuildingShape = { id: 'b1', type: 'polygon', points: RECT, fill: '#000' };
/** 2F（総二階なので points は 1F と同一）。 */
const B2F: BuildingShape = { id: 'b2', type: 'polygon', points: RECT, fill: '#000', floor: 2 };
const BOTH = [B1F, B2F];

describe('R-1h-1: 階の絞り込み', () => {
  it('buildingsOnFloor: floor 未設定は 1F 扱い', () => {
    expect(buildingsOnFloor(BOTH, 1).map((b) => b.id)).toEqual(['b1']);
    expect(buildingsOnFloor(BOTH, 2).map((b) => b.id)).toEqual(['b2']);
    expect(buildingsOnFloor(BOTH, 3)).toEqual([]);
  });

  it('hasFloorBuildings / maxBuildingFloor / isMultiFloor', () => {
    expect(hasFloorBuildings(BOTH, 2)).toBe(true);
    expect(hasFloorBuildings(BOTH, 3)).toBe(false);
    expect(maxBuildingFloor(BOTH)).toBe(2);
    expect(maxBuildingFloor([B1F])).toBe(1);
    expect(maxBuildingFloor([])).toBe(0);
    expect(isMultiFloor([B1F])).toBe(false);
    expect(isMultiFloor(BOTH)).toBe(true);
  });

  it('floorOfBuildingId: 孤児（削除済み建物を指す）は null', () => {
    expect(floorOfBuildingId(BOTH, 'b2')).toBe(2);
    expect(floorOfBuildingId(BOTH, 'b1')).toBe(1);
    expect(floorOfBuildingId(BOTH, 'gone')).toBeNull();
  });
});

describe('R-1h-1: resolveFloorScope（安全側フォールバック）', () => {
  it('その階に建物があればその階だけ', () => {
    expect(resolveFloorScope(BOTH, 2).map((b) => b.id)).toEqual(['b2']);
  });

  it('その階に建物が無ければ全建物（従来挙動・階切替直後の stale 対策）', () => {
    expect(resolveFloorScope(BOTH, 5).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('単一階の物件では絞り込んでも全建物と一致（挙動不変）', () => {
    const only = [B1F, { ...B1F, id: 'b1b' }];
    expect(resolveFloorScope(only, 1)).toEqual(only);
    expect(resolveFloorScope(only, 2)).toEqual(only); // 2F 不在 → フォールバック
  });

  it('建物ゼロなら空のまま', () => {
    expect(resolveFloorScope([], 1)).toEqual([]);
  });
});

describe('R-1h-1: 重なった壁でも対象階の建物が選ばれる', () => {
  const inside: Point = { x: 180, y: 270 }; // 1F/2F どちらの内部でもある点

  it('buildingAtPointOnFloor: 2F 指定なら配列順が後でも 2F が選ばれる（棟ライン）', () => {
    expect(buildingAtPointOnFloor(inside, BOTH, 2)?.id).toBe('b2');
    expect(buildingAtPointOnFloor(inside, BOTH, 1)?.id).toBe('b1');
  });

  it('buildingIdForPolygonOnFloor: 屋根領域も対象階で決まる', () => {
    const roofPoly: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 270 }, { x: 0, y: 270 }];
    expect(buildingIdForPolygonOnFloor(roofPoly, BOTH, 2)).toBe('b2');
    expect(buildingIdForPolygonOnFloor(roofPoly, BOTH, 1)).toBe('b1');
  });

  it('建物の外なら該当なし', () => {
    expect(buildingAtPointOnFloor({ x: 900, y: 900 }, BOTH, 2)).toBeUndefined();
    const far: Point[] = [{ x: 900, y: 900 }, { x: 960, y: 900 }, { x: 960, y: 960 }, { x: 900, y: 960 }];
    expect(buildingIdForPolygonOnFloor(far, BOTH, 2)).toBeNull();
  });

  it('対象階に建物が無ければ従来どおり全建物から探す', () => {
    expect(buildingAtPointOnFloor(inside, BOTH, 4)?.id).toBe('b1'); // フォールバック＝配列順
  });
});

describe('R-1h-1: 減光定数', () => {
  it('ツール中はより濃く減光する（0 < ツール < 通常 < 1）', () => {
    expect(OTHER_FLOOR_OPACITY_TOOL).toBeGreaterThan(0);
    expect(OTHER_FLOOR_OPACITY_TOOL).toBeLessThan(OTHER_FLOOR_OPACITY);
    expect(OTHER_FLOOR_OPACITY).toBeLessThan(1);
  });
});
