// ============================================================
// ページ全コンテンツのバウンディングボックス（グリッド）計算・pure（E-6f）。
// 「全体表示(🔍)」の戻り先に使う。建物・障害物・足場・メモ・ピン・棟線・立面ビューを含む。
// 何も無ければ null（＝空ページ。呼び出し側は原点・デフォルトズームに戻す）。
// ============================================================
import type { CanvasData } from '@/types';
import { elevationPrimitivesBounds } from './quadLayout';
import { pipeEndpointsGrid, stairCornersGrid } from '@/lib/konva/planeParts';
import { freePartsBoundsGrid, scaffoldPartsOf } from '@/lib/konva/freeParts';
import { partsToPrimitives } from '@/lib/konva/elevation/elevationParts';

export type GridBounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * ページの中身が占める範囲 (= 印刷枠・全体表示の基準)。
 * E-8-v5c: 補助線は既定では**含めない**（出力に出さないものを枠に入れない）。
 * 含めるときだけ opts.includeAids を true にする＝出力側のフラグと同じ 1 つに従う。
 */
export function computeContentBounds(
  cv: CanvasData, opts?: { includeAids?: boolean },
): GridBounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };

  for (const b of cv.buildings) for (const p of b.points) see(p.x, p.y);
  // S-1: 敷地は建物の外側に広がるので、ここを見落とすと PDF/画像の枠から切れる。
  for (const sp of cv.sitePolygons ?? []) for (const p of sp.points) see(p.x, p.y);
  for (const o of cv.obstacles) {
    see(o.x, o.y); see(o.x + (o.width ?? 0), o.y + (o.height ?? 0));
    if (o.points) for (const p of o.points) see(p.x, p.y);
  }
  for (const h of cv.handrails) see(h.x, h.y);
  for (const p of cv.posts) see(p.x, p.y);
  for (const a of cv.antis) see(a.x, a.y);
  for (const s of cv.stairs ?? []) for (const c of stairCornersGrid(s)) see(c.x, c.y);
  for (const p of cv.pipes ?? []) for (const e of pipeEndpointsGrid(p)) see(e.x, e.y);
  for (const m of cv.memos) see(m.x, m.y);
  for (const mp of cv.magnetPins ?? []) see(mp.x, mp.y);
  for (const rl of cv.ridgeLines ?? []) { see(rl.p1.x, rl.p1.y); see(rl.p2.x, rl.p2.y); }
  // E-8-v5a: キャンバス直下の手動部材（立面ビューに所属しない）。
  const fb = freePartsBoundsGrid(
    opts?.includeAids ? cv.freeParts : scaffoldPartsOf(cv.freeParts),
  );
  if (fb) { see(fb.minX, fb.minY); see(fb.maxX, fb.maxY); }
  for (const ev of cv.elevationViews ?? []) {
    // E-8-v5a: 背景プリミティブしか見ていなかったため、背景（建物・足場の絵）の外へ
    //   置いた手動部材がページの範囲に入らず、PDF/画像の枠から切れていた。
    //   実際に描かれるものを全部見る（ElevationViewLayer の localBounds と同じ合わせ方）。
    const prims = ev.parts && ev.geom
      ? [...ev.primitives, ...partsToPrimitives({ parts: ev.parts, geom: ev.geom })]
      : ev.primitives;
    const lb = elevationPrimitivesBounds(prims);
    if (!lb) continue;
    see(ev.originGrid.x + lb.minX * ev.scale, ev.originGrid.y + lb.minY * ev.scale);
    see(ev.originGrid.x + lb.maxX * ev.scale, ev.originGrid.y + lb.maxY * ev.scale);
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
