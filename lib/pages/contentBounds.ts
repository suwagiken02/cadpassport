// ============================================================
// ページ全コンテンツのバウンディングボックス（グリッド）計算・pure（E-6f）。
// 「全体表示(🔍)」の戻り先に使う。建物・障害物・足場・メモ・ピン・棟線・立面ビューを含む。
// 何も無ければ null（＝空ページ。呼び出し側は原点・デフォルトズームに戻す）。
// ============================================================
import type { CanvasData } from '@/types';
import { elevationPrimitivesBounds } from './quadLayout';
import { pipeEndpointsGrid, stairCornersGrid } from '@/lib/konva/planeParts';

export type GridBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function computeContentBounds(cv: CanvasData): GridBounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };

  for (const b of cv.buildings) for (const p of b.points) see(p.x, p.y);
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
  for (const ev of cv.elevationViews ?? []) {
    const lb = elevationPrimitivesBounds(ev.primitives);
    if (!lb) continue;
    see(ev.originGrid.x + lb.minX * ev.scale, ev.originGrid.y + lb.minY * ev.scale);
    see(ev.originGrid.x + lb.maxX * ev.scale, ev.originGrid.y + lb.maxY * ev.scale);
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
