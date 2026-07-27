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
import { isMultiFloor } from '@/lib/konva/floorScope';

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
      // R-1h-4: 複数階の物件のときだけ「(2F)」等を文言に出す（単一階では従来どおり階を出さない）。
      targetFloor: isMultiFloor(s.canvasData.buildings) ? s.activeFloor : null,
    };
    return getOperationGuide(state);
  });

  // R-1k: ツール作業中は「編集中の階」を目立つ位置に出し、その場で階選択に戻れるようにする
  //   （隅の FloorSelector は気づきにくく、1F のまま 2F の屋根/高さを作る誤爆が起きていた）。
  const floorTool = useCanvasStore((s) => (
    s.isHeightMarkerMode ? 'height'
      : s.isRidgeLineMode ? 'ridge'
      : (s.pendingTargetType === 'roof' && s.mode === 'building') || s.mode === 'roof' ? 'roof'
      : null
  ));
  const activeFloor = useCanvasStore((s) => s.activeFloor);
  const multiFloor = useCanvasStore((s) => isMultiFloor(s.canvasData.buildings));
  const showFloorBadge = floorTool != null && multiFloor;

  if (!guide && !showFloorBadge) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[92%] flex flex-col items-center gap-1.5">
      {guide && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dark-surface/90 border border-dark-border shadow-lg backdrop-blur-sm pointer-events-none">
          <span className="text-accent text-xs leading-none">▶</span>
          <span className="text-canvas text-xs font-bold whitespace-nowrap overflow-hidden text-ellipsis">{guide}</span>
        </div>
      )}
      {showFloorBadge && (
        <button
          type="button"
          onClick={() => useCanvasStore.getState().setFloorPromptTool(floorTool)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent text-white border border-accent shadow-lg text-xs font-bold whitespace-nowrap"
        >
          <span>編集中: {activeFloor}F</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">切替</span>
        </button>
      )}
    </div>
  );
}
