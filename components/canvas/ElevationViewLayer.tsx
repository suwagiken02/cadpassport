'use client';

// ============================================================
// 立面ビューのキャンバス描画レイヤー（E-4b）。
//  ・elevationViews を Konva グループとして描画（primitives→Line/Rect/Text）。
//  ・グループ単位で native draggable（select モード）→ ドラッグ終了で moveElevationView。
//  ・タップで選択（selectedIds）、消去ツールで削除。座標はローカル(グリッド)→ 明示的に screen へ写像
//    (グループ scale を使わないので線幅/文字は px 一定)。
// ============================================================
import React from 'react';
import { Layer, Group, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { ElevationPrimitive } from '@/types';

type ToScreen = (lx: number, ly: number) => { x: number; y: number };

function renderPrim(p: ElevationPrimitive, i: number, S: ToScreen) {
  if (p.kind === 'line') {
    const a = S(p.x1, p.y1), b = S(p.x2, p.y2);
    return <Line key={i} points={[a.x, a.y, b.x, b.y]} stroke={p.stroke} strokeWidth={p.width} dash={p.dash} opacity={p.opacity ?? 1} strokeScaleEnabled={false} listening={false} />;
  }
  if (p.kind === 'rect') {
    const a = S(p.x, p.y), b = S(p.x + p.w, p.y + p.h);
    return <Rect key={i} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={p.fill} opacity={p.fillOpacity ?? 1} stroke={p.stroke} strokeWidth={p.width ?? 0} strokeScaleEnabled={false} listening={false} />;
  }
  if (p.kind === 'polygon') {
    const pts: number[] = [];
    for (let k = 0; k < p.points.length; k += 2) { const s = S(p.points[k], p.points[k + 1]); pts.push(s.x, s.y); }
    return <Line key={i} points={pts} closed fill={p.fill} opacity={p.fillOpacity ?? 1} stroke={p.stroke} strokeWidth={p.width ?? 0} strokeScaleEnabled={false} listening={false} />;
  }
  // text
  const a = S(p.x, p.y);
  const est = p.text.length * p.size * 0.6;
  const offX = p.anchor === 'middle' ? est / 2 : p.anchor === 'end' ? est : 0;
  return <Text key={i} x={a.x} y={a.y} text={p.text} fontSize={p.size} fill={p.fill} offsetX={offX} fontFamily="monospace" listening={false} />;
}

export default function ElevationViewLayer() {
  const { canvasData, zoom, panX, panY, mode, selectedIds, setSelectedIds, moveElevationView } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;
  const viewsArr = canvasData.elevationViews ?? [];
  if (viewsArr.length === 0) return null;

  const listening = mode === 'select' || mode === 'erase' || mode === 'move-select';

  return (
    <Layer>
      {viewsArr.map((view) => {
        const S: ToScreen = (lx, ly) => ({
          x: (view.originGrid.x + lx * view.scale) * gridPx + panX,
          y: (view.originGrid.y + ly * view.scale) * gridPx + panY,
        });
        const selected = selectedIds.includes(view.id);

        // 選択枠用の bbox（ローカル）
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const see = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
        for (const p of view.primitives) {
          if (p.kind === 'line') { see(p.x1, p.y1); see(p.x2, p.y2); }
          else if (p.kind === 'rect') { see(p.x, p.y); see(p.x + p.w, p.y + p.h); }
          else if (p.kind === 'polygon') { for (let k = 0; k < p.points.length; k += 2) see(p.points[k], p.points[k + 1]); }
          else see(p.x, p.y);
        }

        const onClick = () => {
          if (mode === 'erase') { useCanvasStore.getState().removeElement(view.id); return; }
          setSelectedIds([view.id]);
        };
        const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
          const g = e.target;
          const dx = g.x() / gridPx, dy = g.y() / gridPx;
          g.x(0); g.y(0);
          moveElevationView(view.id, { x: Math.round(view.originGrid.x + dx), y: Math.round(view.originGrid.y + dy) });
        };

        return (
          <Group key={view.id} draggable={mode === 'select'} onDragEnd={onDragEnd} onClick={onClick} onTap={onClick} listening={listening}>
            {view.primitives.map((p, i) => renderPrim(p, i, S))}
            {selected && Number.isFinite(minX) && (() => {
              const a = S(minX, minY), b = S(maxX, maxY);
              return <Rect x={Math.min(a.x, b.x) - 4} y={Math.min(a.y, b.y) - 4} width={Math.abs(b.x - a.x) + 8} height={Math.abs(b.y - a.y) + 8} stroke="#378ADD" strokeWidth={1} dash={[6, 4]} listening={false} />;
            })()}
          </Group>
        );
      })}
    </Layer>
  );
}
