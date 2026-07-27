import { describe, it, expect } from 'vitest';
import {
  COMPASS_PT, PAPER_DIMENSIONS_PT, PDF_MARGIN_PT, TITLE_BLOCK_PT,
  compassFrameRect, titleBlockFrameRect,
} from '../pdfLayout';

// ============================================================
// E-7-fix4: 印刷枠の中で表題欄・方位記号が占める位置（比率）。
// 出力時は「印刷枠の画像を紙面全体に貼る」ので、紙面上の固定位置＝枠内の固定比率になる。
// 実 PDF(renderPdfPage)の配置式と同じ結果になることを固定する。
// ============================================================
const A4L = 'A4_landscape';

/** renderPdfPage の配置式（pt・PDF 座標は下端原点）を再現した期待値。 */
function expectedTitleBlockPt(paperSize: string) {
  const paper = PAPER_DIMENSIONS_PT[paperSize];
  const drawableWidth = paper.width - PDF_MARGIN_PT * 2;
  const drawableX = PDF_MARGIN_PT;
  return {
    x: drawableX + drawableWidth - TITLE_BLOCK_PT.width,
    y: PDF_MARGIN_PT,
    w: TITLE_BLOCK_PT.width,
    h: TITLE_BLOCK_PT.height,
  };
}

describe('titleBlockFrameRect', () => {
  it('renderPdfPage の実配置と一致する（右下・余白 20pt）', () => {
    const paper = PAPER_DIMENSIONS_PT[A4L];
    const exp = expectedTitleBlockPt(A4L);
    const r = titleBlockFrameRect(A4L)!;
    expect(r.xF * paper.width).toBeCloseTo(exp.x, 6);
    expect(r.wF * paper.width).toBeCloseTo(exp.w, 6);
    expect(r.hF * paper.height).toBeCloseTo(exp.h, 6);
    // 上端基準へ反転されている（PDF は下端原点）
    expect((1 - r.yF - r.hF) * paper.height).toBeCloseTo(exp.y, 6);
  });

  it('比率は 0..1 に収まり、右下に寄る', () => {
    const r = titleBlockFrameRect(A4L)!;
    expect(r.xF).toBeGreaterThan(0.5);
    expect(r.yF).toBeGreaterThan(0.5);
    expect(r.xF + r.wF).toBeLessThanOrEqual(1);
    expect(r.yF + r.hF).toBeLessThanOrEqual(1);
  });

  it('用紙サイズごとに比率が変わる（縦は相対的に小さく見える）', () => {
    const land = titleBlockFrameRect(A4L)!;
    const port = titleBlockFrameRect('A4_portrait')!;
    expect(port.wF).toBeGreaterThan(land.wF); // 紙幅が狭い分、幅の比率は大きい
    expect(port.hF).toBeLessThan(land.hF);    // 紙高が高い分、高さの比率は小さい
  });

  it('全用紙サイズで返る / 未知サイズは null', () => {
    for (const size of Object.keys(PAPER_DIMENSIONS_PT)) {
      expect(titleBlockFrameRect(size)).not.toBeNull();
    }
    expect(titleBlockFrameRect('B5_portrait')).toBeNull();
  });
});

describe('compassFrameRect', () => {
  it('表題欄の左隣に置かれる（重ならない）', () => {
    const tb = titleBlockFrameRect(A4L)!;
    const cp = compassFrameRect(A4L)!;
    expect(cp.xF + cp.wF).toBeLessThanOrEqual(tb.xF + 1e-9);
  });

  it('円の外接矩形は直径ぶん（renderPdfPage の半径と一致）', () => {
    const paper = PAPER_DIMENSIONS_PT[A4L];
    const cp = compassFrameRect(A4L)!;
    expect(cp.wF * paper.width).toBeCloseTo(COMPASS_PT.radius * 2, 6);
    expect(cp.hF * paper.height).toBeCloseTo(COMPASS_PT.radius * 2, 6);
  });

  it('未知サイズは null', () => {
    expect(compassFrameRect('unknown')).toBeNull();
  });
});
