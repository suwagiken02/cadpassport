// ============================================================
// フローティングパネルの位置 (E-8-v3c-fix5・pure・node 安全)
//
// 部材パレットのような「画面に浮くパネル」を掴んで動かすときの座標計算。
// 画面外へ逃がさない（掴み直せなくなる）ことだけを担保する。
// DOM を触らないので、実機の見た目に依らずここでテストできる。
//
// 座標はクライアント座標(px)・パネルの左上。
// ============================================================

export type PanelSize = { w: number; h: number };
export type Viewport = { w: number; h: number };
export type PanelPos = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * パネルを画面内へ収める。パネルが画面より大きいときは左上（margin）へ寄せる
 * ＝タイトルバーが必ず見える＝掴み直せる。
 */
export function clampPanelPos(
  pos: PanelPos, panel: PanelSize, vp: Viewport, margin = 8,
): PanelPos {
  const maxX = Math.max(margin, vp.w - panel.w - margin);
  const maxY = Math.max(margin, vp.h - panel.h - margin);
  return {
    x: clamp(pos.x, Math.min(margin, maxX), maxX),
    y: clamp(pos.y, Math.min(margin, maxY), maxY),
  };
}

/**
 * 既定位置＝画面下寄りの中央（従来の固定位置と同じ見え方）。
 * bottomGap は下のツールバーぶんの余白。
 */
export function defaultPanelPos(
  panel: PanelSize, vp: Viewport, bottomGap = 64, margin = 8,
): PanelPos {
  return clampPanelPos(
    { x: (vp.w - panel.w) / 2, y: vp.h - bottomGap - panel.h },
    panel, vp, margin,
  );
}

/** ドラッグ中の位置。掴んだ点からの移動量を足してクランプするだけ。 */
export function dragPanelPos(
  origin: PanelPos, from: { x: number; y: number }, to: { x: number; y: number },
  panel: PanelSize, vp: Viewport, margin = 8,
): PanelPos {
  return clampPanelPos(
    { x: origin.x + (to.x - from.x), y: origin.y + (to.y - from.y) },
    panel, vp, margin,
  );
}
