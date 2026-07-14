'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Layer, Circle, Text, Rect } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import {
  getOutlinePolygon,
  projectPointToOutline,
  snapToCorners,
  snapToMidpointIfNear,
} from '@/lib/konva/heightMarkerUtils';

const MARKER_COLOR = '#378ADD';
const LONG_PRESS_MS = 300;
const SNAP_PX = 10;
const PRESS_MOVE_THRESHOLD_PX = 10;
const MIDPOINT_SNAP_PX = 10;

type DragInfo = {
  markerId: string;
  edgeIndex: number;
  t: number;
};

export default function HeightMarkerLayer() {
  const { canvasData, zoom, panX, panY, setHeightInputMarkerId, moveHeightMarker, isHeightMarkerMode } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const markers = canvasData.heightMarkers ?? [];

  const layerRef = useRef<Konva.Layer>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const wasDraggingRef = useRef(false);
  const dragMarkerIdRef = useRef<string | null>(null);
  const dragInfoRef = useRef<DragInfo | null>(null);
  // mouse: 押下したマーカー（移動が閾値を超えたら初めてドラッグ化。移動なしの click は編集モーダル）
  const mousePendingRef = useRef<{ id: string; edgeIndex: number; t: number } | null>(null);

  // ドラッグ中の論理位置 (= 視覚フィードバック用 state、 dragEnd で 1 回 store 確定)
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  // 中点 ◇ ハイライト用ポインタ screen 位置 (= ドラッグ中のみ更新、 通常時は null)
  const [pointerScreenPos, setPointerScreenPos] = useState<{ x: number; y: number } | null>(null);

  const updateDragInfo = (info: DragInfo | null) => {
    dragInfoRef.current = info;
    setDragInfo(info);
  };

  // Stage の pointermove / pointerup を購読 (= GridCanvas 触らず Layer 内で完結)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const stage = layer.getStage();
    if (!stage) return;

    const onStagePointerMove = () => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // 長押し成立前: 移動量で長押しキャンセル判定
      if (longPressTimerRef.current && pressStartPosRef.current) {
        const dist = Math.hypot(
          pointer.x - pressStartPosRef.current.x,
          pointer.y - pressStartPosRef.current.y,
        );
        if (dist > PRESS_MOVE_THRESHOLD_PX) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          pressStartPosRef.current = null;
        }
      }

      // mouse: 押下後、移動が閾値を超えたら初めてドラッグ開始 (= click と drag を区別。
      //   click(移動なし)は onCircleClick で編集モーダルを開く)
      if (mousePendingRef.current && pressStartPosRef.current && !isDraggingRef.current) {
        const dist = Math.hypot(
          pointer.x - pressStartPosRef.current.x,
          pointer.y - pressStartPosRef.current.y,
        );
        if (dist > PRESS_MOVE_THRESHOLD_PX) {
          const m = mousePendingRef.current;
          isDraggingRef.current = true;
          dragMarkerIdRef.current = m.id;
          updateDragInfo({ markerId: m.id, edgeIndex: m.edgeIndex, t: m.t });
          mousePendingRef.current = null;
        }
      }

      // 長押し成立後 (= ドラッグ中): 射影 + 角スナップ + 中点 ◇ ハイライト用 pointer 位置更新
      if (isDraggingRef.current && dragMarkerIdRef.current) {
        // 中点 ◇ ハイライト用 (= 中点スナップ自体はドラッグ中は適用しない、 stuck 回避)
        setPointerScreenPos({ x: pointer.x, y: pointer.y });

        const marker = (canvasData.heightMarkers ?? []).find((m) => m.id === dragMarkerIdRef.current);
        if (!marker) return;
        const building = canvasData.buildings.find((b) => b.id === marker.buildingId);
        if (!building) return;
        const pointGrid = {
          x: (pointer.x - panX) / gridPx,
          y: (pointer.y - panY) / gridPx,
        };
        const outline = getOutlinePolygon(building);
        const projected = projectPointToOutline(pointGrid, building);
        const snapToleranceGrid = SNAP_PX / gridPx;
        const snapped = snapToCorners(projected.edgeIndex, projected.t, outline, snapToleranceGrid);
        // 追い越し禁止: 建物外周全体で衝突止め (= 周長 s ベース、 edge 跨ぎ対応)
        const edgeLens: number[] = [];
        const cumDist: number[] = [0];
        for (let i = 0; i < outline.length; i++) {
          const p1 = outline[i];
          const p2 = outline[(i + 1) % outline.length];
          const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          edgeLens.push(len);
          cumDist.push(cumDist[i] + len);
        }
        const totalPerimeter = cumDist[outline.length];
        const tToS = (ei: number, t: number) => cumDist[ei] + t * edgeLens[ei];
        const sToT = (s: number): { edgeIndex: number; t: number } => {
          for (let i = 0; i < outline.length; i++) {
            if (s >= cumDist[i] && s <= cumDist[i + 1]) {
              return { edgeIndex: i, t: edgeLens[i] > 0 ? (s - cumDist[i]) / edgeLens[i] : 0 };
            }
          }
          return { edgeIndex: outline.length - 1, t: 1 };
        };
        const startS = tToS(marker.edgeIndex, marker.t);
        const proposedS = tToS(snapped.edgeIndex, snapped.t);
        const MARGIN = 10;  // = 10 grid (= 100mm = 10cm)、 建物サイズ非依存の固定値
        const otherS = (canvasData.heightMarkers ?? [])
          .filter((m) => m.id !== marker.id && m.buildingId === marker.buildingId)
          .map((m) => tToS(m.edgeIndex, m.t));
        // 進行方向は周長 cyclic で最短経路判定 (= 角越え wrap でも誤判定なし)
        const forwardDist = ((proposedS - startS) % totalPerimeter + totalPerimeter) % totalPerimeter;
        const backwardDist = ((startS - proposedS) % totalPerimeter + totalPerimeter) % totalPerimeter;
        let clampedS = proposedS;
        if (forwardDist > 0 && forwardDist <= backwardDist) {
          // forward (= s 増加方向、 cyclic) の最近マーカーで clamp
          const others = otherS
            .map((s) => ((s - startS) % totalPerimeter + totalPerimeter) % totalPerimeter)
            .filter((d) => d > 0);
          if (others.length > 0) {
            const nearest = Math.min(...others) - MARGIN;
            const clampedD = Math.min(forwardDist, Math.max(0, nearest));
            clampedS = (startS + clampedD) % totalPerimeter;
          }
        } else if (backwardDist > 0) {
          // backward (= s 減少方向、 cyclic) の最近マーカーで clamp
          const others = otherS
            .map((s) => ((startS - s) % totalPerimeter + totalPerimeter) % totalPerimeter)
            .filter((d) => d > 0);
          if (others.length > 0) {
            const nearest = Math.min(...others) - MARGIN;
            const clampedD = Math.min(backwardDist, Math.max(0, nearest));
            clampedS = (startS - clampedD + totalPerimeter) % totalPerimeter;
          }
        }
        const clamped = sToT(clampedS);
        updateDragInfo({ markerId: marker.id, edgeIndex: clamped.edgeIndex, t: clamped.t });
      }
    };

    const onStagePointerUp = () => {
      // タイマー解除
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      pressStartPosRef.current = null;

      // ドラッグ確定 (= 1 回 moveHeightMarker、 history 1 件のみ追加)
      if (isDraggingRef.current && dragInfoRef.current) {
        const info = dragInfoRef.current;
        // 中点スナップ補正 (= dragEnd のみ、 ドラッグ中は適用しない、 stuck 回避)
        const pointer = stage.getPointerPosition();
        let finalT = info.t;
        if (pointer) {
          const marker = (canvasData.heightMarkers ?? []).find((m) => m.id === info.markerId);
          if (marker) {
            const building = canvasData.buildings.find((b) => b.id === marker.buildingId);
            if (building) {
              finalT = snapToMidpointIfNear(
                info.edgeIndex, info.t, pointer.x, pointer.y,
                building, gridPx, panX, panY, MIDPOINT_SNAP_PX,
              );
            }
          }
        }
        moveHeightMarker(info.markerId, info.edgeIndex, finalT);
        wasDraggingRef.current = true; // onClick での modal 抑止フラグ
      }
      isDraggingRef.current = false;
      dragMarkerIdRef.current = null;
      mousePendingRef.current = null;
      updateDragInfo(null);
      setPointerScreenPos(null);
    };

    stage.on('pointermove.heightmarker', onStagePointerMove);
    stage.on('pointerup.heightmarker', onStagePointerUp);

    return () => {
      stage.off('pointermove.heightmarker');
      stage.off('pointerup.heightmarker');
    };
  }, [canvasData, gridPx, panX, panY, moveHeightMarker]);

  // unmount 時にタイマー残らないよう保険
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  const onCircleDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, marker: { id: string; edgeIndex: number; t: number }) => {
    e.cancelBubble = true; // Stage の onMouseDown 不発火 (= 新マーカー誤作成回避)
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (pointer) pressStartPosRef.current = { x: pointer.x, y: pointer.y };
    // click/tap(移動なし)は編集モーダルを開くため、押下時はドラッグ開始しない。
    // mouse: 閾値超の移動で初めてドラッグ化(onStagePointerMove)。touch: 長押しでドラッグ化。
    const isTouch = 'touches' in e.evt;
    if (!isTouch) {
      mousePendingRef.current = { id: marker.id, edgeIndex: marker.edgeIndex, t: marker.t };
      return;
    }
    longPressTimerRef.current = setTimeout(() => {
      // 長押し成立 → ドラッグ可能化 + 視覚フィードバック開始
      isDraggingRef.current = true;
      dragMarkerIdRef.current = marker.id;
      updateDragInfo({ markerId: marker.id, edgeIndex: marker.edgeIndex, t: marker.t });
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const onCircleClick = (markerId: string) => {
    // 直前にドラッグした場合は modal 抑止 (= flag を 1 回消費)
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    setHeightInputMarkerId(markerId);
  };

  return (
    <Layer ref={layerRef}>
      {/* 中点 ◇ ガイド (= isHeightMarkerMode 時のみ、 ドラッグ中ポインタ近傍ならハイライト) */}
      {isHeightMarkerMode && canvasData.buildings.flatMap((building) => {
        const outline = getOutlinePolygon(building);
        return outline.map((p1, i) => {
          const p2 = outline[(i + 1) % outline.length];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          const screenMidX = midX * gridPx + panX;
          const screenMidY = midY * gridPx + panY;
          let isNear = false;
          if (pointerScreenPos && isDraggingRef.current) {
            const dist = Math.hypot(pointerScreenPos.x - screenMidX, pointerScreenPos.y - screenMidY);
            isNear = dist < MIDPOINT_SNAP_PX;
          }
          const size = isNear ? Math.max(7, 9 * zoom) : Math.max(5, 6 * zoom);
          const opacity = isNear ? 1.0 : 0.5;
          return (
            <Rect
              key={`midpoint-${building.id}-${i}`}
              x={screenMidX} y={screenMidY}
              width={size * 2} height={size * 2}
              offsetX={size} offsetY={size}
              rotation={45}
              fill={MARKER_COLOR}
              opacity={opacity}
              listening={false}
            />
          );
        });
      })}
      {markers.map((marker) => {
        const building = canvasData.buildings.find((b) => b.id === marker.buildingId);
        if (!building) return null;
        const outline = getOutlinePolygon(building);
        // ドラッグ中なら dragInfo の論理位置を表示、 それ以外は marker 自身
        const isThisDragging = dragInfo?.markerId === marker.id;
        const ei = isThisDragging ? dragInfo!.edgeIndex : marker.edgeIndex;
        const tt = isThisDragging ? dragInfo!.t : marker.t;
        if (ei < 0 || ei >= outline.length) return null;
        const p1 = outline[ei];
        const p2 = outline[(ei + 1) % outline.length];
        const x = p1.x + tt * (p2.x - p1.x);
        const y = p1.y + tt * (p2.y - p1.y);
        const screenX = x * gridPx + panX;
        const screenY = y * gridPx + panY;
        const r = Math.max(6, 8 * zoom);
        const fs = Math.max(11, 13 * zoom);
        const labelText = marker.heightMm === 0
          ? 'H?'
          : `H${marker.heightMm}mm`;
        return (
          <React.Fragment key={marker.id}>
            {/* 透明ヒット領域（モバイル指基準・半径20px以上）。編集/削除のタップを確実化 */}
            <Circle
              x={screenX} y={screenY} radius={Math.max(20, r)}
              fill="transparent"
              onMouseDown={(e) => onCircleDown(e, { id: marker.id, edgeIndex: marker.edgeIndex, t: marker.t })}
              onTouchStart={(e) => onCircleDown(e, { id: marker.id, edgeIndex: marker.edgeIndex, t: marker.t })}
              onClick={() => onCircleClick(marker.id)}
              onTap={() => onCircleClick(marker.id)}
            />
            <Circle
              x={screenX} y={screenY} radius={r}
              fill={MARKER_COLOR} stroke="#fff" strokeWidth={1.5}
              listening={false}
            />
            <Text
              x={screenX + r + 4} y={screenY - fs / 2}
              text={labelText} fontSize={fs} fontStyle="bold"
              fill={MARKER_COLOR} listening={false}
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
}
