import { describe, it, expect } from 'vitest';
import { shouldAutoOpenTouchMenu } from '../touchContextMenu';

const base = { isTouch: true, mode: 'select', selectionCount: 1, viaRubberBand: false, viaTapSelect: true };

describe('shouldAutoOpenTouchMenu (E-6d)', () => {
  it('タッチ・select・選択あり・タップ選択 → 表示', () => {
    expect(shouldAutoOpenTouchMenu(base)).toBe(true);
  });
  it('範囲選択でも表示', () => {
    expect(shouldAutoOpenTouchMenu({ ...base, viaRubberBand: true, viaTapSelect: false })).toBe(true);
  });
  it('マウス操作(PC)は表示しない', () => {
    expect(shouldAutoOpenTouchMenu({ ...base, isTouch: false })).toBe(false);
  });
  it('選択が空なら表示しない', () => {
    expect(shouldAutoOpenTouchMenu({ ...base, selectionCount: 0 })).toBe(false);
  });
  it('select 以外のモードは表示しない', () => {
    expect(shouldAutoOpenTouchMenu({ ...base, mode: 'building' })).toBe(false);
  });
  it('選択確定でない(範囲もタップもなし)なら表示しない', () => {
    expect(shouldAutoOpenTouchMenu({ ...base, viaRubberBand: false, viaTapSelect: false })).toBe(false);
  });
});
