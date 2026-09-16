'use client';

import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 階セレクタ (= N階一般化 P2)。
 * 建物が 2 階以上に跨るときのみ表示する。選んだ階が activeFloor となり、
 * BuildingLayer で他階は薄表示される。割付など既存ロジックには影響しない。
 *
 * ■ 重なりの順（z）
 * 躯体・足場のメニューを開くと z-40 の暗幕が出る。ここが z-30 だったため
 * **暗幕に覆われて押せなかった**（押しても暗幕が反応してメニューが閉じるだけ）。
 * 躯体メニューの項目（建物1F・上の階を追加・高さ・棟・屋根）は**どれも階に
 * 依存する**ので、メニューを開いている間こそ階を変えたい。
 *   暗幕 z-40 ＜ **階セレクタ z-45** ＜ メニュー本体 z-50
 * の順にして、階セレクタだけが暗幕の上に出るようにした。役割の順番がそのまま
 * z の順番になっている。
 *   ・平常時（暗幕が無い）は見た目も挙動も変わらない
 *   ・階を変えてもメニューは閉じない（変えてからメニューを押す流れが切れない）
 *   ・暗幕のそれ以外を押せば従来どおりメニューが閉じる
 *   ・モーダル（z-50）が開いている間は従来どおり下に隠れる（触らせない方が正しい）
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
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[45] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-1.5 py-1 flex gap-1">
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
