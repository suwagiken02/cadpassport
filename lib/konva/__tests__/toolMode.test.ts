import { describe, it, expect } from 'vitest';
import { isPlainSelectMode, isToolActive, type CanvasToolFlags } from '../toolMode';

// ============================================================
// R-1h-fix: 高さ等のツールは mode を変えず副次フラグだけで動くため、
// `mode === 'select'` 単独では「ツール中なのに選択モード扱い」になり、
// 常時リスナー（屋根の出幅点線など）がツールのクリックを先取りしていた。
// ============================================================
const base: CanvasToolFlags = { mode: 'select' };
const f = (o: Partial<CanvasToolFlags>): CanvasToolFlags => ({ ...base, ...o });

describe('isToolActive: クリックを占有するツール', () => {
  it('フラグが全部 OFF なら false', () => {
    expect(isToolActive(base)).toBe(false);
  });

  it('各ツールフラグ単体で true', () => {
    expect(isToolActive(f({ isHeightMarkerMode: true }))).toBe(true);
    expect(isToolActive(f({ isRidgeLineMode: true }))).toBe(true);
    expect(isToolActive(f({ isMeasuring: true }))).toBe(true);
    expect(isToolActive(f({ isMagnetPinMode: true }))).toBe(true);
    expect(isToolActive(f({ isAreaDesignationMode: true }))).toBe(true);
    expect(isToolActive(f({ isReorderMode: true }))).toBe(true);
    expect(isToolActive(f({ moveSelectActive: true }))).toBe(true);
  });

  it('屋根領域の描き入力中(pendingTargetType=roof)も true。building/obstacle は false', () => {
    expect(isToolActive(f({ pendingTargetType: 'roof' }))).toBe(true);
    expect(isToolActive(f({ pendingTargetType: 'building' }))).toBe(false);
    expect(isToolActive(f({ pendingTargetType: 'obstacle' }))).toBe(false);
  });

  it('mode は見ない（副次フラグ専用の判定）', () => {
    expect(isToolActive({ mode: 'erase' })).toBe(false);
    expect(isToolActive({ mode: 'view' })).toBe(false);
  });
});

describe('isPlainSelectMode: 常時リスナーを有効にしてよい状態', () => {
  it('選択モードでツールが動いていなければ true', () => {
    expect(isPlainSelectMode(base)).toBe(true);
  });

  it('高さツール中は false ← 実機症状（mode は select のままフラグだけが立つ）', () => {
    expect(isPlainSelectMode(f({ isHeightMarkerMode: true }))).toBe(false);
  });

  it('棟・計測・ピン・面積指定・並べ替え・一括移動・屋根描き中も false', () => {
    expect(isPlainSelectMode(f({ isRidgeLineMode: true }))).toBe(false);
    expect(isPlainSelectMode(f({ isMeasuring: true }))).toBe(false);
    expect(isPlainSelectMode(f({ isMagnetPinMode: true }))).toBe(false);
    expect(isPlainSelectMode(f({ isAreaDesignationMode: true }))).toBe(false);
    expect(isPlainSelectMode(f({ isReorderMode: true }))).toBe(false);
    expect(isPlainSelectMode(f({ moveSelectActive: true }))).toBe(false);
    expect(isPlainSelectMode(f({ pendingTargetType: 'roof' }))).toBe(false);
  });

  it('select 以外の mode は false（erase/roof/building/view など）', () => {
    for (const mode of ['erase', 'roof', 'building', 'view', 'move-select'] as const) {
      expect(isPlainSelectMode({ mode })).toBe(false);
    }
  });
});
