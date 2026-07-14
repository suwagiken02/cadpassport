'use client';

// 屋根形状セレクタ（E-3.14 共通化）。RoofSettingsModal / BuildingTemplateModal で共用。
import React from 'react';

export type RoofShape = 'hip' | 'gable' | 'flat' | 'shed';

const SHAPE_OPTIONS: { v: RoofShape; label: string }[] = [
  { v: 'hip', label: '寄棟' },
  { v: 'gable', label: '切妻' },
  { v: 'flat', label: '水平' },
  { v: 'shed', label: '片流れ' },
];

const SHAPE_GUIDE: Record<RoofShape, string> = {
  hip: '',
  gable: '妻面(三角の面)の辺の中央に高さマーカーを置くと立面に反映されます',
  flat: '',
  shed: '高い辺と低い辺に高さマーカーを置くと立面に反映されます',
};

export default function RoofShapeSelector({
  shape,
  onShapeChange,
  hipMode,
  onHipModeChange,
}: {
  shape: RoofShape;
  onShapeChange: (s: RoofShape) => void;
  hipMode: 'auto' | 'manual';
  onHipModeChange: (m: 'auto' | 'manual') => void;
}) {
  return (
    <div>
      <label className="block text-sm text-dimension mb-1">屋根形状</label>
      <div className="grid grid-cols-4 gap-1">
        {SHAPE_OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onShapeChange(o.v)}
            className={`py-2 rounded-lg text-sm font-bold border-2 transition-colors ${
              shape === o.v
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-dark-bg border-dark-border text-dimension hover:text-canvas'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {SHAPE_GUIDE[shape] && <p className="mt-2 text-xs text-dimension">{SHAPE_GUIDE[shape]}</p>}
      {shape === 'hip' && (
        <div className="mt-2 flex gap-2">
          {(([['auto', '棟を中央に自動'], ['manual', '棟を手動で引く']]) as ['auto' | 'manual', string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => onHipModeChange(v)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors ${
                hipMode === v
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-dark-bg border-dark-border text-dimension hover:text-canvas'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
