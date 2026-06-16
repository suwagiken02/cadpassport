'use client';

import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 階セレクタ (= N階一般化 P2)。
 * 建物が 2 階以上に跨るときのみ表示する。選んだ階が activeFloor となり、
 * BuildingLayer で他階は薄表示される。割付など既存ロジックには影響しない。
 */
export default function FloorSelector() {
  const buildings = useCanvasStore((s) => s.canvasData.buildings);
  const activeFloor = useCanvasStore((s) => s.activeFloor);
  const setActiveFloor = useCanvasStore((s) => s.setActiveFloor);

  const maxFloor = buildings.reduce((m, b) => Math.max(m, b.floor ?? 1), 0);
  if (maxFloor < 2) return null;

  // 上階から降順に並べる (= 図面の見た目と同じ「上が上階」)
  const floors = Array.from({ length: maxFloor }, (_, i) => maxFloor - i);

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-30 bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-1.5 py-1 flex gap-1">
      {floors.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setActiveFloor(f)}
          className={`px-2.5 py-1 rounded-lg text-[12px] font-bold transition-colors ${
            activeFloor === f
              ? 'bg-accent text-white'
              : 'bg-dark-bg text-dimension border border-dark-border hover:text-canvas'
          }`}
          aria-pressed={activeFloor === f}
        >
          {f}F
        </button>
      ))}
    </div>
  );
}
