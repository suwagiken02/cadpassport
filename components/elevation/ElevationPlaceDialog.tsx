'use client';

// ============================================================
// 立面図の配置ダイアログ（E-6e）。
//   [4面一括(既定) / この面のみ] × [今のページ / 既存ページ / 新しいページ]。
//   ・4面一括: 各面の立面をプリミティブ化→computeQuadLayout で A4横田の字に配置。
//   ・この面のみ: 現在の面を平面と同縮尺(scale=1)で配置（従来の 📍 相当）。
//   ・配置先が別/新規ページなら canvas_data を裏書き（同面は置換）。新規は router.push で切替。
// ============================================================
import React, { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useCanvasStore } from '@/stores/canvasStore';
import { reconstructFaces, type Face } from '@/lib/konva/elevation/faceReconstruction';
import { buildFaceElevation } from '@/lib/konva/elevation/elevationEngine';
import { faceElevationToPrimitives, initialPlacementOrigin } from '@/lib/konva/elevation/elevationToObjects';
import { computeQuadLayout, elevationPrimitivesBounds, type FaceKey } from '@/lib/pages/quadLayout';
import { sortPages, nextPageTitle, type PageMeta } from '@/lib/pages/pageOps';
import type { CanvasData, ElevationView, Point } from '@/types';
import type { PillarType } from '@/lib/konva/calculator';

const FALLBACK_HEIGHT_MM = 5000;
const QUAD_FACES: FaceKey[] = ['south', 'east', 'north', 'west'];

function blankCanvasData(): CanvasData {
  return {
    version: '1.0', grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
    memos: [], compass: { angle: 0 },
  };
}

/** elevationViews を面キーで置換（同面は上書き）して canvas_data に merge。 */
function mergeElevationViews(cv: CanvasData, views: ElevationView[]): CanvasData {
  const placed = new Set(views.map((v) => v.face));
  const kept = (cv.elevationViews ?? []).filter((e) => !placed.has(e.face));
  return { ...cv, elevationViews: [...kept, ...views] };
}

export default function ElevationPlaceDialog({
  face, pillarType, onClose,
}: { face: Face; pillarType: PillarType; onClose: () => void }) {
  const router = useRouter();
  const canvasData = useCanvasStore((s) => s.canvasData);
  const drawingId = useCanvasStore((s) => s.drawingId);
  const projectId = useCanvasStore((s) => s.projectId);

  const [mode, setMode] = useState<'quad' | 'single'>('quad');
  const [target, setTarget] = useState<string>('current'); // 'current' | drawingId | 'new'
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [newTitle, setNewTitle] = useState('立面図');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    supabase.from('drawings').select('id, title, created_at').eq('project_id', projectId).then(({ data }) => {
      if (data) setPages(sortPages(data as PageMeta[]));
    });
  }, [projectId]);

  const fillOf = (id: string) => canvasData.buildings.find((b) => b.id === id)?.fill ?? '#3d3d3a';
  const hasMarkers = (canvasData.heightMarkers ?? []).length > 0;

  const feFor = (f: Face) => {
    const cols = reconstructFaces(canvasData.handrails).filter((c) => c.face === f);
    return buildFaceElevation(cols, canvasData.buildings, {
      markers: canvasData.heightMarkers ?? [],
      defaultHeightMm: hasMarkers ? undefined : FALLBACK_HEIGHT_MM,
      pillarType, face: f,
      roofOverhangs: canvasData.roofOverhangs,
      roofs: canvasData.roofs,
      ridgeLines: canvasData.ridgeLines ?? [],
    });
  };

  /** 配置する ElevationView[] を組み立てる。base は配置先の基準位置。 */
  const buildViews = (base: Point): ElevationView[] | null => {
    if (mode === 'single') {
      const prims = faceElevationToPrimitives(feFor(face), fillOf);
      if (prims.length === 0) return null;
      return [{ id: uuidv4(), face, originGrid: base, scale: 1, primitives: prims }];
    }
    // 4 面一括
    const faceData = QUAD_FACES.map((f) => {
      const prims = faceElevationToPrimitives(feFor(f), fillOf);
      return { face: f, prims, bounds: prims.length ? elevationPrimitivesBounds(prims) : null };
    });
    const layout = computeQuadLayout(faceData.map((d) => ({ face: d.face, bounds: d.bounds })), { base });
    if (!layout) return null;
    return layout.placements.map((pl) => {
      const d = faceData.find((x) => x.face === pl.face)!;
      return { id: uuidv4(), face: pl.face, originGrid: pl.originGrid, scale: layout.scale, primitives: d.prims };
    });
  };

  const doPlace = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 現ページは建物の右側、別/新規ページは左上寄せを基準に。
      const baseCurrent = initialPlacementOrigin(canvasData.buildings);
      const baseOther: Point = { x: 20, y: 20 };

      if (target === 'current') {
        const views = buildViews(baseCurrent);
        if (!views) { alert('配置できる立面がありません（建物・足場を確認してください）'); return; }
        // 4 面まとめて 1 回の pushHistory で追加（E-6e-perf: 履歴スナップショットの重複を回避）。
        useCanvasStore.getState().addElevationViews(views);
      } else if (target === 'new') {
        const views = buildViews(baseOther);
        if (!views) { alert('配置できる立面がありません（建物・足場を確認してください）'); return; }
        if (!projectId) { alert('プロジェクトが不明です'); return; }
        const merged = mergeElevationViews(blankCanvasData(), views);
        const { data, error } = await supabase
          .from('drawings')
          .insert({ project_id: projectId, title: newTitle.trim() || '立面図', canvas_data: merged as unknown as Record<string, unknown> })
          .select('id').single();
        if (error || !data) { alert(`ページ作成エラー: ${error?.message ?? '不明'}`); return; }
        router.push(`/editor/${data.id}`);
      } else {
        const views = buildViews(baseOther);
        if (!views) { alert('配置できる立面がありません（建物・足場を確認してください）'); return; }
        const { data, error } = await supabase.from('drawings').select('canvas_data').eq('id', target).single();
        if (error || !data) { alert(`対象ページの取得に失敗しました: ${error?.message ?? '不明'}`); return; }
        const merged = mergeElevationViews(data.canvas_data as CanvasData, views);
        const { error: uerr } = await supabase.from('drawings')
          .update({ canvas_data: merged as unknown as Record<string, unknown>, updated_at: new Date().toISOString() })
          .eq('id', target);
        if (uerr) { alert(`書き込みに失敗しました: ${uerr.message}`); return; }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const siblings = pages.filter((p) => p.id !== drawingId);
  const radio = (checked: boolean) => (checked ? 'border-accent bg-accent/10' : 'border-dark-border bg-dark-bg');

  return (
    <div className="fixed inset-0 modal-overlay z-[55] flex items-center justify-center p-4">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-sm max-h-[88vh] overflow-y-auto">
        <h2 className="text-base text-canvas font-bold mb-3">立面図を配置</h2>

        {/* 何を */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {([['quad', '4面一括'], ['single', 'この面のみ']] as [typeof mode, string][]).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`py-2 rounded-xl text-sm font-bold border-2 transition-colors ${
                mode === m ? 'bg-accent/20 border-accent text-accent' : 'bg-dark-bg border-dark-border text-dimension'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* どこへ */}
        <p className="text-xs text-dimension mb-1.5">配置先</p>
        <div className="space-y-1.5 mb-4">
          <label className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${radio(target === 'current')}`}>
            <input type="radio" name="ev-target" checked={target === 'current'} onChange={() => setTarget('current')} />
            <span className="text-sm text-canvas">今のページ</span>
          </label>
          {siblings.map((p) => (
            <label key={p.id} className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${radio(target === p.id)}`}>
              <input type="radio" name="ev-target" checked={target === p.id} onChange={() => setTarget(p.id)} />
              <span className="text-sm text-canvas truncate">{p.title}</span>
            </label>
          ))}
          <label className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${radio(target === 'new')}`}>
            <input type="radio" name="ev-target" checked={target === 'new'} onChange={() => setTarget('new')} />
            <span className="text-sm text-canvas whitespace-nowrap">新しいページ</span>
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onFocus={() => setTarget('new')}
              className="flex-1 min-w-0 px-2 py-1 bg-dark-surface border border-dark-border rounded text-xs text-canvas focus:outline-none focus:border-accent" />
          </label>
        </div>

        <button type="button" disabled={busy} onClick={doPlace}
          className="w-full py-2.5 bg-accent text-white rounded-xl text-sm font-bold disabled:opacity-50 mb-2">
          {busy ? '配置中…' : '配置する'}
        </button>
        <button type="button" onClick={onClose}
          className="w-full py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold hover:text-canvas transition-colors">
          キャンセル
        </button>
      </div>
    </div>
  );
}
