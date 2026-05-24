'use client';

import React from 'react';
import { Layer, Group, Circle, Line } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';

/**
 * ピン配置中の仮位置プレビュー（半透明待ち針 + anchor からの破線）。
 * pinAnchor と pinDraftOffset の両方が設定されている時のみ表示。
 *
 * M-3c-fix: 待ち針の「針先」が draft 位置（= anchor + offset）に来るよう、
 * Group 原点を針先にし、頭は左上 (-needleDx, -needleDy) に置く。
 */
export default function PinDraftLayer() {
  // selector ベース購読
  const isMagnetPinMode = useCanvasStore(s => s.isMagnetPinMode);
  const pinAnchor = useCanvasStore(s => s.pinAnchor);
  const pinDraftOffset = useCanvasStore(s => s.pinDraftOffset);
  const zoom = useCanvasStore(s => s.zoom);
  const panX = useCanvasStore(s => s.panX);
  const panY = useCanvasStore(s => s.panY);

  if (!isMagnetPinMode || !pinAnchor || !pinDraftOffset) return null;

  const gridPx = INITIAL_GRID_PX * zoom;

  // anchor の画面ピクセル座標
  const ax = pinAnchor.x * gridPx + panX;
  const ay = pinAnchor.y * gridPx + panY;

  // 仮ピン位置（mm → grid 換算）= 針先位置
  const dxGrid = pinDraftOffset.dx / 10;
  const dyGrid = pinDraftOffset.dy / 10;
  const tipX = (pinAnchor.x + dxGrid) * gridPx + panX;
  const tipY = (pinAnchor.y + dyGrid) * gridPx + panY;

  // ズームクランプ
  const headRadius = Math.max(4, Math.min(8, 6 * zoom));
  const needleLen = Math.max(12, Math.min(20, 16 * zoom));
  const needleDx = needleLen * 0.5;
  const needleDy = needleLen;

  return (
    <Layer listening={false}>
      {/* anchor → 仮位置（針先）の破線 */}
      <Line points={[ax, ay, tipX, tipY]} stroke="#DC2626" strokeWidth={1} dash={[6, 4]} opacity={0.6} />

      {/* 半透明の待ち針: Group 原点 = 針先 (tipX, tipY)、頭は左上 */}
      <Group x={tipX} y={tipY} opacity={0.5}>
        <Line points={[-needleDx, -needleDy, 0, 0]} stroke="#991B1B" strokeWidth={1.5} />
        <Circle x={-needleDx} y={-needleDy} radius={headRadius} fill="#DC2626" stroke="#FFFFFF" strokeWidth={1} />
      </Group>
    </Layer>
  );
}
