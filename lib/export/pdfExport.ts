import { PDFDocument, rgb } from 'pdf-lib';
import Konva from 'konva';
import { CanvasData, ExportSettings } from '@/types';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';

// 用紙サイズ・表題欄・方位記号の実寸は pdfLayout.ts と単一ソース（画面プレビューと共有・E-7-fix4）。
import {
  PAPER_DIMENSIONS_PT as PAPER_DIMENSIONS,
  PDF_MARGIN_PT,
  PDF_TITLE_BLOCK_RESERVE_PT,
  TITLE_BLOCK_PT,
  COMPASS_PT,
} from './pdfLayout';

/** 用紙の実寸 (mm) */
const PAPER_MM: Record<string, { width: number; height: number }> = {
  A4_portrait: { width: 210, height: 297 },
  A4_landscape: { width: 297, height: 210 },
  A3_portrait: { width: 297, height: 420 },
  A3_landscape: { width: 420, height: 297 },
};

const SCALE_FACTORS: Record<string, number> = {
  '1/50': 50,
  '1/100': 100,
  '1/200': 200,
  '1/300': 300,
};

/** 印刷範囲をグリッド単位で返す */
export function getPrintAreaGrid(
  paperSize: string,
  scale: string,
): { widthGrid: number; heightGrid: number } | null {
  const paper = PAPER_MM[paperSize];
  const factor = SCALE_FACTORS[scale];
  if (!paper || !factor) return null;
  // 1グリッド = 10mm実寸
  // 縮尺1/S → 紙1mm = S mm実寸
  // 紙W mm → 実寸 W×S mm → W×S/10 グリッド
  return {
    widthGrid: (paper.width * factor) / 10,
    heightGrid: (paper.height * factor) / 10,
  };
}

/** PDF のファイル名（E-7: 全ページ出力は「図面一式」）。 */
export function pdfFileName(siteName?: string, allPages = false): string {
  const base = siteName || '図面';
  return allPages ? `${base}_図面一式.pdf` : `${base}_平面図.pdf`;
}

/**
 * 表題欄をCanvas で画像化して PNG ArrayBuffer を返す。
 * 平米計算 PDF 出力 (= Phase E-4b) でも共用するため named export。
 * pageLabel (= E-7、 多ページ出力時のページ名) は右上に小さく入れる。未指定なら従来表示のまま。
 */
export function renderTitleBlock(
  siteName: string,
  companyName: string,
  date: string,
  scaleLabel: string,
  width: number,
  height: number,
  pageLabel?: string,
): ArrayBuffer {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  ctx.fillStyle = '#000';
  ctx.font = 'bold 14px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(siteName || '', 8, 22);

  ctx.fillStyle = '#555';
  ctx.font = '11px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
  ctx.fillText(companyName || '', 8, 40);

  ctx.fillStyle = '#888';
  ctx.font = '10px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
  ctx.fillText(date || '', 8, height - 8);

  if (pageLabel) {
    // ページ名は表題欄の右上（現場名の行の右端）。長い名前は省略せず small font で収める。
    ctx.fillStyle = '#555';
    ctx.font = '10px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(pageLabel, width - 8, 20);
  }

  if (scaleLabel) {
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(scaleLabel, width - 8, height - 8);
  }

  const dataUrl = canvas.toDataURL('image/png');
  const binaryString = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/** 1 ページ分の描画に必要な入力（E-7: 多ページ出力はこれをページごとに渡す）。 */
export type PdfPageOptions = {
  canvasData: CanvasData;
  settings: ExportSettings;
  printAreaCenter: { x: number; y: number } | null;
  zoom: number;
  panX: number;
  panY: number;
  /** 表題欄に入れるページ名（多ページ出力時のみ）。 */
  pageLabel?: string;
};

/**
 * 既存 PDFDocument に 1 ページ追加して描画する（E-7-1 で exportToPdf から分解）。
 * 中身は従来の exportToPdf と同一: 紙面グリッド → Konva ステージの印刷枠切り出し → 表題欄 → 方位磁石。
 * キャプチャ元は表示中のステージ (Konva.stages[0]) なので、呼び出し側で対象ページを表示し、
 * 印刷枠がビューポートに収まるビューへ寄せてから呼ぶこと（exportViewport.withFittedPrintView）。
 */
export async function renderPdfPage(pdfDoc: PDFDocument, o: PdfPageOptions): Promise<void> {
  const { canvasData, settings, printAreaCenter, zoom, panX, panY, pageLabel } = o;
  const paperDim = PAPER_DIMENSIONS[settings.paperSize] || PAPER_DIMENSIONS.A4_landscape;
  const page = pdfDoc.addPage([paperDim.width, paperDim.height]);

  const marginPt = PDF_MARGIN_PT;
  const titleBlockPt = PDF_TITLE_BLOCK_RESERVE_PT;
  const drawableWidthPt = paperDim.width - marginPt * 2;
  const drawableHeightPt = paperDim.height - marginPt * 2 - titleBlockPt;
  const drawableX = marginPt;
  const drawableY = marginPt + titleBlockPt;

  // ── グリッド線を紙全体に描画 ──
  const paperMm = PAPER_MM[settings.paperSize] || PAPER_MM.A4_landscape;
  const ptPerMm = paperDim.width / paperMm.width;
  const scaleFactor = SCALE_FACTORS[settings.scale] || 100;
  const gridPt = (10 / scaleFactor) * ptPerMm;
  const minorStep = 5;
  const majorStep = 10;
  const minorPt = gridPt * minorStep;
  const majorPt = gridPt * majorStep;

  if (minorPt > 2) {
    for (let x = minorPt; x < paperDim.width; x += minorPt) {
      const nearMajor = Math.abs(x % majorPt) < 0.5;
      page.drawLine({
        start: { x, y: 0 }, end: { x, y: paperDim.height },
        thickness: nearMajor ? 0.4 : 0.15,
        color: rgb(0.8, 0.8, 0.8),
        opacity: nearMajor ? 0.4 : 0.2,
      });
    }
    for (let y = minorPt; y < paperDim.height; y += minorPt) {
      const nearMajor = Math.abs(y % majorPt) < 0.5;
      page.drawLine({
        start: { x: 0, y }, end: { x: paperDim.width, y },
        thickness: nearMajor ? 0.4 : 0.15,
        color: rgb(0.8, 0.8, 0.8),
        opacity: nearMajor ? 0.4 : 0.2,
      });
    }
  }

  // ── Konvaステージの印刷枠範囲だけをキャプチャ ──
  const stages = Konva.stages;
  if (stages.length > 0) {
    const stage = stages[0];

    // printAreaCenterがnullの場合は建物の中心を使う
    let center = printAreaCenter;
    if (!center) {
      if (canvasData.buildings.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of canvasData.buildings)
          for (const p of b.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
        center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      }
    }

    const area = getPrintAreaGrid(settings.paperSize, settings.scale);

    if (area && center) {
      const gridPx = INITIAL_GRID_PX * zoom;
      const pw = area.widthGrid * gridPx;
      const ph = area.heightGrid * gridPx;
      const rectX = center.x * gridPx + panX - pw / 2;
      const rectY = center.y * gridPx + panY - ph / 2;

      // 印刷枠の赤い破線を一時的に非表示にしてキャプチャ
      const layers = stage.getLayers();
      const hiddenLayers: Konva.Layer[] = [];
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        // 印刷枠Rectを含むレイヤーを探して非表示にする
        const printRects = layer.find('Rect').filter((node: Konva.Node) => {
          const rect = node as Konva.Rect;
          return rect.stroke() === '#EF4444' && rect.dash()?.length > 0;
        });
        if (printRects.length > 0) {
          layer.visible(false);
          hiddenLayers.push(layer);
        }
      }
      stage.batchDraw();

      const pixelRatio = Math.max(2, Math.ceil(paperDim.width / pw));
      const dataUrl = stage.toDataURL({
        x: rectX,
        y: rectY,
        width: pw,
        height: ph,
        pixelRatio,
      });

      // 非表示にしたレイヤーを再表示
      for (const layer of hiddenLayers) {
        layer.visible(true);
      }
      stage.batchDraw();

      const imageBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
      const pngImage = await pdfDoc.embedPng(imageBytes);

      // 紙面全体に原寸で埋め込む（縮尺保証、余白0）
      // 印刷枠の widthGrid/heightGrid は paper.width/height × factor/10 で定義されており、
      // アスペクト比が paper と一致するので歪みなく fit する
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: paperDim.width,
        height: paperDim.height,
      });
    } else {
      // 印刷枠なし: ステージ全体をキャプチャ（フォールバック）
      const dataUrl = stage.toDataURL({ pixelRatio: 2 });
      const imageBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
      const pngImage = await pdfDoc.embedPng(imageBytes);

      const imgAspect = pngImage.width / pngImage.height;
      const areaAspect = drawableWidthPt / drawableHeightPt;
      let imgWidth: number, imgHeight: number;
      if (imgAspect > areaAspect) {
        imgWidth = drawableWidthPt;
        imgHeight = drawableWidthPt / imgAspect;
      } else {
        imgHeight = drawableHeightPt;
        imgWidth = drawableHeightPt * imgAspect;
      }

      page.drawImage(pngImage, {
        x: drawableX + (drawableWidthPt - imgWidth) / 2,
        y: drawableY + (drawableHeightPt - imgHeight) / 2,
        width: imgWidth,
        height: imgHeight,
      });
    }
  }

  // ── 表題欄（右下） ──
  const tbWidthPx = 250;
  const tbHeightPx = 60;
  const scaleLabel = settings.scale !== 'auto' ? `S=${settings.scale}` : '';
  const tbImageBytes = renderTitleBlock(
    settings.siteName || '',
    settings.companyName || '',
    settings.date || '',
    scaleLabel,
    tbWidthPx, tbHeightPx,
    pageLabel,
  );
  const tbImage = await pdfDoc.embedPng(tbImageBytes);

  const tbPdfWidth = TITLE_BLOCK_PT.width;
  const tbPdfHeight = TITLE_BLOCK_PT.height; // = tbPdfWidth * (tbHeightPx / tbWidthPx)
  page.drawImage(tbImage, {
    x: drawableX + drawableWidthPt - tbPdfWidth,
    y: marginPt,
    width: tbPdfWidth,
    height: tbPdfHeight,
  });

  // ── 方位磁石（表題欄の左、 canvasData.compass.angle で回転） ──
  const compassRadius = COMPASS_PT.radius;
  const compassMargin = COMPASS_PT.margin;
  const compassCx = drawableX + drawableWidthPt - tbPdfWidth - compassMargin - compassRadius;
  const compassCy = marginPt + compassRadius;
  // 0-360 度に正規化 (= undefined 互換)
  const rawAngle = canvasData.compass?.angle ?? 0;
  const normalizedAngle = Number.isFinite(rawAngle)
    ? ((rawAngle % 360) + 360) % 360
    : 0;
  const angleRad = (normalizedAngle * Math.PI) / 180;
  // 北矢印の tip (= 上向き = y+、 angle CW 回転で右へ)
  const nTipX = compassCx + compassRadius * 0.8 * Math.sin(angleRad);
  const nTipY = compassCy + compassRadius * 0.8 * Math.cos(angleRad);
  // 南矢印 tip (= 反対方向)
  const sTipX = compassCx - compassRadius * 0.8 * Math.sin(angleRad);
  const sTipY = compassCy - compassRadius * 0.8 * Math.cos(angleRad);
  // 外円
  page.drawCircle({
    x: compassCx,
    y: compassCy,
    size: compassRadius,
    borderColor: rgb(0.53, 0.53, 0.5),
    borderWidth: 0.6,
  });
  // 北矢印 (= 赤線)
  page.drawLine({
    start: { x: compassCx, y: compassCy },
    end: { x: nTipX, y: nTipY },
    thickness: 1.2,
    color: rgb(0.9, 0.24, 0.18),
  });
  // 南矢印 (= 灰線)
  page.drawLine({
    start: { x: compassCx, y: compassCy },
    end: { x: sTipX, y: sTipY },
    thickness: 1.0,
    color: rgb(0.53, 0.53, 0.5),
  });
  // N text (= 北 tip 近く、 baseline 微調整)
  page.drawText('N', {
    x: nTipX - 2.5,
    y: nTipY - 2,
    size: 7,
    color: rgb(0.9, 0.24, 0.18),
  });
}

/** PDFDocument を保存してダウンロードさせる（E-7-1 で分解・多ページ出力と共用）。 */
export async function downloadPdf(pdfDoc: PDFDocument, filename: string): Promise<void> {
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 現在表示中のページ 1 枚を PDF 出力する（従来どおり）。 */
export const exportToPdf = async (
  canvasData: CanvasData,
  settings: ExportSettings,
  printAreaCenter: { x: number; y: number } | null,
  zoom: number,
  panX: number,
  panY: number,
): Promise<void> => {
  const pdfDoc = await PDFDocument.create();
  await renderPdfPage(pdfDoc, { canvasData, settings, printAreaCenter, zoom, panX, panY });
  await downloadPdf(pdfDoc, pdfFileName(settings.siteName));
};
