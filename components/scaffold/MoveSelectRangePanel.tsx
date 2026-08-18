'use client';
import React, { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

type CategoryKey = 'scaffold' | 'building' | 'obstacle' | 'memo';
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  scaffold: '足場部材',
  building: '建物',
  obstacle: '障害物',
  memo: 'メモ',
};

export default function MoveSelectRangePanel() {
  const {
    moveSelectMode,
    canvasData,
    setMoveSelectIds,
    confirmRangeSelection,
    backToCategory,
    cancelMoveSelectMode,
  } = useCanvasStore();

  const show = moveSelectMode.active && moveSelectMode.step === 'select';

  // Esc で全モード終了（既存パターンに合わせる）
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelMoveSelectMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, cancelMoveSelectMode]);

  if (!show) return null;

  const { categories, selectedIds } = moveSelectMode;

  const handleSelectAll = () => {
    const ids: string[] = [];
    if (categories.scaffold) {
      ids.push(
        ...canvasData.handrails.map(h => h.id),
        ...canvasData.posts.map(p => p.id),
        ...canvasData.antis.map(a => a.id),
        // P-1: 階段・単管も足場カテゴリ（手摺・支柱・アンチと同じ扱い）。
        ...(canvasData.stairs ?? []).map(s => s.id),
        ...(canvasData.pipes ?? []).map(p => p.id),
        // E-8-v5a: キャンバス直下の手動部材も足場カテゴリ。
        ...(canvasData.freeParts ?? []).map(p => p.id),
      );
    }
    if (categories.building) {
      ids.push(...canvasData.buildings.map(b => b.id));
      // S-1: 敷地は「建物」カテゴリに含める（躯体まわりで、選択ロックも建物側に従う）。
      ids.push(...(canvasData.sitePolygons ?? []).map(s => s.id));
    }
    if (categories.obstacle) ids.push(...canvasData.obstacles.map(o => o.id));
    if (categories.memo) ids.push(...canvasData.memos.map(m => m.id));
    setMoveSelectIds(ids);
  };

  const hasSelection = selectedIds.length > 0;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-24 z-30 bg-dark-surface/95 backdrop-blur-sm border border-dark-border rounded-2xl shadow-2xl p-3 w-[300px] max-w-[calc(100vw-24px)]">
      {/* ヘッダー: 選択件数 + 全選択 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-canvas">
          選択中: <span className="text-accent font-bold">{selectedIds.length}</span>個
        </span>
        <button
          onClick={handleSelectAll}
          className="px-2.5 py-1 rounded-lg bg-dark-bg border border-dark-border text-canvas text-[11px]"
        >
          全選択
        </button>
      </div>

      {/* カテゴリ読み取り専用表示 */}
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-dimension mb-3">
        {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((k) => (
          <span key={k} className={categories[k] ? 'text-canvas' : 'text-dimension/50'}>
            {categories[k] ? '☑' : '☐'} {CATEGORY_LABELS[k]}
          </span>
        ))}
      </div>

      {/* 戻る / 範囲確定 */}
      <div className="flex gap-2">
        <button
          onClick={backToCategory}
          className="flex-1 py-2 rounded-lg bg-dark-bg border border-dark-border text-dimension text-xs font-bold"
        >
          戻る
        </button>
        <button
          onClick={confirmRangeSelection}
          disabled={!hasSelection}
          className="flex-1 py-2 rounded-lg bg-accent text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          範囲確定
        </button>
      </div>

      <p className="mt-2 text-[10px] text-dimension text-center">
        キャンバスをタップ/ドラッグで選択
      </p>
    </div>
  );
}
