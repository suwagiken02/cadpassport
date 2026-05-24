'use client';

import React from 'react';
import { Layer, Group, Circle, Line } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';

/**
 * マグネットピン本体の描画。
 * M-3c-fix: ピンの中心判定を「針先」に変更。pin.x/pin.y が針先で、
 * 頭は左上 (-needleDx, -needleDy) に位置する（実物の待ち針が刺さってる状態）。
 */
export default function MagnetPinLayer() {
  // selector ベース購読: pins と pan/zoom のみ購読、他の state 更新で再レンダーされない
  // ※ ?? [] は新しい配列参照を毎回生成するので selector 外で行う
  const magnetPins = useCanvasStore(s => s.canvasData.magnetPins);
  const zoom = useCanvasStore(s => s.zoom);
  const panX = useCanvasStore(s => s.panX);
  const panY = useCanvasStore(s => s.panY);
  const mode = useCanvasStore(s => s.mode);
  const eraseMode = mode === 'erase';

  const pins = magnetPins ?? [];
  if (pins.length === 0) return <Layer listening={false} />;

  const gridPx = INITIAL_GRID_PX * zoom;

  // ズームに応じてサイズをクランプ
  const headRadius = Math.max(4, Math.min(8, 6 * zoom));
  const needleLen = Math.max(12, Math.min(20, 16 * zoom));
  const needleDx = needleLen * 0.5;
  const needleDy = needleLen;

  return (
    <Layer listening={eraseMode}>
      {pins.map((pin) => {
        // 針先 = pin.x/y
        const tipX = pin.x * gridPx + panX;
        const tipY = pin.y * gridPx + panY;

        return (
          <Group key={pin.id} x={tipX} y={tipY}>
            {/* 針: 頭(-needleDx,-needleDy) → 針先(0,0) */}
            <Line
              points={[-needleDx, -needleDy, 0, 0]}
              stroke="#991B1B"
              strokeWidth={1.5}
              shadowColor="#000"
              shadowOpacity={0.3}
              shadowBlur={2}
              shadowOffsetX={1}
              shadowOffsetY={1}
            />
            {/* 頭（赤丸）: 左上 */}
            <Circle
              x={-needleDx}
              y={-needleDy}
              radius={headRadius}
              fill="#DC2626"
              stroke="#FFFFFF"
              strokeWidth={1}
              shadowColor="#000"
              shadowOpacity={0.4}
              shadowBlur={3}
              shadowOffsetX={1}
              shadowOffsetY={1}
            />
            {/* Phase M-8: 削除モード時のみ、頭の上に透明な大きい hit area を重ねる */}
            {eraseMode && (
              <Circle
                id={pin.id}
                x={-needleDx}
                y={-needleDy}
                radius={Math.max(20, headRadius * 2.5)}
                fill="transparent"
              />
            )}
          </Group>
        );
      })}
    </Layer>
  );
}
