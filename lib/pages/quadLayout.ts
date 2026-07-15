// ============================================================
// 立面図 4 面の田の字レイアウト計算（E-6e・pure）。
// A4 横 1 枚に収まるよう、4 面を共通縮尺で 2×2 配置する。
//   南=左上 / 東=右上 / 北=左下 / 西=右下（建築図面の慣習）。
//
// 座標系: ElevationView のローカル座標（グリッド。E-4 の faceElevationToPrimitives 出力）。
//   ・ElevationView.scale=1 は「平面と同縮尺」= 基準縮尺 Pref(既定 1/100) 相当。
//   ・印刷縮尺 = Pref / scale。よって scale 候補を Pref/denom に取り、収まる最大を選ぶ。
// 枠は A4 横(297×210mm) を Pref でグリッド換算（1グリッド=10mm実寸）。pdfExport は
// Konva/pdf-lib を含み pure テスト不可のため、ここでは実寸定数から自前算出する。
// ============================================================
import type { ElevationPrimitive, Point } from '@/types';

export type FaceKey = 'south' | 'east' | 'north' | 'west';
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type QuadPlacement = { face: FaceKey; originGrid: Point };
export type QuadLayout = { scale: number; scaleLabel: string; placements: QuadPlacement[] };

/** A4 横の実寸(mm)。 */
const A4_LANDSCAPE_MM = { w: 297, h: 210 };
/** 標準縮尺の分母（キリのいい建築縮尺）。小さい denom = 大きい表示。 */
const STD_DENOMS = [50, 75, 100, 150, 200, 250, 300, 400, 500];

/** 田の字のセル位置（col, row）。南=左上 / 東=右上 / 北=左下 / 西=右下。 */
const CELL_POS: Record<FaceKey, { col: 0 | 1; row: 0 | 1 }> = {
  south: { col: 0, row: 0 },
  east: { col: 1, row: 0 },
  north: { col: 0, row: 1 },
  west: { col: 1, row: 1 },
};

/** プリミティブ列の bbox（ローカル・グリッド）。空なら null。 */
export function elevationPrimitivesBounds(prims: ElevationPrimitive[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  for (const p of prims) {
    if (p.kind === 'line') { see(p.x1, p.y1); see(p.x2, p.y2); }
    else if (p.kind === 'rect') { see(p.x, p.y); see(p.x + p.w, p.y + p.h); }
    else if (p.kind === 'polygon') { for (let i = 0; i < p.points.length; i += 2) see(p.points[i], p.points[i + 1]); }
    else see(p.x, p.y); // text
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** scaleRaw を下回らない最大の標準 scale(=Pref/denom) を選ぶ。 */
function roundToStandardScale(scaleRaw: number, refDenom: number): { scale: number; denom: number } {
  for (const d of STD_DENOMS) {
    const s = refDenom / d; // denom 昇順 = scale 降順
    if (s <= scaleRaw) return { scale: s, denom: d };
  }
  // scaleRaw が最小候補より小さい → 最小 scale（最大 denom）で妥協。
  const last = STD_DENOMS[STD_DENOMS.length - 1];
  return { scale: refDenom / last, denom: last };
}

/**
 * 4 面の bbox から共通縮尺と各面の originGrid を計算する。
 * @param faces 各面の bbox（null は「その面は空＝配置しない」）。
 * @param opts refScaleDenom(既定100)、base(全 origin に加算する基準位置)、gutterGrid/padGrid。
 * @returns 配置可能な面が 0 なら null。
 */
export function computeQuadLayout(
  faces: { face: FaceKey; bounds: Bounds | null }[],
  opts?: { refScaleDenom?: number; base?: Point; gutterGrid?: number; padGrid?: number },
): QuadLayout | null {
  const refDenom = opts?.refScaleDenom ?? 100;
  const base = opts?.base ?? { x: 0, y: 0 };
  const gutter = opts?.gutterGrid ?? 60; // 600mm
  const pad = opts?.padGrid ?? 40;       // 400mm

  const present = faces.filter((f): f is { face: FaceKey; bounds: Bounds } => f.bounds != null);
  if (present.length === 0) return null;

  const frameW = (A4_LANDSCAPE_MM.w * refDenom) / 10;
  const frameH = (A4_LANDSCAPE_MM.h * refDenom) / 10;
  const cellW = (frameW - gutter) / 2;
  const cellH = (frameH - gutter) / 2;
  const innerW = cellW - 2 * pad;
  const innerH = cellH - 2 * pad;

  let wMax = 0, hMax = 0;
  for (const f of present) {
    wMax = Math.max(wMax, f.bounds.maxX - f.bounds.minX);
    hMax = Math.max(hMax, f.bounds.maxY - f.bounds.minY);
  }
  const scaleRaw = Math.min(innerW / Math.max(wMax, 1e-6), innerH / Math.max(hMax, 1e-6));
  const { scale, denom } = roundToStandardScale(scaleRaw, refDenom);

  const placements: QuadPlacement[] = present.map((f) => {
    const { col, row } = CELL_POS[f.face];
    const cellX = base.x + col * (cellW + gutter);
    const cellY = base.y + row * (cellH + gutter);
    // 面 bbox の左上(minX,minY) をセル左上(+pad)へ写像。screen y は originGrid.y + ly*scale。
    return {
      face: f.face,
      originGrid: {
        x: Math.round(cellX + pad - f.bounds.minX * scale),
        y: Math.round(cellY + pad - f.bounds.minY * scale),
      },
    };
  });

  return { scale, scaleLabel: `1/${denom}`, placements };
}
