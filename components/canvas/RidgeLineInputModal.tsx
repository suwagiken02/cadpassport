'use client';

// 棟ラインの棟高入力モーダル（E-3.8d・HeightInputModal を雛形）。
import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';

export default function RidgeLineInputModal() {
  const {
    canvasData,
    ridgeInputLineId,
    setRidgeInputLineId,
    updateRidgeLine,
    removeRidgeLine,
  } = useCanvasStore();

  const line = ridgeInputLineId
    ? (canvasData.ridgeLines ?? []).find((r) => r.id === ridgeInputLineId)
    : null;

  // 削除ボタンの誤タップ防止（mount 直後 250ms ガード）
  const [deleteEnabled, setDeleteEnabled] = useState(false);
  useEffect(() => {
    if (line) {
      setDeleteEnabled(false);
      const timer = setTimeout(() => setDeleteEnabled(true), 250);
      return () => clearTimeout(timer);
    }
  }, [line?.id]);

  // 削除直後などで line が消えたら閉じる
  useEffect(() => {
    if (ridgeInputLineId && !line) setRidgeInputLineId(null);
  }, [ridgeInputLineId, line, setRidgeInputLineId]);

  if (!line) return null;

  const handleChange = (v: number) => {
    const clamped = Math.max(0, Math.min(99000, v));
    updateRidgeLine(line.id, { heightMm: Math.round(clamped) });
  };
  const handleDelete = () => {
    removeRidgeLine(line.id);
    setRidgeInputLineId(null);
  };
  const handleClose = () => setRidgeInputLineId(null);

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-xs mx-4 w-full">
        <h2 className="text-base text-canvas font-bold mb-4">棟高入力</h2>
        <div className="flex items-center gap-2 mb-5">
          <NumInput value={line.heightMm} onChange={handleChange} min={0} step={100} />
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
