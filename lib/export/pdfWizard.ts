// ============================================================
// 全ページ PDF の「ページごとの枠指定」ウィザード (E-7-fix3・pure)。
//
// 従来は表示中ページの枠しか指定できず、ページを移るとモーダル(ローカル state)も
// 印刷枠(resetForDrawingChange で false)も消えていた。ウィザードの状態は store に置き、
// ページ遷移をまたいで生き残らせる。ここはその状態遷移の純粋部分。
//
// 枠中心は「ユーザーが動かしたページだけ」記録する。未指定ページは記録せず、
// 出力時に建物 bbox 中心へフォールバックさせる（renderPdfPage の既定動作）。
// ============================================================
import type { PaperSize, Point, ScaleOption } from '@/types';

export type PdfWizardPage = { id: string; title: string };

export type PdfWizardSettings = {
  paperSize: PaperSize;
  scale: ScaleOption;
  siteName: string;
  companyName: string;
  date: string;
  /**
   * 補助線を含めるか (= E-8-v5c)。全ページ出力はページ遷移をまたいで進むので、
   * モーダルのローカル state では消える。ウィザードの状態（store）が持ち運ぶ。
   */
  includeAids?: boolean;
};

export type PdfWizardState = {
  /** 対象ページ（タブと同じ表示順）。 */
  pages: PdfWizardPage[];
  /** いま枠を指定しているページの index。 */
  index: number;
  /** pageId → 枠中心（ユーザーが指定したページのみ）。 */
  centers: Record<string, Point>;
  settings: PdfWizardSettings;
  /** 開始時のページ（完了/キャンセルで戻る先）。 */
  returnDrawingId: string | null;
  /** 出力実行中か（枠指定 UI を隠して進捗を出す）。 */
  exporting: boolean;
  progress: { current: number; total: number; title: string } | null;
};

/** ウィザードの初期状態。ページが 0 件なら null（開始できない）。 */
export function createWizardState(
  pages: PdfWizardPage[],
  settings: PdfWizardSettings,
  returnDrawingId: string | null,
): PdfWizardState | null {
  if (pages.length === 0) return null;
  return { pages, index: 0, centers: {}, settings, returnDrawingId, exporting: false, progress: null };
}

/** いま枠を指定しているページ。範囲外は null。 */
export function currentWizardPage(w: PdfWizardState): PdfWizardPage | null {
  return w.pages[w.index] ?? null;
}

/** 最後のページか（＝「このページを決定」で出力が走る）。 */
export function isLastWizardStep(w: PdfWizardState): boolean {
  return w.index >= w.pages.length - 1;
}

/**
 * 枠中心を記録する（center=null のページは記録しない＝bbox 中心フォールバック対象のまま）。
 * 既に記録済みのページで null を渡した場合は記録を消す（「未指定に戻す」）。
 */
export function recordCenter(
  centers: Record<string, Point>, pageId: string, center: Point | null,
): Record<string, Point> {
  if (!center) {
    if (!(pageId in centers)) return centers;
    const next = { ...centers };
    delete next[pageId];
    return next;
  }
  return { ...centers, [pageId]: { x: center.x, y: center.y } };
}

/** そのページにユーザー指定の枠中心があるか。無ければ出力時に建物 bbox 中心へフォールバック。 */
export function centerForPage(
  centers: Record<string, Point>, pageId: string,
): Point | null {
  return centers[pageId] ?? null;
}

/** 「(2/5) このページの枠位置を指定してください」の進捗ラベル。 */
export function wizardStepLabel(w: PdfWizardState): string {
  return `(${Math.min(w.index + 1, w.pages.length)}/${w.pages.length})`;
}

/** 決定して次のページへ進めた状態。最後のページなら index は据え置き（呼び出し側が出力へ）。 */
export function advanceWizard(w: PdfWizardState, center: Point | null): PdfWizardState {
  const page = currentWizardPage(w);
  const centers = page ? recordCenter(w.centers, page.id, center) : w.centers;
  return { ...w, centers, index: isLastWizardStep(w) ? w.index : w.index + 1 };
}
