// ============================================================
// 範囲選択（ラバーバンド）の bbox 判定・pure（E-6c）。
// 矩形（グリッド座標）に入る全種オブジェクトの id を返す。
//   ・building: いずれかの頂点が矩形内
//   ・obstacle: 中心 or いずれかの頂点
//   ・handrail/post/anti/memo/magnetPin: 代表点 (x,y)
//   ・elevationView: originGrid（左下=GL アンカー）
//   ・ridgeLine: いずれかの端点
//   ・heightMarker: 建物 outline 上の (edgeIndex,t) を線形補間した点
// ============================================================
import type { CanvasData, BuildingShape, HeightMarker, Point } from '@/types';
import { getOutlinePolygon } from '@/lib/konva/heightMarkerUtils';

export type SelectRect = { x: number; y: number; w: number; h: number };

/** 高さマーカーの grid 上の点（建物 outline を (edgeIndex,t) で補間）。建物が無ければ null。 */
export function heightMarkerPoint(marker: Pick<HeightMarker, 'edgeIndex' | 't'>, building: BuildingShape): Point | null {
  const outline = getOutlinePolygon(building);
  const n = outline.length;
  if (n === 0) return null;
  const p1 = outline[marker.edgeIndex % n];
  const p2 = outline[(marker.edgeIndex + 1) % n];
  return { x: p1.x + marker.t * (p2.x - p1.x), y: p1.y + marker.t * (p2.y - p1.y) };
}

/** 矩形内に入る全種オブジェクトの id 一覧（グループ選択）。 */
export function collectIdsInRect(canvasData: CanvasData, rect: SelectRect): string[] {
  const inRect = (p: { x: number; y: number }) =>
    p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.w && p.y <= rect.y + rect.h;
  const ids: string[] = [];

  for (const b of canvasData.buildings) if (b.points.some(inRect)) ids.push(b.id);
  for (const o of canvasData.obstacles) {
    const center = { x: o.x + (o.width ?? 0) / 2, y: o.y + (o.height ?? 0) / 2 };
    if (inRect(center) || (o.points && o.points.some(inRect))) ids.push(o.id);
  }
  for (const h of canvasData.handrails) if (inRect(h)) ids.push(h.id);
  for (const p of canvasData.posts) if (inRect(p)) ids.push(p.id);
  for (const a of canvasData.antis) if (inRect(a)) ids.push(a.id);
  for (const m of canvasData.memos) if (inRect(m)) ids.push(m.id);
  for (const mp of canvasData.magnetPins ?? []) if (inRect(mp)) ids.push(mp.id);
  for (const ev of canvasData.elevationViews ?? []) if (inRect(ev.originGrid)) ids.push(ev.id);
  for (const rl of canvasData.ridgeLines ?? []) if (inRect(rl.p1) || inRect(rl.p2)) ids.push(rl.id);

  const buildingById = new Map(canvasData.buildings.map((b) => [b.id, b]));
  for (const hm of canvasData.heightMarkers ?? []) {
    const b = buildingById.get(hm.buildingId);
    if (!b) continue;
    const pt = heightMarkerPoint(hm, b);
    if (pt && inRect(pt)) ids.push(hm.id);
  }
  return ids;
}
