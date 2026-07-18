'use client';

// ============================================================
// 屋根「キャラ歩き」入力（R-1e-fix）: mode==='roof' で壁の上を歩いて屋根区間を決める。
//  ・壁の上をタップ → 始点（頂点・辺中点スナップは findClosestOutlineEdge の t、辺途中も可）。
//    roofWalk = {startArc, endArc=startArc} を張る。以降は編集画面の 進む/戻る/確定 で伸縮。
//  ・建物内部（辺から離れた所）タップ かつ 未歩行 → 外周一周ワンタップ → 設定モーダル。
//  ・歩いた弧（start→end）をハイライト表示。
// 進む/戻る/確定ボタンは editor 側（walk の arc を更新）。既存屋根点線のタップ編集は BuildingLayer。
// ============================================================
import React from 'react';
import { Layer, Line, Rect, Circle } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPointInPolygon } from '@/lib/konva/autoLayoutUtils';
import { findClosestOutlineEdge } from '@/lib/konva/heightMarkerUtils';
import { posToArc, arcToPos, spanPolylinePoints, fullSpan } from '@/lib/konva/roofSpan';
import { walkToSpan } from '@/lib/konva/roofDraw';
import type { Point } from '@/types';

const HILITE_COLOR = '#F59E0B';
const EDGE_HIT_PX = 18;

export default function RoofDrawLayer() {
  const {
    canvasData, zoom, panX, panY, canvasSize, mode,
    roofWalk, setRoofWalk, setRoofSettingsTarget,
  } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const active = mode === 'roof';

  const toGrid = (px: number, py: number): Point => ({ x: (px - panX) / gridPx, y: (py - panY) / gridPx });
  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;

  const pointerGrid = (e: Konva.KonvaEventObject<unknown>): Point | null => {
    const p = e.target.getStage()?.getPointerPosition();
    return p ? toGrid(p.x, p.y) : null;
  };

  const handleTap = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const g = pointerGrid(e);
    if (!g) return;
    const edgeHit = findClosestOutlineEdge(g, canvasData.buildings, EDGE_HIT_PX / gridPx);
    if (edgeHit) {
      const b = canvasData.buildings.find((bb) => bb.id === edgeHit.buildingId);
      if (!b) return;
      const arc = posToArc(b, edgeHit.edgeIndex, edgeHit.t);
      setRoofWalk({ buildingId: b.id, startArc: arc, endArc: arc }); // 始点（ゼロ長）で歩行開始
      return;
    }
    // 辺から離れた建物内部タップ：未歩行ならワンタップ外周一周。
    if (!roofWalk) {
      const b = canvasData.buildings.find((bb) => isPointInPolygon(g.x, g.y, bb.points));
      if (b) setRoofSettingsTarget({ buildingId: b.id, span: fullSpan() });
    }
  };

  if (!active) return null;

  const walkBuilding = roofWalk ? canvasData.buildings.find((b) => b.id === roofWalk.buildingId) : undefined;
  const covered = roofWalk && walkBuilding
    ? spanPolylinePoints(walkBuilding, walkToSpan(walkBuilding, roofWalk.startArc, roofWalk.endArc))
    : [];
  const startPt = roofWalk && walkBuilding ? (() => {
    const pos = arcToPos(walkBuilding, roofWalk.startArc);
    const n = walkBuilding.points.length;
    const a = walkBuilding.points[pos.edge], b = walkBuilding.points[(pos.edge + 1) % n];
    return { x: a.x + (b.x - a.x) * pos.t, y: a.y + (b.y - a.y) * pos.t };
  })() : null;
  const r = Math.max(4, 5 * zoom);

  return (
    <Layer>
      {canvasSize.width > 0 && (
        <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} fill="transparent" onClick={handleTap} onTap={handleTap} />
      )}

      {/* 選択候補の壁を薄く見せる */}
      {canvasData.buildings.map((b) => (
        <Line key={`roofdraw-outline-${b.id}`} points={b.points.flatMap((p) => [sx(p.x), sy(p.y)])}
          closed stroke="#888780" strokeWidth={1} dash={[4, 4]} opacity={0.3} listening={false} />
      ))}

      {/* 歩いた区間のハイライト */}
      {covered.length >= 2 && (
        <Line points={covered.flatMap((p) => [sx(p.x), sy(p.y)])} stroke={HILITE_COLOR} strokeWidth={4} lineCap="round" lineJoin="round" listening={false} />
      )}
      {/* 始点マーカー */}
      {startPt && <Circle x={sx(startPt.x)} y={sy(startPt.y)} radius={r} fill={HILITE_COLOR} listening={false} />}
    </Layer>
  );
}
