'use client';

// ============================================================
// ページ(シート)タブ UI（E-6a）。presentational。
//  ・現物件の全ページ(drawing)をタブ表示（表示順は親が sort 済みで渡す）。
//  ・タブクリックで切替、ダブルクリック or ✎ でリネーム（インライン入力）。
//  ・[+] で「空ページ」「現ページを複製」の 2 択ポップオーバー。
//  ・アクティブタブの × で削除（親が確認ダイアログと実行を担当）。
// DB I/O は持たず、操作は全てコールバックで親（エディタ）へ委譲。
//
// レイアウト注意（E-6a-fix）: 横スクロールはタブ列だけを内側ラッパーに閉じ込める。
//   タブバー root に overflow-x-auto を掛けると overflow-y も auto に計算され、
//   [+] の絶対配置ドロップダウン（タブバー外へはみ出す）がクリップされて見えなくなるため。
// ============================================================
import React, { useState } from 'react';

export type PageTabItem = { id: string; title: string };

type Props = {
  pages: PageTabItem[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onAddBlank: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  disabled?: boolean;
};

export default function PageTabs({
  pages,
  activeId,
  onSwitch,
  onAddBlank,
  onDuplicate,
  onDelete,
  onRename,
  disabled,
}: Props) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setDraftTitle(current);
    setAddMenuOpen(false);
  };
  const commitRename = () => {
    if (renamingId) {
      const t = draftTitle.trim();
      if (t) onRename(renamingId, t);
    }
    setRenamingId(null);
  };

  const canDelete = pages.length > 1;

  return (
    // root は overflow を持たない（[+] メニューをクリップしないため）。
    <div className="flex-shrink-0 flex items-stretch gap-1 bg-dark-surface border-b border-dark-border px-2 py-1">
      {/* タブ列だけを横スクロール可能に */}
      <div className="flex items-stretch gap-1 overflow-x-auto min-w-0">
        {pages.map((pg) => {
          const active = pg.id === activeId;
          if (renamingId === pg.id) {
            return (
              <input
                key={pg.id}
                value={draftTitle}
                autoFocus
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); }
                }}
                className="flex-shrink-0 w-28 px-2 py-1 bg-dark-bg border border-accent rounded-lg text-xs text-canvas focus:outline-none"
              />
            );
          }
          return (
            <div
              key={pg.id}
              className={`flex-shrink-0 flex items-center rounded-lg border transition-colors ${
                active
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-dark-bg border-dark-border text-dimension hover:text-canvas'
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => (active ? undefined : onSwitch(pg.id))}
                onDoubleClick={() => startRename(pg.id, pg.title)}
                className="px-3 py-1 text-xs font-bold max-w-[140px] truncate disabled:opacity-50"
                title={pg.title}
              >
                {pg.title}
              </button>
              {active && (
                <>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => startRename(pg.id, pg.title)}
                    className="px-1 text-xs opacity-70 hover:opacity-100 disabled:opacity-30"
                    title="ページ名を変更"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    disabled={disabled || !canDelete}
                    onClick={() => onDelete(pg.id)}
                    className="px-1.5 text-xs opacity-70 hover:opacity-100 disabled:opacity-20"
                    title={canDelete ? 'ページを削除' : '最後のページは削除できません'}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* [+] 追加メニュー（overflow の外に置く） */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAddMenuOpen((v) => !v)}
          className="px-3 py-1 rounded-lg border border-dark-border bg-dark-bg text-dimension hover:text-canvas text-sm font-bold disabled:opacity-50"
          title="ページを追加"
        >
          ＋
        </button>
        {addMenuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setAddMenuOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-30 w-40 bg-dark-surface border border-dark-border rounded-lg shadow-xl overflow-hidden">
              <button
                type="button"
                onClick={() => { setAddMenuOpen(false); onAddBlank(); }}
                className="w-full px-3 py-2 text-left text-xs text-canvas hover:bg-dark-bg"
              >
                ＋ 空ページを追加
              </button>
              <button
                type="button"
                onClick={() => { setAddMenuOpen(false); onDuplicate(); }}
                className="w-full px-3 py-2 text-left text-xs text-canvas hover:bg-dark-bg border-t border-dark-border"
              >
                ⧉ 現ページを複製
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
