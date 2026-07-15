'use client';

// ============================================================
// 立面ビューのキャンバス描画レイヤー（E-4b / E-6e-perf）。
//  ・elevationViews を Konva グループとして描画（primitives→Line/Rect/Text）。
//  ・E-6e-perf: パンを「Group の平行移動」に逃がし、子ノード(primitives)はローカル座標で
//    memo 化する。これによりパン中に子ノードが再生成されず（React reconciliation を回避）、
//    Group の x/y 更新だけで済む。ズーム(gridPx 変化)/ビュー変更時のみ子を再計算。
//  ・グループ単位で native draggable（select）→ dragEnd で moveElevationView、タップで選択、
//    消去ツールで削除。線幅/文字は px 一定（strokeScaleEnabled=false・group scale=1）。
// ============================================================
import React, { useMemo } from 'react';
import { Layer, Group, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { ElevationPrimitive, ElevationView } from '@/types';

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

/** primitives のローカル bbox（生座標・グリッド）。 */
function localBounds(view: ElevationView) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const p of view.primitives) {
    if (p.kind === 'line') { see(p.x1, p.y1); see(p.x2, p.y2); }
    else if (p.kind === 'rect') { see(p.x, p.y); see(p.x + p.w, p.y + p.h); }
    else if (p.kind === 'polygon') { for (let k = 0; k < p.points.length; k += 2) see(p.points[k], p.points[k + 1]); }
    else see(p.x, p.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

type GroupProps = {
  view: ElevationView;
  gridPx: number;
  panX: number;
  panY: number;
  mode: string;
  selected: boolean;
  setSelectedIds: (ids: string[]) => void;
  moveElevationView: (id: string, originGrid: { x: number; y: number }) => void;
};

function ElevationViewGroup({ view, gridPx, panX, panY, mode, selected, setSelectedIds, moveElevationView }: GroupProps) {
  // pan を含まないローカル→ワールドpx 写像（pan は Group の x/y に逃がす）。
  const worldOf: ToScreen = (lx, ly) => ({
    x: (view.originGrid.x + lx * view.scale) * gridPx,
    y: (view.originGrid.y + ly * view.scale) * gridPx,
  });

  // 子ノードは view と gridPx にのみ依存 → パンでは再生成されない。
  const children = useMemo(
    () => view.primitives.map((p, i) => renderPrim(p, i, worldOf)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, gridPx],
  );

  // 選択枠用のワールドpx bbox（同じく pan 非依存）。
  const wbox = useMemo(() => {
    const lb = localBounds(view);
    if (!lb) return null;
    const a = worldOf(lb.minX, lb.minY), b = worldOf(lb.maxX, lb.maxY);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, gridPx]);

  const listening = mode === 'select' || mode === 'erase' || mode === 'move-select';

  const onClick = () => {
    if (mode === 'erase') { useCanvasStore.getState().removeElement(view.id); return; }
    setSelectedIds([view.id]);
  };
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const g = e.target;
    const dx = (g.x() - panX) / gridPx, dy = (g.y() - panY) / gridPx;
    g.x(panX); g.y(panY);
    moveElevationView(view.id, { x: Math.round(view.originGrid.x + dx), y: Math.round(view.originGrid.y + dy) });
  };

  return (
    <>
      <Group x={panX} y={panY} draggable={mode === 'select'} onDragEnd={onDragEnd} onClick={onClick} onTap={onClick} listening={listening}>
        {children}
      </Group>
      {selected && wbox && (
        <Rect x={wbox.x + panX - 4} y={wbox.y + panY - 4} width={wbox.w + 8} height={wbox.h + 8} stroke="#378ADD" strokeWidth={1} dash={[6, 4]} listening={false} />
      )}
    </>
  );
}

export default function ElevationViewLayer() {
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const setSelectedIds = useCanvasStore((s) => s.setSelectedIds);
  const moveElevationView = useCanvasStore((s) => s.moveElevationView);

  const gridPx = INITIAL_GRID_PX * zoom;
  const arr = views ?? [];
  if (arr.length === 0) return null;

  return (
    <Layer>
      {arr.map((view) => (
        <ElevationViewGroup
          key={view.id}
          view={view}
          gridPx={gridPx}
          panX={panX}
          panY={panY}
          mode={mode}
          selected={selectedIds.includes(view.id)}
          setSelectedIds={setSelectedIds}
          moveElevationView={moveElevationView}
        />
      ))}
    </Layer>
  );
}
