import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../canvasStore';

// ============================================================
// R-1k: モード抜けの取りこぼし。屋根描き(pendingTargetType='roof')を他ボタンで中断すると
// 'roof' が残り、以後の選択モードで屋根点線が触れない/非 active 階が減光したままになっていた。
// setMode で建物モードを離れるときに既定へ戻す。
// ============================================================
describe('setMode: 建物モードを離れるとき pendingTargetType を既定に戻す', () => {
  beforeEach(() => {
    useCanvasStore.getState().setPendingTargetType('building');
    useCanvasStore.getState().setMode('select');
  });

  it('屋根描き中に選択モードへ抜けるとリセットされる', () => {
    useCanvasStore.getState().setPendingTargetType('roof');
    useCanvasStore.getState().setMode('building'); // 屋根描き起動と同じ順序
    expect(useCanvasStore.getState().pendingTargetType).toBe('roof');

    useCanvasStore.getState().setMode('select'); // 別ボタンで中断
    expect(useCanvasStore.getState().pendingTargetType).toBe('building');
  });

  it('建物モードへ入るときは維持する（起動順序を壊さない）', () => {
    useCanvasStore.getState().setPendingTargetType('roof');
    useCanvasStore.getState().setMode('building');
    expect(useCanvasStore.getState().pendingTargetType).toBe('roof');
  });

  it('障害物の方向入力も建物モードを離れればリセットされる', () => {
    useCanvasStore.getState().setPendingTargetType('obstacle');
    useCanvasStore.getState().setMode('building');
    expect(useCanvasStore.getState().pendingTargetType).toBe('obstacle');
    useCanvasStore.getState().setMode('view');
    expect(useCanvasStore.getState().pendingTargetType).toBe('building');
  });

  it('selectedIds のクリアという従来の副作用は維持', () => {
    useCanvasStore.getState().setSelectedIds(['x']);
    useCanvasStore.getState().setMode('erase');
    expect(useCanvasStore.getState().selectedIds).toEqual([]);
  });
});
