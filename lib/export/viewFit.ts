// ============================================================
// PDF 出力用のビュー合わせ (E-7-1・pure)。
//
// 出力は Konva ステージの「印刷枠の矩形」を toDataURL で切り出す方式だが、キャンバスの背景と
// グリッド線はビューポート(表示領域)サイズでしか描かれていない。そのため印刷枠が画面外へ
// はみ出していると、その部分が白紙のまま PDF に出る（単一ページ出力にもあった潜在バグ）。
// キャプチャ前に「印刷枠がビューポートに収まる zoom/pan」へ寄せるための計算をここに集約する。
// 実際に store を触って待ち合わせるのは exportViewport.ts（副作用あり）。
// ============================================================
import { INITIAL_GRID_PX, ZOOM_MIN, ZOOM_MAX } from '@/lib/konva/gridUtils';

export type Viewport = { width: number; height: number };
export type ViewTransform = { zoom: number; panX: number; panY: number };
export type PrintAreaGrid = { widthGrid: number; heightGrid: number };

/** 収まり判定の安全率（丸め誤差でヘリが 1px 欠けるのを防ぐ）。 */
const FIT_MARGIN = 0.98;

export type FitResult = ViewTransform & {
  /** 印刷枠がビューポートに収まったか。false=ZOOM_MIN でも収まらない（巨大縮尺×狭い画面）。 */
  fits: boolean;
};

/**
 * 印刷枠(グリッド)がビューポートに収まる zoom と、center が画面中央に来る pan を返す。
 * ・zoom は [ZOOM_MIN, ZOOM_MAX] にクランプ。ZOOM_MIN でも収まらなければ fits=false。
 * ・pan は center(グリッド座標)を画面中央へ持ってくる平行移動。
 * viewport が 0 以下（未計測）や印刷枠が不正なときは fallback をそのまま返す。
 */
export function fitViewToPrintArea(
  area: PrintAreaGrid | null,
  center: { x: number; y: number } | null,
  viewport: Viewport,
  fallback: ViewTransform,
): FitResult {
  if (!area || !center || viewport.width <= 0 || viewport.height <= 0) {
    return { ...fallback, fits: false };
  }
  const areaPxW = area.widthGrid * INITIAL_GRID_PX;
  const areaPxH = area.heightGrid * INITIAL_GRID_PX;
  if (areaPxW <= 0 || areaPxH <= 0) return { ...fallback, fits: false };

  const raw = Math.min(viewport.width / areaPxW, viewport.height / areaPxH) * FIT_MARGIN;
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, raw));
  const gridPx = INITIAL_GRID_PX * zoom;
  return {
    zoom,
    panX: viewport.width / 2 - center.x * gridPx,
    panY: viewport.height / 2 - center.y * gridPx,
    fits: area.widthGrid * gridPx <= viewport.width + 1e-6
      && area.heightGrid * gridPx <= viewport.height + 1e-6,
  };
}

/** 建物の外接矩形の中心（グリッド）。建物なしは null。印刷中心の既定値。 */
export function buildingsCenterGrid(
  buildings: { points: { x: number; y: number }[] }[],
): { x: number; y: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of buildings) {
    for (const p of b.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}
