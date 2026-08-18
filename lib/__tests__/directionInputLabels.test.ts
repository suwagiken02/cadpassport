import { describe, it, expect } from 'vitest';
import { directionInputLabels, directionInputColors } from '../directionInputLabels';

// S-1: 引数を boolean（屋根か）から対象そのものへ変えた。
//   assert の中身は 1 文字も変えていない（= 建物・屋根の出力が不変であることの記録）。

describe('directionInputLabels (R-1e-fix8)', () => {
  it('建物: 壁系の文言', () => {
    const l = directionInputLabels('building');
    expect(l.addSegment).toBe('壁を追加');
    expect(l.confirm).toBe('作図確定');
    expect(l.segmentNoun).toBe('壁');
  });
  it('屋根: 辺・屋根系の文言', () => {
    const l = directionInputLabels('roof');
    expect(l.addSegment).toBe('辺を追加');
    expect(l.confirm).toBe('屋根を確定');
    expect(l.segmentNoun).toBe('辺');
  });
});

describe('directionInputColors (R-1e-fix8)', () => {
  it('躯体は青・屋根は琥珀で一目区別できる（線色が異なる）', () => {
    expect(directionInputColors('building').line).toBe('#3B82F6');
    expect(directionInputColors('roof').line).toBe('#F59E0B');
    expect(directionInputColors('building').line).not.toBe(directionInputColors('roof').line);
  });
});

// ============================================================
// S-1: 敷地境界線を足しても、建物・屋根・障害物の出し分けが 1 文字も変わらないこと。
// ここが崩れると、既存の躯体入力・屋根入力の見え方が変わる。
// ============================================================
describe('既存の対象の出力が不変（S-1）', () => {
  it('建物の文言（全項目）', () => {
    expect(directionInputLabels('building')).toEqual({
      addSegment: '壁を追加', confirm: '作図確定', segmentNoun: '壁',
      moveOnly: '壁を作らずキャラのみ移動',
    });
  });

  it('屋根の文言（全項目）', () => {
    expect(directionInputLabels('roof')).toEqual({
      addSegment: '辺を追加', confirm: '屋根を確定', segmentNoun: '辺',
      moveOnly: '辺を作らずキャラのみ移動',
    });
  });

  it('障害物は建物と同じ扱い（従来の boolean=false と同じ枝）', () => {
    expect(directionInputLabels('obstacle')).toEqual(directionInputLabels('building'));
    expect(directionInputColors('obstacle')).toEqual(directionInputColors('building'));
  });

  it('建物の色（全項目）', () => {
    expect(directionInputColors('building')).toEqual({
      line: '#3B82F6', vertex: '#3B82F6', start: '#EF4444', count: '#378ADD',
    });
  });

  it('屋根の色（全項目）', () => {
    expect(directionInputColors('roof')).toEqual({
      line: '#F59E0B', vertex: '#F59E0B', start: '#B45309', count: '#F59E0B',
    });
  });
});

describe('敷地の文言と色（S-1）', () => {
  it('「境界」表記になる', () => {
    expect(directionInputLabels('site')).toEqual({
      addSegment: '境界を追加', confirm: '敷地を確定', segmentNoun: '境界',
      moveOnly: '境界を作らずキャラのみ移動',
    });
  });

  it('描いている最中の色が、建物とも屋根とも違う', () => {
    const site = directionInputColors('site');
    expect(site.line).not.toBe(directionInputColors('building').line);
    expect(site.line).not.toBe(directionInputColors('roof').line);
  });

  it('起点の赤は建物と同じ（どこから描き始めたかの意味は同じ）', () => {
    expect(directionInputColors('site').start).toBe(directionInputColors('building').start);
  });

  it('どの対象でも文言が全部埋まっている（空文字を作らない）', () => {
    for (const t of ['building', 'obstacle', 'roof', 'site'] as const) {
      for (const v of Object.values(directionInputLabels(t))) {
        expect(v.length, t).toBeGreaterThan(0);
      }
      for (const v of Object.values(directionInputColors(t))) {
        expect(v, t).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
