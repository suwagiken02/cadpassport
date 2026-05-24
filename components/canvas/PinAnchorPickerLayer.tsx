'use client';

import React, { useMemo, useCallback } from 'react';
import { Layer, Circle } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { collectAnchorPoints } from '@/lib/magnetPin/anchorPoints';
import type Konva from 'konva';

export default function PinAnchorPickerLayer() {
  // Phase M-3c-fix: selector ベース購読で zoom/pan 等の更新で再レンダーされないように
  const canvasData = useCanvasStore(s => s.canvasData);
  const zoom = useCanvasStore(s => s.zoom);
  const panX = useCanvasStore(s => s.panX);
  const panY = useCanvasStore(s => s.panY);
  const isMagnetPinMode = useCanvasStore(s => s.isMagnetPinMode);
  const pinAnchor = useCanvasStore(s => s.pinAnchor);
  const setPinAnchor = useCanvasStore(s => s.setPinAnchor);

  const anchors = useMemo(
    () => (isMagnetPinMode ? collectAnchorPoints(canvasData) : []),
    [isMagnetPinMode, canvasData],
  );

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      e.cancelBubble = true;
      const anchorId = e.target.id();
      if (!anchorId) return;
      if (pinAnchor?.id === anchorId) {
        setPinAnchor(null);
      } else {
        const anchor = anchors.find(a => a.id === anchorId);
        if (anchor) setPinAnchor(anchor);
      }
    },
    [anchors, pinAnchor, setPinAnchor],
  );

  if (!isMagnetPinMode) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const baseRadius = Math.max(5, Math.min(9, 6 * zoom));
  const activeRadius = baseRadius + 2;

  return (
    <Layer>
      {anchors.map((a) => {
        const cx = a.x * gridPx + panX;
        const cy = a.y * gridPx + panY;
        const isActive = pinAnchor?.id === a.id;
        return (
          <Circle
            key={a.id}
            id={a.id}
            x={cx}
            y={cy}
            radius={isActive ? activeRadius : baseRadius}
            fill={isActive ? '#F59E0B' : '#2563EB'}
            stroke="#FFFFFF"
            strokeWidth={1}
            onClick={handleClick}
            onTap={handleClick}
          />
        );
      })}
    </Layer>
  );
}
