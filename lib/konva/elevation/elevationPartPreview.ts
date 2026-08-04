// ============================================================
// 立面パレットの姿図プレビュー (E-8-v3c-fix4・pure・node 安全)
//
// 平面の部材パレットには「選んでいる部材の姿図」が出る。立面にも同じものを出すが、
// **プレビュー専用の絵は描かない**。実際に置かれる部材（ElevationPart）を 1 個作って
// partsToPrimitives に通した結果をそのまま見せる ＝ パレットの絵・シャドー・確定後の絵が
// 必ず一致する（別々に描いて食い違う、が E-8 で何度も起きた事故なので構造で潰す）。
//
// 座標系: partsToPrimitives のローカル座標（面軸グリッド 1=10mm、y は下向きが正）。
// SVG 側は viewBox で収める。線幅・丸の半径は screen px なので scale で割って使う。
// ============================================================
import type { ElevationPrimitive } from '@/types';
import {
  newElevationPart, partsToPrimitives,
  type ElevationPartGeometry, type ElevationPartKind,
} from './elevationParts';

export type PartPreviewOptions = {
  /** 手摺・踏板・筋交の長さ(mm)。 */
  sizeMm?: number;
  /** 支柱のコマ数。 */
  komaCount?: number;
  /** 筋交の向き。 */
  flip?: boolean;
  /** 傾き(度)。0 は水平（支柱は垂直）。 */
  angleDeg?: number;
};

export type PartPreview = {
  prims: ElevationPrimitive[];
  /** SVG の viewBox（正方形）。 */
  view: { x: number; y: number; w: number; h: number };
  /** ローカル 1 単位が SVG 何 px か。px 指定の線幅・半径はこれで割る。 */
  scale: number;
};

/** プレビュー用の最小の足場幾何。実データは使わない（パレットは図面に依存しない）。 */
function previewGeom(komaCount: number): ElevationPartGeometry {
  return {
    minXg: 0,
    scaffolds: [{
      postXs: [0, 180],
      jackTopMm: 0,
      topRailMm: Math.max(1, komaCount) * 450,
      levelsMm: [],
      komaGridMm: [],
    }],
  };
}

/** その種類のプレビューで使う基準点(mm)。置いたときと同じ意味の点を渡す。 */
function previewAnchorMm(kind: ElevationPartKind): { xMm: number; yMm: number } {
  if (kind === 'post' || kind === 'postExt') return { xMm: 0, yMm: 0 };   // 下端＝0
  if (kind === 'jack') return { xMm: 0, yMm: 300 };                       // 上端＝300（足元は 0）
  if (kind === 'brace') return { xMm: 0, yMm: 1800 };                     // 上端＝1800（下端は 0）
  return { xMm: 0, yMm: 0 };
}

/**
 * パレットに出す姿図 (= E-8-v3c-fix4)。
 * size は SVG の一辺(px)。中身は正方形の viewBox に収める（部材ごとに大きさが変わらない）。
 */
export function partPreview(
  kind: ElevationPartKind, opts: PartPreviewOptions = {}, size = 76,
): PartPreview {
  const komaCount = opts.komaCount ?? 2;
  const geom = previewGeom(komaCount);
  const part = newElevationPart(kind, 'preview', 0, previewAnchorMm(kind), {
    sizeMm: opts.sizeMm, komaCount, flip: opts.flip, angleDeg: opts.angleDeg,
  });
  const prims = partsToPrimitives({ parts: [part], geom });

  // 収まる正方形を作る（縦横比を保つので、細長い手摺も支柱も同じ枠に入る）。
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const hit = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of prims) {
    if (p.kind === 'line') { hit(p.x1, p.y1); hit(p.x2, p.y2); }
    else if (p.kind === 'polygon') {
      for (let i = 0; i + 1 < p.points.length; i += 2) hit(p.points[i], p.points[i + 1]);
    } else if (p.kind === 'rect') { hit(p.x, p.y); hit(p.x + p.w, p.y + p.h); }
    else hit(p.x, p.y);
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // 一辺は長い方に合わせ、余白を少し。潰れた形（点・水平線）でも 0 にしない。
  const side = Math.max(maxX - minX, maxY - minY, 1) * 1.18;
  const view = { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
  return { prims, view, scale: size / side };
}
