import { describe, it, expect } from 'vitest';
import {
  MAX_BUILDING_FLOOR,
  MAX_SCAFFOLD_FLOOR,
  isContiguousFloors,
  hasFloorAboveScaffoldLimit,
} from '../floorLimits';

describe('floorLimits 定数', () => {
  it('作成上限=8（現行値）・割付上限=3', () => {
    expect(MAX_BUILDING_FLOOR).toBe(8);
    expect(MAX_SCAFFOLD_FLOOR).toBe(3);
  });
});

describe('isContiguousFloors', () => {
  it('空・単一階は連続扱い', () => {
    expect(isContiguousFloors([])).toBe(true);
    expect(isContiguousFloors([1])).toBe(true);
    expect(isContiguousFloors([2])).toBe(true);
  });
  it('{1,2}（N=2）は連続 → ガード非発火', () => {
    expect(isContiguousFloors([1, 2])).toBe(true);
  });
  it('連続集合 {1,2,3} / {2,3} は true', () => {
    expect(isContiguousFloors([1, 2, 3])).toBe(true);
    expect(isContiguousFloors([2, 3])).toBe(true);
    expect(isContiguousFloors([3, 2, 1])).toBe(true); // 順不同
  });
  it('非連続 {1,3} / {1,2,4} は false', () => {
    expect(isContiguousFloors([1, 3])).toBe(false);
    expect(isContiguousFloors([1, 2, 4])).toBe(false);
  });
  it('重複ありは false', () => {
    expect(isContiguousFloors([1, 1, 2])).toBe(false);
  });
});

describe('hasFloorAboveScaffoldLimit', () => {
  it('{1,2}/{1,2,3} は上限内 → false', () => {
    expect(hasFloorAboveScaffoldLimit([1, 2])).toBe(false);
    expect(hasFloorAboveScaffoldLimit([1, 2, 3])).toBe(false);
  });
  it('4 以上を含むと true', () => {
    expect(hasFloorAboveScaffoldLimit([1, 2, 3, 4])).toBe(true);
    expect(hasFloorAboveScaffoldLimit([4])).toBe(true);
  });
  it('limit 引数で閾値変更可', () => {
    expect(hasFloorAboveScaffoldLimit([1, 2, 3], 2)).toBe(true);
    expect(hasFloorAboveScaffoldLimit([1, 2], 8)).toBe(false);
  });
});
