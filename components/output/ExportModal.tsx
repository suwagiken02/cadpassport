'use client';

import React, { useState } from 'react';
import { PaperSize, ScaleOption } from '@/types';
import { useCanvasStore } from '@/stores/canvasStore';

type Props = {
  onClose: () => void;
  onExport: (settings: {
    format: 'pdf' | 'png' | 'dxf';
    paperSize: PaperSize;
    scale: ScaleOption;
  }) => void;
  siteName: string;
};

const PAPER_SIZES: { id: PaperSize; label: string }[] = [
  { id: 'A4_portrait', label: 'A4 縦' },
  { id: 'A4_landscape', label: 'A4 横' },
  { id: 'A3_portrait', label: 'A3 縦' },
  { id: 'A3_landscape', label: 'A3 横' },
];

const SCALES: { id: ScaleOption; label: string }[] = [
  { id: '1/50', label: '1/50' },
  { id: '1/100', label: '1/100' },
  { id: '1/200', label: '1/200' },
  { id: '1/300', label: '1/300' },
  { id: 'auto', label: '自動' },
];

export default function ExportModal({ onClose, onExport, siteName }: Props) {
  const { setPrintPaperSize, setPrintScale, showPrintArea, toggleShowPrintArea, setPrintAreaCenter, canvasSize, zoomToFitPrintArea } = useCanvasStore();
  const [step, setStep] = useState<'settings' | 'range'>('settings');
  const [format, setFormat] = useState<'pdf' | 'png' | 'dxf'>('pdf');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4_landscape');
  const [scale, setScale] = useState<ScaleOption>('1/100');

  // ステップ1 → ステップ2: 印刷枠を表示してモーダルを隠す
  const handleConfirmSettings = () => {
    if (format !== 'pdf') {
      // PNG/DXFは範囲指定不要 → そのまま出力
      onExport({ format, paperSize, scale });
      return;
    }
    // PDF: 印刷枠を表示してステップ2へ + 印刷範囲全体を画面に収める
    setPrintPaperSize(paperSize);
    setPrintScale(scale);
    if (!showPrintArea) toggleShowPrintArea();
    const vw = canvasSize.width || window.innerWidth;
    const vh = canvasSize.height || (window.innerHeight - 120);
    zoomToFitPrintArea(vw, vh);
    setStep('range');
  };

  // ステップ2: 出力実行
  const handleExport = async () => {
    try {
      // capture 時に印刷範囲全体が stage canvas 内に収まることを保証
      // (= Konva stage bitmap 制約で範囲外は透明化、 スマホで画面外グリッド消失対策)
      const vw = canvasSize.width || window.innerWidth;
      const vh = canvasSize.height || (window.innerHeight - 120);
      zoomToFitPrintArea(vw, vh);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await onExport({ format, paperSize, scale });
    } catch (e) {
      console.error('[Export] error:', e);
      alert(`出力エラー: ${e instanceof Error ? e.message : String(e)}`);
    }
    // 印刷枠を非表示
    if (useCanvasStore.getState().showPrintArea) useCanvasStore.getState().toggleShowPrintArea();
    setPrintAreaCenter(null);
  };

  // キャンセル
  const handleClose = () => {
    if (useCanvasStore.getState().showPrintArea) useCanvasStore.getState().toggleShowPrintArea();
    setPrintAreaCenter(null);
    onClose();
  };

  // ステップ2: 範囲指定中（モーダルは下部に小さく表示）
  if (step === 'range') {
    return (
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-1.5 flex items-center gap-2">
        <span className="text-xs text-canvas whitespace-nowrap">範囲をドラッグ</span>
        <button type="button" onClick={handleExport}
          className="px-3 py-1.5 bg-accent text-white font-bold rounded-lg text-xs whitespace-nowrap">
          PDF出力
        </button>
        <button type="button" onClick={() => { setStep('settings'); if (useCanvasStore.getState().showPrintArea) useCanvasStore.getState().toggleShowPrintArea(); }}
          className="px-2 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-xs text-dimension whitespace-nowrap">
          戻る
        </button>
        <button type="button" onClick={handleClose}
          className="px-1.5 py-1.5 text-dimension hover:text-canvas text-xs">
          ✕
        </button>
      </div>
    );
  }

  // ステップ1: 設定モーダル
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 modal-overlay" onClick={handleClose} />
      <div className="relative bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md">
        <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-bold text-lg">出力設定</h2>
          <button type="button" onClick={handleClose} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* 形式 */}
          <div>
            <p className="text-xs text-dimension mb-2">出力形式</p>
            <div className="flex gap-2">
              {(['pdf', 'png', 'dxf'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFormat(f)}
                  className={`flex-1 py-3 rounded-lg text-sm font-bold uppercase ${
                    format === f ? 'bg-accent text-white' : 'bg-dark-bg text-canvas border border-dark-border'
                  }`}>{f}</button>
              ))}
            </div>
          </div>

          {/* 用紙サイズ (PDF only) */}
          {format === 'pdf' && (
            <div>
              <p className="text-xs text-dimension mb-2">用紙サイズ</p>
              <div className="grid grid-cols-2 gap-2">
                {PAPER_SIZES.map((p) => (
                  <button key={p.id} type="button" onClick={() => setPaperSize(p.id)}
                    className={`py-2 rounded-lg text-sm ${
                      paperSize === p.id ? 'bg-accent text-white' : 'bg-dark-bg text-canvas border border-dark-border'
                    }`}>{p.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* 縮尺 */}
          {format !== 'png' && (
            <div>
              <p className="text-xs text-dimension mb-2">縮尺</p>
              <div className="flex gap-2 flex-wrap">
                {SCALES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setScale(s.id)}
                    className={`flex-1 min-w-[48px] py-2 rounded-lg text-sm ${
                      scale === s.id ? 'bg-accent text-white' : 'bg-dark-bg text-canvas border border-dark-border'
                    }`}>{s.label}</button>
                ))}
              </div>
            </div>
          )}

          <button type="button" onClick={handleConfirmSettings}
            className="w-full py-3 bg-accent text-white font-bold rounded-xl text-lg">
            {format === 'pdf' ? '範囲を指定する →' : '出力する'}
          </button>
        </div>
      </div>
    </div>
  );
}
