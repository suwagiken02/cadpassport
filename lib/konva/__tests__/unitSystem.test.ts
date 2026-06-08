import { describe, it, expect } from 'vitest';
import {
  ALL_HANDRAIL_SIZES,
  INCH_ALL_HANDRAIL_SIZES,
  INCH_DEFAULT_ENABLED_SIZES,
  INCH_DEFAULT_PRIORITY_CONFIG,
} from '@/types';
import { HANDRAIL_COLORS, getHandrailColor, getHandrailLegend } from '@/lib/konva/handrailColors';

describe('CAD パスポート: メートル/インチ規格', () => {
  it('インチ全サイズは 8 種・降順', () => {
    expect(INCH_ALL_HANDRAIL_SIZES).toEqual([1829, 1524, 1219, 914, 610, 410, 305, 200]);
  });

  it('インチ既定 ON は全 8 種', () => {
    expect([...INCH_DEFAULT_ENABLED_SIZES].sort((a, b) => b - a)).toEqual(INCH_ALL_HANDRAIL_SIZES);
  });

  it('メートル・インチ全サイズに色が定義されている', () => {
    for (const s of [...ALL_HANDRAIL_SIZES, ...INCH_ALL_HANDRAIL_SIZES]) {
      expect(typeof HANDRAIL_COLORS[s]).toBe('string');
      expect(getHandrailColor(s)).toMatch(/^#/);
    }
  });

  it('インチ長さはメートル兄弟と同色', () => {
    expect(HANDRAIL_COLORS[1829]).toBe(HANDRAIL_COLORS[1800]);
    expect(HANDRAIL_COLORS[1524]).toBe(HANDRAIL_COLORS[1500]);
    expect(HANDRAIL_COLORS[1219]).toBe(HANDRAIL_COLORS[1200]);
    expect(HANDRAIL_COLORS[914]).toBe(HANDRAIL_COLORS[900]);
    expect(HANDRAIL_COLORS[610]).toBe(HANDRAIL_COLORS[600]);
    expect(HANDRAIL_COLORS[410]).toBe(HANDRAIL_COLORS[400]);
    expect(HANDRAIL_COLORS[305]).toBe(HANDRAIL_COLORS[300]);
  });

  it('インチ優先設定は全 8 種を網羅し、有効カウントが 8 以内', () => {
    expect([...INCH_DEFAULT_PRIORITY_CONFIG.order].sort((a, b) => b - a)).toEqual(INCH_ALL_HANDRAIL_SIZES);
    const total =
      INCH_DEFAULT_PRIORITY_CONFIG.mainCount +
      INCH_DEFAULT_PRIORITY_CONFIG.subCount +
      INCH_DEFAULT_PRIORITY_CONFIG.adjustCount;
    expect(total).toBeLessThanOrEqual(8);
  });

  it('規格別 legend を引ける（インチは 8 件・降順）', () => {
    const metric = getHandrailLegend('metric');
    const inch = getHandrailLegend('inch');
    expect(metric.length).toBe(ALL_HANDRAIL_SIZES.length);
    expect(inch.map((e) => e.lengthMm)).toEqual(INCH_ALL_HANDRAIL_SIZES);
  });
});
