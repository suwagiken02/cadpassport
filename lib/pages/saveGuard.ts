// ============================================================
// 保存の安全ガード (E-7-fix2・pure)。
//
// 背景（実機のデータ破壊）: ページ切替は router 遷移で、store の drawingId は遷移直後に
// 新ページの id へ変わるのに canvasData は非同期ロードが終わるまで前ページのものが残る。
// この「id とデータがズレている窓」で保存が走ると、別ページの内容を書き込んでしまう。
// さらに立面の「新しいページへ配置」は遷移前に現ページを保存していなかったため、
// 未保存の編集がそのまま失われていた。
//
// ここでは「いま持っているデータはどの図面のものか(loadedDrawingId)」を突き合わせ、
// ・別図面のデータを書こうとしていないか
// ・中身のあるページを空データで上書きしようとしていないか
// を判定する。実際の I/O は pageSave.ts。
// ============================================================
import type { CanvasData } from '@/types';

/** 図面の中身が空か（コンテンツを持つコレクションが全て空）。 */
export function canvasDataIsEmpty(cv: CanvasData | null | undefined): boolean {
  if (!cv) return true;
  const counts = [
    cv.buildings?.length ?? 0,
    cv.handrails?.length ?? 0,
    cv.posts?.length ?? 0,
    cv.antis?.length ?? 0,
    cv.obstacles?.length ?? 0,
    cv.memos?.length ?? 0,
    cv.elevationViews?.length ?? 0,
    cv.magnetPins?.length ?? 0,
    cv.ridgeLines?.length ?? 0,
    cv.heightMarkers?.length ?? 0,
    cv.roofs?.length ?? 0,
    cv.roofOverhangs?.length ?? 0,
    cv.stairs?.length ?? 0,
    cv.pipes?.length ?? 0,
    // E-8-v5a: 手動部材だけのページ（立面も建物も無い）を「空」と誤判定しない。
    cv.freeParts?.length ?? 0,
    // S-1: 敷地だけ描いたページ（建物はこれから）も「空」ではない。
    cv.sitePolygons?.length ?? 0,
  ];
  return counts.every((n) => n === 0);
}

export type SaveDecision =
  | { ok: true }
  | { ok: false; reason: 'id-mismatch' | 'blank-overwrite'; message: string };

/**
 * 保存してよいかの判定（pure）。
 * ・id-mismatch: メモリ上のデータが別図面のもの（＝ページ遷移の途中）。書けば取り違えになる。
 * ・blank-overwrite: 空データで、中身のある既存ページを潰そうとしている。
 *   existingIsEmpty=null は「未確認」。next が空でなければ確認不要なので ok。
 */
export function checkSaveSafety(args: {
  targetDrawingId: string;
  loadedDrawingId: string | null;
  next: CanvasData;
  existingIsEmpty: boolean | null;
}): SaveDecision {
  const { targetDrawingId, loadedDrawingId, next, existingIsEmpty } = args;
  if (!targetDrawingId) {
    return { ok: false, reason: 'id-mismatch', message: '保存先のページが不明です' };
  }
  if (loadedDrawingId !== targetDrawingId) {
    return {
      ok: false,
      reason: 'id-mismatch',
      message: 'ページの読み込み中のため保存を中断しました（別ページの内容を書き込むのを防ぎました）',
    };
  }
  if (canvasDataIsEmpty(next) && existingIsEmpty === false) {
    return {
      ok: false,
      reason: 'blank-overwrite',
      message: '空の内容で既存ページを上書きしようとしたため中断しました',
    };
  }
  return { ok: true };
}

/** 空データを書こうとしているか（＝保存前に既存ページの中身を確認すべきか）。 */
export function needsExistingCheck(next: CanvasData): boolean {
  return canvasDataIsEmpty(next);
}
