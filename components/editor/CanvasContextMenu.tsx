'use client';

// ============================================================
// キャンバスのコンテキストメニュー＋タッチ貼り付け導線（E-6c / E-6d）。
//   ・メニュー: 右クリック(PC)/長押し(対応環境) or タッチの選択完了時に自動表示（E-6d）。
//     [コピー/切り取り/削除]=選択があるとき、[貼り付け]=クリップボードがあるとき。
//   ・タッチ端末(pointer: coarse)では、ブラウザ長押しに依存せず貼り付けできるよう、
//     クリップボード非空のとき画面隅に「貼り付け」ボタンを常時浮かせる（画面中央に貼る）。
//     PC(細ポインタ)には出さない＝挙動不変。
// 状態は store.contextMenu / clipboard。
// ============================================================
import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';

export default function CanvasContextMenu() {
  const contextMenu = useCanvasStore((s) => s.contextMenu);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const clipboard = useCanvasStore((s) => s.clipboard);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  const hasSelection = selectedIds.length > 0;
  const canPaste = !!clipboard;
  const close = () => useCanvasStore.getState().closeContextMenu();

  const run = (fn: () => void) => () => { fn(); close(); };

  // ビューポート中央のグリッド座標に貼り付け（タッチ貼り付けボタン用）。
  const pasteAtCenter = () => {
    const s = useCanvasStore.getState();
    const gpx = INITIAL_GRID_PX * s.zoom;
    const { width, height } = s.canvasSize;
    s.pasteClipboard({
      x: Math.round((width / 2 - s.panX) / gpx),
      y: Math.round((height / 2 - s.panY) / gpx),
    });
  };

  const Item = ({ label, shortcut, onClick, danger }: {
    label: string; shortcut?: string; onClick: () => void; danger?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-6 px-3 py-2.5 text-left text-sm rounded-lg transition-colors ${
        danger ? 'text-red-400 hover:bg-red-400/10' : 'text-canvas hover:bg-dark-bg'
      }`}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[10px] text-dimension">{shortcut}</span>}
    </button>
  );

  const MENU_W = 176, MENU_H = 200;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 9999;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 9999;
  const left = contextMenu ? Math.max(4, Math.min(contextMenu.clientX, vw - MENU_W - 4)) : 0;
  const top = contextMenu ? Math.max(4, Math.min(contextMenu.clientY, vh - MENU_H - 4)) : 0;

  return (
    <>
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={close}
            onContextMenu={(e) => { e.preventDefault(); close(); }}
          />
          <div
            className="fixed z-[61] w-44 p-1 bg-dark-surface border border-dark-border rounded-xl shadow-2xl"
            style={{ left, top }}
          >
            {/* コピー/切り取り/削除は選択があるときのみ。貼り付けはクリップボードがあるときのみ。 */}
            {hasSelection && (
              <>
                <Item label="コピー" shortcut="Ctrl+C" onClick={run(() => useCanvasStore.getState().copySelection())} />
                <Item label="切り取り" shortcut="Ctrl+X" onClick={run(() => useCanvasStore.getState().cutSelection())} />
              </>
            )}
            {canPaste && (
              <Item label="貼り付け" shortcut="Ctrl+V"
                onClick={run(() => useCanvasStore.getState().pasteClipboard(contextMenu.gridAnchor))} />
            )}
            {hasSelection && (
              <>
                <div className="my-1 border-t border-dark-border" />
                <Item label="削除" shortcut="Del" danger onClick={run(() => useCanvasStore.getState().removeElements(selectedIds))} />
              </>
            )}
          </div>
        </>
      )}

      {/* タッチ端末の貼り付け導線（クリップボード非空のときだけ・PC には出さない） */}
      {coarse && canPaste && !contextMenu && (
        <button
          type="button"
          onClick={pasteAtCenter}
          className="fixed bottom-24 right-3 z-40 flex items-center gap-1.5 px-4 py-3 bg-accent text-white rounded-full shadow-xl text-sm font-bold active:scale-95 transition-transform"
        >
          📋 貼り付け
        </button>
      )}
    </>
  );
}
