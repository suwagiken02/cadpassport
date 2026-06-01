'use client';

import React from 'react';
import { Layer, Line } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { Point } from '@/types';
import { getEdgeOverhangs, computeOffsetPolygon } from '@/lib/konva/roofUtils';

export default function BuildingLayer() {
  const { canvasData, zoom, panX, panY, mode, selectedIds, moveSelectMode, isDarkMode, selectActive, selectLock } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectMode.selectedIds : selectedIds;
  // 「ロック中」判定は selectActive=true のときだけ (= selectActive=false / 入替モードでは selectLock を無視して触れる)
  const isBuildingLocked = mode === 'select' && selectActive && selectLock.building;
  const selectListenBuilding = mode === 'select' && !isBuildingLocked;

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
        const is2F = building.floor === 2;
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
            opacity={is2F ? 0.6 : 1}
            stroke={strokeColor}
            strokeWidth={(isSelected ? 24 : 16) * zoom}
            listening={selectListenBuilding || mode === 'erase' || mode === 'move-select' || mode === 'roof'}
            id={building.id}
            onClick={mode === 'roof' ? handleBuildingRoofTap : undefined}
            onTap={mode === 'roof' ? handleBuildingRoofTap : undefined}
          />
        );
      })}

      {/* 屋根の出幅（建物本体の上に描画、 mode='roof' で tap 再編集可) */}
      {canvasData.buildings.map((building) => {
        if (!building.roof || building.roof.roofType === 'none') return null;
        const overhangs = getEdgeOverhangs(building, building.roof);
        if (overhangs.every((o) => o === 0)) return null;

        const offsetPts = computeOffsetPolygon(building.points, overhangs);
        const flatPoints = offsetPts.flatMap((p) => [
          p.x * gridPx + panX,
          p.y * gridPx + panY,
        ]);

        const handleRoofTap = () => {
          useCanvasStore.getState().setSelectedIds([building.id]);
          useCanvasStore.getState().setAutoOpenRoofForBuildingId(building.id);
        };
        return (
          <Line
            key={`roof-${building.id}`}
            points={flatPoints}
            closed
            stroke="#888780"
            strokeWidth={8 * zoom}
            dash={[48 * zoom, 32 * zoom]}
            hitStrokeWidth={mode === 'roof' ? 12 : 0}
            listening={mode === 'roof'}
            onClick={handleRoofTap}
            onTap={handleRoofTap}
          />
        );
      })}

    </Layer>
  );
}
