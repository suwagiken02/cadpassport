// ============================================================
// 敷地境界線の見た目 — 唯一の定義 (= S-1)
//
// 色は**建物と同じ黒**。図面としては敷地も建物も同じ「黒い線」で、
// 区別は線種（一点鎖線）と太さ（建物より細い）でつける（鮎澤氏の判断）。
// 塗りは持たない：敷地の内側に建物と足場が全部乗るので、塗ると隠れる。
//
// ここは pure（Konva も React も知らない）なので、テストで固定できる。
// ============================================================

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
