'use client';

// ============================================================
// ページまたぎコピー/移動 UI＋サービス（E-6b-b）。
//  ・select モードで selectedIds が非空のとき、下部にアクションバーを表示。
//  ・「別ページへ…」→ モーダル（既存ページ一覧＋「＋ 新しいページ」）で対象を選び、
//    コピー / 移動 を実行。
//  ・サービス: 対象ページの canvas_data を最新取得 → ペイロード(id振り直し済)を merge → 保存。
//    新規ページは payload を canvas_data として insert。現ページは切り替えない（裏書き）。
//  ・移動 = コピー ＋ removeElements(sourceIds)（現ページ側の削除のみ undo 可能。
//    移動先への追記は別ページの独立 DB 操作で undo 対象外）。
//  ・競合: 既存ページ書き込み直前に最新 canvas_data を取得し append（追記のみ）で実害最小化。
// ============================================================
import React, { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasData } from '@/types';
import { sortPages, nextPageTitle, type PageMeta } from '@/lib/pages/pageOps';
import { buildCrossPagePayload, mergePayloadIntoCanvas, payloadCount } from '@/lib/pages/crossPageCopy';

function blankPageCanvasData(): CanvasData {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [], antis: [],
    memos: [], compass: { angle: 0 },
  };
}

/** 古いデータでも merge が落ちないよう必須配列を補完。 */
function ensureArrays(cv: CanvasData): CanvasData {
  return {
    ...cv,
    buildings: cv.buildings ?? [],
    roofOverhangs: cv.roofOverhangs ?? [],
    obstacles: cv.obstacles ?? [],
    handrails: cv.handrails ?? [],
    posts: cv.posts ?? [],
    antis: cv.antis ?? [],
    memos: cv.memos ?? [],
  };
}

export default function CrossPageTransfer() {
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const drawingId = useCanvasStore((s) => s.drawingId);
  const projectId = useCanvasStore((s) => s.projectId);

  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [target, setTarget] = useState<string>('new'); // drawing id or 'new'
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const openModal = useCallback(async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from('drawings')
      .select('id, title, created_at')
      .eq('project_id', projectId);
    const all = data ? sortPages(data as PageMeta[]) : [];
    setPages(all);
    const siblings = all.filter((p) => p.id !== drawingId);
    setTarget(siblings.length > 0 ? siblings[0].id : 'new');
    setNewTitle(nextPageTitle(all));
    setOpen(true);
  }, [projectId, drawingId]);

  const runTransfer = useCallback(async (action: 'copy' | 'move') => {
    if (busy || !projectId) return;
    const cv = useCanvasStore.getState().canvasData;
    const ids = useCanvasStore.getState().selectedIds;
    const { payload, sourceIds } = buildCrossPagePayload(cv, ids);
    const count = payloadCount(payload);
    if (count === 0) { setOpen(false); return; }

    setBusy(true);
    try {
      if (target === 'new') {
        const merged = mergePayloadIntoCanvas(blankPageCanvasData(), payload);
        const title = newTitle.trim() || nextPageTitle(pages);
        const { error } = await supabase
          .from('drawings')
          .insert({ project_id: projectId, title, canvas_data: merged as unknown as Record<string, unknown> });
        if (error) { alert(`ページ作成エラー: ${error.message}`); return; }
      } else {
        // 既存ページ: 最新 canvas_data を取得 → append → 保存
        const { data, error } = await supabase
          .from('drawings')
          .select('canvas_data')
          .eq('id', target)
          .single();
        if (error || !data) { alert(`対象ページの取得に失敗しました: ${error?.message ?? '不明'}`); return; }
        const merged = mergePayloadIntoCanvas(ensureArrays(data.canvas_data as CanvasData), payload);
        const { error: uerr } = await supabase
          .from('drawings')
          .update({ canvas_data: merged as unknown as Record<string, unknown>, updated_at: new Date().toISOString() })
          .eq('id', target);
        if (uerr) { alert(`対象ページへの書き込みに失敗しました: ${uerr.message}`); return; }
      }

      if (action === 'move') {
        // 現ページ側の削除のみ undo 対象（pushHistory 経由・in-memory、保存は手動）。
        useCanvasStore.getState().removeElements(sourceIds);
      }
      useCanvasStore.getState().setSelectedIds([]);
      setOpen(false);
      useCanvasStore.getState().setAlertMessage(
        `${count}個を${action === 'move' ? '移動' : 'コピー'}しました`,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, target, newTitle, pages]);

  if (mode !== 'select' || selectedIds.length === 0) return null;

  const siblings = pages.filter((p) => p.id !== drawingId);

  return (
    <>
      {/* 選択アクションバー */}
      <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 bg-dark-surface border border-dark-border rounded-xl shadow-xl">
        <span className="text-xs text-dimension whitespace-nowrap">
          選択 <span className="text-accent font-bold">{selectedIds.length}</span> 個
        </span>
        <button
          type="button"
          onClick={openModal}
          className="px-3 py-1.5 bg-accent/20 border border-accent text-accent rounded-lg text-xs font-bold hover:bg-accent/30 transition-colors whitespace-nowrap"
        >
          別ページへ…
        </button>
      </div>

      {/* ページ選択モーダル */}
      {open && (
        <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
          <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-sm max-h-[85vh] overflow-y-auto">
            <h2 className="text-base text-canvas font-bold mb-3">選択オブジェクトを別ページへ</h2>

            <div className="space-y-1.5 mb-4">
              {siblings.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg cursor-pointer">
                  <input type="radio" name="xpage-target" checked={target === p.id} onChange={() => setTarget(p.id)} />
                  <span className="text-sm text-canvas truncate">{p.title}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg cursor-pointer">
                <input type="radio" name="xpage-target" checked={target === 'new'} onChange={() => setTarget('new')} />
                <span className="text-sm text-canvas whitespace-nowrap">＋ 新しいページ</span>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onFocus={() => setTarget('new')}
                  className="flex-1 min-w-0 px-2 py-1 bg-dark-surface border border-dark-border rounded text-xs text-canvas focus:outline-none focus:border-accent"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => runTransfer('copy')}
                className="py-2 bg-accent text-white rounded-xl text-sm font-bold disabled:opacity-50"
              >
                コピー
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runTransfer('move')}
                className="py-2 bg-dark-bg border-2 border-accent text-accent rounded-xl text-sm font-bold disabled:opacity-50"
              >
                移動
              </button>
            </div>
            <p className="text-[10px] text-dimension mb-3 leading-relaxed">
              移動は元ページから削除します（削除は元に戻せます・保存で確定）。建物を選ぶと屋根・棟線・高さマーカーも一緒に運びます。
            </p>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold hover:text-canvas transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </>
  );
}
