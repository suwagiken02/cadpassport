'use client';

// ============================================================
// 屋根モードのタップ入力（R-1e-fix7a・暫定）: mode==='roof' で建物をタップ → その建物の外周を
// 屋根領域として設定モーダルへ。※領域を描く入力（2F 作成と同じ turtle 流用）は fix7b で追加。
// 既存屋根点線のタップ編集は BuildingLayer 側。
// ============================================================
import React from 'react';
import { Layer, Line, Rect } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPointInPolygon } from '@/lib/konva/autoLayoutUtils';
import type { Point } from '@/types';

export default function RoofDrawLayer() {
  const { canvasData, zoom, panX, panY, canvasSize, mode, setRoofSettingsTarget } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;

  const handleTap = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const p = e.target.getStage()?.getPointerPosition();
    if (!p) return;
    const g: Point = { x: (p.x - panX) / gridPx, y: (p.y - panY) / gridPx };
    const b = canvasData.buildings.find((bb) => isPointInPolygon(g.x, g.y, bb.points));
    if (b) setRoofSettingsTarget({ buildingId: b.id, polygon: b.points.map((q) => ({ x: q.x, y: q.y })) });
  };

  if (mode !== 'roof') return null;

  return (
    <Layer>
      {canvasSize.width > 0 && (
        <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} fill="transparent" onClick={handleTap} onTap={handleTap} />
      )}
      {/* 屋根をかけられる建物を薄く縁取り */}
      {canvasData.buildings.map((b) => (
        <Line key={`roofpick-${b.id}`} points={b.points.flatMap((q) => [sx(q.x), sy(q.y)])}
          closed stroke="#888780" strokeWidth={1.5} dash={[6, 6]} opacity={0.4} listening={false} />
      ))}
    </Layer>
  );
}
