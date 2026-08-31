// ============================================================
// 画像を拡大・移動して見るための計算 (= U-1 commit 3-fix)・pure
//
// 下図の合わせ込みは「寸法線の端を正確に狙う」操作なので、画面に収まるよう
// 縮小表示しただけでは点が打てない。A3 の図面（4000px 幅）を 700px で表示すると
// **表示上の 1px が図面の 5.7px**にあたり、狙いようがない。
//
// ここは transform（拡大率と平行移動）の計算だけを持つ。DOM も React も知らない。
// ============================================================

export type ImageView = {
  /** 拡大率（1 = 原寸）。 */
  scale: number;
  /** 平行移動(px)。transform-origin は左上。 */
  tx: number;
  ty: number;
};

export const IMAGE_VIEW_MIN_SCALE = 0.05;
export const IMAGE_VIEW_MAX_SCALE = 20;
/** ホイール 1 段の倍率。 */
export const IMAGE_VIEW_WHEEL_STEP = 1.15;
/** 「＋」「−」ボタン 1 回の倍率。 */
export const IMAGE_VIEW_BUTTON_STEP = 1.4;
/** これ以上動いたらドラッグ扱い（S-9 のゴーストと同じ作法）。 */
export const IMAGE_VIEW_DRAG_PX = 6;

const clampScale = (s: number): number =>
  Math.min(IMAGE_VIEW_MAX_SCALE, Math.max(IMAGE_VIEW_MIN_SCALE, s));

/** 画像全体が入る表示（中央寄せ）。 */
export function fitView(
  naturalWidth: number, naturalHeight: number, containerW: number, containerH: number,
): ImageView {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(containerW > 0) || !(containerH > 0)) {
    return { scale: 1, tx: 0, ty: 0 };
  }
  const scale = clampScale(Math.min(containerW / naturalWidth, containerH / naturalHeight));
  return {
    scale,
    tx: (containerW - naturalWidth * scale) / 2,
    ty: (containerH - naturalHeight * scale) / 2,
  };
}

/**
 * ある点（コンテナ座標）を動かさずに拡大・縮小する。
 * ホイールならカーソル、ピンチなら 2 本指の中点を渡す。
 */
export function zoomAbout(view: ImageView, factor: number, cx: number, cy: number): ImageView {
  const next = clampScale(view.scale * factor);
  if (next === view.scale) return view;
  // カーソルの下にある画像上の点は動かさない
  const ix = (cx - view.tx) / view.scale;
  const iy = (cy - view.ty) / view.scale;
  return { scale: next, tx: cx - ix * next, ty: cy - iy * next };
}

/** 平行移動する。 */
export const panView = (view: ImageView, dx: number, dy: number): ImageView =>
  ({ ...view, tx: view.tx + dx, ty: view.ty + dy });

/** コンテナ座標 → 画像の画素。 */
export function viewToImagePx(
  view: ImageView, cx: number, cy: number,
): { x: number; y: number } | null {
  if (!(view.scale > 0)) return null;
  return { x: (cx - view.tx) / view.scale, y: (cy - view.ty) / view.scale };
}

/** 画像の画素 → コンテナ座標（打った点の印を出すのに使う）。 */
export const imagePxToView = (
  view: ImageView, x: number, y: number,
): { x: number; y: number } => ({ x: x * view.scale + view.tx, y: y * view.scale + view.ty });
