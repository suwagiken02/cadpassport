'use client';

import React, { useState } from 'react';
import { Layer, Rect, Circle, Text, Line } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX, gridToMm } from '@/lib/konva/gridUtils';
import { snapObstacleToWall, snapToMagnetPin } from '@/lib/konva/snapUtils';
import { ObstacleType, Obstacle, BuildingShape, Point } from '@/types';

const OBSTACLE_COLORS: Record<ObstacleType, string> = {
  ecocute: '#B5D4F4',
  aircon: '#C0DD97',
  bay_window: '#FAC775',
  carport: '#7B6DE8',
  sunroom: '#F5C4B3',
  balcony: '#5C4A33',
  custom_rect: '#D3D1C7',
  custom_circle: '#D3D1C7',
};

const OBSTACLE_LABELS: Record<ObstacleType, string> = {
  ecocute: 'エコキュート',
  aircon: '室外機',
  bay_window: '出窓',
  carport: 'カーポート',
  sunroom: 'サンルーム',
  balcony: 'バルコニー',
  custom_rect: '',
  custom_circle: '',
};

/**
 * 障害物が建物のどの壁辺に吸着しているかを検出する。
 * 障害物の 4 辺のいずれかが建物の辺と軸並行 + 同 X or 同 Y + 範囲内で
 * 一致すれば、 その建物辺の端点 (= p1, p2) を返す。 軸並行ではない壁
 * (= 斜め壁) は対象外 (= Phase 1 では矩形/L字建物前提)。
 */
function findWallEdgeForObstacle(
  obs: { x: number; y: number; width: number; height: number },
  buildings: BuildingShape[],
): { p1: Point; p2: Point; isHorizontal: boolean } | null {
  const TOL = 0.5;
  const obstacleEdges = [
    { isH: true, fixed: obs.y, min: obs.x, max: obs.x + obs.width },
    { isH: true, fixed: obs.y + obs.height, min: obs.x, max: obs.x + obs.width },
    { isH: false, fixed: obs.x, min: obs.y, max: obs.y + obs.height },
    { isH: false, fixed: obs.x + obs.width, min: obs.y, max: obs.y + obs.height },
  ];

  for (const oe of obstacleEdges) {
    for (const b of buildings) {
      const pts = b.points;
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const beIsH = Math.abs(p1.y - p2.y) < TOL;
        const beIsV = Math.abs(p1.x - p2.x) < TOL;

        if (oe.isH && beIsH && Math.abs(oe.fixed - p1.y) < TOL) {
          const beMin = Math.min(p1.x, p2.x);
          const beMax = Math.max(p1.x, p2.x);
          if (oe.min >= beMin - TOL && oe.max <= beMax + TOL) {
            return { p1, p2, isHorizontal: true };
          }
        } else if (!oe.isH && beIsV && Math.abs(oe.fixed - p1.x) < TOL) {
          const beMin = Math.min(p1.y, p2.y);
          const beMax = Math.max(p1.y, p2.y);
          if (oe.min >= beMin - TOL && oe.max <= beMax + TOL) {
            return { p1, p2, isHorizontal: false };
          }
        }
      }
    }
  }
  return null;
}

export default function ObstacleLayer() {
  const { canvasData, zoom, panX, panY, mode, selectedIds, moveSelectMode, obstaclePreview } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;

  // ドラッグ中の壁吸着距離表示用 (= 投影スナップ位置 + 壁辺端点)
  const [dragInfo, setDragInfo] = useState<{
    obs: Obstacle;
    snappedX: number;
    snappedY: number;
    wallP1: Point;
    wallP2: Point;
    isHorizontalWall: boolean;
  } | null>(null);

  // ドラッグ中、 投影スナップ位置で壁辺検出 → dragInfo 更新 (= リアルタイム再計算)
  const updateDragInfo = (curX: number, curY: number, obs: Obstacle) => {
    const cx = curX + obs.width / 2;
    const cy = curY + obs.height / 2;
    const snapped = snapObstacleToWall({ x: cx, y: cy }, obs.width, obs.height, canvasData.buildings);
    if (!snapped) {
      if (dragInfo) setDragInfo(null);
      return;
    }
    const wallEdge = findWallEdgeForObstacle(
      { x: snapped.x, y: snapped.y, width: obs.width, height: obs.height },
      canvasData.buildings,
    );
    if (!wallEdge) {
      if (dragInfo) setDragInfo(null);
      return;
    }
    setDragInfo({
      obs,
      snappedX: snapped.x,
      snappedY: snapped.y,
      wallP1: wallEdge.p1,
      wallP2: wallEdge.p2,
      isHorizontalWall: wallEdge.isHorizontal,
    });
  };
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectMode.selectedIds : selectedIds;

  /**
   * Phase M-6a-corner-fix: 障害物のピン吸着を「最近傍角」方式に変更。
   * - rect / polygon: 全角 × 全ピン から最良補正の組み合わせを選び、その角がピンに重なる
   * - custom_circle: 角の概念がないため中心吸着のまま維持
   * 壁吸着との優先順は M-6a 同様、補正距離が小さい方を採用。
   */
  const getCornersForObstacle = (obs: Obstacle): { x: number; y: number }[] => {
    if (obs.type === 'custom_circle') {
      // 円形は中心1点を refPoint として返す（既存仕様維持）
      return [{ x: obs.x + obs.width / 2, y: obs.y + obs.height / 2 }];
    }
    if (obs.points && obs.points.length >= 3) {
      // polygon: points は absolute グリッド座標
      return obs.points.map(p => ({ x: p.x, y: p.y }));
    }
    // rect: 左上/右上/右下/左下
    return [
      { x: obs.x, y: obs.y },
      { x: obs.x + obs.width, y: obs.y },
      { x: obs.x + obs.width, y: obs.y + obs.height },
      { x: obs.x, y: obs.y + obs.height },
    ];
  };

  const finalizeMove = (dx: number, dy: number, obs: Obstacle) => {
    // ピン吸着優先: 全角 × 全ピン から最良補正を探す
    const pins = canvasData.magnetPins ?? [];
    const corners = getCornersForObstacle(obs);
    let bestPinSnap: { dx: number; dy: number; pinId: string } | null = null;
    let bestPinCorrection = Infinity;
    for (const corner of corners) {
      const newCorner = { x: corner.x + dx, y: corner.y + dy };
      const snap = snapToMagnetPin(newCorner, pins, zoom);
      if (snap) {
        const corr = Math.hypot(snap.dx, snap.dy);
        if (corr < bestPinCorrection) {
          bestPinCorrection = corr;
          bestPinSnap = snap;
        }
      }
    }
    if (bestPinSnap) {
      // ピン優先: 壁吸着は無視
      useCanvasStore.getState().moveElement(obs.id, dx + bestPinSnap.dx, dy + bestPinSnap.dy);
      return;
    }

    // ピン圏外: 従来通り壁吸着を評価
    const newCx = obs.x + dx + obs.width / 2;
    const newCy = obs.y + dy + obs.height / 2;
    const wallSnapped = snapObstacleToWall({ x: newCx, y: newCy }, obs.width, obs.height, canvasData.buildings);
    if (wallSnapped) {
      useCanvasStore.getState().moveElement(obs.id, wallSnapped.x - obs.x, wallSnapped.y - obs.y);
      return;
    }

    // 両方なし: 通常移動
    useCanvasStore.getState().moveElement(obs.id, dx, dy);
  };

  return (
    <Layer>
      {canvasData.obstacles.map((obs) => {
        const isSelected = effectiveSelectedIds.includes(obs.id);
        const color = OBSTACLE_COLORS[obs.type];
        const label = obs.label || OBSTACLE_LABELS[obs.type];
        const isCarport = obs.type === 'carport';
        // 上層階張り出し構造 (= carport / balcony): 破線輪郭 + 透明 fill で「足元障害物ではない」を表現
        const isElevated = isCarport || obs.type === 'balcony';
        const screenX = obs.x * gridPx + panX;
        const screenY = obs.y * gridPx + panY;
        const w = obs.width * gridPx;
        const h = obs.height * gridPx;

        // ポリゴン障害物
        if (obs.points && obs.points.length >= 3) {
          const flatPts = obs.points.flatMap(p => [p.x * gridPx + panX, p.y * gridPx + panY]);
          return (
            <React.Fragment key={obs.id}>
              <Line
                points={flatPts}
                closed
                fill={color}
                opacity={0.7}
                stroke={isSelected ? '#378ADD' : '#999'}
                strokeWidth={isSelected ? 2 : 1}
                listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
                id={obs.id}
                draggable={mode === 'select'}
                onDragStart={() => useCanvasStore.getState().pushHistory()}
                onDragEnd={(e) => {
                  const dx = Math.round(e.target.x() / gridPx);
                  const dy = Math.round(e.target.y() / gridPx);
                  e.target.x(0); e.target.y(0);
                  if (dx !== 0 || dy !== 0) {
                    finalizeMove(dx, dy, obs);
                  }
                }}
              />
              {label && (() => {
                const cx = obs.points!.reduce((s, p) => s + p.x, 0) / obs.points!.length;
                const cy = obs.points!.reduce((s, p) => s + p.y, 0) / obs.points!.length;
                return (
                  <Text
                    x={cx * gridPx + panX}
                    y={cy * gridPx + panY}
                    text={label}
                    fontSize={Math.max(8, 9 * zoom)}
                    fill="#333"
                    offsetX={label.length * Math.max(8, 9 * zoom) * 0.3}
                    offsetY={Math.max(8, 9 * zoom) / 2}
                    listening={false}
                  />
                );
              })()}
            </React.Fragment>
          );
        }

        if (obs.type === 'custom_circle') {
          const r = Math.max(w, h) / 2;
          return (
            <React.Fragment key={obs.id}>
              <Circle
                x={screenX + r}
                y={screenY + r}
                radius={r}
                fill={color}
                opacity={0.7}
                stroke={isSelected ? '#378ADD' : '#999'}
                strokeWidth={isSelected ? 2 : 0.5}
                listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
                id={obs.id}
                draggable={mode === 'select'}
                onDragStart={() => useCanvasStore.getState().pushHistory()}
                onDragEnd={(e) => {
                  const origX = screenX + r;
                  const origY = screenY + r;
                  const dx = Math.round((e.target.x() - origX) / gridPx);
                  const dy = Math.round((e.target.y() - origY) / gridPx);
                  e.target.x(origX); e.target.y(origY);
                  if (dx !== 0 || dy !== 0) {
                    finalizeMove(dx, dy, obs);
                  }
                }}
              />
              {label && (
                <Text
                  x={screenX}
                  y={screenY + r - 5}
                  width={w}
                  align="center"
                  text={label}
                  fontSize={Math.max(8, 9 * zoom)}
                  fill="#333"
                  listening={false}
                />
              )}
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={obs.id}>
            <Rect
              x={screenX}
              y={screenY}
              width={w}
              height={h}
              fill={isElevated ? 'transparent' : color}
              opacity={0.7}
              stroke={isSelected ? '#378ADD' : isElevated ? color : '#999'}
              strokeWidth={isSelected ? 2 : isElevated ? 1.5 : 0.5}
              dash={isElevated ? [8, 4] : undefined}
              listening={mode === 'select' || mode === 'erase' || mode === 'move-select'}
              id={obs.id}
              draggable={mode === 'select'}
              onDragStart={() => useCanvasStore.getState().pushHistory()}
              onDragMove={(e) => {
                const curX = obs.x + (e.target.x() - screenX) / gridPx;
                const curY = obs.y + (e.target.y() - screenY) / gridPx;
                updateDragInfo(curX, curY, obs);
              }}
              onDragEnd={(e) => {
                const dx = Math.round((e.target.x() - screenX) / gridPx);
                const dy = Math.round((e.target.y() - screenY) / gridPx);
                e.target.x(screenX); e.target.y(screenY);
                setDragInfo(null);
                if (dx !== 0 || dy !== 0) {
                  finalizeMove(dx, dy, obs);
                }
              }}
            />
            {label && (
              <Text
                x={screenX + 2}
                y={screenY + 2}
                text={label}
                fontSize={Math.max(8, 9 * zoom)}
                fill="#333"
                listening={false}
              />
            )}
          </React.Fragment>
        );
      })}
      {/* 壁吸着中の距離ラベル (= 既存配置移動 + 新規配置プレビュー両方、 rect 障害物のみ対応、 Task #3 修正) */}
      {(() => {
        // 表示ソース選択: dragInfo (= 既存配置の移動) 優先、
        // なければ obstaclePreview (= 新規配置中) を吸着判定。
        // PartSelector が既に snapObstacleToWall を適用しているので、
        // 吸着時のみ findWallEdgeForObstacle が非 null を返す。
        let snappedX: number, snappedY: number, width: number, height: number;
        let wallP1: Point, wallP2: Point, isHorizontalWall: boolean;
        if (dragInfo) {
          snappedX = dragInfo.snappedX;
          snappedY = dragInfo.snappedY;
          width = dragInfo.obs.width;
          height = dragInfo.obs.height;
          wallP1 = dragInfo.wallP1;
          wallP2 = dragInfo.wallP2;
          isHorizontalWall = dragInfo.isHorizontalWall;
        } else if (obstaclePreview) {
          const wallEdge = findWallEdgeForObstacle(
            {
              x: obstaclePreview.x,
              y: obstaclePreview.y,
              width: obstaclePreview.widthGrid,
              height: obstaclePreview.heightGrid,
            },
            canvasData.buildings,
          );
          if (!wallEdge) return null;
          snappedX = obstaclePreview.x;
          snappedY = obstaclePreview.y;
          width = obstaclePreview.widthGrid;
          height = obstaclePreview.heightGrid;
          wallP1 = wallEdge.p1;
          wallP2 = wallEdge.p2;
          isHorizontalWall = wallEdge.isHorizontal;
        } else {
          return null;
        }

        const fs = Math.max(11, 13 * zoom);
        const color = '#E85D3A';
        if (isHorizontalWall) {
          const wallY = wallP1.y;
          const wallMinX = Math.min(wallP1.x, wallP2.x);
          const wallMaxX = Math.max(wallP1.x, wallP2.x);
          const obsLeftX = snappedX;
          const obsRightX = snappedX + width;
          const distLeftMm = Math.round(gridToMm(obsLeftX - wallMinX));
          const distRightMm = Math.round(gridToMm(wallMaxX - obsRightX));
          const labelLeftXGrid = (wallMinX + obsLeftX) / 2;
          const labelRightXGrid = (obsRightX + wallMaxX) / 2;
          const yPx = wallY * gridPx + panY - fs - 2;
          return (
            <>
              <Text x={labelLeftXGrid * gridPx + panX} y={yPx}
                text={`${distLeftMm}`} fontSize={fs} fontStyle="bold"
                fill={color} align="center" offsetX={fs * 1.5} listening={false} />
              <Text x={labelRightXGrid * gridPx + panX} y={yPx}
                text={`${distRightMm}`} fontSize={fs} fontStyle="bold"
                fill={color} align="center" offsetX={fs * 1.5} listening={false} />
            </>
          );
        } else {
          const wallX = wallP1.x;
          const wallMinY = Math.min(wallP1.y, wallP2.y);
          const wallMaxY = Math.max(wallP1.y, wallP2.y);
          const obsTopY = snappedY;
          const obsBottomY = snappedY + height;
          const distTopMm = Math.round(gridToMm(obsTopY - wallMinY));
          const distBottomMm = Math.round(gridToMm(wallMaxY - obsBottomY));
          const labelTopYGrid = (wallMinY + obsTopY) / 2;
          const labelBottomYGrid = (obsBottomY + wallMaxY) / 2;
          const xPx = wallX * gridPx + panX + 4;
          return (
            <>
              <Text x={xPx} y={labelTopYGrid * gridPx + panY - fs / 2}
                text={`${distTopMm}`} fontSize={fs} fontStyle="bold"
                fill={color} listening={false} />
              <Text x={xPx} y={labelBottomYGrid * gridPx + panY - fs / 2}
                text={`${distBottomMm}`} fontSize={fs} fontStyle="bold"
                fill={color} listening={false} />
            </>
          );
        }
      })()}
    </Layer>
  );
}
