'use client';

import React, { useState, useMemo } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { RoofType, RoofConfig, Point } from '@/types';
import NumInput from '@/components/ui/NumInput';
import { getBuildingEdgesClockwise } from '@/lib/konva/autoLayoutUtils';
import { computeEdgeLabelPosition } from '@/lib/konva/buildingLabelUtils';

type Props = {
  buildingId: string;
  buildingPoints?: Point[];
  initialRoof?: RoofConfig;
  onClose: () => void;
};

const FACE_LABEL: Record<string, string> = {
  north: '北', south: '南', east: '東', west: '西',
};

const DEFAULT_OVERHANG = 600;
const FIXED_ROOF_TYPE: RoofType = 'yosemune';  // 種類概念廃止、 内部固定値

export default function RoofSettingsModal({ buildingId, buildingPoints, initialRoof, onClose }: Props) {
  const { updateBuildingRoof } = useCanvasStore();

  // 辺情報を取得（多辺ポリゴン対応）
  const edges = useMemo(() => {
    if (!buildingPoints || buildingPoints.length < 3) return null;
    return getBuildingEdgesClockwise({ id: '', type: 'polygon', points: buildingPoints, fill: '' });
  }, [buildingPoints]);

  // 「屋根なし」 = uniformMm=0 + 面別 null + edgeOverhangs 全 0 で判定 (= roof データは残し overhang のみゼロ化)
  const initialIsNone = !!initialRoof &&
    initialRoof.uniformMm === 0 &&
    initialRoof.northMm == null &&
    initialRoof.southMm == null &&
    initialRoof.eastMm == null &&
    initialRoof.westMm == null &&
    (!initialRoof.edgeOverhangsMm || Object.values(initialRoof.edgeOverhangsMm).every((v) => v === 0));

  const [roofNone, setRoofNone] = useState(initialIsNone);
  const [uniform, setUniform] = useState(initialRoof ? initialRoof.northMm === null && !initialRoof.edgeOverhangsMm : true);
  const [uniformMm, setUniformMm] = useState(initialRoof?.uniformMm || DEFAULT_OVERHANG);
  const [northMm, setNorthMm] = useState(initialRoof?.northMm ?? DEFAULT_OVERHANG);
  const [southMm, setSouthMm] = useState(initialRoof?.southMm ?? DEFAULT_OVERHANG);
  const [eastMm, setEastMm] = useState(initialRoof?.eastMm ?? DEFAULT_OVERHANG);
  const [westMm, setWestMm] = useState(initialRoof?.westMm ?? DEFAULT_OVERHANG);

  // 辺ごとの出幅（L字など多辺ポリゴン用）
  const [edgeOverhangs, setEdgeOverhangs] = useState<Record<number, number>>(() => {
    if (initialRoof?.edgeOverhangsMm) return { ...initialRoof.edgeOverhangsMm };
    const d: Record<number, number> = {};
    if (edges) edges.forEach(e => { d[e.index] = DEFAULT_OVERHANG; });
    return d;
  });

  const isMultiEdge = edges && edges.length > 4;

  const handleConfirm = () => {
    if (roofNone) {
      const zeroEdges: Record<number, number> = {};
      if (edges) edges.forEach(e => { zeroEdges[e.index] = 0; });
      const config: RoofConfig = {
        roofType: FIXED_ROOF_TYPE,
        uniformMm: 0,
        northMm: null, southMm: null, eastMm: null, westMm: null,
        edgeOverhangsMm: isMultiEdge ? zeroEdges : undefined,
      };
      updateBuildingRoof(buildingId, config);
      onClose();
      return;
    }
    const config: RoofConfig = {
      roofType: FIXED_ROOF_TYPE,
      uniformMm: uniform ? uniformMm : DEFAULT_OVERHANG,
      northMm: uniform ? null : (isMultiEdge ? null : northMm),
      southMm: uniform ? null : (isMultiEdge ? null : southMm),
      eastMm: uniform ? null : (isMultiEdge ? null : eastMm),
      westMm: uniform ? null : (isMultiEdge ? null : westMm),
      edgeOverhangsMm: !uniform && isMultiEdge ? edgeOverhangs : undefined,
    };
    updateBuildingRoof(buildingId, config);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div className="relative bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-dark-surface px-4 py-3 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-bold text-lg">屋根設定</h2>
          <button type="button" onClick={onClose} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        <div className="p-4 space-y-5">
          {/* 建物プレビュー */}
          {buildingPoints && buildingPoints.length >= 3 && (() => {
            const xs = buildingPoints.map(p => p.x);
            const ys = buildingPoints.map(p => p.y);
            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const minY = Math.min(...ys), maxY = Math.max(...ys);
            const w = maxX - minX || 1;
            const h = maxY - minY || 1;
            const pad = Math.max(w, h) * 0.15;
            const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
            const polyPts = buildingPoints.map(p => `${p.x},${p.y}`).join(' ');
            const edgeLabels = edges || [];

            return (
              <div className="mb-1">
                <svg viewBox={vb} className="w-full h-40 bg-dark-bg rounded-lg border border-dark-border">
                  <polygon points={polyPts} fill="rgba(59,130,246,0.15)" stroke="#3B82F6" strokeWidth={Math.max(w, h) * 0.01} />
                  {edgeLabels.map((edge, i) => {
                    const mx = (edge.p1.x + edge.p2.x) / 2;
                    const my = (edge.p1.y + edge.p2.y) / 2;
                    const N = edgeLabels.length;
                    const prevEdge = edgeLabels[(i - 1 + N) % N];
                    const nextEdge = edgeLabels[(i + 1) % N];
                    const baseOffset = Math.max(w, h) * 0.06;
                    const labelPos = computeEdgeLabelPosition(edge, prevEdge, nextEdge, mx, my, baseOffset);
                    const fontSize = Math.max(w, h) * 0.06;
                    return (
                      <text key={i} x={labelPos.x} y={labelPos.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="#3B82F6" fontSize={fontSize} fontWeight="bold"
                        paintOrder={labelPos.isInside ? 'stroke' : undefined}
                        stroke={labelPos.isInside ? '#0f172a' : undefined}
                        strokeWidth={labelPos.isInside ? Math.max(2, fontSize * 0.25) : undefined}
                      >
                        {edge.label}
                      </text>
                    );
                  })}
                </svg>
              </div>
            );
          })()}

          {/* 屋根なし + 全面同じ出幅 チェック */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={roofNone} onChange={(e) => setRoofNone(e.target.checked)}
                className="w-4 h-4 rounded border-dark-border accent-accent"
              />
              <span className="text-sm">屋根なし</span>
            </label>
            {!roofNone && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)}
                  className="w-4 h-4 rounded border-dark-border accent-accent"
                />
                <span className="text-sm">全面同じ出幅</span>
              </label>
            )}
          </div>

          {/* 出幅入力 */}
          {!roofNone && (uniform ? (
            <div data-tutorial-id="roof-overhang-input">
              <label className="block text-sm text-dimension mb-1">出幅 (mm)</label>
              <NumInput value={uniformMm} onChange={setUniformMm} min={0} step={50} />
            </div>
          ) : isMultiEdge && edges ? (
            <div className="space-y-2">
              <label className="block text-sm text-dimension">辺ごとの出幅 (mm)</label>
              {edges.map((edge) => (
                <div key={edge.index} className="flex items-center gap-2">
                  <span className="w-8 h-6 flex items-center justify-center rounded text-xs font-bold bg-dark-bg text-dimension">
                    {edge.label}
                  </span>
                  <span className="text-[10px] text-dimension w-6 shrink-0">{FACE_LABEL[edge.face]}</span>
                  <NumInput
                    value={edgeOverhangs[edge.index] ?? DEFAULT_OVERHANG}
                    onChange={(v) => setEdgeOverhangs(prev => ({ ...prev, [edge.index]: v }))}
                    min={0} step={50}
                    className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          ) : edges ? (
            <div className="space-y-2">
              <label className="block text-sm text-dimension">辺ごとの出幅 (mm)</label>
              {edges.map((edge) => {
                const pair =
                  edge.face === 'north' ? { value: northMm, set: setNorthMm }
                  : edge.face === 'south' ? { value: southMm, set: setSouthMm }
                  : edge.face === 'east' ? { value: eastMm, set: setEastMm }
                  : { value: westMm, set: setWestMm };
                return (
                  <div key={edge.index} className="flex items-center gap-2">
                    <span className="w-8 h-6 flex items-center justify-center rounded text-xs font-bold bg-dark-bg text-dimension">
                      {edge.label}
                    </span>
                    <span className="text-[10px] text-dimension w-6 shrink-0">{FACE_LABEL[edge.face]}</span>
                    <NumInput value={pair.value} onChange={pair.set} min={0} step={50}
                      className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                );
              })}
            </div>
          ) : null)}

          <button type="button" data-tutorial-id="roof-confirm" onClick={handleConfirm} className="w-full py-3 bg-accent text-white font-bold rounded-xl text-lg">
            設定する
          </button>
        </div>
      </div>
    </div>
  );
}
