// ============================================================
// 方向入力でタップした位置をどこへ寄せるか (= S-8)・pure
//
// 躯体・屋根・障害物はガイドの交点に縛る。建物は「建物と足場は必ず平行」の世界で、
// 壁の位置が半端だと足場の割付がすべて崩れるため、この縛りは意味がある。
//
// 一方**敷地は自由座標の世界**（S-2 で斜め・任意角度を許している）。実際の敷地は
// 交点に乗るとは限らないので、交点への丸めをやめて**タップした場所そのまま**にする。
// ただし建物・障害物の角への強スナップだけは残す（角の近くを狙ったときだけ効く）。
//
// 寄せ方の違いはこの 1 本にまとめてある。呼び出し側が対象種別を渡すだけなので、
// 「片方だけ直し忘れる」が起こらない。
// ============================================================
import {
  getAllExistingEdges, getAllExistingVertices, snapToEdge, snapToGridIntersection, snapToVertex,
} from './snapUtils';
import type { BuildingShape, DirectionInputTarget, Obstacle, Point } from '@/types';

/** 建物・障害物の角へ吸着する画面距離(px)。全対象で共通（従来の値）。 */
export const VERTEX_SNAP_PX = 30;
/** 辺へ弱く吸着する画面距離(px)（従来の値）。 */
export const EDGE_SNAP_PX = 10;

export type DirectionSnapContext = {
  target: DirectionInputTarget;
  buildings: BuildingShape[];
  obstacles: Obstacle[];
  zoom: number;
};

/**
 * タップした位置を、その対象の作法で寄せた結果。
 *
 * 共通: 建物・障害物の角が近ければ、そこへ強く寄せる。
 * 敷地: それ以外は**タップした座標そのまま**（丸めない）。
 * それ以外(躯体・屋根・障害物): 従来どおり グリッド交点 → 辺 → 1 グリッドへ丸め。
 */
export function snapDirectionPoint(rawPos: Point, ctx: DirectionSnapContext): Point {
  const { target, buildings, obstacles, zoom } = ctx;

  // 強スナップ: 既存建物・障害物の頂点（敷地でも残す＝角を狙ったときだけ効く）
  const existVerts = getAllExistingVertices(buildings, obstacles);
  const vertex = snapToVertex(rawPos.x, rawPos.y, existVerts, zoom, VERTEX_SNAP_PX);
  if (vertex) return vertex;

  // S-8: 敷地はここで終わり。交点にも辺にも寄せず、丸めもしない。
  if (target === 'site') return { x: rawPos.x, y: rawPos.y };

  // 次: グリッド交点マグネット
  //   snapToGridIntersection は必ず点を返す（寄る先が無ければ 1 グリッドへ丸める）ので、
  //   実際にはここで決まる。以降の 2 段は移設前からの形をそのまま残してある。
  let snapped: Point | null = snapToGridIntersection(rawPos.x, rawPos.y, zoom);
  // 次: 辺への弱スナップ
  if (!snapped) {
    const existEdges = getAllExistingEdges(buildings, obstacles);
    snapped = snapToEdge(rawPos.x, rawPos.y, existEdges, zoom, EDGE_SNAP_PX);
  }
  // フォールバック
  return snapped ?? { x: Math.round(rawPos.x), y: Math.round(rawPos.y) };
}

/**
 * その対象で「ガイドの交点（十字ガイド・交点マーカー）」を出すか。
 * 敷地は交点に縛らないので出さない（見えていると狙ってしまうため）。
 */
export const showsDirectionGrid = (target: DirectionInputTarget): boolean => target !== 'site';

/**
 * 2 点の位置関係から、キャラの向きを決める（交点タップと同じ決め方）。
 * 横のずれの方が大きければ左右、そうでなければ上下。
 */
export function directionTowards(from: Point, to: Point): 'up' | 'down' | 'left' | 'right' {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
