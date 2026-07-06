import { describe, it, expect } from 'vitest';
import { computeCascadeLayout, normalizeBuildingsByFloor } from '../autolayout/cascade';
import { isBandHonored, proposeClosingBands } from '../autolayout/loopFit';
import { autoStartVertexIndex } from '../labelUtils';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';

const M = DEFAULT_ENABLED_SIZES, PC = DEFAULT_PRIORITY_CONFIG;
const ss: ScaffoldStartConfig = { corner: 'nw', startVertexIndex: 0, face1DistanceMm: 900, face2DistanceMm: 900, face1FirstHandrail: 1800, face2FirstHandrail: 1800 };
const L = (id: string, f: number, w: number, h: number, nx: number, ny: number): BuildingShape => ({ id, type: 'polygon', fill: '#000', floor: f, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: ny }, { x: nx, y: ny }, { x: nx, y: h }, { x: 0, y: h }] });
const rect = (id: string, f: number, w: number, h: number): BuildingShape => ({ id, type: 'polygon', fill: '#000', floor: f, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] });
const fill = (n: number, v: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, v]));

// L字上階(900角)＋覆う矩形1F
const Lbld = { 2: L('2f', 2, 900, 900, 495, 495), 1: rect('1f', 1, 2250, 2350) };
const LD = { 1: fill(8, 900), 2: fill(8, 900) };
const runL = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => computeCascadeLayout(Lbld, LD, ss, M, PC, undefined, undefined, band);
const proposeL = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => proposeClosingBands(Lbld, LD, ss, M, PC, undefined, undefined, band);

// S-2d U字物件（実運用デフォルト帯[700,950]・自動起点相当）
const b1r: BuildingShape = { id: '1f', type: 'polygon', fill: '#000', floor: 1, points: [{ x: -150, y: -150 }, { x: 750, y: -150 }, { x: 750, y: 550 }, { x: 150, y: 550 }, { x: 150, y: 250 }, { x: -150, y: 250 }] };
const b2r: BuildingShape = { id: '2f', type: 'polygon', fill: '#000', floor: 2, points: [{ x: 150, y: 550 }, { x: 750, y: 550 }, { x: 750, y: -150 }, { x: 150, y: -150 }] };
const ssU: ScaffoldStartConfig = { corner: 'nw', startVertexIndex: 0, face1DistanceMm: 825, face2DistanceMm: 825, face1FirstHandrail: 1800, face2FirstHandrail: 1800 };

describe('isBandHonored（帯履行判定）', () => {
  it('良帯 L字[800,950]center: honored=true・帯外0', () => {
    const info = isBandHonored(runL({ lo: 800, hi: 950, mode: 'center' }), { lo: 800, hi: 950 });
    expect(info.honored).toBe(true);
    expect(info.oobCount).toBe(0);
    expect(info.residual).toBeLessThanOrEqual(0.01);
  });
  it('狭帯 L字[850,870]center: honored=false・帯外あり（帯を無視して帯外離れで割っている）', () => {
    const info = isBandHonored(runL({ lo: 850, hi: 870, mode: 'center' }), { lo: 850, hi: 870 });
    expect(info.honored).toBe(false);
    expect(info.oobCount).toBeGreaterThan(0);
    // closed 自体は成立（fallback で tile）＝ closed だけでは検出できないことの固定
    expect(info.residual).toBeLessThanOrEqual(0.01);
    // 実離れが帯外（例 940 まで）に出ている
    expect(info.distRange[1]).toBeGreaterThan(870);
  });
  it('U字物件[700,950]center（実運用デフォルト帯・良ケース）: honored=true', () => {
    const res = computeCascadeLayout({ 1: b1r, 2: b2r }, { 1: fill(7, 825), 2: fill(5, 825) }, ssU, M, PC, undefined, undefined, { lo: 700, hi: 950, mode: 'center' });
    const info = isBandHonored(res, { lo: 700, hi: 950 });
    expect(info.honored).toBe(true);
    expect(info.oobCount).toBe(0);
  });
});

describe('proposeClosingBands（方向別の閉じる帯提案）', () => {
  it('狭帯 L字[940,950]center → 3方向の提案が返り、各 non-null は honored=true・方向規約を満たす', () => {
    const band = { lo: 940, hi: 950, mode: 'center' as const };
    const p = proposeL(band);
    // 少なくとも1方向は提案が出る
    expect(!!p.expandUp || !!p.expandDown || !!p.expandBoth).toBe(true);
    // expandUp: 下限固定(lo=940) / expandDown: 上限固定(hi=950) / expandBoth: 中心保存(=945)
    if (p.expandUp) { expect(p.expandUp.lo).toBe(940); expect(p.expandUp.hi).toBeGreaterThan(950); }
    if (p.expandDown) { expect(p.expandDown.hi).toBe(950); expect(p.expandDown.lo).toBeLessThan(940); }
    if (p.expandBoth) { expect((p.expandBoth.lo + p.expandBoth.hi) / 2).toBeCloseTo(945, 0); }
    // 各提案帯は再計算で honored
    for (const c of [p.expandUp, p.expandDown, p.expandBoth]) {
      if (!c) continue;
      expect(isBandHonored(runL({ lo: c.lo, hi: c.hi, mode: 'center' }), c).honored).toBe(true);
    }
  });
  it('重複排除: 同一帯になった方向は片方 null（3方向が全て異なる帯にはならない場合の担保）', () => {
    const p = proposeL({ lo: 940, hi: 950, mode: 'center' });
    const bands = [p.expandUp, p.expandDown, p.expandBoth].filter(Boolean) as { lo: number; hi: number }[];
    const keys = bands.map(b => `${b.lo},${b.hi}`);
    expect(new Set(keys).size).toBe(keys.length); // 提案帯に重複なし
  });
  it('狭帯 矩形[905,915]center → 各 non-null 提案が honored=true', () => {
    const Rb = { 2: rect('2f', 2, 900, 700), 1: rect('1f', 1, 1500, 1300) };
    const RD = { 1: fill(4, 900), 2: fill(4, 900) };
    const p = proposeClosingBands(Rb, RD, ss, M, PC, undefined, undefined, { lo: 905, hi: 915, mode: 'center' });
    expect(!!p.expandUp || !!p.expandDown || !!p.expandBoth).toBe(true);
    for (const c of [p.expandUp, p.expandDown, p.expandBoth]) {
      if (!c) continue;
      expect(isBandHonored(computeCascadeLayout(Rb, RD, ss, M, PC, undefined, undefined, { lo: c.lo, hi: c.hi, mode: 'center' }), c).honored).toBe(true);
    }
  });
  it('良帯 L字[800,950]center → 全方向 null（提案不要）', () => {
    const p = proposeL({ lo: 800, hi: 950, mode: 'center' });
    expect(p).toEqual({ expandUp: null, expandDown: null, expandBoth: null });
  });
  it('lower 帯は提案対象外（全方向 null）', () => {
    expect(proposeL({ lo: 850, hi: 870, mode: 'lower' })).toEqual({ expandUp: null, expandDown: null, expandBoth: null });
  });
});

// 誤提案ゼロ: 良帯・広帯・lower・実運用デフォルトで honored=true（=UI のダイアログ条件が発火しない）。
describe('誤提案ゼロ（良ケースで dialog 条件 !honored が成立しない）', () => {
  const Rb = { 2: rect('2f', 2, 900, 700), 1: rect('1f', 1, 1500, 1300) };
  const RD = { 1: fill(4, 900), 2: fill(4, 900) };
  const runR = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => computeCascadeLayout(Rb, RD, ss, M, PC, undefined, undefined, band);
  const cases: [string, { lo: number; hi: number; mode: 'center' | 'lower' }][] = [
    ['L字 既定[800,950]center', { lo: 800, hi: 950, mode: 'center' }],
    ['L字 広帯[800,1000]center', { lo: 800, hi: 1000, mode: 'center' }],
    ['L字 運用[700,950]center', { lo: 700, hi: 950, mode: 'center' }],
    ['L字 lower[800,950]', { lo: 800, hi: 950, mode: 'lower' }],
  ];
  for (const [tag, band] of cases) {
    it(`${tag}: honored=true（提案なし）`, () => {
      expect(isBandHonored(runL(band), band).honored).toBe(true);
    });
  }
  it('矩形 既定[800,950]center / 運用[700,950]center: honored=true', () => {
    expect(isBandHonored(runR({ lo: 800, hi: 950, mode: 'center' }), { lo: 800, hi: 950 }).honored).toBe(true);
    expect(isBandHonored(runR({ lo: 700, hi: 950, mode: 'center' }), { lo: 700, hi: 950 }).honored).toBe(true);
  });
});
