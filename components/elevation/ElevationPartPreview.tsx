'use client';

// ============================================================
// 立面パレットの姿図 (E-8-v3c-fix4)
//
// 平面の部材パレットと同じ「選んでいる部材の姿図」を立面にも出す。
// 絵は partPreview（＝実際に置かれる部材の primitives）をそのまま SVG にするだけ。
// プレビュー専用の作図はしない＝パレットの絵と置いた結果が食い違わない。
//
// 太さ・丸の半径は screen px 指定なので viewBox 倍率で割る。グリッド指定(widthGrid/rGrid)が
// あればローカル単位そのままで、キャンバス側と同じ「実寸比で太る」見え方になる。
// ============================================================
import React from 'react';
import { partPreview, type PartPreviewOptions } from '@/lib/konva/elevation/elevationPartPreview';
import type { ElevationPartKind } from '@/lib/konva/elevation/elevationParts';

type Props = PartPreviewOptions & {
  kind: ElevationPartKind;
  size?: number;
  className?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
};

export default function ElevationPartPreview({
  kind, size = 76, className, onPointerDown, ...opts
}: Props) {
  const { prims, view, scale } = partPreview(kind, opts, size);
  const px = (v: number) => v / scale;

  return (
    <svg
      width={size} height={size}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className={className}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
    >
      {prims.map((p, i) => {
        if (p.kind === 'line') {
          return (
            <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
              stroke={p.stroke} strokeWidth={Math.max(px(p.width), p.widthGrid ?? 0)}
              strokeLinecap="round" opacity={p.opacity ?? 1}
              strokeDasharray={p.dash ? p.dash.map(px).join(' ') : undefined} />
          );
        }
        if (p.kind === 'polygon') {
          return (
            <polygon key={i} points={p.points.join(' ')}
              fill={p.fill ?? 'none'} fillOpacity={p.fillOpacity ?? 1}
              stroke={p.stroke} strokeWidth={p.width != null ? px(p.width) : undefined} />
          );
        }
        if (p.kind === 'circle') {
          return (
            <circle key={i} cx={p.x} cy={p.y} r={Math.max(px(p.r), p.rGrid ?? 0)}
              fill={p.fill} stroke={p.stroke}
              strokeWidth={p.strokeWidth != null ? px(p.strokeWidth) : undefined}
              opacity={p.opacity ?? 1} />
          );
        }
        if (p.kind === 'rect') {
          return (
            <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h}
              fill={p.fill ?? 'none'} fillOpacity={p.fillOpacity ?? 1}
              stroke={p.stroke} strokeWidth={p.width != null ? px(p.width) : undefined} />
          );
        }
        return (
          <text key={i} x={p.x} y={p.y} fill={p.fill} fontSize={px(p.size)}
            textAnchor={p.anchor === 'start' ? 'start' : p.anchor === 'end' ? 'end' : 'middle'}>
            {p.text}
          </text>
        );
      })}
    </svg>
  );
}
