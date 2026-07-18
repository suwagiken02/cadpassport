'use client';

// ============================================================
// 操作ガイドバー (R-2b): 現在のツール状態から「次にやること」を1行で常時案内する。
//  ・キャンバス上端中央の細いバー（ダーク半透明・小さめ）。
//  ・pointer-events-none でキャンバス操作を邪魔しない。
//  ・getOperationGuide が null（閲覧中など）のときは非表示。
//  文言の出し分けは lib/operationGuide.ts の pure 関数に集約（ここは表示のみ）。
// ============================================================
import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { getOperationGuide, type GuideState } from '@/lib/operationGuide';

export default function OperationGuideBar() {
  const guide = useCanvasStore((s) => {
    const state: GuideState = {
      mode: s.mode,
      isMeasuring: s.isMeasuring,
      hasMeasurePoint1: s.measurePoint1 != null,
      isHeightMarkerMode: s.isHeightMarkerMode,
      isRidgeLineMode: s.isRidgeLineMode,
      hasRidgeDraft: s.ridgeDraft != null,
      isMagnetPinMode: s.isMagnetPinMode,
      hasPinAnchor: s.pinAnchor != null,
      isAreaDesignationMode: s.isAreaDesignationMode,
      isReorderMode: s.isReorderMode,
      moveSelectActive: s.moveSelectMode.active,
      moveSelectStep: s.moveSelectMode.step,
      buildingInputMethod: s.buildingInputMethod,
      directionPointCount: s.directionPoints.length,
      selectActive: s.selectActive,
      isRoofDraw: s.pendingTargetType === 'roof',
    };
    return getOperationGuide(state);
  });

  if (!guide) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[92%]">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dark-surface/90 border border-dark-border shadow-lg backdrop-blur-sm">
        <span className="text-accent text-xs leading-none">▶</span>
        <span className="text-canvas text-xs font-bold whitespace-nowrap overflow-hidden text-ellipsis">{guide}</span>
      </div>
    </div>
  );
}
