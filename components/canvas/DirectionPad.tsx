'use client';

// ============================================================
// 方向パッド（共通・R-1e-fix2）: トップダウン視点キャラ＋周囲の上下左右 方向キー。
// 壁方向入力（建物）と屋根キャラ歩きの双方から流用する（二重実装の回避）。
//  ・facing: キャラの向き。enabled: 有効な方向（省略＝全方向）。無効方向のキーは非表示。
//  ・onDirection(dir): 方向キー押下時のコールバック。
// Konva ノード（Group）を返すので、呼び出し側の <Layer> 内に置く。
// ============================================================
import React from 'react';
import { Group, Circle, Arc, Ellipse, Rect, Text } from 'react-konva';

export type PadDir = 'up' | 'down' | 'left' | 'right';

export default function DirectionPad({
  x, y, facing, enabled, onDirection,
}: {
  x: number;
  y: number;
  facing: PadDir;
  enabled?: PadDir[];
  onDirection: (dir: PadDir) => void;
}) {
  const btnSize = 36;
  const btnDist = 50;
  const on = (dir: PadDir) => !enabled || enabled.includes(dir);

  const arrow = (dir: PadDir, bx: number, by: number, tx: number, ty: number, glyph: string) => {
    if (!on(dir)) return null;
    return (
      <React.Fragment key={dir}>
        <Rect x={bx} y={by} width={btnSize} height={btnSize} fill="#378ADD" cornerRadius={8} shadowBlur={5} shadowOpacity={0.3}
          onClick={() => onDirection(dir)} onTap={() => onDirection(dir)} />
        <Text x={tx} y={ty} text={glyph} fontSize={20} fill="white" fontStyle="bold" listening={false} />
      </React.Fragment>
    );
  };

  return (
    <>
      {/* トップダウン視点キャラ */}
      <Group x={x} y={y} rotation={{ down: 180, left: 270, up: 0, right: 90 }[facing]} listening={false}>
        <Circle x={0} y={0} radius={14} fill="#F59E0B" />
        <Circle x={0} y={0} radius={10} fill="#FBBF77" />
        <Arc x={0} y={0} innerRadius={0} outerRadius={10} angle={180} rotation={180} fill="#78350F" />
        <Circle x={-9} y={5} radius={6} fill="#3B82F6" />
        <Circle x={9} y={5} radius={6} fill="#3B82F6" />
        <Ellipse x={0} y={6} radiusX={10} radiusY={7} fill="#3B82F6" />
        <Circle x={-3.5} y={0} radius={1.2} fill="#000" />
        <Circle x={3.5} y={0} radius={1.2} fill="#000" />
      </Group>
      {arrow('up', x - btnSize / 2, y - btnDist - btnSize, x - 10, y - btnDist - btnSize + 8, '↑')}
      {arrow('down', x - btnSize / 2, y + btnDist, x - 10, y + btnDist + 8, '↓')}
      {arrow('left', x - btnDist - btnSize, y - btnSize / 2, x - btnDist - btnSize + 10, y - 10, '←')}
      {arrow('right', x + btnDist, y - btnSize / 2, x + btnDist + 10, y - 10, '→')}
    </>
  );
}
