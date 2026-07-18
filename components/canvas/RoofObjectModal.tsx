'use client';

// ============================================================
// 屋根オブジェクト設定モーダル（R-1e）: roofSettingsTarget（なぞり確定 or ワンタップ or 既存編集）
// を対象に、屋根形状・出幅を設定して Roof を追加/更新/削除する。RoofShapeSelector を流用。
// 同一建物・同一 edgeRange の屋根は置換（重複置換）。hip は中央棟を自動生成（roofShapeApply 流用）。
// ============================================================
import React, { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';
import RoofShapeSelector, { type RoofShape } from '@/components/building/RoofShapeSelector';
import { DEFAULT_ROOF_SHAPE } from '@/components/building/roofDefaults';
import { applyRoofShapeRidge } from '@/components/building/roofShapeApply';
import type { Point } from '@/types';

/** 2 つの polygon が同一頂点列か（順同）。 */
const polygonEquals = (a: Point[], b: Point[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);

export default function RoofObjectModal() {
  const {
    canvasData, roofSettingsTarget, setRoofSettingsTarget,
    addRoof, updateRoof, removeRoof,
  } = useCanvasStore();
  const target = roofSettingsTarget;
  const roofs = canvasData.roofs ?? [];
  const existing = target?.roofId ? roofs.find((r) => r.id === target.roofId) : undefined;

  const [roofShape, setRoofShape] = useState<RoofShape>(DEFAULT_ROOF_SHAPE);
  const [hipMode, setHipMode] = useState<'auto' | 'manual'>('auto');
  const [uniformMm, setUniformMm] = useState(600);

  useEffect(() => {
    if (!target) return;
    setRoofShape(existing?.roofShape ?? DEFAULT_ROOF_SHAPE);
    setUniformMm(existing?.uniformMm ?? 600);
    setHipMode('auto');
    // 対象が変わったときだけリセット
  }, [target?.buildingId, target?.roofId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;
  const building = canvasData.buildings.find((b) => b.id === target.buildingId);
  if (!building) return null;

  const close = () => setRoofSettingsTarget(null);

  const handleConfirm = () => {
    const polygon = target.polygon;
    const mm = Math.max(0, Math.min(9900, Math.round(uniformMm)));
    // 既存編集 or 同一建物・同一 polygon があれば置換、無ければ追加（重複置換）。
    const dup = existing ?? roofs.find((r) => r.buildingId === target.buildingId && r.polygon != null && polygonEquals(r.polygon, polygon));
    if (dup) {
      updateRoof(dup.id, { polygon, roofShape, uniformMm: mm });
    } else {
      addRoof({ id: uuidv4(), buildingId: target.buildingId, polygon, roofShape, uniformMm: mm });
    }
    // hip は中央棟を自動生成（gable/flat/shed は既存棟に触れない＝複数屋根の棟を壊さない・R-1f で整理）。
    if (roofShape === 'hip') applyRoofShapeRidge(target.buildingId, building.points, 'hip', hipMode);
    close();
  };

  const handleDelete = () => {
    if (existing) removeRoof(existing.id);
    close();
  };

  const vertexCount = target.polygon.length;

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-sm mx-4 w-full">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base text-canvas font-bold">{existing ? '屋根を編集' : '屋根を作成'}</h2>
          <span className="text-[10px] text-dimension">屋根領域（{vertexCount}頂点）</span>
        </div>

        <div className="mb-3">
          <RoofShapeSelector shape={roofShape} onShapeChange={setRoofShape} hipMode={hipMode} onHipModeChange={setHipMode} />
        </div>

        <label className="block text-sm text-dimension mb-1">出幅</label>
        <div className="flex items-center gap-2 mb-5">
          <NumInput value={uniformMm} onChange={setUniformMm} min={0} step={50} />
          <span className="text-sm text-canvas">mm</span>
        </div>

        <div className="flex gap-2">
          {existing && (
            <button onClick={handleDelete} className="flex-1 py-2 bg-red-500 text-white rounded-xl text-sm font-bold">
              削除
            </button>
          )}
          <button onClick={close} className="flex-1 py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold">
            キャンセル
          </button>
          <button onClick={handleConfirm} className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-bold">
            {existing ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}
