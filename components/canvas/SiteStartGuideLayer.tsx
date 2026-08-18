'use client';

// ============================================================
// 敷地の起点を決めるときの距離ガイド (= S-7)。
//
// 「躯体 → 敷地 → 手で描く」で**最初の 1 点を打つ前**、ポインタの位置から
// いちばん近い建物の角までの X / Y 距離を出す。ここが決まらないと以降の
// 方向入力がぜんぶずれるので、打つ前に建物からの距離が見えると位置を決めやすい。
//
// もともと S-5 で「頂点をドラッグ中」に出していた表示だが、S-6 の常時表示
// （青）と重なって読めなくなったのでそちらからは外し、この場面へ移した。
// 計算は lib/konva/siteVertexGuide.ts のまま（S-5 から変えていない）。
//
// 出すのは**敷地の起点選びだけ**。躯体・屋根の起点選びには出さない
// （建物は「建物と足場は必ず平行」の世界で、建物角からの離れを測る意味が違う）。
//
// タッチでは指を置くまでポインタ位置が取れないので、実質マウス操作のときだけ
// 出る（計測ツールのカーソル追従と同じ扱い）。指で打つときは従来どおり
// 起点タップの頂点スナップが効く。
// ============================================================
import React, { useMemo } from 'react';
import { Layer, Circle, Line, Text } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { buildingCornersGrid, nearestBuildingCornerGuide } from '@/lib/konva/siteVertexGuide';

/** 計測ツールと同じ赤。 */
const GUIDE_COLOR = '#EF4444';
const GUIDE_DASH = [6, 4];

export default function SiteStartGuideLayer() {
  const mode = useCanvasStore((s) => s.mode);
  const buildingInputMethod = useCanvasStore((s) => s.buildingInputMethod);
  const pendingTargetType = useCanvasStore((s) => s.pendingTargetType);
  const directionPoints = useCanvasStore((s) => s.directionPoints);
  const cursor = useCanvasStore((s) => s.siteStartCursor);
  const buildings = useCanvasStore((s) => s.canvasData.buildings);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);

  /** 建物の角は建物が変わったときだけ作り直す。 */
  const corners = useMemo(() => buildingCornersGrid(buildings), [buildings]);

  /** 敷地の起点を選んでいる最中か（起点を打ったら終わり）。 */
  const choosingStart = mode === 'building'
    && buildingInputMethod === 'direction'
    && pendingTargetType === 'site'
    && directionPoints.length === 0;

  const guide = choosingStart && cursor ? nearestBuildingCornerGuide(cursor, corners) : null;
  if (!guide || !cursor) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;

  const cx = sx(guide.corner.x);
  const cy = sy(guide.corner.y);
  const px = sx(cursor.x);
  const py = sy(cursor.y);
  const xLabel = `${guide.dxMm}mm`;
  const yLabel = `${guide.dyMm}mm`;
  // 数値はポインタに隠れないよう、脚の中点から外へずらす（S-5 と同じ置き方）。
  const ySide = cursor.x >= guide.corner.x ? 1 : -1;

  return (
    <Layer listening={false}>
      {/* 水平の補助線（角 → ポインタの真上/真下） */}
      <Line points={[cx, cy, px, cy]} stroke={GUIDE_COLOR} strokeWidth={1.5}
        dash={GUIDE_DASH} opacity={0.9} />
      {/* 垂直の補助線（そこからポインタまで） */}
      <Line points={[px, cy, px, py]} stroke={GUIDE_COLOR} strokeWidth={1.5}
        dash={GUIDE_DASH} opacity={0.9} />
      {/* 相手の建物角 */}
      <Circle x={cx} y={cy} radius={5} fill={GUIDE_COLOR} />
      <Circle x={cx} y={cy} radius={2} fill="#FFFFFF" />
      {/* ポインタ側の目印 */}
      <Circle x={px} y={py} radius={4} stroke={GUIDE_COLOR} strokeWidth={1.5} />
      {/* X 距離 */}
      <Text x={(cx + px) / 2} y={cy - 18} text={xLabel}
        fontSize={13} fontFamily="monospace" fontStyle="bold" fill={GUIDE_COLOR}
        offsetX={(xLabel.length * 7.5) / 2} />
      {/* Y 距離 */}
      <Text x={px + ySide * 14} y={(cy + py) / 2 - 7} text={yLabel}
        fontSize={13} fontFamily="monospace" fontStyle="bold" fill={GUIDE_COLOR}
        offsetX={ySide > 0 ? 0 : yLabel.length * 7.5} />
    </Layer>
  );
}
