'use client';

import React from 'react';
import { Layer, Text, Line, Rect, Group, Path } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { snapToMagnetPin } from '@/lib/konva/snapUtils';
import { MemoShape } from '@/types';

function getShapePath(shape: MemoShape, w: number, h: number): string {
  switch (shape) {
    case 'rect':
      return `M8 0 H${w-8} Q${w} 0 ${w} 8 V${h-8} Q${w} ${h} ${w-8} ${h} H8 Q0 ${h} 0 ${h-8} V8 Q0 0 8 0 Z`;
    case 'cloud': {
      const r = h / 3;
      return `M${r} ${h/2} Q${r} 0 ${w/3} ${r} Q${w/2} 0 ${w*2/3} ${r} Q${w-r} 0 ${w-r} ${h/2} Q${w} ${h} ${w-r} ${h*3/4} Q${w*2/3} ${h} ${w/2} ${h*3/4} Q${w/3} ${h} ${r} ${h*3/4} Q0 ${h} ${r} ${h/2} Z`;
    }
    case 'circle':
      return `M${w/2} 0 A${w/2} ${h/2} 0 1 1 ${w/2} ${h} A${w/2} ${h/2} 0 1 1 ${w/2} 0 Z`;
    case 'speech':
      return `M8 0 H${w-8} Q${w} 0 ${w} 8 V${h-16} Q${w} ${h-8} ${w-8} ${h-8} H${w/2+10} L${w/2} ${h} L${w/2-4} ${h-8} H8 Q0 ${h-8} 0 ${h-16} V8 Q0 0 8 0 Z`;
    default:
      return `M0 0 H${w} V${h} H0 Z`;
  }
}

export default function MemoLayer() {
  const { canvasData, zoom, panX, panY, mode, selectedIds, moveSelectMode } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectMode.selectedIds : selectedIds;

  return (
    <Layer>
      {canvasData.memos.map((memo) => {
        const isSelected = effectiveSelectedIds.includes(memo.id);
        const screenX = memo.x * gridPx + panX;
        const screenY = memo.y * gridPx + panY;
        const fontSize = Math.max(10, 12 * zoom);
        const scX = memo.scaleX || memo.scale || 1;
        const scY = memo.scaleY || memo.scale || 1;
        const ang = memo.angle || 0;

        // 新しいshape付きメモ
        if (memo.shape) {
          const lines = memo.text.split('\n');
          const maxLineLen = Math.max(...lines.map(l => l.length));
          const baseW = Math.max(80, maxLineLen * fontSize * 0.6 + 24);
          const baseH = Math.max(40, lines.length * (fontSize + 4) + 16);
          const w = baseW * scX;
          const h = baseH * scY;

          return (
            <Group
              key={memo.id}
              x={screenX}
              y={screenY}
              rotation={ang}
              offsetX={w / 2}
              offsetY={h / 2}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onDragEnd={(e) => {
                const dx = Math.round((e.target.x() - screenX) / gridPx);
                const dy = Math.round((e.target.y() - screenY) / gridPx);
                e.target.x(screenX); e.target.y(screenY);
                if (dx !== 0 || dy !== 0) {
                  // Phase M-6b: メモ中心がピンに吸着
                  const wGrid = w / gridPx;
                  const hGrid = h / gridPx;
                  const cx = memo.x + dx + wGrid / 2;
                  const cy = memo.y + dy + hGrid / 2;
                  const pinSnap = snapToMagnetPin({ x: cx, y: cy }, canvasData.magnetPins ?? [], zoom);
                  if (pinSnap) {
                    useCanvasStore.getState().moveElement(memo.id, dx + pinSnap.dx, dy + pinSnap.dy);
                  } else {
                    useCanvasStore.getState().moveElement(memo.id, dx, dy);
                  }
                }
              }}
            >
              <Path
                data={getShapePath(memo.shape, w, h)}
                fill="rgba(55, 138, 221, 0.15)"
                stroke={isSelected ? '#FF6B35' : '#378ADD'}
                strokeWidth={isSelected ? 2.5 : 1.5}
                listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
                id={memo.id}
              />
              <Text
                x={0}
                y={0}
                width={w}
                height={h}
                text={memo.text}
                fontSize={fontSize * Math.min(scX, scY)}
                fill="#378ADD"
                align="center"
                verticalAlign="middle"
                listening={false}
              />
            </Group>
          );
        }

        // 旧式callout
        if (memo.style === 'callout' && memo.arrowTo) {
          const arrowX = memo.arrowTo.x * gridPx + panX;
          const arrowY = memo.arrowTo.y * gridPx + panY;
          return (
            <React.Fragment key={memo.id}>
              <Line
                points={[screenX, screenY, arrowX, arrowY]}
                stroke="#888780"
                strokeWidth={1}
                listening={false}
              />
              <Rect
                x={screenX - 4}
                y={screenY - fontSize - 4}
                width={memo.text.length * fontSize * 0.6 + 12}
                height={fontSize + 8}
                fill="#fffde7"
                stroke={isSelected ? '#378ADD' : '#ccc'}
                strokeWidth={isSelected ? 2 : 0.5}
                cornerRadius={4}
                listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
                id={memo.id}
              />
              <Text
                x={screenX + 2}
                y={screenY - fontSize}
                text={memo.text}
                fontSize={fontSize}
                fill="#333"
                listening={false}
              />
            </React.Fragment>
          );
        }

        // 旧式plain
        return (
          <Text
            key={memo.id}
            x={screenX}
            y={screenY}
            text={memo.text}
            fontSize={fontSize}
            fill={isSelected ? '#378ADD' : '#555'}
            listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
            id={memo.id}
            draggable={mode === 'select'}
            onDragStart={() => useCanvasStore.getState().pushHistory()}
            onDragEnd={(e) => {
              const dx = Math.round((e.target.x() - screenX) / gridPx);
              const dy = Math.round((e.target.y() - screenY) / gridPx);
              e.target.x(screenX); e.target.y(screenY);
              if (dx !== 0 || dy !== 0) {
                // Phase M-6b: 旧式 plain メモ — memo.x/y を refPoint として吸着
                const refX = memo.x + dx;
                const refY = memo.y + dy;
                const pinSnap = snapToMagnetPin({ x: refX, y: refY }, canvasData.magnetPins ?? [], zoom);
                if (pinSnap) {
                  useCanvasStore.getState().moveElement(memo.id, dx + pinSnap.dx, dy + pinSnap.dy);
                } else {
                  useCanvasStore.getState().moveElement(memo.id, dx, dy);
                }
              }
            }}
          />
        );
      })}
    </Layer>
  );
}
