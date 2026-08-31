'use client';

// ============================================================
// 下図の位置の微調整 (= U-1 commit 3)。
//
// 下図そのものは静的なレイヤー（listening=false・E-6a-perf で 1 canvas に統合）
// に描いているので触れない。位置合わせ中だけ、この専用レイヤーが
// **画像の上に透明な板**を敷いてドラッグを受ける。
// 調整をやめれば板ごと消えるので、平常時の当たり判定は 1 ミリも変わらない。
//
// 縮尺と回転には触らない（合わせ込んだ値が動くと台無しになる）。原点だけをずらす。
// ============================================================
import React from 'react';
import { Layer, Rect } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { translateTransform } from '@/lib/konva/underlay';

export default function UnderlayAdjustLayer() {
  const underlay = useCanvasStore((s) => s.canvasData.underlay);
  const adjusting = useCanvasStore((s) => s.underlayAdjusting);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);

  if (!underlay || !adjusting) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const t = underlay.transform;
  const scalePx = t.scale * gridPx;

  return (
    <Layer>
      <Rect
        x={t.originGrid.x * gridPx + panX}
        y={t.originGrid.y * gridPx + panY}
        rotation={t.rotationDeg}
        width={underlay.widthPx * scalePx}
        height={underlay.heightPx * scalePx}
        // 見えないが掴める板。薄い枠だけ出して「いま動かせる」ことを示す。
        fill="#000" opacity={0.001}
        stroke="#F59E0B" strokeWidth={2} dash={[8, 6]} strokeScaleEnabled={false}
        draggable
        onDragEnd={(e) => {
          const dx = (e.target.x() - (t.originGrid.x * gridPx + panX)) / gridPx;
          const dy = (e.target.y() - (t.originGrid.y * gridPx + panY)) / gridPx;
          // 1 ドラッグ 1 undo。丸めずにそのままずらす。
          useCanvasStore.getState().setUnderlayTransform(translateTransform(t, { x: dx, y: dy }));
        }}
      />
    </Layer>
  );
}
