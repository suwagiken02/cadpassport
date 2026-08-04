// ============================================================
// 部材をどの立面ビューに入れるか (E-8-v3c-fix・pure・node 安全)
//
// v3 の「どこにでも置ける」は、立面ビューの枠の外も含む。枠の外に置いた部材も
// どこかのビューが持たないと保存できないので、帰属だけは決める必要がある。
//
// 方針（実機の使い方から）:
//   1. どれかのビューの枠（少し余裕を持たせた矩形）の中なら、そのビュー
//   2. 枠の外なら「いちばん近いビュー」。立面の隣に張り出して組む・独立して組む場合、
//      人はいちばん近い図の続きとして描いているので、それが自然
//   3. 近いビューが同距離で並ぶ場合や、そもそも 1 つも無い場合は、いま操作している
//      ビュー（パレットを開いているビュー）に入れる
// 座標は画面 px（どのビューにも共通の土俵）で比較する。
// ============================================================

export type ViewBox = {
  id: string;
  /** 画面 px の外接矩形。 */
  x: number; y: number; w: number; h: number;
};

/** 点と矩形の距離（内側なら 0）。 */
export function distanceToBox(p: { x: number; y: number }, b: ViewBox): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * 置いた点(画面 px)から、部材を入れるビューを選ぶ。
 * activeId は「いまパレットを開いている／最後に操作した」ビュー。
 */
export function pickTargetView(
  boxes: ViewBox[], point: { x: number; y: number }, activeId?: string | null,
): string | null {
  if (boxes.length === 0) return activeId ?? null;
  if (boxes.length === 1) return boxes[0].id;

  let best: { id: string; d: number } | null = null;
  let tie = false;
  for (const b of boxes) {
    const d = distanceToBox(point, b);
    if (!best || d < best.d - 1e-6) { best = { id: b.id, d }; tie = false; }
    else if (Math.abs(d - best.d) <= 1e-6 && b.id !== best.id) tie = true;
  }
  if (!best) return activeId ?? null;
  // 同距離で決められないときは、操作中のビューを優先する（迷ったら手元の図）
  if (tie && activeId && boxes.some((b) => b.id === activeId)) return activeId;
  return best.id;
}
