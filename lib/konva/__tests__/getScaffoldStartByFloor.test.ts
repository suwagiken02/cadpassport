import { describe, it, expect } from 'vitest';
import { getScaffoldStartByFloor } from '@/types';
import type { ScaffoldStartConfig } from '@/types';

// ============================================================
// S-5c: 合成アクセサ getScaffoldStartByFloor の {1,2} byte 不変 + N 階拡張。
//   旧実装は { 1: scaffoldStart1F, 2: scaffoldStart2F } を返すだけ。
//   新実装は scaffoldStartByFloor(新) 優先 + 2スロットフォールバック合成。
//   deprecated 全体 legacy `scaffoldStart` は畳み込まない（consumer 側が扱う）。
// ============================================================

const mk = (floor: number): ScaffoldStartConfig => ({
  corner: 'nw', startVertexIndex: floor, face1DistanceMm: 900, face2DistanceMm: 900,
  face1FirstHandrail: 1800, face2FirstHandrail: 1800, floor,
});

// 旧実装（byte 不変の基準）
const oldImpl = (d: { scaffoldStart1F?: ScaffoldStartConfig; scaffoldStart2F?: ScaffoldStartConfig }) =>
  ({ 1: d.scaffoldStart1F, 2: d.scaffoldStart2F });

describe('getScaffoldStartByFloor: {1,2} 4パタン deep equal (byFloor 未設定)', () => {
  const ss1 = mk(1), ss2 = mk(2), legacy = mk(1);

  it('1F のみ', () => {
    const d = { scaffoldStart1F: ss1 };
    expect(getScaffoldStartByFloor(d)).toEqual(oldImpl(d));
    expect(getScaffoldStartByFloor(d)).toEqual({ 1: ss1, 2: undefined });
  });
  it('2F のみ', () => {
    const d = { scaffoldStart2F: ss2 };
    expect(getScaffoldStartByFloor(d)).toEqual(oldImpl(d));
    expect(getScaffoldStartByFloor(d)).toEqual({ 1: undefined, 2: ss2 });
  });
  it('両方', () => {
    const d = { scaffoldStart1F: ss1, scaffoldStart2F: ss2 };
    expect(getScaffoldStartByFloor(d)).toEqual(oldImpl(d));
    expect(getScaffoldStartByFloor(d)).toEqual({ 1: ss1, 2: ss2 });
  });
  it('legacy のみ（scaffoldStart は畳み込まれない → {1:undef,2:undef}）', () => {
    const d = { scaffoldStart: legacy } as { scaffoldStart?: ScaffoldStartConfig };
    expect(getScaffoldStartByFloor(d)).toEqual(oldImpl({}));
    expect(getScaffoldStartByFloor(d)).toEqual({ 1: undefined, 2: undefined });
  });
});

describe('getScaffoldStartByFloor: N 階拡張', () => {
  const ss1 = mk(1), ss2 = mk(2), ss3 = mk(3);

  it('byFloor に 3F → key 1/2/3 を含む', () => {
    const d = { scaffoldStartByFloor: { 1: ss1, 2: ss2, 3: ss3 } };
    const out = getScaffoldStartByFloor(d);
    expect(Object.keys(out).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(out).toEqual({ 1: ss1, 2: ss2, 3: ss3 });
  });
  it('byFloor が floor 1/2 で 2スロットより優先（両建て前提で同値なら不変）', () => {
    const other1 = mk(1);
    const d = { scaffoldStart1F: ss1, scaffoldStartByFloor: { 1: other1 } };
    // byFloor[1] 優先
    expect(getScaffoldStartByFloor(d)[1]).toBe(other1);
    // byFloor に無い floor 2 は 2スロットにフォールバック
    const d2 = { scaffoldStart2F: ss2, scaffoldStartByFloor: { 3: ss3 } };
    expect(getScaffoldStartByFloor(d2)).toEqual({ 1: undefined, 2: ss2, 3: ss3 });
  });
});
