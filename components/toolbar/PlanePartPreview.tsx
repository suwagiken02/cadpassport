'use client';

// ============================================================
// 平面パレットの姿図（階段・単管）(= P-1-fix)
//
// 既存の手摺の姿図（angleSelector の SVG）と同じ見せ方に揃える:
//   ・bg-dark-bg の角丸枠に収める / 掴んでキャンバスへ引き出せる
//   ・絵は「実際に置かれる部材」そのもの（planePartPreview が pure で作る）
// 色はキャンバス（PlanePartLayer）と同じ PLANE_PART_COLORS を使うので、
// パレットで見た絵と置いた結果が一致する。
//
// 線の太さはキャンバス側と同じ「グリッド比」で描く（px 指定は scale で割る）。
// ============================================================
import React from 'react';
import { pipePreview, stairPreview } from '@/lib/konva/planePartPreview';
import { PLANE_PART_COLORS } from '@/lib/konva/planeParts';

const C = PLANE_PART_COLORS;

type CommonProps = {
  size?: number;
  className?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
};

/** 階段: 外形 ＋ 段板の区切り ＋ 上る向きの矢印。 */
export function StairPreview({
  angleDeg, flip, size = 60, className, onPointerDown,
}: CommonProps & { angleDeg?: number; flip?: boolean }) {
  const { outline, treads, arrow, view, scale } = stairPreview({ angleDeg, flip }, size);
  const px = (v: number) => v / scale;
  // 矢印の先端（三角）。矢の向きに合わせて 2 辺を出す。
  const dx = arrow.to.x - arrow.from.x, dy = arrow.to.y - arrow.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const head = 14, wing = 9;
  const hx = arrow.to.x - ux * head, hy = arrow.to.y - uy * head;
  const headPts = [
    `${arrow.to.x},${arrow.to.y}`,
    `${hx - uy * wing},${hy + ux * wing}`,
    `${hx + uy * wing},${hy - ux * wing}`,
  ].join(' ');

  return (
    <svg
      width={size} height={size}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className={className}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
    >
      <rect
        x={outline.x} y={outline.y} width={outline.w} height={outline.h}
        fill={C.stairFill} fillOpacity={0.9}
        stroke={C.stairStroke} strokeWidth={px(1.5)}
      />
      {treads.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={C.stairStroke} strokeWidth={px(1)} />
      ))}
      <line
        x1={arrow.from.x} y1={arrow.from.y} x2={arrow.to.x} y2={arrow.to.y}
        stroke={C.stairArrow} strokeWidth={px(1.8)} strokeLinecap="round"
      />
      <polygon points={headPts} fill={C.stairArrow} />
    </svg>
  );
}

/** 単管: 1 本の線。長さと角度がそのまま出る（枠は 6m 基準で固定）。 */
export function PipePreview({
  lengthMm, angleDeg, size = 60, className, onPointerDown,
}: CommonProps & { lengthMm: number; angleDeg?: number }) {
  const { line, view, scale } = pipePreview({ lengthMm, angleDeg }, size);
  const px = (v: number) => v / scale;

  return (
    <svg
      width={size} height={size}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className={className}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
    >
      <line
        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
        stroke={C.pipe} strokeWidth={px(3)} strokeLinecap="round"
      />
    </svg>
  );
}
