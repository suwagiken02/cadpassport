'use client';

// ============================================================
// 棟ラインツール（E-3.8d / ガイド・スナップ E-3.13）: 平面図で建物内部に棟の線分を引く・編集・移動。
//  ・配置: isRidgeLineMode 時、全面キャプチャ Rect で2点クリック（建物内部のみ）。
//    中心ガイド（中央棟線＋短辺中央線の十字＋隅棟目安線）を薄く表示し、ガイド線/端点/交点＋
//    頂点/辺中点へスナップ（吸着時はカーソル色を変える）。1点目→ドラフト線→2点目で addRidgeLine。
//  ・既存線: 破線＋中点に「棟N」ラベル。タップで編集モーダル、native draggable で平行移動。
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { Layer, Line, Text, Rect, Circle } from 'react-konva';
import Konva from 'konva';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPointInPolygon } from '@/lib/konva/autoLayoutUtils';
import { computeRidgeGuides, snapRidgeInput } from '@/lib/konva/elevation/ridgeProjection';
import type { Point, BuildingShape } from '@/types';

const RIDGE_COLOR = '#E07B39';
const SNAP_COLOR = '#22C55E';
const SNAP_PX = 15;

export default function RidgeLineLayer() {
  const {
    canvasData, zoom, panX, panY, canvasSize,
    isRidgeLineMode, setRidgeInputLineId, addRidgeLine, moveRidgeLine,
  } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const ridgeLines = canvasData.ridgeLines ?? [];

  const layerRef = useRef<Konva.Layer>(null);
  const [draft, setDraft] = useState<{ buildingId: string; p1: Point } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [cursorSnapped, setCursorSnapped] = useState(false);

  const toGrid = (px: number, py: number): Point => ({ x: (px - panX) / gridPx, y: (py - panY) / gridPx });
  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;

  const buildingAt = (pt: Point): BuildingShape | undefined =>
    canvasData.buildings.find((b) => isPointInPolygon(pt.x, pt.y, b.points));

  const snapIn = (pt: Point, b: BuildingShape) => snapRidgeInput(pt, b.points, SNAP_PX / gridPx);

  // モード解除 / ESC でドラフト破棄
  useEffect(() => { if (!isRidgeLineMode) { setDraft(null); setCursor(null); } }, [isRidgeLineMode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDraft(null); setCursor(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pointerGrid = (e: Konva.KonvaEventObject<unknown>): Point | null => {
    const p = e.target.getStage()?.getPointerPosition();
    return p ? toGrid(p.x, p.y) : null;
  };

  const handlePlace = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true; // Stage の select/measure 等を発火させない
    const g = pointerGrid(e);
    if (!g) return;
    const b = buildingAt(g);
    if (!b) { setCursor(null); return; } // 建物外は無視
    const snapped = snapIn(g, b).point;
    if (!draft) {
      setDraft({ buildingId: b.id, p1: snapped });
      setCursor(snapped);
      return;
    }
    if (b.id !== draft.buildingId) return; // 別建物内は不可
    const id = uuidv4();
    addRidgeLine({ id, buildingId: b.id, p1: draft.p1, p2: snapped, heightMm: useCanvasStore.getState().lastRidgeInputMm });
    setRidgeInputLineId(id);
    setDraft(null);
    setCursor(null);
  };

  const handleMoveCursor = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const g = pointerGrid(e);
    if (!g) return;
    const b = buildingAt(g);
    if (!b) { setCursor(g); setCursorSnapped(false); return; }
    const s = snapIn(g, b);
    setCursor(s.point);
    setCursorSnapped(s.snapped);
  };

  const commitDrag = (lineId: string, node: Konva.Line) => {
    const line = ridgeLines.find((l) => l.id === lineId);
    const dxGrid = node.x() / gridPx;
    const dyGrid = node.y() / gridPx;
    node.x(0); node.y(0); // 表示は再レンダーで確定
    if (!line) return;
    const np1 = { x: Math.round(line.p1.x + dxGrid), y: Math.round(line.p1.y + dyGrid) };
    const np2 = { x: Math.round(line.p2.x + dxGrid), y: Math.round(line.p2.y + dyGrid) };
    const b = canvasData.buildings.find((bb) => bb.id === line.buildingId);
    // 建物外に出る移動は拒否（元位置のまま）
    if (b && isPointInPolygon(np1.x, np1.y, b.points) && isPointInPolygon(np2.x, np2.y, b.points)) {
      moveRidgeLine(line.id, np1, np2);
    }
  };

  const r = Math.max(4, 5 * zoom);
  const fs = Math.max(11, 13 * zoom);
  const segPts = (s: { p1: Point; p2: Point }) => [sx(s.p1.x), sy(s.p1.y), sx(s.p2.x), sy(s.p2.y)];

  return (
    <Layer ref={layerRef}>
      {/* 配置キャプチャ（棟モード時のみ・線より下） */}
      {isRidgeLineMode && canvasSize.width > 0 && (
        <Rect
          x={0} y={0} width={canvasSize.width} height={canvasSize.height}
          fill="transparent"
          onMouseMove={handleMoveCursor}
          onTouchMove={handleMoveCursor}
          onClick={handlePlace}
          onTap={handlePlace}
        />
      )}

      {/* 中心ガイド（棟モード時・建物ごと）: 隅棟→短辺中央線→中央棟線 の順で重ねる */}
      {isRidgeLineMode && canvasData.buildings.map((b) => {
        if (b.points.length < 3) return null;
        const g = computeRidgeGuides(b.points);
        return (
          <React.Fragment key={`guide-${b.id}`}>
            {g.hipLines.map((hl, i) => (
              <Line key={`hip-${i}`} points={segPts(hl)} stroke={RIDGE_COLOR} strokeWidth={0.8} dash={[3, 5]} opacity={0.22} listening={false} />
            ))}
            <Line points={segPts(g.crossLine)} stroke={RIDGE_COLOR} strokeWidth={1} dash={[6, 6]} opacity={0.35} listening={false} />
            <Line points={segPts(g.centerLine)} stroke={RIDGE_COLOR} strokeWidth={1.2} dash={[6, 6]} opacity={0.5} listening={false} />
          </React.Fragment>
        );
      })}

      {/* ドラフト線プレビュー＋カーソルマーカー（スナップ時は色変更） */}
      {isRidgeLineMode && draft && cursor && (
        <Line points={[sx(draft.p1.x), sy(draft.p1.y), sx(cursor.x), sy(cursor.y)]} stroke={RIDGE_COLOR} strokeWidth={2} dash={[8, 4]} listening={false} />
      )}
      {isRidgeLineMode && draft && (
        <Circle x={sx(draft.p1.x)} y={sy(draft.p1.y)} radius={r} fill={RIDGE_COLOR} listening={false} />
      )}
      {isRidgeLineMode && cursor && (
        <Circle x={sx(cursor.x)} y={sy(cursor.y)} radius={r} fill={cursorSnapped ? SNAP_COLOR : RIDGE_COLOR} opacity={0.9} listening={false} />
      )}

      {/* 既存の棟ライン */}
      {ridgeLines.map((line) => {
        const midX = (line.p1.x + line.p2.x) / 2;
        const midY = (line.p1.y + line.p2.y) / 2;
        return (
          <React.Fragment key={line.id}>
            <Line
              points={[sx(line.p1.x), sy(line.p1.y), sx(line.p2.x), sy(line.p2.y)]}
              stroke={RIDGE_COLOR} strokeWidth={2.5} dash={[12, 6]}
              hitStrokeWidth={20}
              draggable={!isRidgeLineMode}
              onDragEnd={(e) => commitDrag(line.id, e.target as Konva.Line)}
              onClick={() => setRidgeInputLineId(line.id)}
              onTap={() => setRidgeInputLineId(line.id)}
            />
            <Circle x={sx(line.p1.x)} y={sy(line.p1.y)} radius={r} fill={RIDGE_COLOR} listening={false} />
            <Circle x={sx(line.p2.x)} y={sy(line.p2.y)} radius={r} fill={RIDGE_COLOR} listening={false} />
            <Text
              x={sx(midX) + 6} y={sy(midY) - fs / 2}
              text={`棟${line.heightMm}`} fontSize={fs} fontStyle="bold"
              fill={RIDGE_COLOR} listening={false}
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
}
