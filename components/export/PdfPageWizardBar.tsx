'use client';

// ============================================================
// 全ページ PDF の枠指定ウィザード (E-7-fix3)。
//
// 1ページずつ実際にそのページへ切り替えて「このページの枠位置」を指定してもらう:
//   ページへ切替 → 枠をドラッグ → [このページを決定] → 次ページ …→ 最後で出力実行。
// 状態は store(pdfWizard) に置く。ExportModal のローカル state ではページ遷移で消えるため。
// ページ遷移はタブ切替と同じ安全経路（saveCurrentPageIfDirty → router.push）を通し、
// E-7-fix2 の loadedDrawingId ガードと整合させる。
// ============================================================
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCurrentPageIfDirty } from '@/lib/pages/pageSave';
import {
  advanceWizard, centerForPage, currentWizardPage, isLastWizardStep, wizardStepLabel,
} from '@/lib/export/pdfWizard';

export default function PdfPageWizardBar() {
  const router = useRouter();
  const wizard = useCanvasStore((s) => s.pdfWizard);
  const drawingId = useCanvasStore((s) => s.drawingId);
  const loadedDrawingId = useCanvasStore((s) => s.loadedDrawingId);
  const busyRef = useRef(false);

  const page = wizard ? currentWizardPage(wizard) : null;
  const onTargetPage = !!page && drawingId === page.id && loadedDrawingId === page.id;

  // 対象ページに着いたら、枠の表示とそのページの既定中心（前回指定があれば復元）を整える。
  useEffect(() => {
    if (!wizard || wizard.exporting || !page || !onTargetPage) return;
    const s = useCanvasStore.getState();
    if (!s.showPrintArea) s.toggleShowPrintArea();
    s.setPrintPaperSize(wizard.settings.paperSize);
    s.setPrintScale(wizard.settings.scale);
    s.setPrintAreaCenter(centerForPage(wizard.centers, page.id));
    const vw = s.canvasSize.width || window.innerWidth;
    const vh = s.canvasSize.height || (window.innerHeight - 120);
    if (vw > 0 && vh > 0) s.zoomToFitPrintArea(vw, vh);
  }, [wizard?.index, wizard?.exporting, page?.id, onTargetPage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wizard) return null;

  /** 枠状態を片付けて元のページへ戻る。 */
  const cleanupAndReturn = async (returnTo: string | null) => {
    const s = useCanvasStore.getState();
    s.setPdfWizard(null); // 先に落とす（resetForDrawingChange が枠を維持しないように）
    if (s.showPrintArea) s.toggleShowPrintArea();
    s.setPrintAreaCenter(null);
    if (returnTo && returnTo !== useCanvasStore.getState().drawingId) {
      await saveCurrentPageIfDirty();
      router.push(`/editor/${returnTo}`);
    }
  };

  const handleCancel = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await cleanupAndReturn(wizard.returnDrawingId);
    } finally {
      busyRef.current = false;
    }
  };

  const runExport = async (centers: Record<string, { x: number; y: number }>) => {
    const s = useCanvasStore.getState();
    s.updatePdfWizard({ exporting: true, progress: null });
    try {
      const { exportAllPagesToPdf } = await import('@/lib/export/multiPageExport');
      const count = await exportAllPagesToPdf({
        projectId: s.projectId!,
        settings: { format: 'pdf', ...wizard.settings },
        centers,
        onProgress: (p) => useCanvasStore.getState().updatePdfWizard({ progress: p }),
      });
      await cleanupAndReturn(wizard.returnDrawingId);
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const deviceMsg = /iPhone|iPad|iPod/.test(ua)
        ? '『ファイル』 アプリの「ダウンロード」 で確認できます。'
        : /Android/i.test(ua)
        ? 'ダウンロードフォルダ または Files アプリで確認できます。'
        : 'ダウンロードフォルダに保存されました。';
      useCanvasStore.getState().setAlertMessage(`PDFを保存しました（全${count}ページ）\n\n${deviceMsg}`);
    } catch (e) {
      console.error('[PdfWizard] export error:', e);
      await cleanupAndReturn(wizard.returnDrawingId);
      useCanvasStore.getState().setAlertMessage(
        `出力に失敗しました\n\n${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const handleDecide = async () => {
    if (busyRef.current || !page) return;
    busyRef.current = true;
    try {
      const center = useCanvasStore.getState().printAreaCenter;
      const next = advanceWizard(wizard, center);
      if (isLastWizardStep(wizard)) {
        useCanvasStore.getState().updatePdfWizard({ centers: next.centers });
        await runExport(next.centers);
        return;
      }
      useCanvasStore.getState().setPdfWizard(next);
      const nextPage = currentWizardPage(next);
      if (nextPage && nextPage.id !== useCanvasStore.getState().drawingId) {
        const saved = await saveCurrentPageIfDirty();
        if (!saved.ok) {
          alert(`ページを保存できませんでした。出力を中止します。\n${saved.message}`);
          await cleanupAndReturn(wizard.returnDrawingId);
          return;
        }
        router.push(`/editor/${nextPage.id}`);
      }
    } finally {
      busyRef.current = false;
    }
  };

  // ── 出力中: 進捗オーバーレイ ──
  if (wizard.exporting) {
    const p = wizard.progress;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        <div className="bg-dark-surface border border-dark-border rounded-2xl px-6 py-5 text-center shadow-2xl">
          <p className="text-canvas font-bold mb-1">
            出力中…{p ? ` (${p.current}/${p.total})` : ''}
          </p>
          <p className="text-xs text-dimension">{p?.title ?? '準備中'}</p>
          <div className="mt-3 h-1.5 w-56 bg-dark-bg rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all"
              style={{ width: `${p ? Math.round((p.current / Math.max(1, p.total)) * 100) : 0}%` }} />
          </div>
        </div>
      </div>
    );
  }

  // ── 枠指定中: 下部バー ──
  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2 max-w-[94vw]">
      <div className="min-w-0">
        <p className="text-[11px] text-dimension leading-tight truncate">
          <span className="text-accent font-bold">{wizardStepLabel(wizard)}</span>{' '}
          {page?.title ?? ''}
        </p>
        <p className="text-xs text-canvas font-bold whitespace-nowrap">
          {onTargetPage ? 'このページの枠位置を指定してください' : 'ページを読み込み中…'}
        </p>
      </div>
      <button type="button" onClick={handleDecide} disabled={!onTargetPage}
        className="px-3 py-2 bg-accent text-white font-bold rounded-lg text-xs whitespace-nowrap disabled:opacity-50">
        {isLastWizardStep(wizard) ? 'このページを決定して出力' : 'このページを決定'}
      </button>
      <button type="button" onClick={handleCancel}
        className="px-2 py-2 bg-dark-bg border border-dark-border rounded-lg text-xs text-dimension whitespace-nowrap">
        キャンセル
      </button>
    </div>
  );
}
