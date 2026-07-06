import { describe, it, expect } from 'vitest';
import { computeCascadeLayout, normalizeBuildingsByFloor } from '../autolayout/cascade';
import { isBandHonored, proposeClosingBand } from '../autolayout/loopFit';
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
const proposeL = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => proposeClosingBand(Lbld, LD, ss, M, PC, undefined, undefined, band);

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

describe('proposeClosingBand（閉じる帯の提案）', () => {
  it('狭帯 L字[850,870]center → 提案帯が返り、その帯は honored=true', () => {
    const band = { lo: 850, hi: 870, mode: 'center' as const };
    const prop = proposeL(band);
    expect(prop).not.toBeNull();
    // 提案帯は元帯を含む拡張で幅 >= 元幅
    expect(prop!.hi - prop!.lo).toBeGreaterThanOrEqual(870 - 850);
    // 提案帯で再計算すると帯履行できる
    const re = runL({ lo: prop!.lo, hi: prop!.hi, mode: 'center' });
    expect(isBandHonored(re, prop!).honored).toBe(true);
  });
  it('狭帯 矩形[905,915]center → 提案帯が honored=true', () => {
    const Rb = { 2: rect('2f', 2, 900, 700), 1: rect('1f', 1, 1500, 1300) };
    const RD = { 1: fill(4, 900), 2: fill(4, 900) };
    const band = { lo: 905, hi: 915, mode: 'center' as const };
    const prop = proposeClosingBand(Rb, RD, ss, M, PC, undefined, undefined, band);
    expect(prop).not.toBeNull();
    const re = computeCascadeLayout(Rb, RD, ss, M, PC, undefined, undefined, { lo: prop!.lo, hi: prop!.hi, mode: 'center' });
    expect(isBandHonored(re, prop!).honored).toBe(true);
  });
  it('良帯 L字[800,950]center → 提案不要（null）', () => {
    expect(proposeL({ lo: 800, hi: 950, mode: 'center' })).toBeNull();
  });
  it('lower 帯は提案対象外（null）', () => {
    expect(proposeL({ lo: 850, hi: 870, mode: 'lower' })).toBeNull();
  });
});
