'use client';

// ============================================================
// 平面図の追加部材レイヤー（階段・単管・P-1）。
//
// 既存の平面部材（ScaffoldLayer の手摺・支柱・アンチ）と同じ流儀で描く:
//   ・座標はグリッド（1 = 10mm）→ 画面 px は gridPx と pan で写す
//   ・listening / draggable / onDragEnd の条件も同じ（選択中だけ触れる）
//   ・移動は moveElement、複製モードなら addStair/addPipe で複製
// 幾何は lib/konva/planeParts.ts（pure）が唯一の定義。
// ============================================================
import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Layer, Line, Rect, Text, Arrow } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import {
  pipeEndpointsGrid, stairArrowGrid, stairFootprintGrid, stairTreadLinesGrid,
} from '@/lib/konva/planeParts';

/** 階段の色（現場の図面で使う灰系＋選択のオレンジ）。 */
const STAIR_FILL = '#9CA3AF';
const STAIR_STROKE = '#4B5563';
const STAIR_ARROW = '#1F2937';
/** 単管の色（鋼管の銀鼠）。 */
const PIPE_COLOR = '#6B7280';
const SELECT_COLOR = '#FF6B35';

export default function PlanePartLayer() {
  const canvasData = useCanvasStore((s) => s.canvasData);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const moveSelectIds = useCanvasStore((s) => s.moveSelectMode.selectedIds);
  const isDuplicateMode = useCanvasStore((s) => s.isDuplicateMode);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const selectActive = useCanvasStore((s) => s.selectActive);
  const selectLockParts = useCanvasStore((s) => s.selectLock.parts);

  const stairs = canvasData.stairs ?? [];
  const pipes = canvasData.pipes ?? [];
  if (stairs.length === 0 && pipes.length === 0) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectIds : selectedIds;
  // ScaffoldLayer と同じ条件（選択ON + ロック解除中、または入替モード中だけ触れる）
  const listenParts =
    (mode === 'select' && selectActive && !selectLockParts)
    || (mode === 'select' && isReorderMode);
  const listening = listenParts || mode === 'erase' || mode === 'move-select';

  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;

  /** ドラッグ確定（既存部材と同じ: グリッド単位に丸めて moveElement / 複製）。 */
  const dropHandler = (
    id: string, dup: (dx: number, dy: number) => void,
  ) => (e: Konva.KonvaEventObject<DragEvent>) => {
    const dx = Math.round(e.target.x() / gridPx);
    const dy = Math.round(e.target.y() / gridPx);
    e.target.x(0); e.target.y(0);
    if (dx === 0 && dy === 0) return;
    if (isDuplicateMode) dup(dx, dy);
    else useCanvasStore.getState().moveElement(id, dx, dy);
  };

  return (
    <Layer>
      {/* 階段: 段板の並んだ矩形 ＋ 上る方向の矢印 */}
      {stairs.map((stair) => {
        const { w, h } = stairFootprintGrid(stair.angleDeg);
        const isSelected = effectiveSelectedIds.includes(stair.id);
        const arrow = stairArrowGrid(stair);
        return (
          <React.Fragment key={stair.id}>
            <Rect
              x={sx(stair.x)} y={sy(stair.y)}
              width={w * gridPx} height={h * gridPx}
              fill={STAIR_FILL} opacity={0.9}
              stroke={isSelected ? SELECT_COLOR : STAIR_STROKE}
              strokeWidth={(isSelected ? 20 : 12) * zoom}
              id={stair.id}
              listening={listening}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onClick={() => useCanvasStore.getState().setSelectedIds([stair.id])}
              onTap={() => useCanvasStore.getState().setSelectedIds([stair.id])}
              onDragEnd={dropHandler(stair.id, (dx, dy) => useCanvasStore.getState().addStair({
                ...stair, id: uuidv4(), x: stair.x + dx, y: stair.y + dy,
              }))}
            />
            {/* 段板の区切り */}
            {stairTreadLinesGrid(stair).map((t, i) => (
              <Line
                key={`${stair.id}-t${i}`}
                points={[sx(t.x1), sy(t.y1), sx(t.x2), sy(t.y2)]}
                stroke={STAIR_STROKE} strokeWidth={8 * zoom} listening={false}
              />
            ))}
            {/* 上る方向（矢の先が上り側） */}
            <Arrow
              points={[sx(arrow.from.x), sy(arrow.from.y), sx(arrow.to.x), sy(arrow.to.y)]}
              stroke={STAIR_ARROW} fill={STAIR_ARROW}
              strokeWidth={14 * zoom} pointerLength={40 * zoom} pointerWidth={34 * zoom}
              listening={false}
            />
          </React.Fragment>
        );
      })}

      {/* 単管: 1 本の線 ＋ 長さ表示 */}
      {pipes.map((pipe) => {
        const [a, b] = pipeEndpointsGrid(pipe);
        const isSelected = effectiveSelectedIds.includes(pipe.id);
        return (
          <React.Fragment key={pipe.id}>
            <Line
              points={[sx(a.x), sy(a.y), sx(b.x), sy(b.y)]}
              stroke={isSelected ? SELECT_COLOR : PIPE_COLOR}
              strokeWidth={(isSelected ? 26 : 18) * zoom}
              lineCap="round"
              hitStrokeWidth={12}
              id={pipe.id}
              listening={listening}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onClick={() => useCanvasStore.getState().setSelectedIds([pipe.id])}
              onTap={() => useCanvasStore.getState().setSelectedIds([pipe.id])}
              onDragEnd={dropHandler(pipe.id, (dx, dy) => useCanvasStore.getState().addPipe({
                ...pipe, id: uuidv4(), x: pipe.x + dx, y: pipe.y + dy,
              }))}
            />
            <Text
              x={sx((a.x + b.x) / 2)} y={sy((a.y + b.y) / 2) - 16}
              text={`${pipe.lengthMm}`}
              fontSize={70 * zoom} fill={PIPE_COLOR}
              offsetX={20} listening={false}
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
}
