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
