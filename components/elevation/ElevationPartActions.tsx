'use client';

// ============================================================
// 立面の操作行 (E-8-v3c-fix5)
//
// 「選択中の部材の削除／元に戻す」と案内文。E-8-v3c-fix4 まではこれが独立した
// 操作バーとして画面下に出ており、部材パレットと**同じ場所を奪い合って重なった**
// （実機でパレットが隠れて触れない）。パネルは 1 つに統合し、これはその最下段の 1 行にする。
//
// 立面図を 1 つ選んでいるときだけ中身が出る。選んでいなければ何も描かない
// （パレットだけのときにこの行ぶんの高さを取らない）。
// ============================================================
import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { hasEditFor, withHide, withoutEditsFor } from '@/lib/konva/elevation/elevationEdits';
import { describeEdit } from '@/lib/konva/elevation/elevationRematch';
import { describePart } from '@/lib/konva/elevation/elevationPartsRematch';
import { withPartDeleted } from '@/lib/konva/elevation/elevationParts';
import type { ElevationPrimitiveKind } from '@/types';

const KIND_LABEL: Record<ElevationPrimitiveKind, string> = {
  building: '建物外形', roof: '屋根', ridge: '棟', gl: 'GL',
  board: '作業床', rail: '手摺', post: '支柱', jack: 'ジャッキ', raise: '嵩上げ床',
  dim: '寸法線', dimText: '寸法値', text: '文字',
  aid: '補助線',   // E-8-v5c: 作図の補助（部材ではない）
};

/** divider: 上にパレットがあるときだけ区切り線を出す（単独表示で宙に浮いた線を出さない）。 */
export default function ElevationPartActions({ divider = true }: { divider?: boolean }) {
  const selectedPartId = useCanvasStore((s) => s.elevationEditSelectedId);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);

  const view = (mode === 'select' && selectedIds.length === 1)
    ? (views ?? []).find((v) => v.id === selectedIds[0]) ?? null
    : null;
  if (!view) return null;
  const viewId = view.id;

  const selected = selectedPartId
    ? [...view.primitives, ...(view.edits ?? []).flatMap((e) => (e.op === 'add' ? [e.primitive] : []))]
      .find((p) => p.meta?.id === selectedPartId) ?? null
    : null;
  const kindLabel = selected?.meta ? KIND_LABEL[selected.meta.kind] : null;
  const edited = selectedPartId ? hasEditFor(view.edits, selectedPartId) : false;

  const remove = () => {
    if (!selectedPartId) return;
    const s = useCanvasStore.getState();
    // 部材は意味データから取り除く（自動生成分は墓標を残す）。背景は削除マーク。
    if ((view.parts ?? []).some((p) => p.id === selectedPartId)) {
      s.setElevationParts(viewId, withPartDeleted(view.parts ?? [], selectedPartId));
    } else {
      s.setElevationEdits(viewId, withHide(view.edits, selectedPartId));
    }
    s.setElevationEditSelectedId(null);
  };
  const reset = () => {
    if (!selectedPartId) return;
    useCanvasStore.getState().setElevationEdits(viewId, withoutEditsFor(view.edits, selectedPartId));
  };

  const orphans = view.orphanEdits ?? [];
  const orphanParts = view.orphanParts ?? [];

  return (
    <>
      {/* E-8d: 再生成で引き継げなかった編集 */}
      {orphans.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-dark-bg border border-dark-border rounded-lg">
          <span className="text-[10px] text-dimension truncate max-w-[46vw]">
            引き継げなかった編集 {orphans.length} 件: {orphans.slice(0, 2).map(describeEdit).join(' / ')}
            {orphans.length > 2 ? ' …' : ''}
          </span>
          <button type="button"
            onClick={() => useCanvasStore.getState().setElevationOrphanEdits(viewId, [])}
            className="px-2 py-1 bg-dark-surface border border-dark-border rounded text-[10px] text-dimension whitespace-nowrap">
            削除
          </button>
        </div>
      )}

      {/* E-8-v2e: 作り直しで置き場所が無くなった部材（勝手に消さず一覧で提示する） */}
      {orphanParts.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-dark-bg border border-dark-border rounded-lg">
          <span className="text-[10px] text-dimension truncate max-w-[46vw]">
            置き場所が無くなった部材 {orphanParts.length} 件: {orphanParts.slice(0, 2).map(describePart).join(' / ')}
            {orphanParts.length > 2 ? ' …' : ''}
          </span>
          <button type="button"
            onClick={() => useCanvasStore.getState().setElevationOrphanParts(viewId, [])}
            className="px-2 py-1 bg-dark-surface border border-dark-border rounded text-[10px] text-dimension whitespace-nowrap">
            削除
          </button>
        </div>
      )}

      <div className={`flex items-center gap-2 flex-wrap ${divider ? 'border-t border-dark-border pt-2' : ''}`}>
        <p className="text-xs text-canvas font-bold truncate min-w-0 flex-1">
          {selected
            ? `${kindLabel}を選択中${edited ? '（編集済み）' : ''}`
            : '部材をタップ（ドラッグで移動・消去ツールで削除）'}
        </p>
        {/* E-8c: 文字(寸法値・ラベル)は上書き編集できる */}
        {selected?.kind === 'text' && (
          <button type="button" onClick={() => useCanvasStore.getState().setElevationTextEditTargetId(selectedPartId)}
            className="px-3 py-2 bg-dark-bg border border-accent text-accent font-bold rounded-lg text-xs whitespace-nowrap">
            文字を編集
          </button>
        )}
        <button type="button" onClick={remove} disabled={!selectedPartId}
          className="px-3 py-2 bg-red-500 text-white font-bold rounded-lg text-xs whitespace-nowrap disabled:opacity-40">
          削除
        </button>
        <button type="button" onClick={reset} disabled={!edited}
          className="px-2 py-2 bg-dark-bg border border-dark-border rounded-lg text-xs text-dimension whitespace-nowrap disabled:opacity-40">
          元に戻す
        </button>
      </div>
    </>
  );
}
