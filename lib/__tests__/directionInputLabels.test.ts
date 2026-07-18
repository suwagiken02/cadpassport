import { describe, it, expect } from 'vitest';
import { directionInputLabels, directionInputColors } from '../directionInputLabels';

describe('directionInputLabels (R-1e-fix8)', () => {
  it('建物: 壁系の文言', () => {
    const l = directionInputLabels(false);
    expect(l.addSegment).toBe('壁を追加');
    expect(l.confirm).toBe('作図確定');
    expect(l.segmentNoun).toBe('壁');
  });
  it('屋根: 辺・屋根系の文言', () => {
    const l = directionInputLabels(true);
    expect(l.addSegment).toBe('辺を追加');
    expect(l.confirm).toBe('屋根を確定');
    expect(l.segmentNoun).toBe('辺');
  });
});

describe('directionInputColors (R-1e-fix8)', () => {
  it('躯体は青・屋根は琥珀で一目区別できる（線色が異なる）', () => {
    expect(directionInputColors(false).line).toBe('#3B82F6');
    expect(directionInputColors(true).line).toBe('#F59E0B');
    expect(directionInputColors(false).line).not.toBe(directionInputColors(true).line);
  });
});
