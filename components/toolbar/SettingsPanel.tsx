'use client';
import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
// 起動ボタンを一旦非表示にしているため未使用だが、再有効化時に使うので import は保持する
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useTutorialStore } from '@/stores/tutorialStore';
import DimensionVisibilityCheckboxes from '@/components/dimension/DimensionVisibilityCheckboxes';

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const {
    isDarkMode, toggleDarkMode,
    showKidare, toggleShowKidare,
    showDimensions, toggleShowDimensions,
    showDimensionLines, toggleShowDimensionLines,
    showGridGuide, toggleShowGridGuide,
    gridStrength, setGridStrength,
  } = useCanvasStore();

  const items = [
    { label: 'ダークモード', value: isDarkMode, toggle: toggleDarkMode, icon: isDarkMode ? '☀️' : '🌙' },
    { label: '離れ表示', value: showKidare, toggle: toggleShowKidare, icon: '↔' },
    { label: 'コーナーガイド', value: showDimensions, toggle: toggleShowDimensions, icon: '⤢' },
    { label: '寸法表示', value: showDimensionLines, toggle: toggleShowDimensionLines, icon: '📐' },
    { label: 'グリッドガイド', value: showGridGuide, toggle: toggleShowGridGuide, icon: '⊞' },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={onClose} />
      <div className="fixed bottom-16 left-0 right-0 z-50 sm:hidden bg-dark-surface border-t border-dark-border rounded-t-2xl p-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm">設定</h3>
          <button onClick={onClose} className="text-dimension text-lg px-2">✕</button>
        </div>
        {items.map(item => (
          <React.Fragment key={item.label}>
            <button onClick={item.toggle}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-bg rounded-xl border border-dark-border">
              <span className="text-sm flex items-center gap-2">
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              <span className={`w-10 h-6 rounded-full transition-colors flex items-center ${item.value ? 'bg-accent' : 'bg-dark-border'}`}>
                <span className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${item.value ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
            {/* Phase J-5: 「寸法表示」(マスター) の直下に段別チェックボックス */}
            {item.label === '寸法表示' && (
              <div className="px-1">
                <DimensionVisibilityCheckboxes disabled={!showDimensionLines} />
              </div>
            )}
          </React.Fragment>
        ))}
        {/* グリッド強弱 */}
        <div className="px-3 py-2.5 bg-dark-bg rounded-xl border border-dark-border">
          <span className="text-sm">グリッド強弱</span>
          <div className="flex gap-2 mt-2">
            {['弱', '中', '強'].map((label, i) => (
              <button key={i} onClick={() => setGridStrength(i)}
                className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                  gridStrength === i ? 'bg-accent text-white border-accent' : 'border-dark-border text-dimension'
                }`}>{label}</button>
            ))}
          </div>
        </div>
        {/*
          TODO: チュートリアル実装の不具合（点滅ハイライト・自動進行）修正後に再有効化する。
          コード本体（TutorialOverlay / tutorialStore / tutorialSteps / data-tutorial-id）は
          残してあるので、下記ボタンのコメントを外すだけで再有効化できる。
        */}
        {/* チュートリアル開始 (= デフォルト OFF、 手動起動のみ) */}
        <button
          type="button"
          onClick={() => {
            useTutorialStore.getState().startTutorial();
            onClose();
          }}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-dark-bg rounded-xl border border-dark-border"
        >
          <span className="text-sm flex items-center gap-2">
            <span>📘</span>
            <span>チュートリアル開始</span>
          </span>
          <span className="text-[10px] text-dimension">9 ステップ</span>
        </button>
      </div>
    </>
  );
}
