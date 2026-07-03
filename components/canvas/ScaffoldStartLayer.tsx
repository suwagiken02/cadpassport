'use client';

import React from 'react';
import { Layer, Text } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { getStartVertexPoint } from '@/lib/konva/labelUtils';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';
import { getScaffoldStartByFloor } from '@/types';

/**
 * 足場開始アイコン (= ★) を canvas に描画する Layer。
 * scaffoldStart1F / 2F / legacy scaffoldStart の優先順で各階の起点角に ★ を表示。
 * 色は AutoLayoutModal の preview ★ と統一 (= #FFD700 ゴールド + 黒縁取り)。
 * PDF 出力は stage.toDataURL 経由のため自動反映される (= 別途描画追加不要)。
 */

const STAR_COLOR = '#FFD700';  // ゴールド (= AutoLayoutModal preview と統一)
const STAR_STROKE = '#000000';
const STAR_FONT_BASE = 64;     // 既存 DimensionLineLayer FONT_BASE と同等で proportional

function getStartPoint(
  building: BuildingShape,
  ss: ScaffoldStartConfig,
): { x: number; y: number } | null {
  // startVertexIndex は CW 辺order の index 規約。生 building.points で読むと
  // CCW 格納の建物で別頂点(SE 等)に誤描画されるため、CW 辺order の p1 を使う。
  return getStartVertexPoint(building, ss.startVertexIndex ?? 0);
}

export default function ScaffoldStartLayer() {
  const { canvasData, zoom, panX, panY } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;

  // 描画対象: scaffoldStart1F / 2F が優先、 どちらも無ければ legacy scaffoldStart をフォールバック
  const jobs: { ss: ScaffoldStartConfig; floor: number }[] = [];
  // S-1: byFloor 派生アクセサ経由で収集（反復は従来と同じ [1,2] 固定＝byte 不変。S-3 で present-floors 化）。
  const startByFloor = getScaffoldStartByFloor(canvasData);
  for (const floor of [1, 2] as const) {
    const ss = startByFloor[floor];
    if (ss) {
      jobs.push({ ss, floor });
    }
  }
  if (jobs.length === 0 && canvasData.scaffoldStart) {
    const f = canvasData.scaffoldStart.floor ?? 1;
    jobs.push({ ss: canvasData.scaffoldStart, floor: f });
  }

  const elements: React.ReactElement[] = [];
  for (const { ss, floor } of jobs) {
    const building = canvasData.buildings.find((b) => (b.floor ?? 1) === floor);
    if (!building) continue;
    const pt = getStartPoint(building, ss);
    if (!pt) continue;
    const fs = STAR_FONT_BASE * zoom;
    // Text の x/y は左上基準のため fs/2 ずらして中心を頂点に合わせる
    elements.push(
      <Text
        key={`scaffold-start-${floor}`}
        x={pt.x * gridPx + panX - fs / 2}
        y={pt.y * gridPx + panY - fs / 2}
        width={fs}
        height={fs}
        text="★"
        fontSize={fs}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill={STAR_COLOR}
        stroke={STAR_STROKE}
        strokeWidth={Math.max(0.5, fs * 0.05)}
        align="center"
        verticalAlign="middle"
        listening={false}
      />,
    );
  }

  return <Layer listening={false}>{elements}</Layer>;
}
