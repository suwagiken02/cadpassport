'use client';

// ============================================================
// 立面ビューのキャンバス描画レイヤー（E-4b / E-6e-perf / E-6e-perf2 / E-8-v2）。
//  ・elevationViews を Konva グループとして描画（primitives→Line/Rect/Circle/Text）。
//  ・パン: Group の x/y 平行移動に逃がし、子ノードは「確定 gridPx」で memo 化（再生成しない）。
//  ・ズーム(E-6e-perf2): ズーム中は Group の scale で追従し、子の再生成・再cache をしない。
//    ズームが止まったら 200ms デバウンスで確定倍率を更新 → 1 回だけ再生成（鮮明化）。
//
// E-8-v2j: 「編集モード」を廃止した。平面に編集モードが無いのと同じで、立面の部材も
//   通常の select でそのまま触れるべき（鮎澤氏）。
//   ・素の select / 消去モード → 部材ごとに当たり判定を持つ対話版で描く
//       部材タップ = 選択 / 部材ドラッグ = コマ吸着移動 / 消去ツール = 部材削除
//   ・それ以外（閲覧・他ツール中）→ 従来どおり cache() した 1 枚絵（軽い）
//   ・図全体は「背景」で扱う。変換 Group の“下”に画面座標の透明 Rect を敷き、
//     そこをタップ＝ビュー選択、ドラッグ＝ビュー移動、消去＝ビュー削除。
//     部材は Group 側（上）にあるので部材が優先して拾う。
//     ※ドラッグ可能な Group を入れ子にすると Konva が両方掴んでしまうので、
//       ビュー移動は「入れ子にしない兄弟の Rect」で受ける。
//  ・座標系: 子は立面ローカル（横=グリッド、縦=mm/10・GL=0・上が負）で置き、Group の
//    x/y/scale が画面へ写す。線幅・文字サイズだけ px 固定に戻す（scale で割る）。
//  ・スロットは面軸の生グリッド、描画はローカル（minXg を引いた値）。境界で必ず変換する。
// ============================================================
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer, Group, Circle, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPlainSelectMode } from '@/lib/konva/toolMode';
import { nextAddId, overriddenTextIds, withAdd, withHide } from '@/lib/konva/elevation/elevationEdits';
import { composeViewPrimitives } from '@/lib/konva/elevation/elevationViewCompose';
import {
  ELEV_PART_STYLE, ELEV_SELECT_COLOR, partHitPx, partWidthPx,
} from '@/lib/konva/elevation/elevationPartStyle';
import {
  buildElevationSlots, nextPartId, slotKey, slotOccupied, slotToPart, snapToSlot, type ElevationSlot,
} from '@/lib/konva/elevation/elevationSlots';
import { withPartDeleted, type ElevationPart } from '@/lib/konva/elevation/elevationParts';
import type { ElevationPrimitive, ElevationView } from '@/types';

type ToScreen = (lx: number, ly: number) => { x: number; y: number };

/** ズーム停止後に再cache / 再生成するまでの待ち時間（ms）。 */
const RECACHE_DEBOUNCE_MS = 200;
/** ドラッグと判定するまでの移動量(px)。指のタップのぶれ（数 px）より大きくする。 */
const EDIT_DRAG_PX = 10;
/** 吸着プレビューの帯の太さ(px)。部材より太く、下に敷く。 */
const SNAP_BAND_PX = 12;
/** 埋まっている位置のプレビュー色（そこには置けない）。 */
const SNAP_TAKEN_COLOR = '#8a8a86';
/** 当たり判定用に bbox を広げる余白（ローカル・グリッド）。 */
const BG_PAD = 4;

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

/**
 * E-8-v2h: 部材の線幅・半径は「平面と同じ実寸比」で描き、縮小時は下限 px で潰さない。
 * pxPerGrid は 1 グリッドの画面 px（= gridPx × view.scale）。
 */
function renderPrim(p: ElevationPrimitive, i: number, S: ToScreen, pxPerGrid: number, overridden = false) {
  if (p.kind === 'line') {
    const a = S(p.x1, p.y1), b = S(p.x2, p.y2);
    const w = partWidthPx(p.width, p.widthGrid, pxPerGrid);
    return <Line key={i} points={[a.x, a.y, b.x, b.y]} stroke={p.stroke} strokeWidth={w} dash={p.dash} opacity={p.opacity ?? 1} lineCap="round" strokeScaleEnabled={false} listening={false} />;
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
  if (p.kind === 'circle') {
    const a = S(p.x, p.y);
    const r = partWidthPx(p.r, p.rGrid, pxPerGrid);
    return <Circle key={i} x={a.x} y={a.y} radius={r} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth ?? 0} strokeScaleEnabled={false} opacity={p.opacity ?? 1} listening={false} />;
  }
  const a = S(p.x, p.y);
  const est = p.text.length * p.size * 0.6;
  const offX = p.anchor === 'middle' ? est / 2 : p.anchor === 'end' ? est : 0;
  // E-8c: ユーザーが上書きした文字は色で明示（生成値のままと区別できるように）。
  const fill = overridden ? '#FF9F1C' : p.fill;
  return <Text key={i} x={a.x} y={a.y} text={p.text} fontSize={p.size} fill={fill} offsetX={offX} fontFamily="monospace" listening={false} />;
}

/**
 * 対話版の描画。ローカル座標のままノードを作る（Group の変換が画面へ写す）。
 * `s` は Group の拡大率（= pxPerGrid）で、線幅・文字サイズを px 固定に戻すために使う。
 */
function renderPrimLocal(
  p: ElevationPrimitive, key: string | number, s: number,
  opts: { selected: boolean; overridden: boolean; interactive: boolean },
) {
  const selStroke = ELEV_SELECT_COLOR;
  // E-8-v2l/v2p: strokeScaleEnabled=false の shape では、Konva は hitStrokeWidth を
  //   「画面 px」として解釈する（HitContext._stroke が pixelRatio 変換で線を引く）。
  //   幅は partHitPx が部材の種類ごとに決める（支柱は細い縦線なので最優先で広げ、
  //   上下に並ぶ手摺・踏板は隣の段と食い合わない範囲で広げる）。
  const hitPx = (visualPx: number) => partHitPx(p.meta?.kind, visualPx, s);
  if (p.kind === 'line') {
    const w = partWidthPx(p.width, p.widthGrid, s);
    return (
      <Line
        key={key} points={[p.x1, p.y1, p.x2, p.y2]}
        stroke={opts.selected ? selStroke : p.stroke}
        strokeWidth={opts.selected ? w + 2 : w}
        dash={p.dash} opacity={p.opacity ?? 1} lineCap="round"
        strokeScaleEnabled={false}
        hitStrokeWidth={opts.interactive ? hitPx(w) : 0}
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
        strokeScaleEnabled={false}
        // ジャッキのベース記号など、小さい塗り面は輪郭のぶんだけ掴みしろを足す。
        hitStrokeWidth={opts.interactive ? hitPx(p.width ?? 0) : 0}
        listening={opts.interactive}
      />
    );
  }
  if (p.kind === 'circle') {
    const r = partWidthPx(p.r, p.rGrid, s);
    return (
      <Circle
        key={key} x={p.x} y={p.y} radius={(opts.selected ? r + 1 : r) / s}
        fill={opts.selected ? selStroke : p.fill}
        stroke={p.stroke} strokeWidth={p.strokeWidth ?? 0} strokeScaleEnabled={false}
        opacity={p.opacity ?? 1}
        // 小さい丸（支柱の端キャップ等）は、直径が掴みしろに届かないぶんを輪で足す。
        hitStrokeWidth={opts.interactive ? Math.max(0, hitPx(r * 2) - r * 2) : 0}
        listening={opts.interactive}
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

/**
 * E-8-v2f: 同じ部材のプリミティブ（太線＋丸ハンドル・帯＋輪郭）をひとまとめにする。
 * partsToPrimitives は 1 部材分を連続で出すので、meta.id の「連なり」で切ればよい。
 */
function groupByPartId(prims: ElevationPrimitive[]): { id?: string; from: number; items: ElevationPrimitive[] }[] {
  const out: { id?: string; from: number; items: ElevationPrimitive[] }[] = [];
  prims.forEach((p, i) => {
    const id = p.meta?.id;
    const last = out[out.length - 1];
    if (id && last && last.id === id) last.items.push(p);
    else out.push({ id, from: i, items: [p] });
  });
  return out;
}

/** primitives のローカル bbox（生座標・グリッド）。当たり判定と選択枠に使う。 */
function localBounds(view: ElevationView) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const p of view.primitives) {
    if (p.kind === 'line') { see(p.x1, p.y1); see(p.x2, p.y2); }
    else if (p.kind === 'rect') { see(p.x, p.y); see(p.x + p.w, p.y + p.h); }
    else if (p.kind === 'polygon') { for (let k = 0; k < p.points.length; k += 2) see(p.points[k], p.points[k + 1]); }
    else see(p.x, p.y); // text / circle（半径は px なので中心点だけ見る）
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

type CommonProps = {
  view: ElevationView;
  gridPx: number;
  panX: number;
  panY: number;
  mode: string;
  selected: boolean;
  setSelectedIds: (ids: string[]) => void;
  moveElevationView: (id: string, originGrid: { x: number; y: number }) => void;
};

/**
 * 対話版（E-8-v2j）。素の select / 消去モードで使う。
 * 部材ブロック（parts）を Konva 標準の当たり判定で選択・ドラッグし、
 * ドラッグ終了時は「最寄りの有効スロット」へ吸着させる（はまる場所にしかはまらない）。
 */
function ElevationInteractiveGroup({
  view, gridPx, panX, panY, mode, selected, setSelectedIds, moveElevationView,
}: CommonProps) {
  const selectedPartId = useCanvasStore((s) => s.elevationEditSelectedId);
  const setSelectedPartId = useCanvasStore((s) => s.setElevationEditSelectedId);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const prims = useMemo(() => composeViewPrimitives(view), [view]);
  const groups = useMemo(() => groupByPartId(prims), [prims]);
  const overridden = useMemo(() => overriddenTextIds(view.edits), [view.edits]);
  const groupRef = useRef<Konva.Group>(null);
  /** ドラッグ中の吸着先（E-8-v2g のスナップフィードバック）。 */
  const [preview, setPreview] = useState<{ slot: ElevationSlot; taken: boolean } | null>(null);

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
  const minXg = view.geom?.minXg ?? 0;
  /** スロットの生グリッド → 描画のローカル座標。 */
  const toLocalX = (rawX: number) => rawX - minXg;

  /** ポインタ位置に最も近い有効スロット（生グリッドで比較する）。 */
  const nearestSlot = (kind: ElevationPart['kind']): ElevationSlot | null => {
    const geom = view.geom;
    const local = pointerLocal();
    if (!geom || !local) return null;
    // E-8-v2n: 既存足場の外側（仮想の支柱位置・コマ）へも吸着させる。
    return snapToSlot({ x: local.x + geom.minXg, yMm: -local.y * 10 }, geom, kind, { extend: true });
  };

  /** ドラッグ中: 最寄りコマを一時ハイライト（置けるかどうかも色で見せる）。 */
  const onPartDragMove = (part: ElevationPart) => {
    const slot = nearestSlot(part.kind);
    if (!slot) { if (preview) setPreview(null); return; }
    const taken = slotOccupied(parts.filter((p) => p.id !== part.id), slot);
    if (!preview || slotKey(preview.slot) !== slotKey(slot) || preview.taken !== taken) {
      setPreview({ slot, taken });
    }
  };

  /** 部材を最寄りの有効スロットへ移す（同じスロットなら何もしない）。 */
  const moveToNearestSlot = (part: ElevationPart) => {
    setPreview(null);
    const slot = nearestSlot(part.kind);
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

  /** 部材／背景要素をタップしたとき。消去ツール中は削除、そうでなければ選択。 */
  const onPrimitiveTap = (id: string) => {
    const st = useCanvasStore.getState();
    if (mode === 'erase') {
      if (partById.has(id)) st.setElevationParts(view.id, withPartDeleted(parts, id));
      else st.setElevationEdits(view.id, withHide(view.edits, id));   // 寸法・文字は削除マーク
      if (selectedPartId === id) setSelectedPartId(null);
      return;
    }
    setSelectedIds([view.id]);   // 部材を触ったビューを選択状態にする（パレットが出る）
    setSelectedPartId(id);
  };

  /** 吸着先スロットのハイライト。部材と同じ場所に敷いて「ここにはまる」を見せる。 */
  const snapPreview = (() => {
    if (!preview || !view.geom) return null;
    const sg = view.geom.scaffolds[preview.slot.scaffoldIndex];
    if (!sg) return null;
    const c = preview.taken ? SNAP_TAKEN_COLOR : ELEV_SELECT_COLOR;
    const x0 = toLocalX(preview.slot.x0), x1 = toLocalX(preview.slot.x1);
    const isPostKind = preview.slot.kind === 'post' || preview.slot.kind === 'jack';
    if (isPostKind) {
      return (
        <Line
          points={[x0, -sg.jackTopMm / 10, x0, -sg.topRailMm / 10]}
          stroke={c} strokeWidth={SNAP_BAND_PX} opacity={0.35} lineCap="round"
          strokeScaleEnabled={false} listening={false}
        />
      );
    }
    const y = -(preview.slot.levelMm ?? 0) / 10;
    const kh = ELEV_PART_STYLE.komaHalfGrid;
    return (
      <>
        <Line
          points={[x0, y, x1, y]}
          stroke={c} strokeWidth={SNAP_BAND_PX} opacity={0.35} lineCap="round"
          strokeScaleEnabled={false} listening={false}
        />
        {/* 吸着先のコマ（両端の支柱の受け金具）を強調する */}
        {[x0, x1].map((cx, i) => (
          <Line
            key={`koma-${i}`} points={[cx - kh, y, cx + kh, y]}
            stroke={c} strokeWidth={ELEV_PART_STYLE.komaWidthPx + 2} opacity={0.95}
            strokeScaleEnabled={false} listening={false}
          />
        ))}
      </>
    );
  })();

  // 部材パレット: 有効スロットをゴースト表示し、タップで吸着配置（選択中のビューだけ）。
  const palette = (() => {
    if (!selected || !addTool || !view.geom || addTool === 'text') return null;
    const geom = view.geom;
    const slots = buildElevationSlots(geom, addTool, { extend: true });
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
          const topMm = isPostKind ? sg.topRailMm : (slot.levelMm ?? 0) + 150;
          const botMm = isPostKind ? sg.jackTopMm : (slot.levelMm ?? 0) - 150;
          const padX = isPostKind ? 6 / s : 0;
          const taken = slotOccupied(parts, slot);
          return (
            <Rect
              key={`slot-${i}`}
              x={toLocalX(slot.x0) - padX} y={-topMm / 10}
              width={(slot.x1 - slot.x0) + padX * 2} height={(topMm - botMm) / 10}
              // E-8-v2n: 既存足場の外側（仮想の支柱位置・コマ）は薄く。置けることは同じ。
              fill={taken ? '#888888' : ELEV_SELECT_COLOR}
              opacity={taken ? 0.06 : (slot.virtual ? 0.07 : 0.14)}
              stroke={taken ? undefined : ELEV_SELECT_COLOR} strokeWidth={taken ? 0 : 1}
              strokeScaleEnabled={false} dash={[3, 3]}
              onClick={() => place(slot)} onTap={() => place(slot)}
            />
          );
        })}
      </>
    );
  })();

  const lb = localBounds(view);

  // 文字追加（E-8c の入口）。選択中のビューで「文字」ツールを選んだときだけ。
  const textSurface = (() => {
    if (!selected || addTool !== 'text' || !lb) return null;
    const onPoint = () => {
      const L = pointerLocal();
      if (!L) return;
      const st = useCanvasStore.getState();
      const id = nextAddId(view, 'text');
      st.setElevationEdits(view.id, withAdd(view.edits, {
        kind: 'text', x: L.x, y: L.y, text: '文字', size: 9, fill: '#c9c9c6', anchor: 'start',
        meta: { kind: 'text', id, x: Math.round(L.x * 10) / 10 },
      }));
      st.setElevationAddTool(null);
      st.setElevationTextEditTargetId(id);
    };
    return (
      <Rect
        x={lb.minX - BG_PAD} y={lb.minY - BG_PAD}
        width={(lb.maxX - lb.minX) + BG_PAD * 2} height={(lb.maxY - lb.minY) + BG_PAD * 2}
        fill="#000" opacity={0.001} onClick={onPoint} onTap={onPoint}
      />
    );
  })();

  // 背景（＝図全体）の当たり判定。変換 Group の「下」に画面座標で敷く。
  //   タップ＝ビュー選択 / ドラッグ＝ビュー移動 / 消去＝ビュー削除。
  //   部材は Group 側（上）にあるので部材が優先して拾う。
  const bg = lb ? (() => {
    const ax = gx + (lb.minX - BG_PAD) * s, ay = gy + (lb.minY - BG_PAD) * s;
    const bx = gx + (lb.maxX + BG_PAD) * s, by = gy + (lb.maxY + BG_PAD) * s;
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  })() : null;

  const onBgTap = () => {
    if (mode === 'erase') { useCanvasStore.getState().removeElement(view.id); return; }
    setSelectedIds([view.id]);
    setSelectedPartId(null);
  };
  /** ドラッグ中は変換 Group を一緒に動かして見た目を追従させる（Rect は透明なので単体では見えない）。 */
  const onBgDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const g = groupRef.current;
    if (!g || !bg) return;
    g.position({ x: gx + (e.target.x() - bg.x), y: gy + (e.target.y() - bg.y) });
  };
  const onBgDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const g = groupRef.current;
    if (!bg) return;
    const dx = (e.target.x() - bg.x) / gridPx, dy = (e.target.y() - bg.y) / gridPx;
    e.target.position({ x: bg.x, y: bg.y });
    g?.position({ x: gx, y: gy });
    const nx = Math.round(view.originGrid.x + dx), ny = Math.round(view.originGrid.y + dy);
    if (nx === view.originGrid.x && ny === view.originGrid.y) return; // 動いていなければ履歴を汚さない
    moveElevationView(view.id, { x: nx, y: ny });
  };

  // 選択枠（ビュー自体が選択されているとき）。
  const selRect = selected && bg ? { x: bg.x, y: bg.y, w: bg.w, h: bg.h } : null;

  return (
    <>
      {bg && (
        <Rect
          x={bg.x} y={bg.y} width={bg.w} height={bg.h}
          fill="#000" opacity={0}
          draggable={mode === 'select'} dragDistance={6}
          onDragMove={onBgDragMove} onDragEnd={onBgDragEnd}
          onClick={onBgTap} onTap={onBgTap}
        />
      )}
      <Group ref={groupRef} x={gx} y={gy} scaleX={s} scaleY={s}>
        {snapPreview}
        {groups.map(({ id, from, items }) => {
          const part = id ? partById.get(id) : undefined;
          const interactive = !addTool;
          const isSel = !!id && id === selectedPartId;
          const nodes = items.map((p, k) => renderPrimLocal(p, `${from}-${k}`, s, {
            selected: isSel,
            overridden: !!id && overridden.has(id),
            interactive,
          }));
          if (!interactive || !id) return <React.Fragment key={`g-${from}`}>{nodes}</React.Fragment>;
          const isText = items.length === 1 && items[0].kind === 'text';
          // 部材は掴んで隣の有効位置へ。背景要素（寸法・文字）は選択のみ。
          return (
            <Group
              key={`g-${from}`}
              draggable={!!part && mode === 'select'}
              // E-8-v2l: 指のタップは必ず数 px ぶれる。dragDistance が小さいと Konva が
              //   ドラッグ扱いにして click/tap を発火しなくなり（DD._endDragBefore が
              //   _touchListenClick=false にする）、しかも同じスロットへ吸着し直すので
              //   「タップしても選べない・動かしても戻る」に見えていた。
              //   指向けの距離まで上げ、掴んだ時点で選択しておく（＝ぶれたタップ＝選択）。
              dragDistance={EDIT_DRAG_PX}
              onDragStart={() => { if (part && mode === 'select') onPrimitiveTap(id); }}
              onDragMove={() => { if (part) onPartDragMove(part); }}
              onDragEnd={(e) => {
                e.target.position({ x: 0, y: 0 });
                if (part) moveToNearestSlot(part);
              }}
              onClick={() => onPrimitiveTap(id)}
              onTap={() => onPrimitiveTap(id)}
              onDblClick={() => { if (isText && mode === 'select') useCanvasStore.getState().setElevationTextEditTargetId(id); }}
              onDblTap={() => { if (isText && mode === 'select') useCanvasStore.getState().setElevationTextEditTargetId(id); }}
            >
              {nodes}
            </Group>
          );
        })}
        {palette}
        {textSurface}
      </Group>
      {selRect && (
        <Rect x={selRect.x - 4} y={selRect.y - 4} width={selRect.w + 8} height={selRect.h + 8}
          stroke="#378ADD" strokeWidth={1} dash={[6, 4]} listening={false} />
      )}
    </>
  );
}

/** 閲覧・他ツール中の描画（cache() した 1 枚絵。従来どおり軽い）。 */
function ElevationViewGroup({ view, gridPx, panX, panY, mode, selected, setSelectedIds, moveElevationView }: CommonProps) {
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
      const pxPerGrid = cachedGridPx * view.scale;
      return composeViewPrimitives(view)
        .map((p, i) => renderPrim(p, i, worldOf, pxPerGrid, !!p.meta && ov.has(p.meta.id)));
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
  //
  // E-8-v2l: useEffect（ペイント後）ではなく useLayoutEffect（ペイント前）で焼く。
  //   cachedGridPx が G_old → G_new に確定するコミットでは、子の座標と followScale は
  //   その場で新しくなるのに、キャッシュ画像だけ G_old のままになる。するとその 1 フレームは
  //     screen_bad − pan = (screen_good − pan) × (G_old / G_new)
  //   ＝ pan 原点を中心にズーム比の逆数倍された位置に描かれる。立面は原点より右下に置くので、
  //   拡大＝左上へ、縮小＝右下へ一瞬ワープして戻る（実機の症状と向きが一致）。
  //   ペイント前に焼き直せば、ずれたフレーム自体が発生しない。
  const groupRef = useRef<Konva.Group>(null);
  useLayoutEffect(() => {
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

  // 閲覧中も当たり判定は生かす（タップで選択できる）。
  const listening = mode === 'select' || mode === 'erase' || mode === 'move-select' || mode === 'view';
  const followScale = gridPx / cachedGridPx;

  const onClick = () => {
    if (mode === 'view') return;  // 閲覧中は単タップで選択しない（従来どおり触れない）
    if (mode === 'erase') { useCanvasStore.getState().removeElement(view.id); return; }
    setSelectedIds([view.id]);
  };
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const g = e.target;
    const dx = (g.x() - panX) / gridPx, dy = (g.y() - panY) / gridPx;
    g.x(panX); g.y(panY);
    const gx = Math.round(view.originGrid.x + dx), gy = Math.round(view.originGrid.y + dy);
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
      <Group ref={groupRef} x={panX} y={panY} scaleX={followScale} scaleY={followScale} draggable={mode === 'select'} dragDistance={6} onDragEnd={onDragEnd} onClick={onClick} onTap={onClick} listening={listening}>
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
  const selectActive = useCanvasStore((s) => s.selectActive);
  // E-8-v2l-hotfix3: ツールフラグは「1 つずつ」購読する。
  //   zustand v5 の useStore は selector の結果をメモ化しないので、オブジェクトを組み立てて
  //   返す selector は useSyncExternalStore から見て毎回別値になる。React はこれを
  //   「ストアが変わり続けている」と解釈して forceStoreRerender(SyncLane) を打ち続け、
  //   このレイヤーだけが上限なしで再レンダリングし続ける（＝主スレッドを食い潰す）。
  //   参照: react-dom updateStoreInstance → checkIfSnapshotChanged → forceStoreRerender。
  //   プリミティブで購読すればスナップショットが安定し、ループは起きない。
  const isHeightMarkerMode = useCanvasStore((s) => s.isHeightMarkerMode);
  const isRidgeLineMode = useCanvasStore((s) => s.isRidgeLineMode);
  const isMeasuring = useCanvasStore((s) => s.isMeasuring);
  const isMagnetPinMode = useCanvasStore((s) => s.isMagnetPinMode);
  const isAreaDesignationMode = useCanvasStore((s) => s.isAreaDesignationMode);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const pendingTargetType = useCanvasStore((s) => s.pendingTargetType);

  const gridPx = INITIAL_GRID_PX * zoom;
  const arr = views ?? [];
  // E-8-v2j: 素の select（選択ON）と消去モードでは部材を直接触れる対話版で描く。
  //   それ以外（閲覧・他ツール中）はキャッシュ版のままにして軽さを保つ。
  const toolFlags = {
    mode, isHeightMarkerMode, isRidgeLineMode, isMeasuring, isMagnetPinMode,
    isAreaDesignationMode, isReorderMode,
    moveSelectActive: mode === 'move-select',
    pendingTargetType,
  };
  const interactive = (isPlainSelectMode(toolFlags) && selectActive) || mode === 'erase';
  if (arr.length === 0) return null;

  return (
    <Layer>
      {arr.map((view) => {
        const common = {
          view, gridPx, panX, panY, mode,
          selected: selectedIds.includes(view.id),
          setSelectedIds, moveElevationView,
        };
        return interactive
          ? <ElevationInteractiveGroup key={view.id} {...common} />
          : <ElevationViewGroup key={view.id} {...common} />;
      })}
    </Layer>
  );
}
