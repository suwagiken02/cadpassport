'use client';

// ============================================================
// 下図の操作パネル (= U-1 commit 3、 fix3 で置き場所を直した)。
//
// ■ fix3 で直したこと
// もとは `absolute left-2 bottom-2` だったが、このパネルは**キャンバス領域
// （唯一の relative な入れ物）の外**にマウントされている。位置の基準になる
// 親が無いので absolute が効かず、画面からはみ出していた。
// キャンバス上に浮く UI は、このアプリでは**例外なく fixed ＋ 明示的な幅 ＋
// max-w-[calc(100vw-24px)]** で書かれている（MoveSelectRangePanel /
// ReorderModeBar / PdfPageWizardBar など）。同じ作法に揃えた。
//
// 下図があるあいだ出しっぱなしになるので、**既定は小さなつまみ**にして
// 図面の邪魔をしない。押すと開く。
// ============================================================
import React, { useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { UNDERLAY_MAX_OPACITY, UNDERLAY_MIN_OPACITY } from '@/lib/konva/underlay';

export default function UnderlayPanel() {
  const underlay = useCanvasStore((s) => s.canvasData.underlay);
  const status = useCanvasStore((s) => s.underlayStatus);
  const adjusting = useCanvasStore((s) => s.underlayAdjusting);
  const hidden = useCanvasStore((s) => s.underlayHidden);
  const [open, setOpen] = useState(false);

  if (!underlay) return null;
  const s = () => useCanvasStore.getState();
  const btn = 'px-2 py-1 rounded-lg text-[11px] font-bold';

  // 畳んだ状態。位置を調整している間は開いていないと分かりにくいので印を出す。
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-16 left-3 z-30 bg-dark-surface/95 border border-dark-border rounded-xl shadow-2xl px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold text-canvas"
      >
        <span>🖼 下図</span>
        {status === 'error' && <span className="text-red-300">!</span>}
        {adjusting && <span className="text-amber-400">調整中</span>}
        {hidden && <span className="text-dimension">非表示</span>}
      </button>
    );
  }

  return (
    <div className="fixed top-16 left-3 z-30 w-[260px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-140px)] overflow-y-auto bg-dark-surface/95 backdrop-blur-sm border border-dark-border rounded-2xl shadow-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-canvas font-bold">🖼 下図</span>
        <button type="button" onClick={() => setOpen(false)}
          className="text-dimension hover:text-canvas px-1 text-xs">✕</button>
      </div>

      {status === 'loading' && <div className="text-[11px] text-dimension">読み込み中…</div>}
      {status === 'error' && (
        <div className="text-[11px] text-red-300 leading-relaxed">
          画像を読み込めませんでした。<br />
          「合わせ直す」から入れ直してください。
        </div>
      )}

      {status === 'ready' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-dimension">
            <span className="w-8">濃さ</span>
            <input
              type="range"
              min={UNDERLAY_MIN_OPACITY * 100} max={UNDERLAY_MAX_OPACITY * 100}
              value={Math.round(underlay.opacity * 100)}
              onChange={(e) => s().setUnderlayOpacity(Number(e.target.value) / 100)}
              className="flex-1 min-w-0"
            />
            <span className="w-9 text-right text-canvas">{Math.round(underlay.opacity * 100)}%</span>
          </label>

          <div className="flex gap-1.5">
            <button type="button" onClick={() => s().setUnderlayHidden(!hidden)}
              className={`${btn} flex-1 ${hidden ? 'bg-dark-border text-canvas' : 'bg-accent text-white'}`}>
              {hidden ? '表示する' : '隠す'}
            </button>
            <button type="button" onClick={() => s().setUnderlayAdjusting(!adjusting)}
              className={`${btn} flex-1 ${adjusting ? 'bg-amber-500 text-white' : 'bg-dark-border text-canvas'}`}>
              {adjusting ? '調整をやめる' : '位置を調整'}
            </button>
          </div>

          {adjusting && (
            <p className="text-[10px] text-amber-300 leading-relaxed">
              オレンジの枠をドラッグして下図を動かします。
              建物や足場は動きません（合わせるのは下図の側です）。
            </p>
          )}
        </div>
      )}

      <div className="flex gap-1.5 mt-2 pt-2 border-t border-dark-border">
        <button type="button" onClick={() => s().setShowUnderlayModal(true)}
          className={`${btn} flex-1 bg-dark-border text-canvas`}>合わせ直す</button>
        <button type="button"
          onClick={() => {
            if (!confirm('下図を外しますか？（画像そのものは残ります）')) return;
            s().setUnderlayAdjusting(false);
            s().setUnderlay(null);
          }}
          className={`${btn} flex-1 bg-dark-border text-canvas`}>外す</button>
      </div>
    </div>
  );
}
