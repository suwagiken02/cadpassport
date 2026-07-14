'use client';

// ============================================================
// 棟ラインツール（E-3.8d）: 平面図で建物内部に棟(むね)の線分を引く・編集・移動。
//  ・配置: isRidgeLineMode 時、全面キャプチャ Rect で2点クリック（建物内部のみ・頂点/中点スナップ）。
//    1点目→ドラフト線プレビュー→2点目で addRidgeLine + 高さ入力モーダル。ESC/モード解除で破棄。
//  ・既存線: 破線＋中点に「棟 N」ラベル。タップで編集モーダル、ドラッグで平行移動（建物外は拒否）。
//    ドラッグ/タップ判定は react-konva の native draggable に委譲（E-3.9 の手動判定不具合を回避）。
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { Layer, Line, Text, Rect, Circle } from 'react-konva';
import Konva from 'konva';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPointInPolygon } from '@/lib/konva/autoLayoutUtils';
import type { Point, BuildingShape } from '@/types';

const RIDGE_COLOR = '#E07B39';
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

  const toGrid = (sx: number, sy: number): Point => ({ x: (sx - panX) / gridPx, y: (sy - panY) / gridPx });
  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;

  const buildingAt = (pt: Point): BuildingShape | undefined =>
    canvasData.buildings.find((b) => isPointInPolygon(pt.x, pt.y, b.points));

  /** 頂点・辺中点スナップ（閾値内）。無ければグリッド丸め。 */
  const snapPoint = (pt: Point, b: BuildingShape): Point => {
    const thr = SNAP_PX / gridPx;
    let best: Point = { x: Math.round(pt.x), y: Math.round(pt.y) };
    let bd = Infinity;
    const cands: Point[] = [...b.points];
    for (let i = 0; i < b.points.length; i++) {
      const p1 = b.points[i], p2 = b.points[(i + 1) % b.points.length];
      cands.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    }
    for (const c of cands) {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < thr && d < bd) { bd = d; best = { x: c.x, y: c.y }; }
    }
    return best;
  };

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
    const snapped = snapPoint(g, b);
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
    setCursor(b ? snapPoint(g, b) : g);
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

      {/* ドラフト線プレビュー */}
      {isRidgeLineMode && draft && cursor && (
        <>
          <Line
            points={[sx(draft.p1.x), sy(draft.p1.y), sx(cursor.x), sy(cursor.y)]}
            stroke={RIDGE_COLOR} strokeWidth={2} dash={[8, 4]} listening={false}
          />
          <Circle x={sx(draft.p1.x)} y={sy(draft.p1.y)} radius={r} fill={RIDGE_COLOR} listening={false} />
        </>
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
