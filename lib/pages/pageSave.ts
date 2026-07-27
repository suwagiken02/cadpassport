'use client';

// ============================================================
// 図面(ページ)の保存 I/O を1経路に集約 (E-7-fix2)。
// 保存の可否判定は saveGuard.ts（pure）。ここは Supabase アクセスと store 連携のみ。
//
// 保存経路はこれまで3箇所（手動保存 / タブ切替前の保存 / 立面の別ページ書き込み）に散らばり、
// ページ遷移中の id とデータのズレを誰も見ていなかった。ここを通せば全経路にガードが効く。
// ============================================================
import { supabase } from '@/lib/supabase/client';
import { useCanvasStore } from '@/stores/canvasStore';
import { canvasDataIsEmpty, checkSaveSafety, needsExistingCheck, type SaveDecision } from './saveGuard';
import type { CanvasData } from '@/types';

export type SaveOutcome =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true }
  | { ok: false; reason: 'id-mismatch' | 'blank-overwrite' | 'db'; message: string };

/**
 * canvasData を指定図面へ保存する（ガード付き）。
 * ・メモリ上のデータが別図面のもの（遷移中）なら書かない。
 * ・空データで中身のあるページを潰そうとしたら書かない。
 */
export async function saveDrawingCanvas(
  targetDrawingId: string,
  next: CanvasData,
  loadedDrawingId: string | null,
): Promise<SaveOutcome> {
  // 空データを書こうとしているときだけ、既存ページの中身を確認する（通常保存に余計な往復を足さない）。
  let existingIsEmpty: boolean | null = null;
  if (needsExistingCheck(next) && targetDrawingId) {
    const { data } = await supabase.from('drawings').select('canvas_data').eq('id', targetDrawingId).single();
    if (data) existingIsEmpty = canvasDataIsEmpty(data.canvas_data as CanvasData);
  }

  const decision: SaveDecision = checkSaveSafety({ targetDrawingId, loadedDrawingId, next, existingIsEmpty });
  if (!decision.ok) return decision;

  const { error } = await supabase
    .from('drawings')
    .update({ canvas_data: next as unknown as Record<string, unknown>, updated_at: new Date().toISOString() })
    .eq('id', targetDrawingId);
  if (error) return { ok: false, reason: 'db', message: error.message };
  return { ok: true };
}

/**
 * 現ページに未保存変更があれば保存する（ページ切替・別ページへの遷移の直前に呼ぶ）。
 * 変更なし/保存先不明なら skipped=true で何もしない。
 */
export async function saveCurrentPageIfDirty(): Promise<SaveOutcome> {
  const s = useCanvasStore.getState();
  if (!s.drawingId || !s.isDirty) return { ok: true, skipped: true };
  const res = await saveDrawingCanvas(s.drawingId, s.canvasData, s.loadedDrawingId);
  if (res.ok && !res.skipped) useCanvasStore.setState({ isDirty: false });
  return res;
}
