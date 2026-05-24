'use client';

import React from 'react';
import { Layer, Line, Text, Rect } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX, gridToMm } from '@/lib/konva/gridUtils';
import { getBuildingEdgesClockwise } from '@/lib/konva/autoLayoutUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';

const COLOR = '#00BFFF';
const ARROW = 5;

export default function KidareLayer() {
  const { canvasData, zoom, panX, panY, showKidare } = useCanvasStore();
  if (!showKidare) return <Layer listening={false} />;
  if (!canvasData.buildings.length || !canvasData.handrails.length) return <Layer listening={false} />;

  const gridPx = INITIAL_GRID_PX * zoom;
  const gx = (g: number) => g * gridPx + panX;
  const gy = (g: number) => g * gridPx + panY;
  const elements: React.ReactElement[] = [];

  // 全建物を iterate し、建物の階層と一致する手摺の端点だけを検索対象にする。
  // これにより 2F 建物 ⇔ 2F 手摺 / 1F 建物 ⇔ 1F 手摺 の組合せで離れが表示される。
  for (const building of canvasData.buildings) {
    const buildingFloor = (building.floor ?? 1);
    const edges = getBuildingEdgesClockwise(building);

    // この建物の階層と一致する手摺の端点
    const eps: { x: number; y: number }[] = [];
    for (const h of canvasData.handrails) {
      if ((h.floor ?? 1) !== buildingFloor) continue;
      const [p1, p2] = getHandrailEndpoints(h);
      eps.push(p1, p2);
    }
    if (eps.length === 0) continue;

    const floorKey = `f${buildingFloor}`;

    edges.forEach((edge, i) => {
    const isH = edge.face === 'north' || edge.face === 'south';

    // 足場ラインのグリッド座標を推定（手摺端点から）
    let scaffoldCoord: number | null = null;
    let bestCount = 0;

    if (isH) {
      // 水平辺: Y方向の離れ
      const sign = edge.face === 'north' ? -1 : 1;
      const wallY = (edge.p1.y + edge.p2.y) / 2;
      const candidates: Record<number, number> = {};
      for (const ep of eps) {
        const dy = (ep.y - wallY) * sign;
        if (dy > 0 && dy < 200) {
          const key = Math.round(ep.y * 10);   // 1mm 精度 = 0.1 grid
          candidates[key] = (candidates[key] ?? 0) + 1;
        }
      }
      for (const [k, v] of Object.entries(candidates)) {
        if (v > bestCount) { bestCount = v; scaffoldCoord = Number(k) / 10; }
      }
      if (scaffoldCoord === null) return;

      const wallYcoord = edge.p1.y;
      const distGrid = Math.abs(scaffoldCoord - wallYcoord);
      const distMm = Math.round(gridToMm(distGrid));
      if (distMm <= 0) return;

      const midX = (edge.p1.x + edge.p2.x) / 2;

      const x1 = gx(midX);
      const y1 = gy(wallYcoord);
      const y2 = gy(scaffoldCoord);
      const a = ARROW * zoom;

      elements.push(
        <Line key={`${floorKey}-k-${i}`} points={[x1, y1, x1, y2]}
          stroke={COLOR} strokeWidth={1.5} listening={false} />,
        <Line key={`${floorKey}-ka-${i}`} points={[x1-a, y1+a*Math.sign(y2-y1), x1, y1, x1+a, y1+a*Math.sign(y2-y1)]}
          stroke={COLOR} strokeWidth={1.5} listening={false} />,
        <Line key={`${floorKey}-kb-${i}`} points={[x1-a, y2-a*Math.sign(y2-y1), x1, y2, x1+a, y2-a*Math.sign(y2-y1)]}
          stroke={COLOR} strokeWidth={1.5} listening={false} />,
        <Rect key={`${floorKey}-kr-${i}`} x={x1-18} y={(y1+y2)/2-9} width={36} height={18}
          fill="white" opacity={0.8} cornerRadius={2} listening={false} />,
        <Text key={`${floorKey}-kt-${i}`} x={x1-18} y={(y1+y2)/2-7}
          text={`${distMm}`} fontSize={12} fontFamily="monospace" fontStyle="bold"
          fill={COLOR} width={36} align="center" listening={false} />,
      );
    } else {
      // 垂直辺: X方向の離れ
      const sign = edge.face === 'east' ? 1 : -1;
      const wallX = (edge.p1.x + edge.p2.x) / 2;
      const candidates: Record<number, number> = {};
      for (const ep of eps) {
        const dx = (ep.x - wallX) * sign;
        if (dx > 0 && dx < 200) {
          const key = Math.round(ep.x * 10);   // 1mm 精度 = 0.1 grid
          candidates[key] = (candidates[key] ?? 0) + 1;
        }
      }
      for (const [k, v] of Object.entries(candidates)) {
        if (v > bestCount) { bestCount = v; scaffoldCoord = Number(k) / 10; }
      }
      if (scaffoldCoord === null) return;

      const wallXcoord = edge.p1.x;
      const distGrid = Math.abs(scaffoldCoord - wallXcoord);
      const distMm = Math.round(gridToMm(distGrid));
      if (distMm <= 0) return;

      const midY = (edge.p1.y + edge.p2.y) / 2;

      const y1 = gy(midY);
      const x1 = gx(wallXcoord);
      const x2 = gx(scaffoldCoord);
      const a = ARROW * zoom;

      elements.push(
        <Line key={`${floorKey}-k-${i}`} points={[x1, y1, x2, y1]}
          stroke={COLOR} strokeWidth={1.5} listening={false} />,
        <Line key={`${floorKey}-ka-${i}`} points={[x1+a*Math.sign(x2-x1), y1-a, x1, y1, x1+a*Math.sign(x2-x1), y1+a]}
          stroke={COLOR} strokeWidth={1.5} listening={false} />,
        <Line key={`${floorKey}-kb-${i}`} points={[x2-a*Math.sign(x2-x1), y1-a, x2, y1, x2-a*Math.sign(x2-x1), y1+a]}
          stroke={COLOR} strokeWidth={1.5} listening={false} />,
        <Rect key={`${floorKey}-kr-${i}`} x={(x1+x2)/2-18} y={y1-9} width={36} height={18}
          fill="white" opacity={0.8} cornerRadius={2} listening={false} />,
        <Text key={`${floorKey}-kt-${i}`} x={(x1+x2)/2-18} y={y1-7}
          text={`${distMm}`} fontSize={12} fontFamily="monospace" fontStyle="bold"
          fill={COLOR} width={36} align="center" listening={false} />,
      );
    }
  });
  } // end of for (building of buildings)

  return <Layer listening={false}>{elements}</Layer>;
}
