'use client';

// ============================================================
// キャンバス直下の手動部材レイヤー (= E-8-v5a)。
//
// 「自動は構造を持つ、手動は自由」。ここに描かれる部材は立面ビューに所属せず、
// キャンバスの絶対座標に実寸で住む。だから
//   ・立面図が 1 つも無いまっさらなキャンバスにも置ける
//   ・立面ビューを動かしても付いていかない
//   ・再生成しても消えない（引き継ぎ・孤立判定そのものが要らない）
//
// 見た目・吸着・回転は立面部材とまったく同じ実装を共有する（freeParts.ts と
// ElevationViewLayer の renderPrimLocal）。ので「立面で置いた部材」と「キャンバスに
// 置いた部材」が別物に見えることはない。
//
// 置き先の切り分け（既存の立面編集を一切変えないための約束）:
//   ・立面ビューを選択中にパレットで置く → 従来どおりそのビューの parts へ（現行のまま）
//   ・どのビューも選択していないときに置く → ここ（freeParts）へ
// つまり今まで「何も起きなかった」操作だけを拾う。既存の動きは素通しする。
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Layer, Group, Rect } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPlainSelectMode } from '@/lib/konva/toolMode';
import {
  GRID_MM, movePart, type ElevationPart,
} from '@/lib/konva/elevation/elevationParts';
import { snapJoint } from '@/lib/konva/elevation/elevationJoints';
import {
  freePartsToPrimitives, newFreePart, nextFreePartId, type FreePart,
} from '@/lib/konva/freeParts';
import { groupByPartId, renderPrimLocal } from './ElevationViewLayer';

/** 接合点へ吸着する画面距離(px)。立面と同じ値（同じ操作感にする）。 */
const JOINT_SNAP_PX = 22;
/** ドラッグと判定するまでの移動量(px)。指のタップのぶれより大きく。 */
const EDIT_DRAG_PX = 10;

export default function FreePartLayer() {
  const freeParts = useCanvasStore((s) => s.canvasData.freeParts);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const selectActive = useCanvasStore((s) => s.selectActive);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const addSize = useCanvasStore((s) => s.elevationAddSize);
  const addFlip = useCanvasStore((s) => s.elevationAddFlip);
  const addAngle = useCanvasStore((s) => s.elevationAddAngle);
  const dropAt = useCanvasStore((s) => s.elevationDropAt);
  // E-8-v2l-hotfix3 と同じ理由でツールフラグは 1 つずつ購読する
  //   （オブジェクトを組み立てる selector は zustand v5 で毎回別値になり、再描画が止まらない）。
  const isHeightMarkerMode = useCanvasStore((s) => s.isHeightMarkerMode);
  const isRidgeLineMode = useCanvasStore((s) => s.isRidgeLineMode);
  const isMeasuring = useCanvasStore((s) => s.isMeasuring);
  const isMagnetPinMode = useCanvasStore((s) => s.isMagnetPinMode);
  const isAreaDesignationMode = useCanvasStore((s) => s.isAreaDesignationMode);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const pendingTargetType = useCanvasStore((s) => s.pendingTargetType);

  /** 指/カーソルが指している画面位置（シャドー表示用）。 */
  const [hoverScreen, setHoverScreen] = useState<{ x: number; y: number } | null>(null);
  const layerRef = React.useRef<Konva.Layer>(null);

  const parts = useMemo(() => freeParts ?? [], [freeParts]);
  const gridPx = INITIAL_GRID_PX * zoom;

  const plain = isPlainSelectMode({
    mode, isHeightMarkerMode, isRidgeLineMode, isMeasuring, isMagnetPinMode,
    isAreaDesignationMode, isReorderMode,
    moveSelectActive: mode === 'move-select',
    pendingTargetType,
  });
  const interactive = (plain && selectActive) || mode === 'erase';
  /** 立面ビューを選択中は、従来どおりそのビューが配置を受け持つ。 */
  const viewSelected = (views ?? []).some((v) => selectedIds.includes(v.id));
  const placing = interactive && !!addTool && addTool !== 'text' && !viewSelected;

  const prims = useMemo(() => freePartsToPrimitives(parts), [parts]);
  const groups = useMemo(() => groupByPartId(prims), [prims]);
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  /** 画面 px → キャンバスのグリッド。 */
  const toGrid = (pt: { x: number; y: number }) => ({
    x: (pt.x - panX) / gridPx, y: (pt.y - panY) / gridPx,
  });

  /** 置こうとしている部材（シャドー兼、確定時の実体）。接合が近ければ吸着する。 */
  const draftAt = (atGrid: { x: number; y: number }): FreePart | null => {
    if (!addTool || addTool === 'text') return null;
    const isPost = addTool === 'post' || addTool === 'postExt';
    const draft = newFreePart(addTool, 'draft', atGrid, {
      komaCount: isPost ? addSize : undefined,
      sizeMm: isPost ? undefined : addSize,
      flip: addFlip,
      angleDeg: addAngle,
    });
    const snap = snapJoint(draft, parts, undefined, { dxMm: 0, dyMm: 0 }, {
      pxPerMm: gridPx / GRID_MM, tolPx: JOINT_SNAP_PX,
    });
    return (snap.dxMm || snap.dyMm) ? movePart(draft, undefined, snap) : draft;
  };

  const placeAtScreen = (pt: { x: number; y: number }) => {
    if (!addTool || addTool === 'text') return;
    const draft = draftAt(toGrid(pt));
    if (!draft) return;
    useCanvasStore.getState().addFreePart({ ...draft, id: nextFreePartId(parts, addTool) });
  };

  /**
   * パレットから指で引き出して離したとき (= E-8-v3c と同じ受け口)。
   * 立面ビューを選択していないときだけここが受ける（選択中は ElevationViewLayer が受ける）。
   */
  useEffect(() => {
    if (!dropAt || !placing) return;
    const box = layerRef.current?.getStage()?.container().getBoundingClientRect();
    if (!box) return;
    placeAtScreen({ x: dropAt.clientX - box.left, y: dropAt.clientY - box.top });
    useCanvasStore.getState().setElevationDropAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropAt, placing]);

  /** ドラッグ量(グリッド) → 吸着込みの移動量(mm)。 */
  const dragMove = (part: ElevationPart, d: { x: number; y: number }) => {
    const move = { dxMm: d.x * GRID_MM, dyMm: -d.y * GRID_MM };
    const snap = snapJoint(part, parts, undefined, move, {
      pxPerMm: gridPx / GRID_MM, tolPx: JOINT_SNAP_PX,
    });
    return { dxMm: move.dxMm + snap.dxMm, dyMm: move.dyMm + snap.dyMm };
  };

  const dropPart = (part: ElevationPart, d: { x: number; y: number }) => {
    const move = dragMove(part, d);
    if (Math.abs(move.dxMm) < 1e-6 && Math.abs(move.dyMm) < 1e-6) return;
    useCanvasStore.getState().setFreePart(part.id, movePart(part, undefined, move));
  };

  /** タップ: 消去ツール中は削除、そうでなければ既存の選択経路（selectedIds）へ乗せる。 */
  const onPartTap = (id: string) => {
    const st = useCanvasStore.getState();
    if (mode === 'erase') { st.removeElement(id); return; }
    st.setSelectedIds([id]);
  };

  const draftPreview = (() => {
    if (!placing || !hoverScreen) return null;
    const draft = draftAt(toGrid(hoverScreen));
    if (!draft) return null;
    return (
      <Group opacity={0.45} listening={false}>
        {freePartsToPrimitives([draft]).map((p, k) => renderPrimLocal(p, `draft-${k}`, gridPx, {
          selected: false, overridden: false, interactive: false,
        }))}
      </Group>
    );
  })();

  // 部材も置き場所も無いなら何も出さない（従来どおりのキャンバス）。
  if (parts.length === 0 && !placing) return null;

  return (
    <Layer ref={layerRef}>
      {/* 置くための面。キャンバス全域に敷く（パレットで部材を選んでいる間だけ）。 */}
      {placing && (
        <Rect
          x={-1e5} y={-1e5} width={2e5} height={2e5} fill="#000" opacity={0}
          onMouseMove={() => {
            const p = layerRef.current?.getStage()?.getPointerPosition();
            if (p) setHoverScreen(p);
          }}
          onMouseLeave={() => setHoverScreen(null)}
          onTouchMove={() => {
            const p = layerRef.current?.getStage()?.getPointerPosition();
            if (p) setHoverScreen(p);
          }}
          onClick={() => {
            const p = layerRef.current?.getStage()?.getPointerPosition();
            if (p) placeAtScreen(p);
          }}
          onTap={() => {
            const p = layerRef.current?.getStage()?.getPointerPosition();
            if (p) placeAtScreen(p);
          }}
        />
      )}
      <Group x={panX} y={panY} scaleX={gridPx} scaleY={gridPx}>
        {groups.map(({ id, from, items }) => {
          const part = id ? partById.get(id) : undefined;
          // 置いている最中は既存部材を触らせない（面が全部拾う）。
          const hittable = interactive && !placing && !!part;
          const isSel = !!id && selectedIds.includes(id);
          const nodes = items.map((p, k) => renderPrimLocal(p, `${from}-${k}`, gridPx, {
            selected: isSel, overridden: false, interactive: hittable,
          }));
          if (!hittable || !id) return <React.Fragment key={`g-${from}`}>{nodes}</React.Fragment>;
          return (
            <Group
              key={`g-${from}`}
              draggable={mode === 'select'}
              // 指のタップは必ず数 px ぶれる。小さすぎるとドラッグ扱いになり選べなくなる。
              dragDistance={EDIT_DRAG_PX}
              onDragStart={() => { if (mode === 'select') onPartTap(id); }}
              onDragEnd={(e) => {
                const d = e.target.position();
                e.target.position({ x: 0, y: 0 });
                if (part) dropPart(part, d);
              }}
              onClick={() => onPartTap(id)}
              onTap={() => onPartTap(id)}
            >
              {nodes}
            </Group>
          );
        })}
        {draftPreview}
      </Group>
    </Layer>
  );
}
