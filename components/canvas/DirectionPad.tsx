'use client';

// ============================================================
// 方向パッド（共通・R-1e-fix2）: トップダウン視点キャラ＋周囲の方向キー。
// 壁方向入力（建物）と屋根キャラ歩きの双方から流用する（二重実装の回避）。
//  ・facing: キャラの向き。enabled: 有効な方向（省略＝全方向）。無効方向のキーは非表示。
//  ・onDirection(dir): 方向キー押下時のコールバック。
//  ・diagonal (= S-2): 斜め 4 方向も出す。**敷地のときだけ true**。
//    躯体・屋根は 4 方向のまま（平面の絶対原則「建物と足場は必ず平行」を守るため）。
// Konva ノード（Group）を返すので、呼び出し側の <Layer> 内に置く。
// ============================================================
import React from 'react';
import { Group, Circle, Arc, Ellipse, Rect, Text } from 'react-konva';
import {
  DIR_FACING_ROTATION, PAD_DIRS_4, PAD_DIRS_8, type PadDir8,
} from '@/lib/konva/directionStep';

/** 後方互換の別名（4 方向）。 */
export type PadDir = PadDir8;

/**
 * ボタンの中心オフセット（キャラからの相対）と、矢印文字のボタン左上からのずれ。
 * tdx/tdy は**従来の式をそのまま数値にしたもの**（縦は 8,8 ／横は 10,8）。
 * 見た目を 1px も変えないため、上下左右はこの値を変えていない。
 */
const OFFSET: Record<PadDir8, { dx: number; dy: number; glyph: string; tdx: number; tdy: number }> = {
  up: { dx: 0, dy: -1, glyph: '↑', tdx: 8, tdy: 8 },
  down: { dx: 0, dy: 1, glyph: '↓', tdx: 8, tdy: 8 },
  left: { dx: -1, dy: 0, glyph: '←', tdx: 10, tdy: 8 },
  right: { dx: 1, dy: 0, glyph: '→', tdx: 10, tdy: 8 },
  // 斜めは縦横と同じ距離感で並ぶよう 1/√2 に置く (= S-2)
  upLeft: { dx: -0.7071, dy: -0.7071, glyph: '↖', tdx: 8, tdy: 8 },
  upRight: { dx: 0.7071, dy: -0.7071, glyph: '↗', tdx: 8, tdy: 8 },
  downLeft: { dx: -0.7071, dy: 0.7071, glyph: '↙', tdx: 8, tdy: 8 },
  downRight: { dx: 0.7071, dy: 0.7071, glyph: '↘', tdx: 8, tdy: 8 },
};

export default function DirectionPad({
  x, y, facing, enabled, diagonal, onDirection,
}: {
  x: number;
  y: number;
  facing: PadDir8;
  enabled?: PadDir8[];
  /** S-2: 斜め 4 方向も出すか（敷地のときだけ true）。 */
  diagonal?: boolean;
  onDirection: (dir: PadDir8) => void;
}) {
  const btnSize = 36;
  const btnDist = 50;
  const dirs = diagonal ? PAD_DIRS_8 : PAD_DIRS_4;
  const on = (dir: PadDir8) => (!enabled || enabled.includes(dir)) && dirs.includes(dir);

  const arrow = (dir: PadDir8) => {
    if (!on(dir)) return null;
    const { dx, dy, glyph, tdx, tdy } = OFFSET[dir];
    // ボタンの左上（キャラの中心から btnDist ＋ ボタン半分だけ離す）
    const bx = x + dx * (btnDist + btnSize / 2) - btnSize / 2;
    const by = y + dy * (btnDist + btnSize / 2) - btnSize / 2;
    return (
      <React.Fragment key={dir}>
        <Rect x={bx} y={by} width={btnSize} height={btnSize} fill="#378ADD" cornerRadius={8} shadowBlur={5} shadowOpacity={0.3}
          onClick={() => onDirection(dir)} onTap={() => onDirection(dir)} />
        <Text x={bx + tdx} y={by + tdy} text={glyph} fontSize={20} fill="white" fontStyle="bold" listening={false} />
      </React.Fragment>
    );
  };

  return (
    <>
      {/* トップダウン視点キャラ */}
      <Group x={x} y={y} rotation={DIR_FACING_ROTATION[facing]} listening={false}>
        <Circle x={0} y={0} radius={14} fill="#F59E0B" />
        <Circle x={0} y={0} radius={10} fill="#FBBF77" />
        <Arc x={0} y={0} innerRadius={0} outerRadius={10} angle={180} rotation={180} fill="#78350F" />
        <Circle x={-9} y={5} radius={6} fill="#3B82F6" />
        <Circle x={9} y={5} radius={6} fill="#3B82F6" />
        <Ellipse x={0} y={6} radiusX={10} radiusY={7} fill="#3B82F6" />
        <Circle x={-3.5} y={0} radius={1.2} fill="#000" />
        <Circle x={3.5} y={0} radius={1.2} fill="#000" />
      </Group>
      {PAD_DIRS_8.map((d) => arrow(d))}
    </>
  );
}
