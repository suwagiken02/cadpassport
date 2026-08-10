'use client';

// ============================================================
// 平面図の追加部材レイヤー（階段・単管・P-1）。
//
// 既存の平面部材（ScaffoldLayer の手摺・支柱・アンチ）と同じ流儀で描く:
//   ・座標はグリッド（1 = 10mm）→ 画面 px は gridPx と pan で写す
//   ・listening / draggable / onDragEnd の条件も同じ（選択中だけ触れる）
//   ・移動は moveElement、複製モードなら addStair/addPipe で複製
// 幾何は lib/konva/planeParts.ts（pure）が唯一の定義。
//
// P-1-fix8: 引き出し中の配置プレビュー（ゴースト）もここで描く。
//   実物とゴーストは**同じ描画関数**を通す（StairView / PipeView）。別々に
//   描くと「ゴーストと置いた結果が違う」が起きるので、構造で潰しておく。
//   ゴーストは手摺のプレビューに合わせて半透明＋破線。階段は吸着後の位置に
//   出るので、どの区画に納まるかが離す前に分かる。
// ============================================================
import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Layer, Line, Rect, Text, Arrow } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import {
  PLANE_PART_COLORS, pipeEndpointsGrid, stairArrowGrid, stairFootprintGrid, stairTreadLinesGrid,
} from '@/lib/konva/planeParts';
import type { Pipe, Stair } from '@/types';

/** 色は planeParts.ts（pure）が唯一の定義。パレットの姿図と必ず同じ絵になる。 */
const STAIR_FILL = PLANE_PART_COLORS.stairFill;
const STAIR_STROKE = PLANE_PART_COLORS.stairStroke;
const STAIR_ARROW = PLANE_PART_COLORS.stairArrow;
const PIPE_COLOR = PLANE_PART_COLORS.pipe;
const SELECT_COLOR = '#FF6B35';

/** ゴーストの見え方。手摺のプレビュー（opacity 0.4 / dash [8,4]）に揃える。 */
const GHOST_OPACITY = 0.4;
const GHOST_DASH = [8, 4];

/** 画面へ写す関数の組（レイヤー内で共通）。 */
type ToScreen = { sx: (g: number) => number; sy: (g: number) => number };

/** 部材に触れるときのハンドラ一式。ゴーストには渡さない（＝触れない）。 */
type Interaction = {
  listening: boolean;
  draggable: boolean;
  onTap: () => void;
  onDragStart: () => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

/**
 * 階段の見た目（外形 ＋ 段板の区切り ＋ 上る向きの矢印）。
 * 実物もゴーストもこれを通る。ghost のときだけ半透明＋破線にする。
 */
function StairView({
  stair, S, zoom, selected, ghost, interaction,
}: {
  stair: Stair; S: ToScreen; zoom: number;
  selected?: boolean; ghost?: boolean; interaction?: Interaction;
}) {
  const { w, h } = stairFootprintGrid(stair.angleDeg);
  const gridPx = INITIAL_GRID_PX * zoom;
  const arrow = stairArrowGrid(stair);
  const op = ghost ? GHOST_OPACITY : 0.9;
  return (
    <>
      <Rect
        x={S.sx(stair.x)} y={S.sy(stair.y)}
        width={w * gridPx} height={h * gridPx}
        fill={STAIR_FILL} opacity={op}
        stroke={selected ? SELECT_COLOR : STAIR_STROKE}
        strokeWidth={(selected ? 20 : 12) * zoom}
        dash={ghost ? GHOST_DASH : undefined}
        id={ghost ? undefined : stair.id}
        listening={!ghost && !!interaction?.listening}
        draggable={!ghost && !!interaction?.draggable}
        onDragStart={interaction?.onDragStart}
        onClick={interaction?.onTap}
        onTap={interaction?.onTap}
        onDragEnd={interaction?.onDragEnd}
      />
      {stairTreadLinesGrid(stair).map((t, i) => (
        <Line
          key={`t${i}`}
          points={[S.sx(t.x1), S.sy(t.y1), S.sx(t.x2), S.sy(t.y2)]}
          stroke={STAIR_STROKE} strokeWidth={8 * zoom}
          opacity={ghost ? GHOST_OPACITY : 1} listening={false}
        />
      ))}
      <Arrow
        points={[S.sx(arrow.from.x), S.sy(arrow.from.y), S.sx(arrow.to.x), S.sy(arrow.to.y)]}
        stroke={STAIR_ARROW} fill={STAIR_ARROW}
        strokeWidth={14 * zoom} pointerLength={40 * zoom} pointerWidth={34 * zoom}
        opacity={ghost ? GHOST_OPACITY : 1} listening={false}
      />
    </>
  );
}

/** 単管の見た目（1 本の線 ＋ 長さ表示）。実物もゴーストもこれを通る。 */
function PipeView({
  pipe, S, zoom, selected, ghost, interaction,
}: {
  pipe: Pipe; S: ToScreen; zoom: number;
  selected?: boolean; ghost?: boolean; interaction?: Interaction;
}) {
  const [a, b] = pipeEndpointsGrid(pipe);
  return (
    <>
      <Line
        points={[S.sx(a.x), S.sy(a.y), S.sx(b.x), S.sy(b.y)]}
        stroke={selected ? SELECT_COLOR : PIPE_COLOR}
        strokeWidth={(selected ? 26 : 18) * zoom}
        lineCap="round"
        opacity={ghost ? GHOST_OPACITY : 1}
        dash={ghost ? GHOST_DASH : undefined}
        hitStrokeWidth={12}
        id={ghost ? undefined : pipe.id}
        listening={!ghost && !!interaction?.listening}
        draggable={!ghost && !!interaction?.draggable}
        onDragStart={interaction?.onDragStart}
        onClick={interaction?.onTap}
        onTap={interaction?.onTap}
        onDragEnd={interaction?.onDragEnd}
      />
      <Text
        x={S.sx((a.x + b.x) / 2)} y={S.sy((a.y + b.y) / 2) - 16}
        text={`${pipe.lengthMm}`}
        fontSize={70 * zoom} fill={PIPE_COLOR}
        opacity={ghost ? GHOST_OPACITY : 1}
        offsetX={20} listening={false}
      />
    </>
  );
}

export default function PlanePartLayer() {
  const canvasData = useCanvasStore((s) => s.canvasData);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const moveSelectIds = useCanvasStore((s) => s.moveSelectMode.selectedIds);
  const isDuplicateMode = useCanvasStore((s) => s.isDuplicateMode);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const selectActive = useCanvasStore((s) => s.selectActive);
  const selectLockParts = useCanvasStore((s) => s.selectLock.parts);
  /** 引き出し中のゴースト (= P-1-fix8)。手摺の handrailPreview と同じ役目。 */
  const preview = useCanvasStore((s) => s.planePartPreview);

  const stairs = canvasData.stairs ?? [];
  const pipes = canvasData.pipes ?? [];
  if (stairs.length === 0 && pipes.length === 0 && !preview) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectIds : selectedIds;
  // ScaffoldLayer と同じ条件（選択ON + ロック解除中、または入替モード中だけ触れる）
  const listenParts =
    (mode === 'select' && selectActive && !selectLockParts)
    || (mode === 'select' && isReorderMode);
  const listening = listenParts || mode === 'erase' || mode === 'move-select';

  const S: ToScreen = {
    sx: (gx: number) => gx * gridPx + panX,
    sy: (gy: number) => gy * gridPx + panY,
  };

  /** ドラッグ確定（既存部材と同じ: グリッド単位に丸めて moveElement / 複製）。 */
  const dropHandler = (
    id: string, dup: (dx: number, dy: number) => void,
  ) => (e: Konva.KonvaEventObject<DragEvent>) => {
    const dx = Math.round(e.target.x() / gridPx);
    const dy = Math.round(e.target.y() / gridPx);
    e.target.x(0); e.target.y(0);
    if (dx === 0 && dy === 0) return;
    if (isDuplicateMode) dup(dx, dy);
    else useCanvasStore.getState().moveElement(id, dx, dy);
  };

  const interactionOf = (id: string, dup: (dx: number, dy: number) => void): Interaction => ({
    listening,
    draggable: mode === 'select',
    onTap: () => useCanvasStore.getState().setSelectedIds([id]),
    onDragStart: () => useCanvasStore.getState().pushHistory(),
    onDragEnd: dropHandler(id, dup),
  });

  return (
    <Layer>
      {stairs.map((stair) => (
        <React.Fragment key={stair.id}>
          <StairView
            stair={stair} S={S} zoom={zoom}
            selected={effectiveSelectedIds.includes(stair.id)}
            interaction={interactionOf(stair.id, (dx, dy) => useCanvasStore.getState().addStair({
              ...stair, id: uuidv4(), x: stair.x + dx, y: stair.y + dy,
            }))}
          />
        </React.Fragment>
      ))}

      {pipes.map((pipe) => (
        <React.Fragment key={pipe.id}>
          <PipeView
            pipe={pipe} S={S} zoom={zoom}
            selected={effectiveSelectedIds.includes(pipe.id)}
            interaction={interactionOf(pipe.id, (dx, dy) => useCanvasStore.getState().addPipe({
              ...pipe, id: uuidv4(), x: pipe.x + dx, y: pipe.y + dy,
            }))}
          />
        </React.Fragment>
      ))}

      {/* 引き出し中のゴースト。実物と同じ描画を通るので、置かれる姿がそのまま出る。 */}
      {preview?.kind === 'stair' && (
        <StairView stair={preview.stair} S={S} zoom={zoom} ghost />
      )}
      {preview?.kind === 'pipe' && (
        <PipeView pipe={preview.pipe} S={S} zoom={zoom} ghost />
      )}
    </Layer>
  );
}
