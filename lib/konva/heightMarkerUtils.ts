import { BuildingShape, Point, Roof } from '@/types';
import { getRoofPolygon } from './roofRegion';

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
  /**
   * 屋根領域基準のガイド (= R-1n)。壁に乗らない屋根の辺（下屋と大屋根の境目など）のとき、
   * その屋根 id。壁に乗る辺は壁基準（edgeIndex/t は building.points）に直してあるので undefined。
   */
  roofId?: string;
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

/** 屋根の辺が壁に乗っているとみなす許容差（グリッド）。roofRegion の WALL_TOL と同じ基準。 */
const ROOF_WALL_TOL = 1.5;

/** 点 pt を線分 p→q へ射影した媒介変数 t（0..1 クランプ）と距離。 */
function projectOnSegment(pt: Point, p: Point, q: Point): { t: number; dist: number } {
  const dx = q.x - p.x, dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { t: 0, dist: Math.hypot(pt.x - p.x, pt.y - p.y) };
  const t = Math.max(0, Math.min(1, ((pt.x - p.x) * dx + (pt.y - p.y) * dy) / len2));
  return { t, dist: Math.hypot(pt.x - (p.x + t * dx), pt.y - (p.y + t * dy)) };
}

/**
 * 屋根領域のガイド点（角・辺中央）(= R-1n)。
 *
 * 原則（鮎澤氏）: 「壁＝屋根ではない」。高さマーカー・妻 TOP の入力対象は**屋根**なので、
 * ガイドはユーザーが作った屋根領域(Roof.polygon)の四隅と各辺の中央に出す。
 *   ・建物全面に屋根を作った → 全周に出る（従来と同じ見た目＝互換）
 *   ・一部にだけ屋根を作った → その領域の四隅・辺中央だけ
 *   ・屋根が無い建物         → 何も出ない（先に屋根を作るのが正しい順序）
 *
 * 保存形式との整合: ガイド点が**壁の上**にあるなら、その壁の辺 index と t に直して返す
 * （＝従来の HeightMarker と完全に同じ形で保存でき、立面の高さプロファイルにそのまま効く）。
 * 壁に乗らない辺（下屋と大屋根の境目・2F との境界）だけ roofId 付き＝屋根 polygon 基準になる。
 */
export function roofOutlineGuides(building: BuildingShape, roofs: Roof[]): OutlineGuide[] {
  const bpts = building.points;
  const out: OutlineGuide[] = [];
  /** 点が壁の上なら、その壁の {edgeIndex, t}。乗っていなければ null。 */
  const onWall = (pt: Point): { edgeIndex: number; t: number } | null => {
    let best: { edgeIndex: number; t: number } | null = null;
    let bestD = ROOF_WALL_TOL;
    for (let j = 0; j < bpts.length; j++) {
      const { t, dist } = projectOnSegment(pt, bpts[j], bpts[(j + 1) % bpts.length]);
      if (dist <= bestD) { bestD = dist; best = { edgeIndex: j, t }; }
    }
    return best;
  };

  for (const roof of roofs) {
    if (roof.buildingId !== building.id) continue;
    const poly = getRoofPolygon(building, roof);
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const push = (kind: 'corner' | 'mid', t: number, point: Point) => {
        const w = onWall(point);
        out.push(w
          ? { buildingId: building.id, edgeIndex: w.edgeIndex, kind, t: w.t, point }
          : { buildingId: building.id, edgeIndex: i, kind, t, point, roofId: roof.id });
      };
      push('corner', 0, { x: p1.x, y: p1.y });
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.001) continue;
      push('mid', 0.5, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    }
  }
  return out;
}

/**
 * 対象建物[]のガイド点 (= R-1n)。屋根がある建物は屋根領域基準、
 * 屋根が 1 つも無い建物はガイドを出さない（先に屋根を作る運用）。
 */
export function guidesForBuildings(buildings: BuildingShape[], roofs: Roof[]): OutlineGuide[] {
  return buildings.flatMap((b) => roofOutlineGuides(b, roofs));
}

/** その建物に屋根があるか（ガイドが出るか＝案内文の出し分け）。 */
export function hasRoofFor(building: BuildingShape, roofs: Roof[]): boolean {
  return roofs.some((r) => r.buildingId === building.id);
}

/**
 * マーカーの位置の基準になる polygon (= R-1n)。
 * roofId 付き＝その屋根の polygon、無印＝従来どおり壁外周。
 */
export function markerPolygon(
  building: BuildingShape, roofs: Roof[], marker: { roofId?: string },
): Point[] {
  if (!marker.roofId) return getOutlinePolygon(building);
  const roof = roofs.find((r) => r.id === marker.roofId && r.buildingId === building.id);
  return roof ? getRoofPolygon(building, roof) : getOutlinePolygon(building);
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
  return projectPointToPolygon(point, getOutlinePolygon(building));
}

/**
 * 任意の polygon への射影 (= R-1n)。屋根領域基準のマーカーは屋根 polygon 上を動くので、
 * 壁外周に固定していた projectPointToOutline から基準ポリゴンを外に出した版。
 */
export function projectPointToPolygon(
  point: Point,
  outline: Point[],
): { edgeIndex: number; t: number } {
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
