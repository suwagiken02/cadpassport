'use client';

// ============================================================
// 立面ビューのキャンバス描画レイヤー（E-4b / E-6e-perf / E-6e-perf2 / E-8-v2）。
//  ・elevationViews を Konva グループとして描画（primitives→Line/Rect/Text）。
//  ・パン: Group の x/y 平行移動に逃がし、子ノードは「確定 gridPx」で memo 化（再生成しない）。
//  ・ズーム(E-6e-perf2): 実測で「毎フレーム子再生成＋再cache」がズーム重の根因と確定。
//    ズーム中は Group の scale = liveGridPx / cachedGridPx で追従し、子の再生成・再cache をしない。
//    ズームが止まったら 200ms デバウンスで cachedGridPx を更新 → 1 回だけ再生成＋再cache（鮮明化）。
//  ・各 Group は cache() でビットマップ化。選択/ドラッグ/消去は従来どおり。
//
// E-8-v2d: 編集モードは「変換付き Group の中にローカル座標でそのまま描く」方式に統一した。
//  ・子は立面ローカル座標（横=グリッド、縦=mm/10・GL=0・上が負）で置き、Group の
//    x/y/scale が画面へ写す。線幅と文字サイズだけ px 固定に戻す（scale で割る）。
//  ・当たり判定は Konva 標準（線は hitStrokeWidth）。旧「bbox を覆う透明 Rect」の
//    手動ヒットテストは撤去した。
//  ・ポインタ座標は getRelativePointerPosition() で Group ローカルに取る（手計算の逆変換をしない）。
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Group, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { nextAddId, overriddenTextIds, withAdd } from '@/lib/konva/elevation/elevationEdits';
import { composeViewPrimitives } from '@/lib/konva/elevation/elevationViewCompose';
import {
  buildElevationSlots, nextPartId, slotOccupied, slotToPart, snapToSlot, type ElevationSlot,
} from '@/lib/konva/elevation/elevationSlots';
import type { ElevationPart } from '@/lib/konva/elevation/elevationParts';
import type { ElevationPrimitive, ElevationView } from '@/types';

type ToScreen = (lx: number, ly: number) => { x: number; y: number };

/** ズーム停止後に再cache するまでの待ち時間（ms）。 */
const RECACHE_DEBOUNCE_MS = 200;
/** 編集モードで線を掴める幅(px)。 */
const EDIT_HIT_PX = 14;

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

function renderPrim(p: ElevationPrimitive, i: number, S: ToScreen, overridden = false) {
  if (p.kind === 'line') {
    const a = S(p.x1, p.y1), b = S(p.x2, p.y2);
    return <Line key={i} points={[a.x, a.y, b.x, b.y]} stroke={p.stroke} strokeWidth={p.width} dash={p.dash} opacity={p.opacity ?? 1} strokeScaleEnabled={false} listening={false} />;
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

/**
 * E-8-v2d: 編集モード用。ローカル座標のままノードを作る（Group の変換が画面へ写す）。
 * `s` は Group の拡大率で、線幅・文字サイズを px 固定に戻すために使う。
 */
function renderPrimLocal(
  p: ElevationPrimitive, key: string | number, s: number,
  opts: { selected: boolean; overridden: boolean; interactive: boolean },
) {
  const hit = EDIT_HIT_PX / s;
  const selStroke = '#FF6B35';
  if (p.kind === 'line') {
    return (
      <Line
        key={key} points={[p.x1, p.y1, p.x2, p.y2]}
        stroke={opts.selected ? selStroke : p.stroke}
        strokeWidth={(opts.selected ? p.width + 2 : p.width)}
        dash={p.dash} opacity={p.opacity ?? 1}
        strokeScaleEnabled={false}
        hitStrokeWidth={opts.interactive ? hit : 0}
        listening={opts.interactive}
      />
    );
  }
  if (p.kind === 'rect') {
    return (
      <Rect
        key={key} x={p.x} y={p.y} width={p.w} height={p.h}
        fill={withAlpha(p.fill, p.fillOpacity)}
        stroke={opts.selected ? selStroke : p.stroke}
        strokeWidth={(p.width ?? 0) + (opts.selected ? 2 : 0)}
        strokeScaleEnabled={false} listening={opts.interactive}
      />
    );
  }
  if (p.kind === 'polygon') {
    return (
      <Line
        key={key} points={p.points} closed
        fill={withAlpha(p.fill, p.fillOpacity)}
        stroke={opts.selected ? selStroke : p.stroke}
        strokeWidth={(p.width ?? 0) + (opts.selected ? 2 : 0)}
        strokeScaleEnabled={false} listening={opts.interactive}
      />
    );
  }
  const size = p.size / s;
  const est = p.text.length * size * 0.6;
  const offX = p.anchor === 'middle' ? est / 2 : p.anchor === 'end' ? est : 0;
  return (
    <Text
      key={key} x={p.x} y={p.y} text={p.text} fontSize={size}
      fill={opts.selected ? selStroke : (opts.overridden ? '#FF9F1C' : p.fill)}
      offsetX={offX} fontFamily="monospace" listening={opts.interactive}
    />
  );
}

/** primitives のローカル bbox（生座標・グリッド）。通常表示の hit 領域と選択枠に使う。 */
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
 * 立面編集モードの描画（E-8b → E-8-v2d で座標系を統一）。
 * 部材ブロック（parts）を Konva 標準の当たり判定で選択・ドラッグし、
 * ドラッグ終了時は「最寄りの有効スロット」へ吸着させる（はまる場所にしかはまらない）。
 */
function ElevationEditGroup({ view, gridPx, panX, panY }: {
  view: ElevationView; gridPx: number; panX: number; panY: number;
}) {
  const selectedId = useCanvasStore((s) => s.elevationEditSelectedId);
  const setSelectedId = useCanvasStore((s) => s.setElevationEditSelectedId);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const addDraft = useCanvasStore((s) => s.elevationAddDraft);
  const prims = useMemo(() => composeViewPrimitives(view), [view]);
  const overridden = useMemo(() => overriddenTextIds(view.edits), [view.edits]);
  const groupRef = useRef<Konva.Group>(null);

  // ローカル → 画面 の変換は Group に持たせる（子はローカル座標のまま置く）。
  const s = gridPx * view.scale;
  const gx = view.originGrid.x * gridPx + panX;
  const gy = view.originGrid.y * gridPx + panY;

  /** ポインタの Group ローカル座標（Konva 標準・手計算の逆変換をしない）。 */
  const pointerLocal = (): { x: number; y: number } | null => {
    const g = groupRef.current;
    const p = g?.getRelativePointerPosition();
    return p ? { x: p.x, y: p.y } : null;
  };

  const parts = view.parts ?? [];
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  /** 部材を最寄りの有効スロットへ移す（同じスロットなら何もしない）。 */
  const moveToNearestSlot = (part: ElevationPart) => {
    const geom = view.geom;
    const local = pointerLocal();
    if (!geom || !local) return;
    const slot = snapToSlot({ x: local.x, yMm: -local.y * 10 }, geom, part.kind);
    if (!slot) return;
    const same = slot.spanIndex === part.spanIndex && slot.postIndex === part.postIndex
      && slot.levelMm === part.levelMm && slot.scaffoldIndex === part.scaffoldIndex;
    if (same) return;
    if (slotOccupied(parts.filter((p) => p.id !== part.id), slot)) return; // 埋まっている位置へは移さない
    const moved: ElevationPart = { ...slotToPart(slot, part.id), origin: 'manual' };
    useCanvasStore.getState().setElevationParts(
      view.id, parts.map((p) => (p.id === part.id ? moved : p)),
    );
  };

  // 部材パレット: 有効スロットをゴースト表示し、タップで吸着配置（ローカル座標）。
  const palette = (() => {
    if (!addTool || !view.geom || addTool === 'line' || addTool === 'text') return null;
    const geom = view.geom;
    const slots = buildElevationSlots(geom, addTool);
    if (slots.length === 0) return null;
    const place = (slot: ElevationSlot) => {
      if (slotOccupied(parts, slot)) return;
      useCanvasStore.getState().addElevationPart(view.id, slotToPart(slot, nextPartId(parts, slot.kind)));
    };
    return (
      <>
        {slots.map((slot, i) => {
          const sg = geom.scaffolds[slot.scaffoldIndex];
          const isPostKind = slot.kind === 'post' || slot.kind === 'jack';
          const topMm = isPostKind ? sg.topRailMm : (slot.levelMm ?? 0) + 225;
          const botMm = isPostKind ? sg.jackTopMm : (slot.levelMm ?? 0) - 225;
          const padX = isPostKind ? 6 / s : 0;
          const taken = slotOccupied(parts, slot);
          return (
            <Rect
              key={`slot-${i}`}
              x={slot.x0 - padX} y={-topMm / 10}
              width={(slot.x1 - slot.x0) + padX * 2} height={(topMm - botMm) / 10}
              fill={taken ? '#888888' : '#FF6B35'} opacity={taken ? 0.06 : 0.14}
              stroke={taken ? undefined : '#FF6B35'} strokeWidth={taken ? 0 : 1}
              strokeScaleEnabled={false} dash={[3, 3]}
              onClick={() => place(slot)} onTap={() => place(slot)}
            />
          );
        })}
      </>
    );
  })();

  // 文字追加（E-8c の入口。自由線は v2e で撤去予定）。
  const textSurface = (() => {
    if (addTool !== 'text' && addTool !== 'line') return null;
    const lb = localBounds(view);
    if (!lb) return null;
    const onPoint = () => {
      const L = pointerLocal();
      if (!L) return;
      const st = useCanvasStore.getState();
      if (addTool === 'text') {
        const id = nextAddId(view, 'text');
        st.setElevationEdits(view.id, withAdd(view.edits, {
          kind: 'text', x: L.x, y: L.y, text: '文字', size: 9, fill: '#c9c9c6', anchor: 'start',
          meta: { kind: 'text', id, x: Math.round(L.x * 10) / 10 },
        }));
        st.setElevationAddTool(null);
        st.setElevationTextEditTargetId(id);
        return;
      }
      if (!addDraft) { st.setElevationAddDraft(L); return; }
      const id = nextAddId(view, 'line');
      st.setElevationEdits(view.id, withAdd(view.edits, {
        kind: 'line', x1: addDraft.x, y1: addDraft.y, x2: L.x, y2: L.y, stroke: '#c9c9c6', width: 1,
        meta: { kind: 'text', id, x: Math.round(addDraft.x * 10) / 10 },
      }));
      st.setElevationAddDraft(null);
    };
    const pad = 4;
    return (
      <Rect
        x={lb.minX - pad} y={lb.minY - pad}
        width={(lb.maxX - lb.minX) + pad * 2} height={(lb.maxY - lb.minY) + pad * 2}
        fill="#000" opacity={0.001} onClick={onPoint} onTap={onPoint}
      />
    );
  })();

  return (
    <Group ref={groupRef} x={gx} y={gy} scaleX={s} scaleY={s}>
      {prims.map((p, i) => {
        const id = p.meta?.id;
        const part = id ? partById.get(id) : undefined;
        const interactive = !addTool;
        const node = renderPrimLocal(p, id ?? i, s, {
          selected: !!id && id === selectedId,
          overridden: !!id && overridden.has(id),
          interactive,
        });
        if (!interactive || !id) return node;
        // 部材は掴んで隣の有効位置へ。背景（寸法・文字など）は選択のみ。
        return (
          <Group
            key={id}
            draggable={!!part}
            dragDistance={4}
            onDragEnd={(e) => {
              e.target.position({ x: 0, y: 0 });
              if (part) moveToNearestSlot(part);
            }}
            onClick={() => setSelectedId(id)}
            onTap={() => setSelectedId(id)}
            onDblClick={() => { if (p.kind === 'text') useCanvasStore.getState().setElevationTextEditTargetId(id); }}
            onDblTap={() => { if (p.kind === 'text') useCanvasStore.getState().setElevationTextEditTargetId(id); }}
          >
            {node}
          </Group>
        );
      })}
      {palette}
      {textSurface}
      {addDraft && (
        <Rect x={addDraft.x - 4 / s} y={addDraft.y - 4 / s} width={8 / s} height={8 / s} fill="#FF6B35" listening={false} />
      )}
    </Group>
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
      return composeViewPrimitives(view).map((p, i) => renderPrim(p, i, worldOf, !!p.meta && ov.has(p.meta.id)));
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
