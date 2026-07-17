'use client';

// ============================================================
// 屋根なぞり入力ツール（R-1e）: mode==='roof' で壁をなぞって屋根の対象辺を選ぶ。
//  ・全画面キャプチャ Rect でタップを受ける（RidgeLineLayer 式）。
//  ・壁の辺付近タップ → その辺を選択にトグル（同一建物のみ・別建物タップで選び直し）。
//  ・建物内部（辺から離れた所）タップ かつ 未選択 → 外周一周のワンタップ → 設定モーダル。
//  ・選択中の辺はハイライト表示。確定は編集画面の「確定」ボタン（roofDraftEdges を見て表示）。
// 既存屋根点線のタップ編集は BuildingLayer 側。
// ============================================================
import React from 'react';
import { Layer, Line, Rect } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPointInPolygon } from '@/lib/konva/autoLayoutUtils';
import { findClosestOutlineEdge } from '@/lib/konva/heightMarkerUtils';
import { toggleEdgeInRange, fullPerimeterEdgeRange } from '@/lib/konva/roofDraw';
import type { Point } from '@/types';

const ROOF_COLOR = '#888780';
const HILITE_COLOR = '#F59E0B';
const EDGE_HIT_PX = 18;

export default function RoofDrawLayer() {
  const {
    canvasData, zoom, panX, panY, canvasSize, mode,
    roofDraftEdges, setRoofDraftEdges, setRoofSettingsTarget,
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
    // 壁の辺付近か？（building.points 基準・R-1b の getOutlinePolygon＝壁線）
    const edgeHit = findClosestOutlineEdge(g, canvasData.buildings, EDGE_HIT_PX / gridPx);
    if (edgeHit) {
      const cur = roofDraftEdges;
      if (!cur || cur.buildingId !== edgeHit.buildingId) {
        setRoofDraftEdges({ buildingId: edgeHit.buildingId, edges: [edgeHit.edgeIndex] });
      } else {
        const edges = toggleEdgeInRange(cur.edges, edgeHit.edgeIndex);
        setRoofDraftEdges(edges.length ? { buildingId: cur.buildingId, edges } : null);
      }
      return;
    }
    // 辺から離れた建物内部タップ：未選択ならワンタップ外周一周。
    if (!roofDraftEdges) {
      const b = canvasData.buildings.find((bb) => isPointInPolygon(g.x, g.y, bb.points));
      if (b) setRoofSettingsTarget({ buildingId: b.id, edgeRange: fullPerimeterEdgeRange(b) });
    }
  };

  if (!active) return null;

  const draftBuilding = roofDraftEdges
    ? canvasData.buildings.find((b) => b.id === roofDraftEdges.buildingId)
    : undefined;

  return (
    <Layer>
      {canvasSize.width > 0 && (
        <Rect
          x={0} y={0} width={canvasSize.width} height={canvasSize.height}
          fill="transparent"
          onClick={handleTap}
          onTap={handleTap}
        />
      )}

      {/* 選択候補の全建物の壁を薄くなぞり可能に見せる（うっすら） */}
      {canvasData.buildings.map((b) => (
        <Line
          key={`roofdraw-outline-${b.id}`}
          points={b.points.flatMap((p) => [sx(p.x), sy(p.y)])}
          closed stroke={ROOF_COLOR} strokeWidth={1} dash={[4, 4]} opacity={0.3} listening={false}
        />
      ))}

      {/* 選択中の辺のハイライト */}
      {draftBuilding && roofDraftEdges?.edges.map((ei) => {
        const n = draftBuilding.points.length;
        const p1 = draftBuilding.points[ei];
        const p2 = draftBuilding.points[(ei + 1) % n];
        if (!p1 || !p2) return null;
        return (
          <Line
            key={`roofdraw-sel-${ei}`}
            points={[sx(p1.x), sy(p1.y), sx(p2.x), sy(p2.y)]}
            stroke={HILITE_COLOR} strokeWidth={4} lineCap="round" listening={false}
          />
        );
      })}
    </Layer>
  );
}
