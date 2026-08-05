import { BuildingShape, HeightMarker, Point } from '@/types';
import { getOutlinePolygon } from '@/lib/konva/heightMarkerUtils';

/** 建物 outline 各辺の長さ (= グリッド単位) を計算 */
function getEdgeLengths(outline: Point[]): number[] {
  const n = outline.length;
  const lens: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p1 = outline[i];
    const p2 = outline[(i + 1) % n];
    lens[i] = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return lens;
}

/** 辺位置 (= edgeIndex, t) を建物外周の弧長 (= 0..totalPerimeter) に変換 */
function arcLengthOf(edgeLengths: number[], edgeIndex: number, t: number): number {
  let arc = 0;
  for (let i = 0; i < edgeIndex; i++) arc += edgeLengths[i];
  return arc + Math.max(0, Math.min(1, t)) * edgeLengths[edgeIndex];
}

/**
 * 建物外周上の指定位置 (= edgeIndex + t) における高さ (mm) を返す。
 *
 * 仕様 (= Task #8 spec):
 *   - 該当建物のマーカーが 0 個 → null (= 計算不能)
 *   - 1 個 → そのマーカーの heightMm (= 全周一定値)
 *   - 2+ 個 → 弧長距離ベースで隣接 2 マーカー間を線形補間 (= 周回考慮)
 *   - 1mm 精度を保つため Math.round で丸め
 *   - UI 表示しない、 内部 API のみ (= 将来の自動平米計算 / 立面図用)
 *
 * 戻り値:
 *   - number: 高さ (mm 単位、 整数)
 *   - null: 計算不能 (= マーカー 0 個 / edgeIndex 範囲外 / outline 不正 / 全周ゼロ)
 */
export function getHeightAtPosition(
  building: BuildingShape,
  markers: HeightMarker[],
  edgeIndex: number,
  t: number,
): number | null {
  // 該当建物のマーカーのみ抽出。
  // R-1n: roofId 付き＝**壁に乗らない屋根の辺**（下屋と大屋根の境目など）に置いたマーカーで、
  //   edgeIndex/t は屋根 polygon 基準。壁の高さプロファイルには参加しない
  //   （その屋根の棟マーカーとして roofMarkerMaxMm が拾う）。
  const buildingMarkers = markers.filter((m) => m.buildingId === building.id && !m.roofId);
  if (buildingMarkers.length === 0) return null;

  // outline 取得 + 範囲チェック
  const outline = getOutlinePolygon(building);
  if (outline.length < 3) return null;
  if (edgeIndex < 0 || edgeIndex >= outline.length) return null;

  // 1 マーカー → 全周一定値
  if (buildingMarkers.length === 1) {
    return Math.round(buildingMarkers[0].heightMm);
  }

  // 各辺長 + 全周
  const edgeLengths = getEdgeLengths(outline);
  const totalPerimeter = edgeLengths.reduce((s, l) => s + l, 0);
  if (totalPerimeter < 0.001) return null;

  // クエリ点の弧長
  const queryArc = arcLengthOf(edgeLengths, edgeIndex, t);

  // 各マーカーを弧長でソート (= edgeIndex 範囲外マーカーは除外)
  const markerArcs = buildingMarkers
    .filter((m) => m.edgeIndex >= 0 && m.edgeIndex < outline.length)
    .map((m) => ({
      arc: arcLengthOf(edgeLengths, m.edgeIndex, m.t),
      heightMm: m.heightMm,
    }))
    .sort((a, b) => a.arc - b.arc);

  if (markerArcs.length === 0) return null;
  if (markerArcs.length === 1) return Math.round(markerArcs[0].heightMm);

  // クエリ弧長を含む 2 マーカー間を見つけて補間
  for (let i = 0; i < markerArcs.length; i++) {
    const m1 = markerArcs[i];
    const m2 = markerArcs[(i + 1) % markerArcs.length];
    let arc1 = m1.arc;
    let arc2 = m2.arc;
    let q = queryArc;

    // 周回考慮: 末尾と先頭の間 (= 周回区間) は arc2 に totalPerimeter を加える
    if (i === markerArcs.length - 1) {
      arc2 = m2.arc + totalPerimeter;
      // queryArc が m1 の弧長未満なら周回越え扱い (= q + totalPerimeter)
      if (q < arc1) q += totalPerimeter;
    }

    if (arc1 <= q && q <= arc2) {
      const span = arc2 - arc1;
      if (span < 0.001) return Math.round(m1.heightMm);
      const factor = (q - arc1) / span;
      const h = m1.heightMm + factor * (m2.heightMm - m1.heightMm);
      return Math.round(h);
    }
  }

  // フォールバック (= 通常到達しない、 数値誤差時のみ)
  return Math.round(markerArcs[0].heightMm);
}
