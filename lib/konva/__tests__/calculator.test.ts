import { describe, it, expect } from 'vitest';
import { evalExpr, fillByLargest, heightToFloors } from '../calculator';
import type { PriorityConfig } from '@/types';

describe('evalExpr（四則演算）', () => {
  it('加減乗除', () => {
    expect(evalExpr('1+2')).toBe(3);
    expect(evalExpr('7-9')).toBe(-2);
    expect(evalExpr('6*7')).toBe(42);
    expect(evalExpr('8/2')).toBe(4);
  });
  it('× ÷ が + − より先（優先順位）', () => {
    expect(evalExpr('2+3*4')).toBe(14);
    expect(evalExpr('2+3*4-5/2')).toBe(11.5);
    expect(evalExpr('10-2*3')).toBe(4);
  });
  it('連続演算', () => {
    expect(evalExpr('1+2+3+4')).toBe(10);
    expect(evalExpr('2*3*4')).toBe(24);
  });
  it('小数', () => {
    expect(evalExpr('0.5+0.25')).toBe(0.75);
    expect(evalExpr('1.5*2')).toBe(3);
  });
  it('先頭の負数', () => {
    expect(evalExpr('-3+5')).toBe(2);
    expect(evalExpr('-2*-3')).toBe(6);
  });
  it('ゼロ除算は null', () => {
    expect(evalExpr('5/0')).toBeNull();
    expect(evalExpr('1+2/0')).toBeNull();
  });
  it('空・不正式は null', () => {
    expect(evalExpr('')).toBeNull();
    expect(evalExpr('1+')).toBeNull();
    expect(evalExpr('*3')).toBeNull();
    expect(evalExpr('1++2')).toBeNull();
    expect(evalExpr('.')).toBeNull();
  });
});

describe('fillByLargest（割付・大物優先グリーディ＋余り）', () => {
  const sizes1500 = [1800, 1500, 1200, 900, 600, 400, 300, 200];
  it('仕様例: 7000 → 1800×3＋1500×1＝6900 余り100', () => {
    const r = fillByLargest(7000, sizes1500);
    expect(r.combo).toEqual([{ size: 1800, count: 3 }, { size: 1500, count: 1 }]);
    expect(r.usedMm).toBe(6900);
    expect(r.remainderMm).toBe(100);
  });
  it('ぴったり: 3600 → 1800×2 余り0', () => {
    const r = fillByLargest(3600, [1800, 1200, 900]);
    expect(r.combo).toEqual([{ size: 1800, count: 2 }]);
    expect(r.remainderMm).toBe(0);
  });
  it('非整数は四捨五入', () => {
    expect(fillByLargest(1800.4, [1800]).combo).toEqual([{ size: 1800, count: 1 }]);
  });
  it('非正・部材なしは combo 空', () => {
    expect(fillByLargest(0, [1800])).toEqual({ combo: [], usedMm: 0, remainderMm: 0 });
    expect(fillByLargest(-5, [1800]).combo).toEqual([]);
    expect(fillByLargest(5000, []).combo).toEqual([]);
    expect(fillByLargest(5000, []).remainderMm).toBe(5000);
  });
  it('priorityConfig の excluded サイズは使わない', () => {
    // order に 1800/900 のみ → 1500 等は excluded 扱い。mainCount など最小構成。
    const pc = { order: [1800, 900], mainCount: 1, subCount: 1, adjustCount: 0 } as unknown as PriorityConfig;
    const r = fillByLargest(2700, [1800, 1500, 900], pc);
    // 1500 は order 外=excluded で不使用 → 1800×1 + 900×1 = 2700
    expect(r.combo).toEqual([{ size: 1800, count: 1 }, { size: 900, count: 1 }]);
    expect(r.remainderMm).toBe(0);
  });
  it('インチ enabledSizes でも動作（部材リストを尊重）', () => {
    const inch = [1829, 1524, 1219, 914, 610, 410, 305, 200];
    const r = fillByLargest(4000, inch);
    expect(r.usedMm + r.remainderMm).toBe(4000);
    expect(r.combo[0].size).toBe(1829); // 大物優先
  });
});

describe('heightToFloors（高さ→段数＋スタート）', () => {
  it('仕様例: 5000 → 1400スタートの2段', () => {
    expect(heightToFloors(5000)).toEqual({ startMm: 1400, floors: 2 });
  });
  it('境界: H=1800 → 1800スタートの0段（端数=全高・段0）', () => {
    expect(heightToFloors(1800)).toEqual({ startMm: 1800, floors: 0 });
  });
  it('境界: H=3600 → 1800スタートの1段', () => {
    expect(heightToFloors(3600)).toEqual({ startMm: 1800, floors: 1 });
  });
  it('境界: H=3601 → 1スタートの2段', () => {
    expect(heightToFloors(3601)).toEqual({ startMm: 1, floors: 2 });
  });
  it('非正は 0 段', () => {
    expect(heightToFloors(0)).toEqual({ startMm: 0, floors: 0 });
    expect(heightToFloors(-100)).toEqual({ startMm: 0, floors: 0 });
  });
});
