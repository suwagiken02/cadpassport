'use client';

// ============================================================
// 全ページ PDF 出力 (E-7-2・副作用あり・ブラウザ専用)。
//
// 方式（調査の案A'）: 表示中の Konva ステージはそのままに、store の canvasData だけを
// ページごとに差し替えてキャプチャする。ルーティング(router.push)を伴うページ切替は
// 出力中に URL が変わり失敗時の復帰が難しいため使わない。レンダラは実機と同一なので
// 見た目の差異が出ない（オフスクリーン再実装も不要）。
//
// 不変条件: 元の canvasData / isDirty / 選択状態 / ビュー(zoom,pan) を finally で必ず戻す。
//   setCanvasData は normalize 込みで isDirty=false にするため、未保存の変更があっても
//   失われないよう保存しておいた値で明示的に復元する。
// ============================================================
import { PDFDocument } from 'pdf-lib';
import { supabase } from '@/lib/supabase/client';
import { useCanvasStore } from '@/stores/canvasStore';
import { sortPages, type PageMeta } from '@/lib/pages/pageOps';
import { downloadPdf, pdfFileName, renderPdfPage } from './pdfExport';
import { nextPaint, withFittedPrintView } from './exportViewport';
import type { CanvasData, ExportSettings } from '@/types';

/** 進捗通知（「出力中… (2/5)」の表示用）。 */
export type ExportProgress = { current: number; total: number; title: string };

type PageRow = PageMeta & { canvas_data: unknown };

/** 物件の全ページを表示順（created_at 昇順）で取得する。 */
export async function fetchProjectPages(projectId: string): Promise<PageRow[]> {
  const { data, error } = await supabase
    .from('drawings')
    .select('id, title, created_at, canvas_data')
    .eq('project_id', projectId);
  if (error || !data) return [];
  return sortPages(data as PageRow[]);
}

/**
 * 物件の全ページを 1 つの PDF にまとめて出力する。
 * ・ページ順は表示順（タブと同じ created_at 昇順）。
 * ・表示中のページは store の canvasData（未保存の編集込み）をそのまま使う＝画面と一致する。
 * ・他ページは DB の canvas_data を一時的に流し込んでキャプチャする。
 * ・印刷中心は表示中ページのみ現在の指定を使い、他ページは建物の中心（renderPdfPage の既定）。
 * 戻り値は出力したページ数（0 = 出力対象なし）。
 */
export async function exportAllPagesToPdf(opts: {
  projectId: string;
  settings: ExportSettings;
  onProgress?: (p: ExportProgress) => void;
}): Promise<number> {
  const { projectId, settings, onProgress } = opts;
  const pages = await fetchProjectPages(projectId);
  if (pages.length === 0) return 0;

  const s0 = useCanvasStore.getState();
  const savedCanvasData = s0.canvasData;
  const savedDirty = s0.isDirty;
  const savedSelectedIds = s0.selectedIds;
  const currentDrawingId = s0.drawingId;

  const pdfDoc = await PDFDocument.create();
  try {
    // 差し替え中に存在しない id を選択したままにしない（描画の乱れ防止）。
    if (savedSelectedIds.length > 0) useCanvasStore.setState({ selectedIds: [] });

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      onProgress?.({ current: i + 1, total: pages.length, title: p.title });

      const isCurrent = p.id === currentDrawingId;
      if (isCurrent) {
        // 表示中ページ: 画面に出ているものをそのまま出す（未保存の編集を落とさない）。
        useCanvasStore.setState({ canvasData: savedCanvasData });
      } else {
        useCanvasStore.getState().setCanvasData(p.canvas_data as CanvasData);
      }
      await nextPaint();

      const cv = useCanvasStore.getState().canvasData;
      const center = isCurrent ? useCanvasStore.getState().printAreaCenter : null;
      await withFittedPrintView(cv, settings.paperSize, settings.scale, center, (view) =>
        renderPdfPage(pdfDoc, {
          canvasData: cv,
          settings,
          printAreaCenter: center,
          zoom: view.zoom,
          panX: view.panX,
          panY: view.panY,
          pageLabel: p.title,
        }),
      );
    }
  } finally {
    // 元のページ・状態へ復元（isDirty は setCanvasData に潰されるので明示的に戻す）。
    useCanvasStore.setState({
      canvasData: savedCanvasData,
      isDirty: savedDirty,
      selectedIds: savedSelectedIds,
    });
    await nextPaint();
  }

  await downloadPdf(pdfDoc, pdfFileName(settings.siteName, true));
  return pages.length;
}
