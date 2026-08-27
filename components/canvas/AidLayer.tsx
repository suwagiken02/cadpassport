'use client';

// ============================================================
// 作図の補助（補助線・目印）のレイヤー (= E-8-v5c)。
//
// ■ なぜ FreePartLayer から分けたか
//   1. **重ね順**: 補助線は下地なので、建物・足場より**背面**に敷く。
//      主役（黒＝建物・青＝手摺）を補助線が隠さないことを優先する。
//   2. **出力での出し分け**: PNG / PDF はステージを丸ごと画像化するので、
//      「補助線を含めない」を実現するには**キャンバプチャの間だけレイヤーごと隠す**しかない。
//      部材と同じレイヤーに混ぜると補助線だけ隠せない。
//      名指しで隠せるよう name(AID_LAYER_NAME) を付けてある。
//
// 描き方と触り方（クリックで選ぶ・ドラッグで動かす）は FreePartGroups が
// 部材と共通で持つので、分離しても選択・移動・削除の作法は変わらない。
// 置く操作（パレットから配置）は FreePartLayer 側が受け持つ（面はあちらが敷く）。
// ============================================================
import React from 'react';
import { Layer, Group } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPlainSelectMode } from '@/lib/konva/toolMode';
import { canPlaceFreePart } from '@/lib/konva/elevation/placementGate';
import { aidPartsOf } from '@/lib/konva/freeParts';
import FreePartGroups from './FreePartGroups';

/**
 * 出力時にこのレイヤーだけを名指しで隠すための名前 (= E-8-v5c)。
 * PNG / PDF は stage.toDataURL でステージを画像化するので、
 * 「補助線を含めない」はキャプチャの間だけ visible(false) にして実現する。
 */
export const AID_LAYER_NAME = 'aid-layer';

export default function AidLayer() {
  const freeParts = useCanvasStore((s) => s.canvasData.freeParts);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const selectActive = useCanvasStore((s) => s.selectActive);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  // E-8-v2l-hotfix3 と同じ理由でツールフラグは 1 つずつ購読する
  //   （オブジェクトを組み立てる selector は zustand v5 で毎回別値になり、再描画が止まらない）。
  const isHeightMarkerMode = useCanvasStore((s) => s.isHeightMarkerMode);
  const isRidgeLineMode = useCanvasStore((s) => s.isRidgeLineMode);
  const isMeasuring = useCanvasStore((s) => s.isMeasuring);
  const isMagnetPinMode = useCanvasStore((s) => s.isMagnetPinMode);
  const isAreaDesignationMode = useCanvasStore((s) => s.isAreaDesignationMode);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const pendingTargetType = useCanvasStore((s) => s.pendingTargetType);

  const aids = aidPartsOf(freeParts);
  if (aids.length === 0) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const flags = {
    mode, isHeightMarkerMode, isRidgeLineMode, isMeasuring, isMagnetPinMode,
    isAreaDesignationMode, isReorderMode,
    moveSelectActive: mode === 'move-select',
    pendingTargetType,
  };
  const viewSelected = (views ?? []).some((v) => selectedIds.includes(v.id));
  // 置いている最中は既存のものを触らせない（配置面が全部拾う）＝ FreePartLayer と同条件。
  const placing = canPlaceFreePart({ addTool, flags, selectActive, viewSelected });
  const interactive = ((isPlainSelectMode(flags) && selectActive) || mode === 'erase') && !placing;

  return (
    <Layer name={AID_LAYER_NAME}>
      <Group x={panX} y={panY} scaleX={gridPx} scaleY={gridPx}>
        <FreePartGroups
          parts={aids} gridPx={gridPx} interactive={interactive}
          mode={mode} selectedIds={selectedIds}
        />
      </Group>
    </Layer>
  );
}
