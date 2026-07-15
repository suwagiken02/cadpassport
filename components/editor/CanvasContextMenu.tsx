'use client';

// ============================================================
// キャンバスのコンテキストメニュー（E-6c）。右クリック/長押しで開く。
//   [コピー / 切り取り / 貼り付け / 削除]。
//   ・コピー/切り取り/削除: 選択が非空のとき有効。
//   ・貼り付け: クリップボードが非空のとき有効。gridAnchor 基準（右クリック位置）に貼る。
//   ・ページまたぎ = コピー/切り取り → タブ切替 → 貼り付け（clipboard は store singleton で生存）。
// 状態は store.contextMenu。開閉は openContextMenu/closeContextMenu。
// ============================================================
import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

export default function CanvasContextMenu() {
  const contextMenu = useCanvasStore((s) => s.contextMenu);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const clipboard = useCanvasStore((s) => s.clipboard);

  if (!contextMenu) return null;

  const hasSelection = selectedIds.length > 0;
  const canPaste = !!clipboard;
  const close = () => useCanvasStore.getState().closeContextMenu();

  const run = (fn: () => void, enabled: boolean) => () => {
    if (!enabled) return;
    fn();
    close();
  };

  // 画面端で見切れないよう軽くクランプ。
  const MENU_W = 176, MENU_H = 176;
  const left = Math.min(contextMenu.clientX, (typeof window !== 'undefined' ? window.innerWidth : 9999) - MENU_W - 4);
  const top = Math.min(contextMenu.clientY, (typeof window !== 'undefined' ? window.innerHeight : 9999) - MENU_H - 4);

  const Item = ({ label, shortcut, enabled, onClick, danger }: {
    label: string; shortcut?: string; enabled: boolean; onClick: () => void; danger?: boolean;
  }) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-6 px-3 py-2 text-left text-sm rounded-lg transition-colors ${
        enabled
          ? danger ? 'text-red-400 hover:bg-red-400/10' : 'text-canvas hover:bg-dark-bg'
          : 'text-dimension/40 cursor-default'
      }`}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[10px] text-dimension">{shortcut}</span>}
    </button>
  );

  return (
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
        <Item label="コピー" shortcut="Ctrl+C" enabled={hasSelection}
          onClick={run(() => useCanvasStore.getState().copySelection(), hasSelection)} />
        <Item label="切り取り" shortcut="Ctrl+X" enabled={hasSelection}
          onClick={run(() => useCanvasStore.getState().cutSelection(), hasSelection)} />
        <Item label="貼り付け" shortcut="Ctrl+V" enabled={canPaste}
          onClick={run(() => useCanvasStore.getState().pasteClipboard(contextMenu.gridAnchor), canPaste)} />
        <div className="my-1 border-t border-dark-border" />
        <Item label="削除" shortcut="Del" enabled={hasSelection} danger
          onClick={run(() => useCanvasStore.getState().removeElements(selectedIds), hasSelection)} />
      </div>
    </>
  );
}
