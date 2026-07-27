import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '../canvasStore';

// ============================================================
// E-7-fix: 印刷枠(赤破線)の残留。store は SPA セッション中ずっと生きているため、
// PDF の範囲指定中にホームへ戻ると showPrintArea が true のまま残り、別の現場を開いても
// 新規作成した現場にも赤枠が出続けていた。現場・ページ切替のリセットで必ず落とす。
// ============================================================
describe('resetForDrawingChange: 印刷枠の状態', () => {
  beforeEach(() => {
    if (useCanvasStore.getState().showPrintArea) useCanvasStore.getState().toggleShowPrintArea();
    useCanvasStore.getState().setPrintAreaCenter(null);
  });

  it('表示中の印刷枠を消す', () => {
    useCanvasStore.getState().toggleShowPrintArea();
    useCanvasStore.getState().setPrintAreaCenter({ x: 100, y: 200 });
    expect(useCanvasStore.getState().showPrintArea).toBe(true);

    useCanvasStore.getState().resetForDrawingChange();

    expect(useCanvasStore.getState().showPrintArea).toBe(false);
    expect(useCanvasStore.getState().printAreaCenter).toBeNull();
  });

  it('既に非表示なら非表示のまま（トグルで反転させない）', () => {
    useCanvasStore.getState().resetForDrawingChange();
    expect(useCanvasStore.getState().showPrintArea).toBe(false);
  });

  it('用紙サイズ・縮尺の設定値は保持する（次回出力の既定として残す）', () => {
    useCanvasStore.getState().setPrintPaperSize('A3_portrait');
    useCanvasStore.getState().setPrintScale('1/50');
    useCanvasStore.getState().resetForDrawingChange();
    expect(useCanvasStore.getState().printPaperSize).toBe('A3_portrait');
    expect(useCanvasStore.getState().printScale).toBe('1/50');
  });
});
