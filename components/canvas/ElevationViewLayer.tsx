'use client';

// ============================================================
// 立面ビューのキャンバス描画レイヤー（E-4b / E-6e-perf / E-6e-perf2）。
//  ・elevationViews を Konva グループとして描画（primitives→Line/Rect/Text）。
//  ・パン: Group の x/y 平行移動に逃がし、子ノードは「確定 gridPx」で memo 化（再生成しない）。
//  ・ズーム(E-6e-perf2): 実測で「毎フレーム子再生成＋再cache」がズーム重の根因と確定。
//    ズーム中は Group の scale = liveGridPx / cachedGridPx で追従し、子の再生成・再cache をしない。
//    ズームが止まったら 200ms デバウンスで cachedGridPx を更新 → 1 回だけ再生成＋再cache（鮮明化）。
//    ズーム中の一時的なボケは許容。停止後は px 一定の元の見た目に戻る。
//  ・各 Group は cache() でビットマップ化。選択/ドラッグ/消去は従来どおり。
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Group, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { ElevationPrimitive, ElevationView } from '@/types';

type ToScreen = (lx: number, ly: number) => { x: number; y: number };

/** ズーム停止後に再cache するまでの待ち時間（ms）。 */
const RECACHE_DEBOUNCE_MS = 200;

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
  // 「確定 gridPx」: 子ノード/キャッシュはこの値で作る。ズーム中は据え置き、停止後に追従。
  const [cachedGridPx, setCachedGridPx] = useState(gridPx);

  // ズームが止まってから(デバウンス)確定 gridPx を更新 → 子再生成＋再cache は 1 回だけ。
  useEffect(() => {
    if (gridPx === cachedGridPx) return;
    const id = setTimeout(() => setCachedGridPx(gridPx), RECACHE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [gridPx, cachedGridPx]);

  // 子は確定 gridPx でローカル→ワールドpx（pan 非依存・ズーム中不変）。
  const worldOf: ToScreen = (lx, ly) => ({
    x: (view.originGrid.x + lx * view.scale) * cachedGridPx,
    y: (view.originGrid.y + ly * view.scale) * cachedGridPx,
  });
  const children = useMemo(
    () => view.primitives.map((p, i) => renderPrim(p, i, worldOf)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, cachedGridPx],
  );

  // hit 判定用の確定ワールドpx bbox（cache 空間・グループ内）。
  const lb = useMemo(() => localBounds(view), [view]);
  const wboxCached = useMemo(() => {
    if (!lb) return null;
    const a = worldOf(lb.minX, lb.minY), b = worldOf(lb.maxX, lb.maxY);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lb, cachedGridPx]);

  // Group をビットマップ化。view / cachedGridPx / mode の変化時だけ再cache（ズーム中は走らない）。
  const groupRef = useRef<Konva.Group>(null);
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const box = g.getClientRect({ skipTransform: true });
    if (box.width < 1 || box.height < 1) return;
    const maxSide = Math.max(box.width, box.height);
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const pixelRatio = Math.max(0.3, Math.min(dpr, 2600 / maxSide));
    g.cache({ pixelRatio });
    g.getLayer()?.batchDraw();
    return () => { g.clearCache(); };
  }, [view, cachedGridPx, mode]);

  const listening = mode === 'select' || mode === 'erase' || mode === 'move-select';
  // ズーム中の追従倍率。停止時は 1。
  const followScale = gridPx / cachedGridPx;

  const onClick = () => {
    if (mode === 'erase') { useCanvasStore.getState().removeElement(view.id); return; }
    setSelectedIds([view.id]);
  };
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const g = e.target;
    // ドラッグは position(x/y) を親(Layer)px で動かす。scale は無関係。
    const dx = (g.x() - panX) / gridPx, dy = (g.y() - panY) / gridPx;
    g.x(panX); g.y(panY);
    moveElevationView(view.id, { x: Math.round(view.originGrid.x + dx), y: Math.round(view.originGrid.y + dy) });
  };

  // 選択枠は live gridPx でスクリーン計算（ズーム中も正しく追従）。
  const selRect = selected && lb ? (() => {
    const ax = (view.originGrid.x + lb.minX * view.scale) * gridPx + panX;
    const ay = (view.originGrid.y + lb.minY * view.scale) * gridPx + panY;
    const bx = (view.originGrid.x + lb.maxX * view.scale) * gridPx + panX;
    const by = (view.originGrid.y + lb.maxY * view.scale) * gridPx + panY;
    return { x: Math.min(ax, bx) - 4, y: Math.min(ay, by) - 4, w: Math.abs(bx - ax) + 8, h: Math.abs(by - ay) + 8 };
  })() : null;

  return (
    <>
      <Group ref={groupRef} x={panX} y={panY} scaleX={followScale} scaleY={followScale} draggable={mode === 'select'} onDragEnd={onDragEnd} onClick={onClick} onTap={onClick} listening={listening}>
        {children}
        {/* cached hit canvas は listening=false 子を無視するため、bbox を覆う透明 Rect を hit 領域に。 */}
        {wboxCached && <Rect x={wboxCached.x} y={wboxCached.y} width={wboxCached.w} height={wboxCached.h} fill="#000" opacity={0} listening={listening} />}
      </Group>
      {selRect && (
        <Rect x={selRect.x} y={selRect.y} width={selRect.w} height={selRect.h} stroke="#378ADD" strokeWidth={1} dash={[6, 4]} listening={false} />
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
