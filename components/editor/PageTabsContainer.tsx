'use client';

// ============================================================
// ページタブのコンテナ（E-6a）。DB I/O・遷移・保存を担い、表示は PageTabs に委譲。
//  ・現物件(projectId)の全 drawing を取得しタブ表示（created_at 昇順）。
//  ・切替/新設/複製: 現ページを保存(dirty時) → 対象 drawing へ router.push。
//    エディタの既存ロード useEffect（drawingId 変化で resetForDrawingChange + load）を再利用。
//  ・削除: 最後の1ページは不可。確認後に削除し、アクティブを消したら隣ページへ。
//  ・リネーム: drawings.title を更新。
// 自己完結（store の drawingId/projectId/canvasData を参照）なのでエディタ側の配線は最小。
// ============================================================
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useCanvasStore } from '@/stores/canvasStore';
import PageTabs from './PageTabs';
import {
  sortPages,
  nextPageTitle,
  duplicateTitle,
  canDeletePage,
  nextActiveAfterDelete,
  type PageMeta,
} from '@/lib/pages/pageOps';
import { saveCurrentPageIfDirty } from '@/lib/pages/pageSave';

/** 新規空ページの canvas_data（projects の blankCanvasData と同一テンプレ）。 */
function blankPageCanvasData() {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [],
    roofOverhangs: [],
    obstacles: [],
    handrails: [],
    posts: [],
    antis: [],
    memos: [],
    compass: { angle: 0 },
  };
}

export default function PageTabsContainer() {
  const router = useRouter();
  const drawingId = useCanvasStore((s) => s.drawingId);
  const projectId = useCanvasStore((s) => s.projectId);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [busy, setBusy] = useState(false);

  const loadPages = useCallback(async (pid: string) => {
    const { data } = await supabase
      .from('drawings')
      .select('id, title, created_at')
      .eq('project_id', pid);
    if (data) setPages(sortPages(data as PageMeta[]));
  }, []);

  useEffect(() => {
    if (projectId) loadPages(projectId);
  }, [projectId, loadPages]);

  /** 現ページに未保存変更があれば保存（切替前に呼ぶ）。
   *  E-7-fix2: 保存は pageSave の1経路へ集約（ページ遷移中の取り違え・空上書きをガード）。 */
  const saveCurrent = useCallback(async () => {
    const res = await saveCurrentPageIfDirty();
    if (!res.ok) alert(`保存できませんでした: ${res.message}`);
  }, []);

  const goToPage = useCallback((id: string) => router.push(`/editor/${id}`), [router]);

  const handleSwitch = useCallback(async (id: string) => {
    if (busy || id === drawingId) return;
    setBusy(true);
    try {
      await saveCurrent();
      goToPage(id);
    } finally {
      setBusy(false);
    }
  }, [busy, drawingId, saveCurrent, goToPage]);

  const insertPage = useCallback(async (title: string, canvas_data: unknown) => {
    if (!projectId) return;
    const { data, error } = await supabase
      .from('drawings')
      .insert({ project_id: projectId, title, canvas_data: canvas_data as Record<string, unknown> })
      .select('id')
      .single();
    if (error || !data) {
      alert(`ページ作成エラー: ${error?.message ?? '不明なエラー'}`);
      return;
    }
    goToPage(data.id);
  }, [projectId, goToPage]);

  const handleAddBlank = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveCurrent();
      await insertPage(nextPageTitle(pages), blankPageCanvasData());
    } finally {
      setBusy(false);
    }
  }, [busy, pages, saveCurrent, insertPage]);

  const handleDuplicate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveCurrent();
      const currentTitle = pages.find((p) => p.id === drawingId)?.title ?? '平面図';
      const snapshot = JSON.parse(JSON.stringify(useCanvasStore.getState().canvasData));
      await insertPage(duplicateTitle(currentTitle, pages), snapshot);
    } finally {
      setBusy(false);
    }
  }, [busy, pages, drawingId, saveCurrent, insertPage]);

  const handleDelete = useCallback(async (id: string) => {
    if (busy || !canDeletePage(pages)) return;
    if (!window.confirm('このページを削除しますか？（元に戻せません）')) return;
    setBusy(true);
    try {
      const nextActive = drawingId ? nextActiveAfterDelete(pages, id, drawingId) : null;
      const { error } = await supabase.from('drawings').delete().eq('id', id);
      if (error) {
        alert(`ページ削除エラー: ${error.message}`);
        return;
      }
      if (id === drawingId && nextActive) {
        goToPage(nextActive);
      } else if (projectId) {
        await loadPages(projectId);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, pages, drawingId, projectId, goToPage, loadPages]);

  const handleRename = useCallback(async (id: string, title: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, title } : p)));
    const { error } = await supabase.from('drawings').update({ title }).eq('id', id);
    if (error) {
      alert(`ページ名の変更に失敗しました: ${error.message}`);
      if (projectId) loadPages(projectId);
    }
  }, [projectId, loadPages]);

  // ページ情報未取得（projectId 未確定）の間は何も出さない。
  if (pages.length === 0) return null;

  return (
    <PageTabs
      pages={pages.map((p) => ({ id: p.id, title: p.title }))}
      activeId={drawingId}
      onSwitch={handleSwitch}
      onAddBlank={handleAddBlank}
      onDuplicate={handleDuplicate}
      onDelete={handleDelete}
      onRename={handleRename}
      disabled={busy}
    />
  );
}
