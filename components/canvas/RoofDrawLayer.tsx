'use client';

// ============================================================
// 屋根「キャラ歩き」入力（R-1e-fix2）: mode==='roof' で壁の上をキャラで歩いて屋根区間を決める。
//  ・壁の上をタップ → 始点（辺途中も可）。その位置にキャラ＋方向キー（壁方向入力と同じ DirectionPad）。
//  ・方向キー押下 → その方向に壁が続いていれば次の頂点まで（距離入力があればその距離）進む。
//    壁の無い方向のキーは非表示（walkDirectionsAt で判定）。◀方向に戻ると区間が縮む。
//  ・建物内部（辺から離れた所）タップ かつ 未歩行 → 外周一周ワンタップ → 設定モーダル。
//  ・歩いた弧をハイライト。確定は editor の「確定」ボタン。既存屋根点線のタップ編集は BuildingLayer。
// ============================================================
import React from 'react';
import { Layer, Line, Rect } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPointInPolygon } from '@/lib/konva/autoLayoutUtils';
import { findClosestOutlineEdge } from '@/lib/konva/heightMarkerUtils';
import { getAllExistingVertices } from '@/lib/konva/snapUtils';
import { posToArc, pointAtArc, spanPolylinePoints, fullSpan, walkDirectionsAt, stepToVertex, perimeterGrid, snapArcToVertex } from '@/lib/konva/roofSpan';
import { walkToSpan } from '@/lib/konva/roofDraw';
import DirectionPad, { type PadDir } from './DirectionPad';
import type { Point } from '@/types';

const HILITE_COLOR = '#F59E0B';
const GUIDE_COLOR = '#F97316';
const EDGE_HIT_PX = 18;
const VERTEX_SNAP_PX = 22;

export default function RoofDrawLayer() {
  const {
    canvasData, zoom, panX, panY, canvasSize, mode,
    roofWalk, setRoofWalk, roofWalkStepMm, setRoofSettingsTarget,
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
      // 角付近タップは頂点へ吸着（角で正しい2方向を出す・R-1e-fix3）。辺の中央付近はそのまま辺途中に置ける。
      const arc = snapArcToVertex(b, posToArc(b, edgeHit.edgeIndex, edgeHit.t), VERTEX_SNAP_PX / gridPx);
      setRoofWalk({ buildingId: b.id, startArc: arc, endArc: arc }); // 始点（キャラ出現）
      return;
    }
    if (!roofWalk) {
      const b = canvasData.buildings.find((bb) => isPointInPolygon(g.x, g.y, bb.points));
      if (b) setRoofSettingsTarget({ buildingId: b.id, span: fullSpan() });
    }
  };

  const walkBuilding = roofWalk ? canvasData.buildings.find((b) => b.id === roofWalk.buildingId) : undefined;

  const handleWalk = (compass: PadDir) => {
    if (!roofWalk || !walkBuilding) return;
    const dirs = walkDirectionsAt(walkBuilding, roofWalk.endArc);
    const match = dirs.find((d) => d.compass === compass);
    if (!match) return; // その方向に壁は続かない
    const perim = perimeterGrid(walkBuilding);
    const step = roofWalkStepMm > 0 ? roofWalkStepMm / 10 : stepToVertex(walkBuilding, roofWalk.endArc, match.arcDir);
    let newEnd = roofWalk.endArc + match.arcDir * step;
    newEnd = Math.max(roofWalk.startArc - perim, Math.min(roofWalk.startArc + perim, newEnd)); // ±全周にクランプ
    setRoofWalk({ ...roofWalk, endArc: newEnd });
  };

  if (!active) return null;

  // ハイライト区間（start と end の間・forward）。
  const covered = roofWalk && walkBuilding
    ? spanPolylinePoints(walkBuilding, walkToSpan(walkBuilding, Math.min(roofWalk.startArc, roofWalk.endArc), Math.max(roofWalk.startArc, roofWalk.endArc)))
    : [];
  const charPt = roofWalk && walkBuilding ? pointAtArc(walkBuilding, roofWalk.endArc) : null;
  const enabled = roofWalk && walkBuilding ? walkDirectionsAt(walkBuilding, roofWalk.endArc) : [];
  const facing: PadDir = enabled.find((d) => d.arcDir === 1)?.compass ?? 'up';

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

      {/* 交点ガイド（歩行中・壁方向入力と同じオレンジ破線。全頂点のユニーク X/Y の延長線）R-1e-fix3 */}
      {roofWalk && (() => {
        const verts = getAllExistingVertices(canvasData.buildings, canvasData.obstacles);
        const xs = Array.from(new Set(verts.map((v) => v.x)));
        const ys = Array.from(new Set(verts.map((v) => v.y)));
        return (
          <>
            {xs.map((gx, i) => { const X = sx(gx); return (X < -10 || X > canvasSize.width + 10) ? null : (
              <Line key={`rg-x-${i}`} points={[X, 0, X, canvasSize.height]} stroke={GUIDE_COLOR} strokeWidth={1} opacity={0.5} dash={[6, 6]} listening={false} />); })}
            {ys.map((gy, i) => { const Y = sy(gy); return (Y < -10 || Y > canvasSize.height + 10) ? null : (
              <Line key={`rg-y-${i}`} points={[0, Y, canvasSize.width, Y]} stroke={GUIDE_COLOR} strokeWidth={1} opacity={0.5} dash={[6, 6]} listening={false} />); })}
          </>
        );
      })()}

      {/* 歩いた区間のハイライト */}
      {covered.length >= 2 && (
        <Line points={covered.flatMap((p) => [sx(p.x), sy(p.y)])} stroke={HILITE_COLOR} strokeWidth={4} lineCap="round" lineJoin="round" listening={false} />
      )}

      {/* キャラ＋方向キー（壁が続く方向のみ有効・DirectionPad 流用） */}
      {charPt && (
        <DirectionPad x={sx(charPt.x)} y={sy(charPt.y)} facing={facing} enabled={enabled.map((d) => d.compass)} onDirection={handleWalk} />
      )}
    </Layer>
  );
}
