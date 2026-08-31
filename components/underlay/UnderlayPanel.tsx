'use client';

// ============================================================
// 下図の操作パネル (= U-1 commit 3)。
// 下図があるときだけ出る小さなバー。合わせたあとに触るのはここだけ。
//   ・濃さ（足場が見やすいよう既定は薄め）
//   ・表示のオンオフ（重なりを目で比べる）
//   ・位置の微調整（キャンバス上でドラッグ）
//   ・縮尺の合わせ直し／下図を外す
// 読めなかったときの案内もここに出す（キャンバス上には出さない＝作図の邪魔をしない）。
// ============================================================
import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  UNDERLAY_MAX_OPACITY, UNDERLAY_MIN_OPACITY,
} from '@/lib/konva/underlay';

export default function UnderlayPanel() {
  const underlay = useCanvasStore((s) => s.canvasData.underlay);
  const status = useCanvasStore((s) => s.underlayStatus);
  const adjusting = useCanvasStore((s) => s.underlayAdjusting);
  const hidden = useCanvasStore((s) => s.underlayHidden);

  if (!underlay) return null;
  const s = () => useCanvasStore.getState();
  const btn = 'px-2 py-1 rounded-lg text-[11px] font-bold';

  return (
    <div className="absolute left-2 bottom-2 z-20 bg-dark-surface/95 border border-dark-border rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap max-w-[92vw]">
      <span className="text-[11px] text-dimension font-bold">下図</span>

      {status === 'loading' && <span className="text-[11px] text-dimension">読み込み中…</span>}
      {status === 'error' && (
        <span className="text-[11px] text-red-300">
          読み込めませんでした（画像を入れ直してください）
        </span>
      )}

      {status === 'ready' && (
        <>
          <label className="flex items-center gap-1 text-[11px] text-dimension">
            濃さ
            <input
              type="range"
              min={UNDERLAY_MIN_OPACITY * 100} max={UNDERLAY_MAX_OPACITY * 100}
              value={Math.round(underlay.opacity * 100)}
              onChange={(e) => s().setUnderlayOpacity(Number(e.target.value) / 100)}
              className="w-24"
            />
            <span className="w-8 text-canvas">{Math.round(underlay.opacity * 100)}%</span>
          </label>

          <button type="button" onClick={() => s().setUnderlayHidden(!hidden)}
            className={`${btn} ${hidden ? 'bg-dark-border text-canvas' : 'bg-accent text-white'}`}>
            {hidden ? '表示する' : '隠す'}
          </button>

          <button type="button" onClick={() => s().setUnderlayAdjusting(!adjusting)}
            className={`${btn} ${adjusting ? 'bg-amber-500 text-white' : 'bg-dark-border text-canvas'}`}>
            {adjusting ? '調整をやめる' : '位置を調整'}
          </button>
        </>
      )}

      <button type="button" onClick={() => s().setShowUnderlayModal(true)}
        className={`${btn} bg-dark-border text-canvas`}>合わせ直す</button>
      <button type="button"
        onClick={() => {
          if (!confirm('下図を外しますか？（画像そのものは残ります）')) return;
          s().setUnderlayAdjusting(false);
          s().setUnderlay(null);
        }}
        className={`${btn} bg-dark-border text-canvas`}>外す</button>
    </div>
  );
}
