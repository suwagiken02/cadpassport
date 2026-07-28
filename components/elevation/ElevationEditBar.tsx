'use client';

// ============================================================
// 立面編集モードのバー (E-8b)。
// 配置済み立面をダブルタップで入り、部材(プリミティブ)を選んで 削除／移動 する。
// 編集は ElevationView.edits に差分として積むだけなので、元の primitives は保護され、
// undo/redo は canvasData の履歴にそのまま乗る（差分配列ごと巻き戻る）。
// ============================================================
import React, { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { hasEditFor, withHide, withoutEditsFor } from '@/lib/konva/elevation/elevationEdits';
import type { ElevationPrimitiveKind } from '@/types';

const KIND_LABEL: Record<ElevationPrimitiveKind, string> = {
  building: '建物外形', roof: '屋根', ridge: '棟', gl: 'GL',
  board: '作業床', rail: '手摺', post: '支柱', jack: 'ジャッキ', raise: '嵩上げ床',
  dim: '寸法線', dimText: '寸法値', text: '文字',
};

export default function ElevationEditBar() {
  const viewId = useCanvasStore((s) => s.elevationEditViewId);
  const selectedId = useCanvasStore((s) => s.elevationEditSelectedId);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const view = (views ?? []).find((v) => v.id === viewId) ?? null;

  // Esc で編集モードを抜ける（選択中なら選択解除を先に）。
  useEffect(() => {
    if (!viewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useCanvasStore.getState();
      if (s.elevationEditSelectedId) s.setElevationEditSelectedId(null);
      else s.setElevationEditViewId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewId]);

  // 対象ビューが消えた（削除・ページ切替）ら編集モードも閉じる。
  useEffect(() => {
    if (viewId && !view) useCanvasStore.getState().setElevationEditViewId(null);
  }, [viewId, view]);

  if (!viewId || !view) return null;

  const selected = selectedId
    ? [...view.primitives, ...(view.edits ?? []).flatMap((e) => (e.op === 'add' ? [e.primitive] : []))]
      .find((p) => p.meta?.id === selectedId) ?? null
    : null;
  const kindLabel = selected?.meta ? KIND_LABEL[selected.meta.kind] : null;
  const edited = selectedId ? hasEditFor(view.edits, selectedId) : false;

  const hide = () => {
    if (!selectedId) return;
    useCanvasStore.getState().setElevationEdits(viewId, withHide(view.edits, selectedId));
    useCanvasStore.getState().setElevationEditSelectedId(null);
  };
  const reset = () => {
    if (!selectedId) return;
    useCanvasStore.getState().setElevationEdits(viewId, withoutEditsFor(view.edits, selectedId));
  };
  const done = () => useCanvasStore.getState().setElevationEditViewId(null);

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2 max-w-[94vw]">
      <div className="min-w-0">
        <p className="text-[11px] text-accent font-bold leading-tight">立面編集</p>
        <p className="text-xs text-canvas font-bold whitespace-nowrap truncate">
          {selected
            ? `${kindLabel}を選択中${edited ? '（編集済み）' : ''}`
            : '部材をタップして選択（ドラッグで移動）'}
        </p>
      </div>
      {/* E-8c: 文字(寸法値・ラベル)は上書き編集できる */}
      {selected?.kind === 'text' && (
        <button type="button" onClick={() => useCanvasStore.getState().setElevationTextEditTargetId(selectedId)}
          className="px-3 py-2 bg-dark-bg border border-accent text-accent font-bold rounded-lg text-xs whitespace-nowrap">
          文字を編集
        </button>
      )}
      <button type="button" onClick={hide} disabled={!selectedId}
        className="px-3 py-2 bg-red-500 text-white font-bold rounded-lg text-xs whitespace-nowrap disabled:opacity-40">
        削除
      </button>
      <button type="button" onClick={reset} disabled={!edited}
        className="px-2 py-2 bg-dark-bg border border-dark-border rounded-lg text-xs text-dimension whitespace-nowrap disabled:opacity-40">
        元に戻す
      </button>
      <button type="button" onClick={done}
        className="px-3 py-2 bg-accent text-white font-bold rounded-lg text-xs whitespace-nowrap">
        完了
      </button>
    </div>
  );
}
