// ============================================================
// アンチの吸着 (= P-4)・pure
//
// ■ 何を直すための関数か
// アンチは手摺と同じ snapHandrailPlacement を通しており、返る「線の始点」を
// そのまま anti.x/y（＝**矩形の左上**）に入れていた。そのため通り芯に合わせると
// **アンチは必ず線の下側にぶら下がる**形でしか置けなかった。
// 線の上側に置きたいときは矩形の下辺を線に乗せたいが、それができなかった。
//
// ■ どう決めるか
// 吸着**先**は今までとまったく同じ（snapToHandrail が返す点）。カーソルの意味も
// 従来どおり**矩形の左上**で、ドラッグの手触りは 1 ミリも変えない。
// 変えるのは「4 隅のどれを吸着先に合わせるか」だけ。
//   下から近づける（＝上辺が線の近くに来る）→ 上辺が乗る＝線の下側に置かれる
//   上から近づける（＝下辺が線の近くに来る）→ 下辺が乗る＝線の上側に置かれる
// **左上が選ばれたときは従来とまったく同じ位置**になる（回帰にならない）。
//
// ■ 境界はどこにあるか
// 隅は矩形の寸法ぶん離れているので、別の隅が選ばれるには吸着先が矩形の中ほどを
// またぐ必要がある。ユーザーは狙った線へ寄せるので、境界に留まらない。
// 「スナップ先のどちら側に置かれるか」という考え方は階段（snapStairToCell）と同じで、
// 式は snapSide.ts の rectLeadingEdge に切り出して階段が使っている。
// アンチは 4 隅のうち実際に近い隅を採る形（線が 1 本とは限らないため）で、
// **どちらを直すときも、もう一方を必ず見ること**。
// ============================================================
import { mmToGrid } from '../gridUtils';
import { snapToHandrail } from '../snapUtils';
import type { Anti, Handrail, HandrailLengthMm, Point } from '@/types';

/** アンチの外形（グリッド）。direction で縦横が入れ替わる。 */
export function antiSizeGrid(
  lengthMm: number, widthMm: number, direction: 'horizontal' | 'vertical',
): { w: number; h: number } {
  return direction === 'horizontal'
    ? { w: mmToGrid(lengthMm), h: mmToGrid(widthMm) }
    : { w: mmToGrid(widthMm), h: mmToGrid(lengthMm) };
}

/** どの隅を吸着先に合わせたか。表示とテストで基点を名指しするのに使う。 */
export type AntiAnchor = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export type AntiSnapResult = {
  /** 置かれるアンチの左上（anti.x / anti.y にそのまま入る値）。 */
  topLeft: Point;
  /** 吸着した点（印を出す位置）。 */
  snapIndicator: Point;
  /** その点に合わせた隅。 */
  anchor: AntiAnchor;
};

/**
 * アンチの吸着先を決める。吸着しなければ null（呼び出し側はカーソルのまま置く）。
 *
 * 手順:
 *   1. 矩形の 4 隅それぞれに **従来とまったく同じ** snapToHandrail を当てる
 *   2. いちばん近く吸着した隅を採り、その隅が吸着先に乗るよう矩形ごと動かす
 */
export function snapAntiPlacement(
  cursor: Point,
  lengthMm: HandrailLengthMm,
  widthMm: number,
  direction: 'horizontal' | 'vertical',
  handrails: Handrail[],
  snapRadiusGrid: number,
  antis?: Anti[],
): AntiSnapResult | null {
  const { w, h } = antiSizeGrid(lengthMm, widthMm, direction);

  // カーソルは従来どおり**矩形の左上**（ドラッグの手触りは 1 ミリも変えない）。
  //   変えるのは「4 隅のどれを吸着先に合わせるか」だけ。
  const corners: { at: Point; anchor: AntiAnchor }[] = [
    { at: { x: cursor.x, y: cursor.y }, anchor: 'topLeft' },
    { at: { x: cursor.x + w, y: cursor.y }, anchor: 'topRight' },
    { at: { x: cursor.x, y: cursor.y + h }, anchor: 'bottomLeft' },
    { at: { x: cursor.x + w, y: cursor.y + h }, anchor: 'bottomRight' },
  ];

  let best: { at: Point; anchor: AntiAnchor; snapped: Point; d: number } | null = null;
  for (const c of corners) {
    const snapped = snapToHandrail(c.at, handrails, snapRadiusGrid, antis);
    if (!snapped) continue;
    const d = Math.hypot(snapped.x - c.at.x, snapped.y - c.at.y);
    if (!best || d < best.d) best = { ...c, snapped, d };
  }
  if (!best) return null;

  // その隅が吸着先に乗るよう、矩形ごと平行移動する。
  //   左上が選ばれたときは **従来とまったく同じ位置**（左上＝吸着先）になる。
  const topLeft: Point = {
    x: cursor.x + (best.snapped.x - best.at.x),
    y: cursor.y + (best.snapped.y - best.at.y),
  };
  return { topLeft, snapIndicator: best.snapped, anchor: best.anchor };
}

/**
 * その配置で、指定の隅が実際にどこに来るか。表示とテストで使う。
 */
export function antiCornerAt(
  topLeft: Point, lengthMm: number, widthMm: number,
  direction: 'horizontal' | 'vertical', anchor: AntiAnchor,
): Point {
  const { w, h } = antiSizeGrid(lengthMm, widthMm, direction);
  const dx = anchor === 'topRight' || anchor === 'bottomRight' ? w : 0;
  const dy = anchor === 'bottomLeft' || anchor === 'bottomRight' ? h : 0;
  return { x: topLeft.x + dx, y: topLeft.y + dy };
}
