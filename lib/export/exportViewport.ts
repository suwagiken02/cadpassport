'use client';

// ============================================================
// PDF 出力時のビュー操作 (E-7-1・副作用あり・ブラウザ専用)。
//
// キャプチャは表示中の Konva ステージから切り出すため、印刷枠がビューポートに収まるよう
// 一時的に zoom/pan を寄せてから撮り、必ず元へ戻す（finally）。多ページ出力(E-7-2)でも
// ページごとに同じ処理を通す。計算そのものは viewFit.ts（pure）。
// ============================================================
import { useCanvasStore } from '@/stores/canvasStore';
import { getPrintAreaGrid } from './pdfExport';
import { fitViewToPrintArea, resolvePrintAreaCenter, type ViewTransform } from './viewFit';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { CanvasData } from '@/types';

/** 次の描画フレームまで待つ（React 再レンダ → Konva 再描画の完了待ち）。 */
export function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * 印刷枠がビューポートに収まる位置へビューを寄せて fn を実行し、必ず元のビューへ戻す。
 * fn には実際に適用された zoom/pan を渡す（キャプチャ矩形の計算に使う）。
 * ビューポート未計測などで寄せられない場合は現在のビューのまま実行する（従来挙動）。
 */
export async function withFittedPrintView<T>(
  canvasData: CanvasData,
  paperSize: string,
  scale: string,
  printAreaCenter: { x: number; y: number } | null,
  fn: (view: ViewTransform) => Promise<T>,
): Promise<T> {
  const s = useCanvasStore.getState();
  const before: ViewTransform = { zoom: s.zoom, panX: s.panX, panY: s.panY };
  // E-7-fix5: 描く側・切り取る側と同じ 1 本を通す（別々の既定値を持たない）。
  const center = resolvePrintAreaCenter(
    printAreaCenter, canvasData.buildings, s.canvasSize, before, INITIAL_GRID_PX,
  );
  const fit = fitViewToPrintArea(
    getPrintAreaGrid(paperSize, scale),
    center,
    s.canvasSize,
    before,
  );

  const changed = fit.zoom !== before.zoom || fit.panX !== before.panX || fit.panY !== before.panY;
  try {
    if (changed) {
      useCanvasStore.getState().setZoom(fit.zoom);
      useCanvasStore.getState().setPan(fit.panX, fit.panY);
      await nextPaint();
    }
    const applied = useCanvasStore.getState();
    return await fn({ zoom: applied.zoom, panX: applied.panX, panY: applied.panY });
  } finally {
    if (changed) {
      useCanvasStore.getState().setZoom(before.zoom);
      useCanvasStore.getState().setPan(before.panX, before.panY);
    }
  }
}
