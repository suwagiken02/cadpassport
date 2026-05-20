'use client';

import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';

export default function HeightInputModal() {
  const {
    canvasData,
    heightInputMarkerId,
    setHeightInputMarkerId,
    updateHeightMarker,
    removeHeightMarker,
  } = useCanvasStore();

  const marker = heightInputMarkerId
    ? (canvasData.heightMarkers ?? []).find((m) => m.id === heightInputMarkerId)
    : null;

  // 削除ボタンの誤タップ防止 (= モーダル mount 直後の touchend → click 合成で
  // 漏れタップが削除ボタンに到達するのを 250ms ガード)
  const [deleteEnabled, setDeleteEnabled] = useState(false);
  useEffect(() => {
    if (marker) {
      setDeleteEnabled(false);
      const timer = setTimeout(() => setDeleteEnabled(true), 250);
      return () => clearTimeout(timer);
    }
  }, [marker?.id]);

  // marker が消えた場合 (= 削除直後の race フォールバック) は閉じる
  useEffect(() => {
    if (heightInputMarkerId && !marker) setHeightInputMarkerId(null);
  }, [heightInputMarkerId, marker, setHeightInputMarkerId]);

  if (!marker) return null;

  const handleChange = (v: number) => {
    // 範囲: 0..99000 mm (= NumInput min=0、 max は onChange 側で clamp)
    // step 100 (= 10cm 刻み、 足場高さは 10cm 刻みで十分)、 Issue 2 修正
    const clamped = Math.max(0, Math.min(99000, v));
    updateHeightMarker(marker.id, { heightMm: Math.round(clamped) });
  };

  const handleDelete = () => {
    removeHeightMarker(marker.id);
    setHeightInputMarkerId(null);
  };

  const handleClose = () => setHeightInputMarkerId(null);

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-xs mx-4 w-full">
        <h2 className="text-base text-canvas font-bold mb-4">高さ入力</h2>
        <div className="flex items-center gap-2 mb-5">
          <NumInput
            value={marker.heightMm}
            onChange={handleChange}
            min={0}
            step={100}
          />
          <span className="text-sm text-canvas">mm</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={!deleteEnabled}
            className="flex-1 py-2 bg-red-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            削除
          </button>
          <button
            onClick={handleClose}
            className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-bold"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
