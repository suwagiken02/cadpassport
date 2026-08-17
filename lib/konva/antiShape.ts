// ============================================================
// アンチ（踏板）の外形と色 — 唯一の定義 (= P-3)
//
// P-3 まで、アンチの姿を知っているのは ScaffoldLayer だけだった。そのため
// 配置シャドー（ゴースト）は手摺の入れ物に相乗りして「3px の青い細線」で
// 出ており、実際に置かれる琥珀色の板とはまるで別物だった＝実機では
// 「アンチのシャドーが出ない」に見えていた。
//
// 実物とゴーストが**同じ関数**を通れば、その食い違いは構造的に起こらない。
// ここは pure（Konva も React も知らない）なので、テストで固定できる。
//
// 数値・色はすべて ScaffoldLayer にあったものをそのまま移しただけで、
// 見た目は 1 ミリも変えていない。
// ============================================================
import { mmToGrid } from './gridUtils';
import type { Anti } from '@/types';

/** 描画に必要な最小限。ゴースト（id を持たない仮のアンチ）も渡せるようにする。 */
export type AntiShape = Pick<Anti, 'x' | 'y' | 'width' | 'lengthMm' | 'direction'>;

export const ANTI_COLORS = {
  /** 幅 400（メートル規格の広い方）の面 */
  wideFill: '#F59E0B',
  /** それ以外（250 / インチ規格の 500・240）の面 */
  narrowFill: '#FCD34D',
  wideStroke: '#B45309',
  narrowStroke: '#A16207',
  selected: '#FF6B35',
  /** 板の継ぎ目（内側の破線） */
  seam: '#b8860b',
} as const;

export const ANTI_OPACITY = 0.85;
export const ANTI_CORNER_RADIUS = 2;

/**
 * 濃い色にするのは幅 400 のときだけ。
 * 従来の判定（`anti.width === 400`）をそのまま保つ。インチ規格の 500 は
 * 「広い方」だが色は薄い側 — 見た目を変えないため、ここでも変えない。
 */
export const isWideAnti = (anti: Pick<Anti, 'width'>): boolean => anti.width === 400;

export const antiFill = (anti: Pick<Anti, 'width'>): string =>
  isWideAnti(anti) ? ANTI_COLORS.wideFill : ANTI_COLORS.narrowFill;

export const antiStroke = (anti: Pick<Anti, 'width'>): string =>
  isWideAnti(anti) ? ANTI_COLORS.wideStroke : ANTI_COLORS.narrowStroke;

export const antiStrokeWidth = (zoom: number, selected: boolean): number =>
  (selected ? 16 : 12) * zoom;

/** 外形（グリッド単位・左上基準）。横置きなら長さが幅方向に伸びる。 */
export function antiRectGrid(anti: AntiShape): { x: number; y: number; w: number; h: number } {
  const w = anti.direction === 'horizontal' ? mmToGrid(anti.lengthMm) : mmToGrid(anti.width);
  const h = anti.direction === 'horizontal' ? mmToGrid(anti.width) : mmToGrid(anti.lengthMm);
  return { x: anti.x, y: anti.y, w, h };
}

/** 板の継ぎ目に入れる内側の破線（グリッド単位）。 */
export function antiSeamGrid(anti: AntiShape): { x1: number; y1: number; x2: number; y2: number } {
  const { x, y, w, h } = antiRectGrid(anti);
  const horizontal = anti.direction === 'horizontal';
  return {
    x1: x + 1,
    y1: y + (horizontal ? h / 2 : 1),
    x2: x + w - 1,
    y2: y + (horizontal ? h / 2 : h - 1),
  };
}
