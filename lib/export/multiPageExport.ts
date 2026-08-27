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
import { withAidsHidden } from './aidVisibility';
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
  /** E-7-fix3: pageId → 枠中心（ウィザードで指定したページのみ）。未指定ページは建物 bbox 中心。 */
  centers?: Record<string, { x: number; y: number }>;
  onProgress?: (p: ExportProgress) => void;
}): Promise<number> {
  const { projectId, settings, centers, onProgress } = opts;
  const pages = await fetchProjectPages(projectId);
  if (pages.length === 0) return 0;

  const s0 = useCanvasStore.getState();
  const savedCanvasData = s0.canvasData;
  const savedDirty = s0.isDirty;
  const savedSelectedIds = s0.selectedIds;
  const currentDrawingId = s0.drawingId;
  // E-7-fix2: 差し替え中は「メモリ上のデータは表示中ページのものではない」状態になるため、
  //   所属図面 id を退避して finally で戻す（出力中に保存が走っても取り違えない）。
  const savedLoadedId = s0.loadedDrawingId;

  const pdfDoc = await PDFDocument.create();
  // E-8-v5c: 補助線を含めないときは、全ページのキャプチャの間ずっと隠しておく
  //   （ページを差し替えながら描くので、1 枚ごとに出し入れしない）。
  //   例外が出ても withAidsHidden の finally で必ず戻る。
  return withAidsHidden(settings.includeAids, async () => {
  try {
    // 差し替え中に存在しない id を選択したままにしない（描画の乱れ防止）。
    if (savedSelectedIds.length > 0) useCanvasStore.setState({ selectedIds: [] });

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      onProgress?.({ current: i + 1, total: pages.length, title: p.title });

      const isCurrent = p.id === currentDrawingId;
      if (isCurrent) {
        // 表示中ページ: 画面に出ているものをそのまま出す（未保存の編集を落とさない）。
        useCanvasStore.setState({ canvasData: savedCanvasData, loadedDrawingId: savedLoadedId });
      } else {
        useCanvasStore.getState().setCanvasData(p.canvas_data as CanvasData);
      }
      await nextPaint();

      const cv = useCanvasStore.getState().canvasData;
      // 枠中心の優先順: ウィザードでこのページに指定された中心 → 表示中ページの現在の指定 → null(bbox 中心)。
      const center = centers?.[p.id] ?? (isCurrent ? useCanvasStore.getState().printAreaCenter : null);
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
      loadedDrawingId: savedLoadedId,
    });
    await nextPaint();
  }

    await downloadPdf(pdfDoc, pdfFileName(settings.siteName, true));
    return pages.length;
  });
}
