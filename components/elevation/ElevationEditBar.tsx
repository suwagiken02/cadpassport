'use client';

// ============================================================
// 立面編集モードのバー (E-8b)。
// 配置済み立面をダブルタップ（または「✏️ 編集」）で入り、部材ブロックを組み立てる。
//   ・部材(parts)  → 意味データそのものを足し引きする（E-8-v2）
//   ・背景(寸法線・文字など) → ElevationView.edits に差分として積む（E-8b/c）
// どちらも canvasData の履歴に乗るので undo/redo はそのまま効く。
// ============================================================
import React, { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { hasEditFor, withHide, withoutEditsFor } from '@/lib/konva/elevation/elevationEdits';
import { describeEdit } from '@/lib/konva/elevation/elevationRematch';
import { describePart } from '@/lib/konva/elevation/elevationPartsRematch';
import { PALETTE_KINDS } from '@/lib/konva/elevation/elevationSlots';
import type { ElevationPart, ElevationPartKind } from '@/lib/konva/elevation/elevationParts';
import type { ElevationPrimitiveKind } from '@/types';

/** パレットの部材名。 */
const PART_LABEL: Record<ElevationPartKind, string> = {
  post: '支柱', postExt: '支柱延長', jack: 'ジャッキ', board: '踏板',
  rail: '手摺', raiseBoard: '嵩上げ床', raiseRail: '嵩上げ手摺', brace: '筋交',
};

const KIND_LABEL: Record<ElevationPrimitiveKind, string> = {
  building: '建物外形', roof: '屋根', ridge: '棟', gl: 'GL',
  board: '作業床', rail: '手摺', post: '支柱', jack: 'ジャッキ', raise: '嵩上げ床',
  dim: '寸法線', dimText: '寸法値', text: '文字',
};

export default function ElevationEditBar() {
  const viewId = useCanvasStore((s) => s.elevationEditViewId);
  const selectedId = useCanvasStore((s) => s.elevationEditSelectedId);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
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

  // E-8-fix: ダブルタップに頼らない導線。立面を1つ選択していれば「編集」ボタンを出す。
  //   （ダブルタップは端末差で取りこぼしやすいので、確実に入れる入口を併設する）
  if (!viewId) {
    if (mode !== 'select' || selectedIds.length !== 1) return null;
    const target = (views ?? []).find((v) => v.id === selectedIds[0]);
    if (!target) return null;
    return (
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2">
        <span className="text-xs text-canvas font-bold whitespace-nowrap">立面図を選択中</span>
        <button
          type="button"
          onClick={() => useCanvasStore.getState().setElevationEditViewId(target.id)}
          className="px-3 py-2 bg-accent text-white font-bold rounded-lg text-xs whitespace-nowrap"
        >
          ✏️ 編集
        </button>
      </div>
    );
  }
  if (!view) return null;

  const selected = selectedId
    ? [...view.primitives, ...(view.edits ?? []).flatMap((e) => (e.op === 'add' ? [e.primitive] : []))]
      .find((p) => p.meta?.id === selectedId) ?? null
    : null;
  const kindLabel = selected?.meta ? KIND_LABEL[selected.meta.kind] : null;
  const edited = selectedId ? hasEditFor(view.edits, selectedId) : false;

  const hide = () => {
    if (!selectedId) return;
    const s = useCanvasStore.getState();
    const parts = view.parts ?? [];
    const part = parts.find((p) => p.id === selectedId);
    if (part) {
      // E-8-v2e: 自動生成部材の削除は「墓標」を残す。作り直しても消したままにするため。
      //   手動で足した部材は配列から取り除くだけでよい（元から生えてこない）。
      const next: ElevationPart[] = part.origin === 'manual'
        ? parts.filter((p) => p.id !== selectedId)
        : parts.map((p) => (p.id === selectedId ? { ...p, origin: 'manual' as const, removed: true } : p));
      s.setElevationParts(viewId, next);
    } else {
      // 背景（寸法線・文字など）は従来どおり削除マーク（hide 差分）。
      s.setElevationEdits(viewId, withHide(view.edits, selectedId));
    }
    s.setElevationEditSelectedId(null);
  };
  const reset = () => {
    if (!selectedId) return;
    useCanvasStore.getState().setElevationEdits(viewId, withoutEditsFor(view.edits, selectedId));
  };
  const done = () => useCanvasStore.getState().setElevationEditViewId(null);

  const orphans = view.orphanEdits ?? [];
  const orphanParts = view.orphanParts ?? [];

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-2 max-w-[94vw]">
      {/* E-8-v2c: 部材ブロックのパレット。選ぶと有効位置がゴースト表示され、タップで吸着配置。 */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <span className="text-[10px] text-dimension mr-1">部材</span>
        {PALETTE_KINDS.map((k) => (
          <button key={k} type="button"
            onClick={() => useCanvasStore.getState().setElevationAddTool(addTool === k ? null : k)}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
              addTool === k ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
            }`}>
            {PART_LABEL[k]}
          </button>
        ))}
        {addTool && addTool !== 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">はまる位置をタップ</span>
        )}
        {addTool === 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">位置をタップ</span>
        )}
      </div>

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

      <div className="flex items-center gap-2">
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
    </div>
  );
}
