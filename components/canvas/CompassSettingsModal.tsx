'use client';

import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

type Props = { onClose: () => void };

export default function CompassSettingsModal({ onClose }: Props) {
  const { canvasData, setCompassAngle } = useCanvasStore();
  const angle = canvasData.compass.angle;

  const add = (delta: number) => setCompassAngle(angle + delta);
  const reset = () => setCompassAngle(0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 modal-overlay" />
      <div
        className="relative bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-xs w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">方位設定</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-dimension hover:text-canvas px-2"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        {/* 数値入力 (= 0-360 度) */}
        <div>
          <label className="block text-sm text-dimension mb-2">方位（度）</label>
          <input
            type="number"
            value={angle}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCompassAngle(Number.isFinite(v) ? v : 0);
            }}
            min={0}
            max={360}
            step={1}
            className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-canvas text-right font-mono focus:outline-none focus:border-accent"
          />
        </div>

        {/* 増減ボタン */}
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => add(-15)}
            className="py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-canvas hover:border-accent"
          >
            -15°
          </button>
          <button
            type="button"
            onClick={() => add(-1)}
            className="py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-canvas hover:border-accent"
          >
            -1°
          </button>
          <button
            type="button"
            onClick={() => add(1)}
            className="py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-canvas hover:border-accent"
          >
            +1°
          </button>
          <button
            type="button"
            onClick={() => add(15)}
            className="py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-canvas hover:border-accent"
          >
            +15°
          </button>
        </div>

        {/* リセット */}
        <button
          type="button"
          onClick={reset}
          className="w-full py-2 border border-dark-border rounded-lg text-sm text-dimension hover:text-canvas hover:border-accent"
        >
          リセット（0°）
        </button>
      </div>
    </div>
  );
}
