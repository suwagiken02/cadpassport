// ============================================================
// PDF 紙面レイアウトの定数と、印刷枠内での占有位置の計算 (E-7-fix4・pure)。
//
// 出力時は「印刷枠の切り出し画像を紙面全体に貼り、その上に表題欄と方位記号を重ねる」ので、
// 表題欄・方位記号は常に紙面の右下の固定位置に入る。画面の印刷枠プレビューでも同じ位置を
// 出せるよう、紙寸法と配置定数をここに集約し、pdfExport と共有する（数値の二重管理を避ける）。
//
// 返すのは「印刷枠に対する比率(0..1)」。画面側は枠の px サイズを掛けるだけでよく、
// ズーム・用紙サイズ・縮尺のいずれが変わっても追従する。依存なし＝node でもテスト可能。
// ============================================================

/** 用紙サイズ (pt, 72pt=1inch)。 */
export const PAPER_DIMENSIONS_PT: Record<string, { width: number; height: number }> = {
  A4_portrait: { width: 595.28, height: 841.89 },
  A4_landscape: { width: 841.89, height: 595.28 },
  A3_portrait: { width: 841.89, height: 1190.55 },
  A3_landscape: { width: 1190.55, height: 841.89 },
};

/** 紙面の余白(pt)。 */
export const PDF_MARGIN_PT = 20;
/** 図面領域の下部に確保する表題欄ぶんの高さ(pt)。 */
export const PDF_TITLE_BLOCK_RESERVE_PT = 50;
/** 表題欄の実寸(pt)。renderTitleBlock は 250x60px を 200pt 幅で貼るのでその比率。 */
export const TITLE_BLOCK_PT = { width: 200, height: 200 * (60 / 250) };
/** 方位記号(pt)。表題欄の左隣に置く円。 */
export const COMPASS_PT = { radius: 18, margin: 12 };

/** 印刷枠に対する比率の矩形。y は上端からの比率（画面座標に合わせる）。 */
export type FrameRectF = { xF: number; yF: number; wF: number; hF: number };

/**
 * 表題欄が印刷枠内で占める領域（比率）。用紙サイズ不明は null。
 * PDF 座標は下端原点なので、上端基準へ反転して返す。
 */
export function titleBlockFrameRect(paperSize: string): FrameRectF | null {
  const paper = PAPER_DIMENSIONS_PT[paperSize];
  if (!paper) return null;
  const left = paper.width - PDF_MARGIN_PT - TITLE_BLOCK_PT.width;
  const bottom = PDF_MARGIN_PT;
  return {
    xF: left / paper.width,
    yF: 1 - (bottom + TITLE_BLOCK_PT.height) / paper.height,
    wF: TITLE_BLOCK_PT.width / paper.width,
    hF: TITLE_BLOCK_PT.height / paper.height,
  };
}

/** 方位記号が印刷枠内で占める領域（円の外接矩形・比率）。用紙サイズ不明は null。 */
export function compassFrameRect(paperSize: string): FrameRectF | null {
  const paper = PAPER_DIMENSIONS_PT[paperSize];
  if (!paper) return null;
  const { radius, margin } = COMPASS_PT;
  const cx = paper.width - PDF_MARGIN_PT - TITLE_BLOCK_PT.width - margin - radius;
  const cyFromBottom = PDF_MARGIN_PT + radius;
  return {
    xF: (cx - radius) / paper.width,
    yF: 1 - (cyFromBottom + radius) / paper.height,
    wF: (radius * 2) / paper.width,
    hF: (radius * 2) / paper.height,
  };
}
