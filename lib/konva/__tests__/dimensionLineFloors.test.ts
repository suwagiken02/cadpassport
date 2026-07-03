import { describe, it, expect } from 'vitest';
import {
  FLOOR_DIM_COLORS,
  floorDimColor,
  getPresentFloors,
  dimBaseOffsetMm,
  dimKey,
  readDimVisibility,
  buildFloorDimDescriptors,
} from '@/lib/konva/dimensionLineFloors';

// ============================================================
// S-4: 寸法線 N 階一般化の pure 部分回帰。
//   (a) N=2({1,2}) が従来リテラル(色/キー/offset)と完全一致(byte 不変の根拠)。
//   (b) N=3({1,2,3}) が式どおり・キー衝突なし。
// 従来値の出所(DimensionLineLayer 修正前の定数):
//   BOTH:  scaffold2F=50 / scaffold1F=100, wall2F=200 / wall1F=500, roof2F=350 / roof1F=700
//   SOLO:  scaffold=75, wall=150, roof=300
//   色:    COLOR_1F='#444', COLOR_2F='#378ADD'
// ============================================================

describe('getPresentFloors', () => {
  it('存在階を昇順ユニーク化 (floor 未指定は 1F)', () => {
    expect(getPresentFloors([{ floor: 2 }, { floor: 1 }, { floor: 2 }, {}])).toEqual([1, 2]);
    expect(getPresentFloors([{ floor: 3 }, { floor: 1 }, { floor: 2 }])).toEqual([1, 2, 3]);
    expect(getPresentFloors([{ floor: 2 }])).toEqual([2]);
    expect(getPresentFloors([])).toEqual([]);
  });
});

describe('floorDimColor パレット', () => {
  it('1F→#444 / 2F→#378ADD (従来色一致)', () => {
    expect(floorDimColor(1)).toBe('#444');
    expect(floorDimColor(2)).toBe('#378ADD');
  });
  it('3F 以降は追加色、length 超過は循環', () => {
    expect(floorDimColor(3)).toBe(FLOOR_DIM_COLORS[2]);
    expect(floorDimColor(FLOOR_DIM_COLORS.length + 1)).toBe(FLOOR_DIM_COLORS[0]);
  });
});

describe('dimBaseOffsetMm', () => {
  it('N=2(複数階): 従来 BOTH 定数と一致', () => {
    const fp = [1, 2];
    expect(dimBaseOffsetMm('scaffold', 2, fp)).toBe(50);
    expect(dimBaseOffsetMm('scaffold', 1, fp)).toBe(100);
    expect(dimBaseOffsetMm('wall', 2, fp)).toBe(200);
    expect(dimBaseOffsetMm('wall', 1, fp)).toBe(500);
    expect(dimBaseOffsetMm('roof', 2, fp)).toBe(350);
    expect(dimBaseOffsetMm('roof', 1, fp)).toBe(700);
  });
  it('単独階: 従来 SOLO 定数と一致', () => {
    for (const fp of [[1], [2], [3]]) {
      expect(dimBaseOffsetMm('scaffold', fp[0], fp)).toBe(75);
      expect(dimBaseOffsetMm('wall', fp[0], fp)).toBe(150);
      expect(dimBaseOffsetMm('roof', fp[0], fp)).toBe(300);
    }
  });
  it('N=3(複数階): 式 base+(maxFloor−floor)·step どおり', () => {
    const fp = [1, 2, 3]; // maxFloor=3
    // scaffold: base50 step50
    expect(dimBaseOffsetMm('scaffold', 3, fp)).toBe(50);
    expect(dimBaseOffsetMm('scaffold', 2, fp)).toBe(100);
    expect(dimBaseOffsetMm('scaffold', 1, fp)).toBe(150);
    // wall: base200 step300
    expect(dimBaseOffsetMm('wall', 3, fp)).toBe(200);
    expect(dimBaseOffsetMm('wall', 2, fp)).toBe(500);
    expect(dimBaseOffsetMm('wall', 1, fp)).toBe(800);
    // roof: base350 step350
    expect(dimBaseOffsetMm('roof', 3, fp)).toBe(350);
    expect(dimBaseOffsetMm('roof', 2, fp)).toBe(700);
    expect(dimBaseOffsetMm('roof', 1, fp)).toBe(1050);
  });
});

describe('dimKey', () => {
  it('`${cat}${floor}F` を生成', () => {
    expect(dimKey('scaffold', 1)).toBe('scaffold1F');
    expect(dimKey('wall', 2)).toBe('wall2F');
    expect(dimKey('roof', 3)).toBe('roof3F');
  });
});

describe('readDimVisibility', () => {
  it('明示値を優先 (6 キー)', () => {
    const vis = { scaffold1F: true, wall1F: false, roof1F: true };
    expect(readDimVisibility(vis, 'scaffold', 1)).toBe(true);
    expect(readDimVisibility(vis, 'wall', 1)).toBe(false);
  });
  it('未定義キー(3F+)は種別デフォルト (wall/roof=true, scaffold=false)', () => {
    expect(readDimVisibility({}, 'scaffold', 3)).toBe(false);
    expect(readDimVisibility({}, 'wall', 3)).toBe(true);
    expect(readDimVisibility({}, 'roof', 3)).toBe(true);
  });
});

describe('buildFloorDimDescriptors', () => {
  it('N=2({1,2}): 従来リテラル(色/キー/offset)と完全一致・昇順', () => {
    const ds = buildFloorDimDescriptors([1, 2]);
    expect(ds).toEqual([
      {
        floor: 1, color: '#444',
        scaffoldKey: 'scaffold1F', wallKey: 'wall1F', roofKey: 'roof1F',
        offScaffoldMm: 100, offWallMm: 500, offRoofMm: 700,
      },
      {
        floor: 2, color: '#378ADD',
        scaffoldKey: 'scaffold2F', wallKey: 'wall2F', roofKey: 'roof2F',
        offScaffoldMm: 50, offWallMm: 200, offRoofMm: 350,
      },
    ]);
  });

  it('N=3({1,2,3}): floorsPresent=[1,2,3]・式どおり・キー衝突なし', () => {
    const ds = buildFloorDimDescriptors([1, 2, 3]);
    expect(ds.map(d => d.floor)).toEqual([1, 2, 3]);
    // 全キーがユニーク (衝突なし)
    const keys = ds.flatMap(d => [d.scaffoldKey, d.wallKey, d.roofKey]);
    expect(new Set(keys).size).toBe(keys.length);
    // 3F 記述子
    expect(ds[2]).toEqual({
      floor: 3, color: FLOOR_DIM_COLORS[2],
      scaffoldKey: 'scaffold3F', wallKey: 'wall3F', roofKey: 'roof3F',
      offScaffoldMm: 50, offWallMm: 200, offRoofMm: 350,
    });
    // 1F は最上階(3F)からの段差で最大 offset
    expect(ds[0]).toMatchObject({ offScaffoldMm: 150, offWallMm: 800, offRoofMm: 1050 });
  });

  it('単独階({2}): SOLO offset', () => {
    const ds = buildFloorDimDescriptors([2]);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      floor: 2, color: '#378ADD',
      offScaffoldMm: 75, offWallMm: 150, offRoofMm: 300,
    });
  });
});
