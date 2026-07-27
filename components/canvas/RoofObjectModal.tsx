'use client';

// ============================================================
// 屋根オブジェクト設定モーダル（R-1e）: roofSettingsTarget（なぞり確定 or ワンタップ or 既存編集）
// を対象に、屋根形状・出幅を設定して Roof を追加/更新/削除する。RoofShapeSelector を流用。
// 同一建物・同一 edgeRange の屋根は置換（重複置換）。hip は中央棟を自動生成（roofShapeApply 流用）。
//
// R-1j: 出幅は「全面同じ出幅」チェック（既定 ON）＋辺ごとの個別入力に対応（旧・屋根設定モーダルと
// 同等の UI）。屋根 polygon の全辺がユーザー設定の対象で、システムが内部辺を自動 0 にすることは
// しない（0 にしたい辺はユーザーが 0 を入力する・鮎澤氏指示）。辺の識別はプレビュー図の
// 辺ラベル（A/B/C…）と入力欄の対応で行う。
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';
import RoofShapeSelector, { type RoofShape } from '@/components/building/RoofShapeSelector';
import { DEFAULT_ROOF_SHAPE } from '@/components/building/roofDefaults';
import { applyRoofShapeRidge } from '@/components/building/roofShapeApply';
import { getBuildingEdgesClockwise } from '@/lib/konva/autoLayoutUtils';
import { computeEdgeLabelPosition } from '@/lib/konva/buildingLabelUtils';
import type { Point } from '@/types';

/** 2 つの polygon が同一頂点列か（順同）。 */
const polygonEquals = (a: Point[], b: Point[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);

const FACE_LABEL: Record<string, string> = {
  north: '北', south: '南', east: '東', west: '西',
};

const DEFAULT_OVERHANG = 600;
const MAX_OVERHANG_MM = 9900;
const clampMm = (v: number) => Math.max(0, Math.min(MAX_OVERHANG_MM, Math.round(v)));

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
  const [uniform, setUniform] = useState(true);
  const [uniformMm, setUniformMm] = useState(DEFAULT_OVERHANG);
  /** 辺ごとの出幅(mm)。キーは屋根 polygon の辺 index（EdgeInfo.originalIndex）。 */
  const [edgeOverhangs, setEdgeOverhangs] = useState<Record<number, number>>({});

  // 屋根 polygon の辺（ラベル A/B/C… と向き）。入力欄とプレビュー図の対応付けに使う。
  const polygon = target?.polygon ?? [];
  const edges = useMemo(() => {
    if (polygon.length < 3) return [];
    return getBuildingEdgesClockwise({ id: '', type: 'polygon', points: polygon, fill: '' });
  }, [polygon]);

  useEffect(() => {
    if (!target) return;
    setRoofShape(existing?.roofShape ?? DEFAULT_ROOF_SHAPE);
    const mm = existing?.uniformMm ?? DEFAULT_OVERHANG;
    setUniformMm(mm);
    setUniform(!existing?.edgeOverhangsMm);
    setEdgeOverhangs(existing?.edgeOverhangsMm ? { ...existing.edgeOverhangsMm } : {});
    setHipMode('auto');
    // 対象が変わったときだけリセット
  }, [target?.buildingId, target?.roofId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;
  const building = canvasData.buildings.find((b) => b.id === target.buildingId);
  if (!building) return null;

  const close = () => setRoofSettingsTarget(null);

  const handleConfirm = () => {
    const poly = target.polygon;
    const mm = clampMm(uniformMm);
    // 辺ごと指定は全辺分を書き出す（未入力の辺は一律出幅と同じ＝既定は全辺同じ出幅）。
    const perEdge: Record<number, number> | undefined = uniform || edges.length === 0
      ? undefined
      : Object.fromEntries(edges.map((e) => [e.originalIndex, clampMm(edgeOverhangs[e.originalIndex] ?? mm)]));
    // 既存編集 or 同一建物・同一 polygon があれば置換、無ければ追加（重複置換）。
    const dup = existing ?? roofs.find((r) => r.buildingId === target.buildingId && r.polygon != null && polygonEquals(r.polygon, poly));
    if (dup) {
      updateRoof(dup.id, { polygon: poly, roofShape, uniformMm: mm, edgeOverhangsMm: perEdge });
    } else {
      addRoof({ id: uuidv4(), buildingId: target.buildingId, polygon: poly, roofShape, uniformMm: mm, edgeOverhangsMm: perEdge });
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

  // 辺ラベル付きの屋根領域プレビュー（旧・屋根設定モーダルと同じ流儀）。
  const preview = (() => {
    if (polygon.length < 3) return null;
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const pad = Math.max(w, h) * 0.15;
    const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
    const polyPts = polygon.map((p) => `${p.x},${p.y}`).join(' ');
    return (
      <svg viewBox={vb} className="w-full h-32 bg-dark-bg rounded-lg border border-dark-border">
        <polygon points={polyPts} fill="rgba(59,130,246,0.15)" stroke="#3B82F6" strokeWidth={Math.max(w, h) * 0.01} />
        {edges.map((edge, i) => {
          const mx = (edge.p1.x + edge.p2.x) / 2;
          const my = (edge.p1.y + edge.p2.y) / 2;
          const N = edges.length;
          const baseOffset = Math.max(w, h) * 0.06;
          const labelPos = computeEdgeLabelPosition(edge, edges[(i - 1 + N) % N], edges[(i + 1) % N], mx, my, baseOffset);
          const fontSize = Math.max(w, h) * 0.06;
          return (
            <text key={edge.index} x={labelPos.x} y={labelPos.y}
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
    );
  })();

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-sm mx-4 w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base text-canvas font-bold">{existing ? '屋根を編集' : '屋根を作成'}</h2>
          <span className="text-[10px] text-dimension">屋根領域（{vertexCount}頂点）</span>
        </div>

        <div className="mb-3">
          <RoofShapeSelector shape={roofShape} onShapeChange={setRoofShape} hipMode={hipMode} onHipModeChange={setHipMode} />
        </div>

        {!uniform && preview && <div className="mb-3">{preview}</div>}

        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)}
            className="w-4 h-4 rounded border-dark-border accent-accent"
          />
          <span className="text-sm text-canvas">全面同じ出幅</span>
        </label>

        {uniform ? (
          <>
            <label className="block text-sm text-dimension mb-1">出幅</label>
            {/* data-tutorial-id: チュートリアルの「軒の出を変更」ステップが値を読む（R-1k で旧モーダルから移設）。 */}
            <div className="flex items-center gap-2 mb-5" data-tutorial-id="roof-overhang-input">
              <NumInput value={uniformMm} onChange={setUniformMm} min={0} step={50} />
              <span className="text-sm text-canvas">mm</span>
            </div>
          </>
        ) : (
          <div className="space-y-2 mb-5">
            <label className="block text-sm text-dimension">辺ごとの出幅 (mm)</label>
            {edges.map((edge) => (
              <div key={edge.index} className="flex items-center gap-2">
                <span className="w-8 h-6 flex items-center justify-center rounded text-xs font-bold bg-dark-bg text-dimension">
                  {edge.label}
                </span>
                <span className="text-[10px] text-dimension w-6 shrink-0">{FACE_LABEL[edge.face]}</span>
                <NumInput
                  value={edgeOverhangs[edge.originalIndex] ?? uniformMm}
                  onChange={(v) => setEdgeOverhangs((prev) => ({ ...prev, [edge.originalIndex]: v }))}
                  min={0} step={50}
                  className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {existing && (
            <button onClick={handleDelete} className="flex-1 py-2 bg-red-500 text-white rounded-xl text-sm font-bold">
              削除
            </button>
          )}
          <button onClick={close} className="flex-1 py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold">
            キャンセル
          </button>
          <button onClick={handleConfirm} data-tutorial-id="roof-confirm" className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-bold">
            {existing ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}
