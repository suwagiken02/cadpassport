import { BuildingShape, Point } from '@/types';

/**
 * 建物の outline ポリゴン (= 高さマーカーの配置基準線) を取得する。
 * R-1b: 常に building.points (= 壁外周線) を返す。
 *   従来は「屋根あり + 出幅 > 0 → 屋根破線 (computeOffsetPolygon)」に載せていたが、
 *   実建築図面には壁高さ (軒高) しか載らないため、マーカーの意味を「軒先高さ」→「壁位置の
 *   軒高」に転換。置き場所も屋根破線 → 壁線上に変わる。軒先の下がりは勾配×出幅でシステムが
 *   計算する (R-1c)。配置・ドラッグ・描画・補間・面積・範囲選択がこの一関数で一斉に壁基準へ。
 */
export function getOutlinePolygon(building: BuildingShape): Point[] {
  return building.points;
}

/** 距離が「同じ」とみなす許容差（グリッド）。壁を共有する 2 棟の辺は完全に重なる。 */
const EDGE_TIE_EPS = 1e-6;

/**
 * 吸着ガイド点 (= R-1m-fix)。角(t=0) と 辺中央(t=0.5)。
 * **表示（○・◆）とスナップ判定の唯一の出所**。
 */
export type OutlineGuide = {
  buildingId: string;
  edgeIndex: number;
  kind: 'corner' | 'mid';
  /** 辺上の位置。角は 0、中央は 0.5。 */
  t: number;
  /** グリッド座標。 */
  point: Point;
};

/**
 * 対象建物[]の全辺から、角と辺中央のガイド点を作る (= R-1m-fix)。
 *
 * 経緯: 表示（◆の描画）は「建物の辺ごとに 1 個」、スナップは「クリックで決まった 1 辺の中央だけ」と
 * **別々のロジック**だった。他棟と壁を共有する辺では、クリックが隣の建物の（共線で長い）辺に
 * 解決されることがあり、狙っている ◆ は吸着しない＝実機では「その辺だけ中央ガイドが効かない/
 * 出ていない」に見えた。表示も判定もこの 1 関数から作ることで、見えているガイド＝吸着できる点、
 * を構造として保証する（重なりの有無に依らず、対象建物の全辺に必ず出る）。
 *
 * 長さ 0 の辺（重複頂点）は中央を作らない（角と重なって意味がないため）。
 */
export function outlineGuides(buildings: BuildingShape[]): OutlineGuide[] {
  const out: OutlineGuide[] = [];
  for (const b of buildings) {
    const outline = getOutlinePolygon(b);
    if (outline.length < 2) continue;
    for (let i = 0; i < outline.length; i++) {
      const p1 = outline[i];
      const p2 = outline[(i + 1) % outline.length];
      out.push({ buildingId: b.id, edgeIndex: i, kind: 'corner', t: 0, point: { x: p1.x, y: p1.y } });
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.001) continue;
      out.push({
        buildingId: b.id, edgeIndex: i, kind: 'mid', t: 0.5,
        point: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      });
    }
  }
  return out;
}

/**
 * ポインタ（グリッド座標）に最も近いガイド点 (= R-1m-fix)。tolGrid 以内に無ければ null。
 * 同距離なら中央 ◆ を優先する（角は辺の解決でも拾えるが、中央は ◆ を狙う操作そのもの）。
 */
export function nearestOutlineGuide(
  pt: Point, guides: OutlineGuide[], tolGrid: number,
): OutlineGuide | null {
  let best: OutlineGuide | null = null;
  let bestD = Infinity;
  for (const g of guides) {
    const d = Math.hypot(g.point.x - pt.x, g.point.y - pt.y);
    if (d > tolGrid) continue;
    if (d < bestD - EDGE_TIE_EPS
      || (d < bestD + EDGE_TIE_EPS && g.kind === 'mid' && best?.kind !== 'mid')) {
      bestD = Math.min(bestD, d);
      best = g;
    }
  }
  return best;
}

/**
 * クリック点に最も近い建物 outline の辺を見つける。
 * 閾値内に辺があれば { buildingId, edgeIndex, t } を返す、 なければ null。
 *
 * R-1m: 隣り合う 2 棟が壁を共有していると候補の距離が完全に一致し、どちらの辺になるかが
 *   **配列順**（先に作った建物）で決まっていた。狙った建物の辺に置けない（下屋の妻に
 *   TOP マーカーが付かない）ので、同距離のときは**短い辺**を採る。長い通し壁より、
 *   その場所だけの短い壁（下屋の妻など）の方がユーザーの狙いに一致する。
 *   ※距離が同じときだけの決着なので、通常のクリックの挙動は一切変わらない。
 */
export function findClosestOutlineEdge(
  clickGrid: Point,
  buildings: BuildingShape[],
  thresholdGrid: number,
): { buildingId: string; edgeIndex: number; t: number } | null {
  let bestDist = Infinity;
  let bestLen = Infinity;
  let bestResult: { buildingId: string; edgeIndex: number; t: number } | null = null;
  for (const b of buildings) {
    const outline = getOutlinePolygon(b);
    for (let i = 0; i < outline.length; i++) {
      const p1 = outline[i];
      const p2 = outline[(i + 1) % outline.length];
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const len2 = ex * ex + ey * ey;
      if (len2 < 0.001) continue;
      const t = Math.max(0, Math.min(1, ((clickGrid.x - p1.x) * ex + (clickGrid.y - p1.y) * ey) / len2));
      const projX = p1.x + t * ex;
      const projY = p1.y + t * ey;
      const dist = Math.hypot(clickGrid.x - projX, clickGrid.y - projY);
      if (dist >= thresholdGrid) continue;
      const len = Math.sqrt(len2);
      const better = dist < bestDist - EDGE_TIE_EPS
        || (dist < bestDist + EDGE_TIE_EPS && len < bestLen);   // 同距離なら短い辺
      if (better) {
        bestDist = Math.min(bestDist, dist);
        bestLen = len;
        bestResult = { buildingId: b.id, edgeIndex: i, t };
      }
    }
  }
  return bestResult;
}

/**
 * 任意の点を建物 outline に射影し、 最寄り辺の edgeIndex + t を返す。
 * findClosestOutlineEdge と異なり、 閾値なしで「必ず最寄り辺」 を返す
 * (= ドラッグ中の連続射影用、 Phase E)。
 */
export function projectPointToOutline(
  point: Point,
  building: BuildingShape,
): { edgeIndex: number; t: number } {
  const outline = getOutlinePolygon(building);
  let bestDist = Infinity;
  let best = { edgeIndex: 0, t: 0 };
  for (let i = 0; i < outline.length; i++) {
    const p1 = outline[i];
    const p2 = outline[(i + 1) % outline.length];
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const len2 = ex * ex + ey * ey;
    if (len2 < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((point.x - p1.x) * ex + (point.y - p1.y) * ey) / len2));
    const projX = p1.x + t * ex;
    const projY = p1.y + t * ey;
    const dist = Math.hypot(point.x - projX, point.y - projY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { edgeIndex: i, t };
    }
  }
  return best;
}

/**
 * 辺上の位置 (= edgeIndex + t) を、 t=0/1 (= 角) のいずれかが
 * snapToleranceGrid 以内なら吸着させる。 ドラッグ中のスナップ用。
 *
 * Phase E 当初は中点 (t=0.5) もスナップ対象だったが、 実機テストで
 * 中点に粘着して反対側に動かせない「stuck」 症状発生のため中点を削除
 * (= 足場職人用途で中点スナップの実用性低い、 Issue 1 修正)。
 */
export function snapToCorners(
  edgeIndex: number,
  t: number,
  outline: Point[],
  snapToleranceGrid: number,
): { edgeIndex: number; t: number } {
  if (edgeIndex < 0 || edgeIndex >= outline.length) return { edgeIndex, t };
  const p1 = outline[edgeIndex];
  const p2 = outline[(edgeIndex + 1) % outline.length];
  const edgeLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (edgeLen < 0.001) return { edgeIndex, t };
  const candidates = [0, 1];
  for (const ct of candidates) {
    const distGrid = Math.abs(t - ct) * edgeLen;
    if (distGrid < snapToleranceGrid) {
      return { edgeIndex, t: ct };
    }
  }
  return { edgeIndex, t };
}

/**
 * 辺中点 (= t=0.5) からポインタまでの screen px 距離が snapPx 以内なら
 * t を 0.5 に補正、 それ以外は元の t を返す。
 *
 * ドラッグ中は使わず、 配置時 / dragEnd 時のみ呼び出すこと
 * (= ドラッグ中の中点粘着 stuck を回避するため、 Issue 1 の経緯)。
 * 切妻屋根の中央高所マーカー配置等の用途を支援。
 */
export function snapToMidpointIfNear(
  edgeIndex: number,
  t: number,
  pointerScreenX: number,
  pointerScreenY: number,
  building: BuildingShape,
  gridPx: number,
  panX: number,
  panY: number,
  snapPx: number,
): number {
  const outline = getOutlinePolygon(building);
  if (edgeIndex < 0 || edgeIndex >= outline.length) return t;
  const p1 = outline[edgeIndex];
  const p2 = outline[(edgeIndex + 1) % outline.length];
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const screenMidX = midX * gridPx + panX;
  const screenMidY = midY * gridPx + panY;
  const dist = Math.hypot(pointerScreenX - screenMidX, pointerScreenY - screenMidY);
  return dist < snapPx ? 0.5 : t;
}
