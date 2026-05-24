'use client';

import React, { useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Layer, Line, Circle, Rect, Text } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX, mmToGrid } from '@/lib/konva/gridUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';
import { getHandrailColor } from '@/lib/konva/handrailColors';
import { HandrailLengthMm } from '@/types';

const LINE_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
const TOL = 3;

export default function ScaffoldLayer() {
  const {
    canvasData, zoom, panX, panY, mode, selectedIds, moveSelectMode,
    isDuplicateMode, highlightIds, isReorderMode,
    isAreaDesignationMode, floorDesignation, toggleHandrailFloor,
  } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectMode.selectedIds : selectedIds;

  // 同一ラインごとにグループ化してカラーインデックスを割り当て
  const lineColorMap = useMemo(() => {
    if (!isReorderMode) return new Map<string, string>();
    const map = new Map<string, string>();
    const assigned = new Set<string>();
    let colorIdx = 0;

    for (const h of canvasData.handrails) {
      if (assigned.has(h.id)) continue;
      const isHoriz = h.direction === 'horizontal';
      const group = canvasData.handrails.filter(o =>
        isHoriz ? Math.abs(o.y - h.y) < TOL && o.direction === 'horizontal'
                : Math.abs(o.x - h.x) < TOL && o.direction !== 'horizontal'
      );
      if (group.length < 2) continue;
      const color = LINE_COLORS[colorIdx % LINE_COLORS.length];
      colorIdx++;
      for (const g of group) {
        map.set(g.id, color);
        assigned.add(g.id);
      }
    }
    return map;
  }, [isReorderMode, canvasData.handrails]);

  const handleHandrailClick = (hId: string) => {
    // 平米計算 1F足場指定モード: タップで個別反転 (= 平米計算 Phase D-2-c)
    if (isAreaDesignationMode) {
      toggleHandrailFloor(hId);
      return;
    }
    if (!isReorderMode) {
      // 通常の選択処理
      useCanvasStore.getState().setSelectedIds([hId]);
      return;
    }
    const h = canvasData.handrails.find(x => x.id === hId);
    if (!h) return;
    const isHoriz = h.direction === 'horizontal';
    const lineIds = canvasData.handrails
      .filter(o =>
        isHoriz ? Math.abs(o.y - h.y) < TOL && o.direction === 'horizontal'
                : Math.abs(o.x - h.x) < TOL && o.direction !== 'horizontal'
      )
      .map(o => o.id);
    if (lineIds.length >= 2) {
      useCanvasStore.getState().setSelectedLineIds(lineIds);
    }
  };

  return (
    <Layer>
      {/* アンチ（踏板） */}
      {canvasData.antis.map((anti) => {
        const w = anti.direction === 'horizontal' ? mmToGrid(anti.lengthMm) : mmToGrid(anti.width);
        const h = anti.direction === 'horizontal' ? mmToGrid(anti.width) : mmToGrid(anti.lengthMm);
        const isSelected = effectiveSelectedIds.includes(anti.id);

        return (
          <React.Fragment key={anti.id}>
            <Rect
              x={anti.x * gridPx + panX}
              y={anti.y * gridPx + panY}
              width={w * gridPx}
              height={h * gridPx}
              fill={anti.width === 400 ? '#F59E0B' : '#FCD34D'}
              opacity={0.85}
              cornerRadius={2}
              stroke={isSelected ? '#FF6B35' : (anti.width === 400 ? '#B45309' : '#A16207')}
              strokeWidth={isSelected ? 2 : 1.5}
              listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
              id={anti.id}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onDragEnd={(e) => {
                const dx = Math.round(e.target.x() / gridPx);
                const dy = Math.round(e.target.y() / gridPx);
                e.target.x(0); e.target.y(0);
                if (dx !== 0 || dy !== 0) {
                  if (isDuplicateMode) {
                    useCanvasStore.getState().addAnti({ ...anti, id: uuidv4(), x: anti.x + dx, y: anti.y + dy });
                  } else {
                    useCanvasStore.getState().moveElement(anti.id, dx, dy);
                  }
                }
              }}
            />
            {/* 内側の破線（境界線） */}
            <Line
              points={[
                (anti.x + 1) * gridPx + panX,
                (anti.y + (anti.direction === 'horizontal' ? h / 2 : 1)) * gridPx + panY,
                (anti.x + w - 1) * gridPx + panX,
                (anti.y + (anti.direction === 'horizontal' ? h / 2 : h - 1)) * gridPx + panY,
              ]}
              stroke="#b8860b"
              strokeWidth={0.5}
              dash={[3, 3]}
              listening={false}
            />
          </React.Fragment>
        );
      })}

      {/* 手摺 */}
      {canvasData.handrails.map((h) => {
        const [start, end] = getHandrailEndpoints(h);
        const isSelected = effectiveSelectedIds.includes(h.id);
        const isHighlighted = highlightIds.includes(h.id);
        const defaultColor = getHandrailColor(h.lengthMm as HandrailLengthMm);
        const lineColor = lineColorMap.get(h.id);
        // 平米計算 1F足場指定モード: 1F 指定済 Handrail は amber 強調 (= 平米計算 Phase D-2-c)
        const is1F = isAreaDesignationMode && floorDesignation[h.id] === 1;
        const color = is1F
          ? '#f59e0b'
          : isHighlighted ? '#FF6B35'
          : isSelected ? '#FF6B35'
          : (lineColor || defaultColor);
        const strokeWidth = (isHighlighted ? 5 : lineColor ? 4 : 3) + (is1F ? 1 : 0);

        return (
          <React.Fragment key={h.id}>
            <Line
              points={[
                start.x * gridPx + panX,
                start.y * gridPx + panY,
                end.x * gridPx + panX,
                end.y * gridPx + panY,
              ]}
              stroke={color}
              strokeWidth={strokeWidth}
              lineCap="round"
              hitStrokeWidth={isReorderMode || isAreaDesignationMode ? 30 : 10}
              listening={true}
              id={h.id}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onClick={() => handleHandrailClick(h.id)}
              onTap={() => handleHandrailClick(h.id)}
              onDragEnd={(e) => {
                const dx = Math.round(e.target.x() / gridPx);
                const dy = Math.round(e.target.y() / gridPx);
                e.target.x(0); e.target.y(0);
                if (dx !== 0 || dy !== 0) {
                  if (isDuplicateMode) {
                    useCanvasStore.getState().addHandrail({ ...h, id: uuidv4(), x: h.x + dx, y: h.y + dy });
                  } else {
                    useCanvasStore.getState().moveElement(h.id, dx, dy);
                  }
                }
              }}
            />
            {/* 両端の●マーク */}
            <Circle
              x={start.x * gridPx + panX}
              y={start.y * gridPx + panY}
              radius={3}
              fill={lineColor || defaultColor}
              listening={false}
            />
            <Circle
              x={end.x * gridPx + panX}
              y={end.y * gridPx + panY}
              radius={3}
              fill={lineColor || defaultColor}
              listening={false}
            />
            {/* 1800mm以外は長さテキスト表示 */}
            {h.lengthMm !== 1800 && (() => {
              const lengthGrid = mmToGrid(h.lengthMm);
              const isH = h.direction === 'horizontal';
              const midX = (h.x + (isH ? lengthGrid / 2 : 0)) * gridPx + panX;
              const midY = (h.y + (isH ? 0 : lengthGrid / 2)) * gridPx + panY;
              const offsetPx = isH ? -14 : -4;
              return (
                <Text
                  x={isH ? midX : midX + offsetPx}
                  y={isH ? midY + offsetPx : midY}
                  text={String(h.lengthMm)}
                  fontSize={10}
                  fill={lineColor || defaultColor}
                  align={isH ? 'center' : 'right'}
                  offsetX={isH ? 15 : 30}
                  listening={false}
                />
              );
            })()}
          </React.Fragment>
        );
      })}

      {/* 支柱 */}
      {canvasData.posts.map((p) => {
        const isSelected = effectiveSelectedIds.includes(p.id);
        return (
          <React.Fragment key={p.id}>
            <Circle
              x={p.x * gridPx + panX}
              y={p.y * gridPx + panY}
              radius={8}
              fill="#2c2c2a"
              stroke={isSelected ? '#FF6B35' : '#2c2c2a'}
              strokeWidth={isSelected ? 2 : 0}
              listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
              id={p.id}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onDragEnd={(e) => {
                const dx = Math.round(e.target.x() / gridPx);
                const dy = Math.round(e.target.y() / gridPx);
                e.target.x(0); e.target.y(0);
                if (dx !== 0 || dy !== 0) {
                  if (isDuplicateMode) {
                    useCanvasStore.getState().addPost({ ...p, id: uuidv4(), x: p.x + dx, y: p.y + dy });
                  } else {
                    useCanvasStore.getState().moveElement(p.id, dx, dy);
                  }
                }
              }}
            />
            <Circle
              x={p.x * gridPx + panX}
              y={p.y * gridPx + panY}
              radius={3}
              fill="white"
              listening={false}
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
}
