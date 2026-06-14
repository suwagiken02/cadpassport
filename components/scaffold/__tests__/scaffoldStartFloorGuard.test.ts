import { describe, it, expect } from 'vitest';
import { isScaffoldFloorBlocked } from '../scaffoldStartGuard';

// ============================================================
// ⭐起点の入口ガード: 1F+2F同時割付(bothmode)では足場開始を2Fに置く必要があるため、
// bothmode 経由で開いた ScaffoldStartModal(lockFloor=2)では 1F 設置を弾く。
// 1Fのみ/2Fのみ(lockFloor 未指定)は両階とも許可する。
// ============================================================

describe('isScaffoldFloorBlocked — ⭐起点階の入口ガード', () => {
  it('lockFloor=2 (bothmode): 1F設置は弾かれ、2Fは許可', () => {
    expect(isScaffoldFloorBlocked(2, 1)).toBe(true);   // 1F は不可
    expect(isScaffoldFloorBlocked(2, 2)).toBe(false);  // 2F は可
  });

  it('lockFloor=1: 2F設置は弾かれ、1Fは許可', () => {
    expect(isScaffoldFloorBlocked(1, 2)).toBe(true);
    expect(isScaffoldFloorBlocked(1, 1)).toBe(false);
  });

  it('lockFloor 未指定(通常起動=1Fのみ/2Fのみ): 両階とも許可', () => {
    expect(isScaffoldFloorBlocked(undefined, 1)).toBe(false);
    expect(isScaffoldFloorBlocked(undefined, 2)).toBe(false);
  });
});
