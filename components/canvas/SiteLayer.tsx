'use client';

// ============================================================
// 敷地境界線のレイヤー (= S-1)。
//
// 建物より**下**に敷く（敷地は下地で、その上に建物・足場が乗る）。
// 見た目は lib/konva/siteShape.ts が唯一の定義：建物と同じ黒・一点鎖線・建物より細い。
// 塗りは持たないので、当たり判定は線そのもの（内側をタップしても拾わない＝
// 上に乗っている建物のタップを奪わない）。
//
// 触れる条件・当たり判定の作法は BuildingLayer とまったく同じにしてある
// （素の選択モードで選択ONかつロック解除中、または消去／一括移動中）。
// ============================================================
import React from 'react';
import { Layer, Line } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPlainSelectMode } from '@/lib/konva/toolMode';
import { siteDash, siteStrokeColor, siteStrokeWidth } from '@/lib/konva/siteShape';

export default function SiteLayer() {
  const sitePolygons = useCanvasStore((s) => s.canvasData.sitePolygons);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const isDarkMode = useCanvasStore((s) => s.isDarkMode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const moveSelectIds = useCanvasStore((s) => s.moveSelectMode.selectedIds);
  const moveSelectActive = useCanvasStore((s) => s.moveSelectMode.active);
  const selectActive = useCanvasStore((s) => s.selectActive);
  const selectLockBuilding = useCanvasStore((s) => s.selectLock.building);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const isHeightMarkerMode = useCanvasStore((s) => s.isHeightMarkerMode);
  const isRidgeLineMode = useCanvasStore((s) => s.isRidgeLineMode);
  const isMeasuring = useCanvasStore((s) => s.isMeasuring);
  const isMagnetPinMode = useCanvasStore((s) => s.isMagnetPinMode);
  const isAreaDesignationMode = useCanvasStore((s) => s.isAreaDesignationMode);
  const pendingTargetType = useCanvasStore((s) => s.pendingTargetType);

  const sites = sitePolygons ?? [];
  // 敷地が 1 枚も無ければ何も出さない（既存の図面はノードが 1 つも増えない）。
  if (sites.length === 0) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const plainSelect = isPlainSelectMode({
    mode, isHeightMarkerMode, isRidgeLineMode, isMeasuring, isMagnetPinMode,
    isAreaDesignationMode, isReorderMode, moveSelectActive, pendingTargetType,
  });
  // BuildingLayer と同じ条件（敷地は建物と同じ「躯体まわり」なのでロックも建物側に従う）
  const listenSite =
    (plainSelect && selectActive && !selectLockBuilding)
    || (mode === 'select' && isReorderMode);
  const listening = listenSite || mode === 'erase' || mode === 'move-select';
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectIds : selectedIds;

  return (
    <Layer>
      {sites.map((site) => {
        const isSelected = effectiveSelectedIds.includes(site.id);
        const flatPoints = site.points.flatMap((p) => [
          p.x * gridPx + panX, p.y * gridPx + panY,
        ]);
        return (
          <Line
            key={site.id}
            id={site.id}
            points={flatPoints}
            closed
            stroke={siteStrokeColor(isDarkMode, isSelected)}
            strokeWidth={siteStrokeWidth(zoom, isSelected)}
            dash={siteDash(zoom)}
            // 塗らない＝内側は当たらない。線そのものを掴めるよう当たり幅だけ広げる。
            hitStrokeWidth={listening ? 14 : 0}
            listening={listening}
          />
        );
      })}
    </Layer>
  );
}
