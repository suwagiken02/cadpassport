import { describe, it, expect } from 'vitest';
import { normalizeCompassAngle } from '../compassUtils';

describe('normalizeCompassAngle', () => {
  it('returns 0 for undefined (= 既存データ互換)', () => {
    expect(normalizeCompassAngle(undefined)).toBe(0);
  });

  it('returns 0 for null (= 既存データ互換)', () => {
    expect(normalizeCompassAngle(null)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(normalizeCompassAngle(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(normalizeCompassAngle(Infinity)).toBe(0);
    expect(normalizeCompassAngle(-Infinity)).toBe(0);
  });

  it('returns angle as-is for 0-359', () => {
    expect(normalizeCompassAngle(0)).toBe(0);
    expect(normalizeCompassAngle(45)).toBe(45);
    expect(normalizeCompassAngle(180)).toBe(180);
    expect(normalizeCompassAngle(359)).toBe(359);
  });

  it('wraps 360 to 0', () => {
    expect(normalizeCompassAngle(360)).toBe(0);
  });

  it('wraps over-range angles (= 仕様: 370 → 10)', () => {
    expect(normalizeCompassAngle(370)).toBe(10);
    expect(normalizeCompassAngle(720)).toBe(0);
    expect(normalizeCompassAngle(725)).toBe(5);
    expect(normalizeCompassAngle(1080)).toBe(0);
  });

  it('wraps negative angles (= 仕様: -10 → 350)', () => {
    expect(normalizeCompassAngle(-10)).toBe(350);
    expect(normalizeCompassAngle(-1)).toBe(359);
    expect(normalizeCompassAngle(-360)).toBe(0);
    expect(normalizeCompassAngle(-370)).toBe(350);
  });

  it('handles fractional angles', () => {
    expect(normalizeCompassAngle(45.5)).toBeCloseTo(45.5);
    expect(normalizeCompassAngle(-0.5)).toBeCloseTo(359.5);
  });
});
