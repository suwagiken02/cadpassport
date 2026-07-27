'use client';

import React from 'react';
import { Layer, Line } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { Point } from '@/types';
import { computeOffsetPolygon } from '@/lib/konva/roofUtils';
import { getRoofPolygon, roofPolygonOffsetsGrid } from '@/lib/konva/roofRegion';
import { OTHER_FLOOR_OPACITY, OTHER_FLOOR_OPACITY_TOOL } from '@/lib/konva/floorScope';

export default function BuildingLayer() {
  const { canvasData, zoom, panX, panY, mode, selectedIds, moveSelectMode, isDarkMode, selectActive, selectLock, isReorderMode, activeFloor, isHeightMarkerMode, isRidgeLineMode, pendingTargetType } = useCanvasStore();
  // R-1h-3: 高さ・棟・屋根領域の入力中は「どの階の壁に置いているか」を一目で分かるよう、
  //   非 active 階をさらに大幅減光する（通常の薄表示 0.6 → 0.18）。非表示にしないのは
  //   下階との位置関係が見えないと上階の壁位置を掴めないため。
  const isFloorScopedTool = isHeightMarkerMode || isRidgeLineMode || pendingTargetType === 'roof' || mode === 'roof';
  const otherFloorOpacity = isFloorScopedTool ? OTHER_FLOOR_OPACITY_TOOL : OTHER_FLOOR_OPACITY;
  const gridPx = INITIAL_GRID_PX * zoom;
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectMode.selectedIds : selectedIds;
  // 選択ON + ロック解除中、 または入替モード中のみ触れる (= 選択OFF + 非入替 = 閲覧モードで触れない)
  const selectListenBuilding =
    (mode === 'select' && selectActive && !selectLock.building)
    || (mode === 'select' && isReorderMode);

  return (
    <Layer>
      {/* 旧式の roofOverhangs（後方互換、最下層） */}
      {canvasData.roofOverhangs.map((overhang) => {
        const building = canvasData.buildings.find((b) => b.id === overhang.buildingId);
        if (!building) return null;
        const pts = building.points;
        const i = overhang.faceIndex;
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;
        const nx = -dy / len;
        const ny = dx / len;
        const g = overhang.overhangMm / 10;

        return (
          <Line key={overhang.id}
            points={[
              (p1.x + nx * g) * gridPx + panX, (p1.y + ny * g) * gridPx + panY,
              (p2.x + nx * g) * gridPx + panX, (p2.y + ny * g) * gridPx + panY,
            ]}
            stroke="#888780" strokeWidth={8 * zoom} dash={[48 * zoom, 32 * zoom]} listening={false}
          />
        );
      })}

      {/* 建物本体 */}
      {canvasData.buildings.map((building) => {
        const flatPoints = building.points.flatMap((p) => [
          p.x * gridPx + panX, p.y * gridPx + panY,
        ]);
        const isSelected = effectiveSelectedIds.includes(building.id);
        // N階一般化 P2: activeFloor 以外の階を薄表示 (= 変数名は後方互換で is2F のまま)。
        // activeFloor に建物が無い (= 切替直後/stale) ときは薄表示しない (= 全階くっきり、安全側)。
        const is2F = canvasData.buildings.some((b) => (b.floor ?? 1) === activeFloor) && (building.floor ?? 1) !== activeFloor;
        const fillColor = is2F ? '#A0A0A0' : (isDarkMode ? '#555555' : '#3d3d3a');
        const strokeColor = isSelected ? '#FF6B35' : (is2F ? '#888888' : (isDarkMode ? '#888888' : '#1a1a18'));

        // mode='roof' 時の屋根再編集 (= 屋根なし状態でも building 本体 tap で開く、 #5 仕様)
        const handleBuildingRoofTap = () => {
          useCanvasStore.getState().setSelectedIds([building.id]);
          useCanvasStore.getState().setAutoOpenRoofForBuildingId(building.id);
        };
        return (
          <Line key={building.id} points={flatPoints} closed
            fill={fillColor}
            opacity={is2F ? otherFloorOpacity : 1}
            stroke={strokeColor}
            strokeWidth={(isSelected ? 24 : 16) * zoom}
            listening={selectListenBuilding || mode === 'erase' || mode === 'move-select' || mode === 'roof'}
            id={building.id}
            onClick={mode === 'roof' ? handleBuildingRoofTap : undefined}
            onTap={mode === 'roof' ? handleBuildingRoofTap : undefined}
          />
        );
      })}

      {/* 屋根の出幅点線（R-1e-fix7: 屋根領域 polygon を、壁重なり辺だけ出幅ぶん外へオフセットして描画）。 */}
      {(canvasData.roofs ?? []).map((roof) => {
        const building = canvasData.buildings.find((b) => b.id === roof.buildingId);
        if (!building) return null;
        const poly = getRoofPolygon(building, roof);
        if (poly.length < 3) return null;
        const offsets = roofPolygonOffsetsGrid(building, roof);
        const eave = computeOffsetPolygon(poly, offsets);
        const flatPoints = eave.flatMap((p) => [p.x * gridPx + panX, p.y * gridPx + panY]);

        const handleRoofTap = () => {
          useCanvasStore.getState().setRoofSettingsTarget({ buildingId: roof.buildingId, polygon: poly, roofId: roof.id });
        };
        return (
          <Line
            key={`roof-${roof.id}`}
            points={flatPoints}
            closed
            stroke="#888780"
            strokeWidth={8 * zoom}
            dash={[48 * zoom, 32 * zoom]}
            hitStrokeWidth={mode === 'select' ? 14 : 0}
            listening={mode === 'select'}
            onClick={handleRoofTap}
            onTap={handleRoofTap}
          />
        );
      })}

    </Layer>
  );
}
