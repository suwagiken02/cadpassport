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
import { nextAddId, overriddenTextIds, primitiveBounds, withAdd, withMove } from '@/lib/konva/elevation/elevationEdits';
import { composeViewPrimitives } from '@/lib/konva/elevation/elevationViewCompose';
import {
  buildElevationSlots, nextPartId, slotOccupied, slotToPart, type ElevationSlot,
} from '@/lib/konva/elevation/elevationSlots';
import type { ElevationPrimitive, ElevationView } from '@/types';

type ToScreen = (lx: number, ly: number) => { x: number; y: number };

/** ズーム停止後に再cache するまでの待ち時間（ms）。 */
const RECACHE_DEBOUNCE_MS = 200;

/** hex(#rrggbb) を fillOpacity 付き rgba に。fill の半透明は fill 側で表し stroke は不透明を保つ
 *  （E-5-fix2: 従来は opacity=fillOpacity で shape 全体を薄くし、建物外形・屋根の輪郭線＝L 字
 *  段差の縦線が 0.22 で消えて見えた。プレビュー(Modal)は fill と stroke の不透明度を分けている）。 */
function withAlpha(hex: string | undefined, a: number | undefined): string | undefined {
  if (!hex || a == null || a >= 1) return hex;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function renderPrim(p: ElevationPrimitive, i: number, S: ToScreen, editing = false, overridden = false) {
  if (p.kind === 'line') {
    const a = S(p.x1, p.y1), b = S(p.x2, p.y2);
    return <Line key={i} points={[a.x, a.y, b.x, b.y]} stroke={p.stroke} strokeWidth={p.width} dash={p.dash} opacity={p.opacity ?? 1} strokeScaleEnabled={false} listening={false} hitStrokeWidth={editing ? 10 : 0} />;
  }
  if (p.kind === 'rect') {
    const a = S(p.x, p.y), b = S(p.x + p.w, p.y + p.h);
    return <Rect key={i} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={withAlpha(p.fill, p.fillOpacity)} stroke={p.stroke} strokeWidth={p.width ?? 0} strokeScaleEnabled={false} listening={false} />;
  }
  if (p.kind === 'polygon') {
    const pts: number[] = [];
    for (let k = 0; k < p.points.length; k += 2) { const s = S(p.points[k], p.points[k + 1]); pts.push(s.x, s.y); }
    return <Line key={i} points={pts} closed fill={withAlpha(p.fill, p.fillOpacity)} stroke={p.stroke} strokeWidth={p.width ?? 0} strokeScaleEnabled={false} listening={false} />;
  }
  // text
  const a = S(p.x, p.y);
  const est = p.text.length * p.size * 0.6;
  const offX = p.anchor === 'middle' ? est / 2 : p.anchor === 'end' ? est : 0;
  // E-8c: ユーザーが上書きした文字は色で明示（生成値のままと区別できるように）。
  const fill = overridden ? '#FF9F1C' : p.fill;
  return <Text key={i} x={a.x} y={a.y} text={p.text} fontSize={p.size} fill={fill} offsetX={offX} fontFamily="monospace" listening={false} />;
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

/**
 * E-8b: 立面編集モードの描画。cache() を外して部材(プリミティブ)単位で当たり判定を持たせ、
 * タップで選択・ドラッグで移動差分（move edit）を作る。編集中のビューだけがこの経路。
 * 通常表示は従来どおり cache 済みビットマップ＋bbox 1枚 hit のまま（性能を落とさない）。
 */
function ElevationEditGroup({ view, gridPx, panX, panY }: {
  view: ElevationView; gridPx: number; panX: number; panY: number;
}) {
  const selectedId = useCanvasStore((s) => s.elevationEditSelectedId);
  const setSelectedId = useCanvasStore((s) => s.setElevationEditSelectedId);
  const prims = useMemo(() => composeViewPrimitives(view), [view]);
  const overridden = useMemo(() => overriddenTextIds(view.edits), [view.edits]);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const addDraft = useCanvasStore((s) => s.elevationAddDraft);

  const S: ToScreen = (lx, ly) => ({
    x: (view.originGrid.x + lx * view.scale) * gridPx + panX,
    y: (view.originGrid.y + ly * view.scale) * gridPx + panY,
  });
  /** スクリーン px → ビューローカル（グリッド）。 */
  const toLocal = (sx: number, sy: number) => ({
    x: ((sx - panX) / gridPx - view.originGrid.x) / view.scale,
    y: ((sy - panY) / gridPx - view.originGrid.y) / view.scale,
  });

  // E-8-v2c: 部材ブロックのパレット配置。有効スロットをゴースト表示し、タップで吸着配置。
  const partPalette = (() => {
    if (!addTool || !view.geom || addTool === 'line' || addTool === 'text') return null;
    const geom = view.geom;
    const slots = buildElevationSlots(geom, addTool);
    if (slots.length === 0) return null;
    const parts = view.parts ?? [];

    const place = (slot: ElevationSlot) => {
      if (slotOccupied(parts, slot)) return; // 同じ位置に同種は置かない
      const id = nextPartId(parts, slot.kind);
      useCanvasStore.getState().addElevationPart(view.id, slotToPart(slot, id));
    };

    return (
      <>
        {slots.map((slot, i) => {
          const sg = geom.scaffolds[slot.scaffoldIndex];
          const isPostKind = slot.kind === 'post' || slot.kind === 'jack';
          // ゴーストの当たり範囲: 支柱系は縦長、スパン系はスパン幅×1段ぶん。
          const yTopMm = isPostKind ? sg.topRailMm : (slot.levelMm ?? 0) + 225;
          const yBotMm = isPostKind ? sg.jackTopMm : (slot.levelMm ?? 0) - 225;
          const a = S(slot.x0, -yTopMm / 10), b = S(slot.x1, -yBotMm / 10);
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          const w = Math.max(Math.abs(b.x - a.x), 10), h = Math.max(Math.abs(b.y - a.y), 10);
          const taken = slotOccupied(parts, slot);
          return (
            <Rect
              key={`slot-${i}`}
              x={x - (isPostKind ? 5 : 0)} y={y} width={isPostKind ? w + 10 : w} height={h}
              fill={taken ? '#888888' : '#FF6B35'}
              opacity={taken ? 0.06 : 0.14}
              stroke={taken ? undefined : '#FF6B35'}
              strokeWidth={taken ? 0 : 0.5}
              dash={[3, 3]}
              onClick={() => place(slot)}
              onTap={() => place(slot)}
            />
          );
        })}
      </>
    );
  })();

  // E-8d: 追加ツールの入力面（ビュー全体を覆う透明 Rect）。2点タップで線、1点で文字。
  const addSurface = (() => {
    if (!addTool || (addTool !== 'line' && addTool !== 'text')) return null;
    const b = prims.reduce<{ minX: number; minY: number; maxX: number; maxY: number } | null>((acc, p) => {
      const q = primitiveBounds(p);
      if (!acc) return { ...q };
      return {
        minX: Math.min(acc.minX, q.minX), minY: Math.min(acc.minY, q.minY),
        maxX: Math.max(acc.maxX, q.maxX), maxY: Math.max(acc.maxY, q.maxY),
      };
    }, null);
    if (!b) return null;
    const pad = 4;
    const a = S(b.minX - pad, b.minY - pad), c = S(b.maxX + pad, b.maxY + pad);
    const rect = {
      x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
      w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y),
    };
    const onPoint = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;
      const L = toLocal(pos.x, pos.y);
      const s = useCanvasStore.getState();
      if (addTool === 'text') {
        // 文字は1点。空文字で作って、そのまま文字編集モーダルを開く。
        const id = nextAddId(view, 'text');
        const prim: ElevationPrimitive = {
          kind: 'text', x: L.x, y: L.y, text: '文字', size: 9, fill: '#c9c9c6', anchor: 'start',
          meta: { kind: 'text', id, x: Math.round(L.x * 10) / 10 },
        };
        s.setElevationEdits(view.id, withAdd(view.edits, prim));
        s.setElevationAddTool(null);
        s.setElevationTextEditTargetId(id);
        return;
      }
      // 自由線（E-8d の名残・部材は v2c のパレットが担当。v2e で撤去予定）。
      if (!addDraft) { s.setElevationAddDraft(L); return; }
      const x1 = addDraft.x, y1 = addDraft.y;
      const x2 = L.x, y2 = L.y;
      if (Math.abs(x2 - x1) < 1e-6 && Math.abs(y2 - y1) < 1e-6) { s.setElevationAddDraft(null); return; }
      const id = nextAddId(view, 'line');
      const prim: ElevationPrimitive = {
        kind: 'line', x1, y1, x2, y2, stroke: '#c9c9c6', width: 1,
        meta: { kind: 'text', id, x: Math.round(x1 * 10) / 10 },
      };
      s.setElevationEdits(view.id, withAdd(view.edits, prim));
      s.setElevationAddDraft(null);
    };
    return (
      <>
        <Rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="#000" opacity={0.001}
          onClick={onPoint} onTap={onPoint} />
        {addDraft && (() => {
          const d = S(addDraft.x, addDraft.y);
          return <Rect x={d.x - 4} y={d.y - 4} width={8} height={8} fill="#FF6B35" listening={false} />;
        })()}
      </>
    );
  })();

  return (
    <>
      {prims.map((p, i) => {
        const id = p.meta?.id;
        const isSel = !!id && id === selectedId;
        const b = primitiveBounds(p);
        const a = S(b.minX, b.minY), c = S(b.maxX, b.maxY);
        const box = {
          x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
          w: Math.max(Math.abs(c.x - a.x), 6), h: Math.max(Math.abs(c.y - a.y), 6),
        };
        return (
          <Group
            key={id ?? i}
            draggable={!!id && !addTool}
            listening={!addTool}
            onDragEnd={(e) => {
              if (!id) return;
              const g = e.target;
              // ローカル(グリッド)へ戻して差分に積む。ノード自体の位置は 0 に戻す。
              const dx = g.x() / (gridPx * view.scale);
              const dy = g.y() / (gridPx * view.scale);
              g.position({ x: 0, y: 0 });
              if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
              useCanvasStore.getState().setElevationEdits(view.id, withMove(view.edits, id, dx, dy));
            }}
            onClick={() => id && setSelectedId(id)}
            onTap={() => id && setSelectedId(id)}
            onDblClick={() => { if (id && p.kind === 'text') useCanvasStore.getState().setElevationTextEditTargetId(id); }}
            onDblTap={() => { if (id && p.kind === 'text') useCanvasStore.getState().setElevationTextEditTargetId(id); }}
          >
            {renderPrim(p, i, S, true, !!id && overridden.has(id))}
            {/* 細い線でも掴めるよう、bbox を覆う透明の当たり判定を重ねる。 */}
            <Rect x={box.x - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} fill="#000" opacity={0.001} />
            {isSel && (
              <Rect
                x={box.x - 4} y={box.y - 4} width={box.w + 8} height={box.h + 8}
                stroke="#FF6B35" strokeWidth={1.5} dash={[4, 3]} listening={false}
              />
            )}
          </Group>
        );
      })}
      {partPalette}
      {addSurface}
    </>
  );
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
  // E-8b: 編集差分を反映して描く（未編集なら元の配列がそのまま返る＝従来と同一）。
  const children = useMemo(
    () => {
      const ov = overriddenTextIds(view.edits);
      return composeViewPrimitives(view).map((p, i) => renderPrim(p, i, worldOf, false, !!p.meta && ov.has(p.meta.id)));
    },
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

  // E-8-fix: 閲覧(view)モードでも当たり判定は生かす。ただし単タップでは何もせず、
  //   ダブルタップのときだけ編集モードへ入る（閲覧中に選択・移動が起きる従来の挙動は変えない）。
  const listening = mode === 'select' || mode === 'erase' || mode === 'move-select' || mode === 'view';
  // ズーム中の追従倍率。停止時は 1。
  const followScale = gridPx / cachedGridPx;

  const onClick = () => {
    if (mode === 'view') return;  // 閲覧中は単タップで選択しない（従来どおり触れない）
    if (mode === 'erase') { useCanvasStore.getState().removeElement(view.id); return; }
    setSelectedIds([view.id]);
  };
  /** E-8b: ダブルタップで立面編集モードへ（部材単位の編集）。 */
  const onDblTap = () => {
    if (mode !== 'select' && mode !== 'view') return;
    useCanvasStore.getState().setSelectedIds([view.id]);
    useCanvasStore.getState().setElevationEditViewId(view.id);
  };
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const g = e.target;
    // ドラッグは position(x/y) を親(Layer)px で動かす。scale は無関係。
    const dx = (g.x() - panX) / gridPx, dy = (g.y() - panY) / gridPx;
    g.x(panX); g.y(panY);
    const gx = Math.round(view.originGrid.x + dx), gy = Math.round(view.originGrid.y + dy);
    // E-8-fix: 動いていない「ドラッグ」で履歴を汚さない（タップの取りこぼし対策で dragDistance を
    //   入れたが、それでも 1 グリッド未満のドラッグは位置が変わらないため書き込まない）。
    if (gx === view.originGrid.x && gy === view.originGrid.y) return;
    moveElevationView(view.id, { x: gx, y: gy });
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
      {/* E-8-fix: dragDistance を入れないと、押下中の 1px の揺れでもドラッグ扱いになり
          Konva が click/tap を発火しない＝ダブルクリック/ダブルタップが成立しない（指では特に顕著）。 */}
      <Group ref={groupRef} x={panX} y={panY} scaleX={followScale} scaleY={followScale} draggable={mode === 'select'} dragDistance={6} onDragEnd={onDragEnd} onClick={onClick} onTap={onClick} onDblClick={onDblTap} onDblTap={onDblTap} listening={listening}>
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
  const editingViewId = useCanvasStore((s) => s.elevationEditViewId);

  const gridPx = INITIAL_GRID_PX * zoom;
  const arr = views ?? [];
  if (arr.length === 0) return null;

  return (
    <Layer>
      {arr.map((view) => (
        editingViewId === view.id ? (
          // E-8b: 編集中のビューは cache を外して部材単位で扱う。
          <ElevationEditGroup key={view.id} view={view} gridPx={gridPx} panX={panX} panY={panY} />
        ) : (
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
        )
      ))}
    </Layer>
  );
}
