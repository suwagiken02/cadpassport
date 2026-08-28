// ============================================================
// 敷地境界線の見た目 — 唯一の定義 (= S-1)
//
// 色は**建物と同じ黒**。図面としては敷地も建物も同じ「黒い線」で、
// 区別は線種（一点鎖線）と太さ（建物より細い）でつける（鮎澤氏の判断）。
// 塗りは持たない：敷地の内側に建物と足場が全部乗るので、塗ると隠れる。
//
// ここは pure（Konva も React も知らない）なので、テストで固定できる。
// ============================================================
import type { Point } from '@/types';

/** 建物の枠と同じ黒（ライト／ダーク）。敷地だけ別の色にしない。 */
export const SITE_STROKE_LIGHT = '#1a1a18';
export const SITE_STROKE_DARK = '#888888';
/** 選択中は他の要素と同じオレンジ。 */
export const SITE_SELECT_COLOR = '#FF6B35';

/**
 * 一点鎖線の刻み（長線・空き・点・空き）。zoom 倍して画面 px にする。
 * 建物は実線なので、この線種だけで「敷地の線」と分かる。
 */
export const SITE_DASH_UNITS: readonly number[] = [60, 18, 10, 18];

/** 建物（16 / 選択 24）より細くする。 */
export const SITE_STROKE_WIDTH_UNITS = 12;
export const SITE_STROKE_WIDTH_UNITS_SELECTED = 18;

export const siteDash = (zoom: number): number[] => SITE_DASH_UNITS.map((v) => v * zoom);

export const siteStrokeWidth = (zoom: number, selected: boolean): number =>
  (selected ? SITE_STROKE_WIDTH_UNITS_SELECTED : SITE_STROKE_WIDTH_UNITS) * zoom;

export const siteStrokeColor = (isDarkMode: boolean, selected: boolean): string =>
  selected ? SITE_SELECT_COLOR : (isDarkMode ? SITE_STROKE_DARK : SITE_STROKE_LIGHT);

// ============================================================
// 頂点のつまみ (= S-4)
//
// 敷地を選ぶと角につまみが出て、引っ張ると形を直せる。
// 敷地は S-2 で斜め・任意角度を許しているので、動かす向きに制約はかけない
// （軸に平行へ寄せたりしない）。吸着も「近くの角へ軽く寄る」だけにする。
// ============================================================

/** つまみの半径(px)。見た目の大きさ。 */
export const SITE_VERTEX_R = 7;
/** 指で掴める当たり幅(px)。見た目より大きくしてタッチで外さないようにする。 */
export const SITE_VERTEX_HIT = 30;
/** 近くの角へ吸着する画面距離(px)。 */
export const SITE_VERTEX_SNAP_PX = 12;
export const SITE_VERTEX_FILL = '#FFFFFF';

/** 浮動小数のごみを落とす（0.1mm まで）。 */
const tidy = (v: number): number => Math.round(v * 1e3) / 1e3;
export const tidyPoint = (p: { x: number; y: number }) => ({ x: tidy(p.x), y: tidy(p.y) });

// ============================================================
// 頂点の追加 (= S-9)
//
// 辺の中点に「押せば頂点が増える」ゴーストのつまみを出す。ダブルクリックや
// 長押しではなく**見えているものを押す**方式にしたのは、タッチでは指を置くまで
// 位置が取れず、ホバーでの予告が使えないため（S-7 の教訓）。
// ============================================================

/** ゴーストの見た目の半径(px)。本物（7）より一回り小さく。 */
export const SITE_GHOST_R = 5;
/** ゴーストの不透明度。「押せるが主役ではない」見え方。 */
export const SITE_GHOST_OPACITY = 0.4;
/**
 * ゴーストの当たり半径(px)。本物（30）より**小さくする**。
 * 重なったときに本物が優先され、「動かそうとしてゴーストを掴む」が起きにくい。
 */
export const SITE_GHOST_HIT = 22;
/**
 * ゴーストを出す最小の辺の長さ(px)。これ未満の辺には出さない。
 * 本物のつまみの当たり半径（30）＋余裕。短い辺だと両端のつまみと団子になり、
 * 押し分けられなくなる。
 */
export const SITE_GHOST_MIN_EDGE_PX = 40;

/** 辺の中点（グリッド）。閉じた外形なので辺の数＝頂点の数。 */
export type EdgeMidpoint = {
  /** 何番目の辺か（辺 i は 頂点 i → 頂点 i+1）。 */
  edgeIndex: number;
  point: Point;
  /** その辺の長さ（グリッド）。画面 px は呼び出し側で gridPx を掛ける。 */
  lengthGrid: number;
};

/** 全辺の中点。頂点が 2 つ未満なら空。 */
export function edgeMidpointsGrid(points: Point[]): EdgeMidpoint[] {
  const n = points.length;
  if (n < 2) return [];
  const out: EdgeMidpoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push({
      edgeIndex: i,
      point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      lengthGrid: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  return out;
}

/**
 * 辺 edgeIndex の後ろへ頂点を差し込んだ点列。
 * 辺 i は「頂点 i → 頂点 i+1」なので、新しい頂点は index i+1 に入る
 * ＝前後の頂点の間に挟まり、形が崩れない。
 */
export function insertPointAfterEdge(
  points: Point[], edgeIndex: number, point: Point,
): Point[] {
  const at = edgeIndex + 1;
  return [...points.slice(0, at), { ...point }, ...points.slice(at)];
}

/**
 * つまみを操作している最中の仮の状態 (= S-4 の移動 / S-9 の追加)。
 * 確定するまではストアへ書かず、これで見せるだけ。
 */
export type SiteVertexEdit =
  | { kind: 'move'; id: string; index: number; point: Point }
  | { kind: 'insert'; id: string; edgeIndex: number; point: Point };

/** 操作中の仮の状態を反映した点列（その敷地でなければそのまま）。 */
export function withPendingEdit(
  points: Point[], edit: SiteVertexEdit | null, id: string,
): Point[] {
  if (!edit || edit.id !== id) return points;
  if (edit.kind === 'move') {
    return points.map((p, i) => (i === edit.index ? edit.point : p));
  }
  return insertPointAfterEdge(points, edit.edgeIndex, edit.point);
}

// ============================================================
// 頂点の削除 (= S-9 commit 2)
//
// 操作は**つまみのダブルクリック／ダブルタップだけ**。単発の操作（タップ・
// ドラッグ）には割り当てない＝「動かそうとして消えた」が起こりようがない。
// キャンバスは touch-action:none ＋ viewport の userScalable:false なので、
// ダブルタップがブラウザの拡大に取られることもない（実機確認済み）。
// ============================================================

/** これ以下には減らさない頂点数。三角形が最小。 */
export const SITE_MIN_VERTICES = 3;

/** その敷地の頂点を消せるか（消せないときはつまみの見た目でも示す）。 */
export const canRemoveSiteVertex = (pointCount: number): boolean =>
  pointCount > SITE_MIN_VERTICES;

/**
 * 消せないつまみの色。消せるとき（オレンジ＝選択色）と分けて、
 * 「これ以上は減らせない」を見た目で伝える。
 */
export const SITE_VERTEX_LOCKED_COLOR = '#9CA3AF';

/**
 * 近くの角があれば、そこへ寄せる（無ければそのまま）。
 * 「自由が原則」なので、寄せるのは実在する角だけ。グリッドには吸着させない。
 */
export function snapSiteVertex(
  p: { x: number; y: number },
  candidates: { x: number; y: number }[],
  radiusGrid: number,
): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  let bestD = radiusGrid;
  for (const c of candidates) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { x: best.x, y: best.y } : tidyPoint(p);
}
