// ============================================================
// 敷地の頂点を動かしている間の距離ガイド (= S-5)・pure
//
// S-4 で頂点を引っ張って形を直せるようになったが、建物との距離が目分量になる。
// 「建物から 1m 空ける」といった調整のために、ドラッグ中だけ
// 「いちばん近い建物の角（出隅）までの X 距離・Y 距離」を数字で出す。
//
// ■ どの角を選ぶか
// ドラッグ中の頂点からの直線距離がいちばん近い建物の角。動かして最寄りが変われば
// 表示対象も切り替わる（毎フレームここを呼ぶ）。
//
// ■ 重さ
// 建物の角は「建物が変わったときだけ」作り直せば済むので、角の一覧を作る関数と
// 最寄りを選ぶ関数を分けてある。呼び出し側は一覧を覚えておき、ドラッグ中は
// 選ぶ方だけを回す。現場の図面は建物 1〜数棟・角は多くて数十なので、
// 毎フレームの総当たりでも十分軽い。
// ============================================================
import { GRID_UNIT_MM } from './gridUtils';
import type { Point } from '@/types';

export type SiteVertexGuide = {
  /** いちばん近い建物の角（グリッド座標）。 */
  corner: Point;
  /** X 方向の距離(mm・絶対値)。 */
  dxMm: number;
  /** Y 方向の距離(mm・絶対値)。 */
  dyMm: number;
};

/** 建物の角の一覧（グリッド座標）。建物が変わったときだけ作り直せばよい。 */
export function buildingCornersGrid(buildings: { points: Point[] }[]): Point[] {
  const out: Point[] = [];
  for (const b of buildings) {
    for (const p of b.points) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * その位置からいちばん近い建物の角と、X/Y の距離(mm)。
 * 角が 1 つも無ければ null（建物の無い図面では何も出さない）。
 * 同じ距離の角が複数あるときは、先に見つかった方を採る（表示がちらつかない）。
 */
export function nearestBuildingCornerGuide(p: Point, corners: Point[]): SiteVertexGuide | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const c of corners) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  return {
    corner: { x: best.x, y: best.y },
    dxMm: Math.round(Math.abs(p.x - best.x) * GRID_UNIT_MM),
    dyMm: Math.round(Math.abs(p.y - best.y) * GRID_UNIT_MM),
  };
}
