'use client';

// ============================================================
// 立面の文字編集モーダル (E-8c)。
// 立面編集モードで 寸法値(dimText) や 文字(text) を選び、表示文字を上書きする。
// 上書きは ElevationEdit の text 差分として積むだけなので、元の生成値は保持されたまま。
// 「元に戻す」で差分を外せば再生成値（エンジンが計算した数字）へ戻る。
// ============================================================
import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { withText, withoutTextFor } from '@/lib/konva/elevation/elevationEdits';
import type { ElevationEdit, ElevationPrimitive } from '@/types';

/** ビュー内（生成分＋追加分）から id でプリミティブを引く。 */
function findPrimitive(
  prims: ElevationPrimitive[], edits: ElevationEdit[] | undefined, id: string,
): ElevationPrimitive | null {
  const added = (edits ?? []).flatMap((e) => (e.op === 'add' ? [e.primitive] : []));
  return [...prims, ...added].find((p) => p.meta?.id === id) ?? null;
}

export default function ElevationTextEditModal() {
  const targetId = useCanvasStore((s) => s.elevationTextEditTargetId);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  // E-8-v2j: 編集モードを廃止したので、対象の文字を持っているビューを id から引く。
  const view = targetId
    ? (views ?? []).find((v) => findPrimitive(v.primitives, v.edits, targetId) != null) ?? null
    : null;
  const viewId = view?.id ?? null;

  const target = view && targetId ? findPrimitive(view.primitives, view.edits, targetId) : null;
  /** 上書き前の生成値（エンジンが計算した文字）。 */
  const originalText = target && target.kind === 'text' ? target.text : '';
  const override = (view?.edits ?? []).find(
    (e) => e.op === 'text' && e.targetId === targetId,
  ) as { op: 'text'; text: string } | undefined;

  const [value, setValue] = useState('');
  useEffect(() => {
    if (!targetId) return;
    setValue(override?.text ?? originalText);
    // 対象が変わったときだけ初期化
  }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!viewId || !targetId || !view || !target || target.kind !== 'text') return null;

  const close = () => useCanvasStore.getState().setElevationTextEditTargetId(null);
  const apply = () => {
    const t = value.trim();
    const s = useCanvasStore.getState();
    // 生成値と同じ文字なら上書きを持たない（差分を無駄に増やさない）。
    s.setElevationEdits(viewId, t === originalText || t === ''
      ? withoutTextFor(view.edits, targetId)
      : withText(view.edits, targetId, t));
    close();
  };
  const reset = () => {
    useCanvasStore.getState().setElevationEdits(viewId, withoutTextFor(view.edits, targetId));
    close();
  };

  return (
    <div className="fixed inset-0 modal-overlay z-[70] flex items-center justify-center p-4">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-xs">
        <h2 className="text-base text-canvas font-bold mb-1">文字を編集</h2>
        <p className="text-[11px] text-dimension mb-3">
          {target.meta?.kind === 'dimText' ? '寸法値' : '文字'}
          {override && <span className="text-accent">（上書き中）</span>}
        </p>

        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          autoFocus
          className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-canvas focus:outline-none focus:border-accent mb-2"
        />
        <p className="text-[10px] text-dimension mb-4">
          元の値: <span className="font-mono">{originalText}</span>
        </p>

        <div className="flex gap-2">
          {override && (
            <button type="button" onClick={reset}
              className="flex-1 py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold">
              元に戻す
            </button>
          )}
          <button type="button" onClick={close}
            className="flex-1 py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold">
            キャンセル
          </button>
          <button type="button" onClick={apply}
            className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-bold">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
