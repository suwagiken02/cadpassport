// ============================================================
// ページまたぎコピー/移動・クリップボード貼り付けの pure ロジック（E-6b / E-6c）。
//   ・collectSelectionSubset: 選択集合から「素の部分集合」を収集（id 振り直しなし）。
//     建物を選ぶと buildingId 参照の roofOverhang/roof/ridgeLine/heightMarker を自動同梱。
//     origin（bbox 左上）も返す＝貼り付け時のオフセット基準。
//   ・instantiateSubset: 部分集合を deep clone し、新 id 採番・buildingId 追随・
//     位置オフセット適用（heightMarker/roofOverhang/roof は建物パラメトリックのため非オフセット）。
//   ・buildCrossPagePayload: collect + instantiate(offset=0)（E-6b 後方互換）。
//   ・mergePayloadIntoCanvas: 対象 canvas へ配列 append。
// DB I/O は持たない。
// ============================================================
import type {
  CanvasData, BuildingShape, RoofOverhang, Roof, Obstacle, Handrail, Post, Anti, Memo,
  HeightMarker, RidgeLine, ElevationView, MagnetPin, Point, Stair, Pipe,
} from '@/types';
import { freePartAnchorGrid, moveFreePart, type FreePart } from '@/lib/konva/freeParts';
import { v4 as uuidv4 } from 'uuid';

/** 別ページ/クリップボード用オブジェクト群（CanvasData の配列サブセット）。 */
export type CrossPagePayload = {
  buildings: BuildingShape[];
  roofOverhangs: RoofOverhang[];
  roofs: Roof[];
  obstacles: Obstacle[];
  handrails: Handrail[];
  posts: Post[];
  antis: Anti[];
  memos: Memo[];
  heightMarkers: HeightMarker[];
  ridgeLines: RidgeLine[];
  elevationViews: ElevationView[];
  magnetPins: MagnetPin[];
  stairs: Stair[];
  pipes: Pipe[];
  /** キャンバス直下の手動部材 (= E-8-v5a)。 */
  freeParts: FreePart[];
};

function emptyPayload(): CrossPagePayload {
  return {
    buildings: [], roofOverhangs: [], roofs: [], obstacles: [], handrails: [], posts: [],
    antis: [], memos: [], heightMarkers: [], ridgeLines: [], elevationViews: [], magnetPins: [],
    stairs: [], pipes: [], freeParts: [],
  };
}

/** プレーンデータの deep clone（関数を含まないため JSON で十分・安全）。 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * 選択集合から「素の部分集合」（id 振り直しなし・deep clone 済）と、
 * 移動時に消す元 id 一式、貼り付け基準 origin（bbox 左上）を返す。
 */
export function collectSelectionSubset(
  canvasData: CanvasData,
  selectedIds: string[],
): { subset: CrossPagePayload; sourceIds: string[]; origin: Point } {
  const sel = new Set(selectedIds);
  const subset = emptyPayload();
  const sourceIds: string[] = [];
  const selBuildingIds = new Set<string>();

  for (const b of canvasData.buildings) {
    if (!sel.has(b.id)) continue;
    subset.buildings.push(clone(b));
    selBuildingIds.add(b.id);
    sourceIds.push(b.id);
  }
  // 建物依存（buildingId 参照）: 選択建物に紐づくものを自動同梱。
  for (const r of canvasData.roofOverhangs) {
    if (!selBuildingIds.has(r.buildingId)) continue;
    subset.roofOverhangs.push(clone(r)); sourceIds.push(r.id);
  }
  for (const rf of canvasData.roofs ?? []) {
    if (!selBuildingIds.has(rf.buildingId)) continue;
    subset.roofs.push(clone(rf)); sourceIds.push(rf.id);
  }
  for (const m of canvasData.heightMarkers ?? []) {
    if (!selBuildingIds.has(m.buildingId)) continue;
    subset.heightMarkers.push(clone(m)); sourceIds.push(m.id);
  }
  for (const rl of canvasData.ridgeLines ?? []) {
    if (!selBuildingIds.has(rl.buildingId)) continue;
    subset.ridgeLines.push(clone(rl)); sourceIds.push(rl.id);
  }
  // 独立オブジェクト: 選択された id のみ。
  const pushSelected = <T extends { id: string }>(src: T[], dst: T[]) => {
    for (const o of src) {
      if (!sel.has(o.id)) continue;
      dst.push(clone(o)); sourceIds.push(o.id);
    }
  };
  pushSelected(canvasData.obstacles, subset.obstacles);
  pushSelected(canvasData.handrails, subset.handrails);
  pushSelected(canvasData.posts, subset.posts);
  pushSelected(canvasData.antis, subset.antis);
  pushSelected(canvasData.memos, subset.memos);
  pushSelected(canvasData.elevationViews ?? [], subset.elevationViews);
  pushSelected(canvasData.magnetPins ?? [], subset.magnetPins);
  pushSelected(canvasData.stairs ?? [], subset.stairs);
  pushSelected(canvasData.pipes ?? [], subset.pipes);
  pushSelected(canvasData.freeParts ?? [], subset.freeParts);

  return { subset, sourceIds, origin: subsetOrigin(subset) };
}

/** 部分集合の位置系ジオメトリの bbox 左上（貼り付けオフセット基準）。無ければ {0,0}。 */
function subsetOrigin(s: CrossPagePayload): Point {
  let minX = Infinity, minY = Infinity;
  const see = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; };
  for (const b of s.buildings) for (const p of b.points) see(p.x, p.y);
  for (const o of s.obstacles) { see(o.x, o.y); if (o.points) for (const p of o.points) see(p.x, p.y); }
  for (const h of s.handrails) see(h.x, h.y);
  for (const p of s.posts) see(p.x, p.y);
  for (const a of s.antis) see(a.x, a.y);
  for (const m of s.memos) see(m.x, m.y);
  for (const mp of s.magnetPins) see(mp.x, mp.y);
  for (const st of s.stairs) see(st.x, st.y);
  for (const pp of s.pipes) see(pp.x, pp.y);
  for (const fp of s.freeParts) { const a = freePartAnchorGrid(fp); if (a) see(a.x, a.y); }
  for (const ev of s.elevationViews) see(ev.originGrid.x, ev.originGrid.y);
  for (const rl of s.ridgeLines) { see(rl.p1.x, rl.p1.y); see(rl.p2.x, rl.p2.y); }
  return Number.isFinite(minX) ? { x: minX, y: minY } : { x: 0, y: 0 };
}

/**
 * 部分集合を新規オブジェクト列へ実体化。新 id 採番・buildingId 追随・位置オフセット適用。
 * heightMarker/roofOverhang/roof は建物パラメトリックのため位置オフセットは掛けない（建物に自動追随）。
 */
export function instantiateSubset(
  subset: CrossPagePayload,
  offset: Point,
  genId: () => string = uuidv4,
): CrossPagePayload {
  const out = emptyPayload();
  const off = <P extends Point>(p: P): P => ({ ...p, x: p.x + offset.x, y: p.y + offset.y });
  const buildingIdMap = new Map<string, string>();

  for (const b of subset.buildings) {
    const id = genId();
    buildingIdMap.set(b.id, id);
    out.buildings.push({ ...clone(b), id, points: b.points.map(off) });
  }
  for (const r of subset.roofOverhangs) {
    out.roofOverhangs.push({ ...clone(r), id: genId(), buildingId: buildingIdMap.get(r.buildingId) ?? r.buildingId });
  }
  for (const rf of subset.roofs) {
    out.roofs.push({ ...clone(rf), id: genId(), buildingId: buildingIdMap.get(rf.buildingId) ?? rf.buildingId });
  }
  for (const m of subset.heightMarkers) {
    out.heightMarkers.push({ ...clone(m), id: genId(), buildingId: buildingIdMap.get(m.buildingId) ?? m.buildingId });
  }
  for (const rl of subset.ridgeLines) {
    out.ridgeLines.push({ ...clone(rl), id: genId(), buildingId: buildingIdMap.get(rl.buildingId) ?? rl.buildingId, p1: off(rl.p1), p2: off(rl.p2) });
  }
  for (const o of subset.obstacles) {
    out.obstacles.push({ ...clone(o), id: genId(), x: o.x + offset.x, y: o.y + offset.y, ...(o.points ? { points: o.points.map(off) } : {}) });
  }
  for (const h of subset.handrails) out.handrails.push({ ...clone(h), id: genId(), x: h.x + offset.x, y: h.y + offset.y });
  for (const p of subset.posts) out.posts.push({ ...clone(p), id: genId(), x: p.x + offset.x, y: p.y + offset.y });
  for (const a of subset.antis) out.antis.push({ ...clone(a), id: genId(), x: a.x + offset.x, y: a.y + offset.y });
  for (const m of subset.memos) out.memos.push({ ...clone(m), id: genId(), x: m.x + offset.x, y: m.y + offset.y });
  for (const ev of subset.elevationViews) out.elevationViews.push({ ...clone(ev), id: genId(), originGrid: off(ev.originGrid) });
  for (const mp of subset.magnetPins) out.magnetPins.push({ ...clone(mp), id: genId(), x: mp.x + offset.x, y: mp.y + offset.y });
  for (const st of subset.stairs) out.stairs.push({ ...clone(st), id: genId(), x: st.x + offset.x, y: st.y + offset.y });
  for (const pp of subset.pipes) out.pipes.push({ ...clone(pp), id: genId(), x: pp.x + offset.x, y: pp.y + offset.y });
  // E-8-v5a: 手動部材は自由座標なので、グリッドのオフセットを mm へ直して足す。
  for (const fp of subset.freeParts) out.freeParts.push({ ...moveFreePart(clone(fp), offset.x, offset.y), id: genId() });

  return out;
}

/** 全 top-level 新 id を列挙（貼り付け後に選択状態にする用）。 */
export function payloadIds(p: CrossPagePayload): string[] {
  return [
    ...p.buildings, ...p.roofOverhangs, ...p.roofs, ...p.obstacles, ...p.handrails, ...p.posts,
    ...p.antis, ...p.memos, ...p.heightMarkers, ...p.ridgeLines, ...p.elevationViews, ...p.magnetPins,
    ...p.stairs, ...p.pipes, ...p.freeParts,
  ].map((o) => o.id);
}

/**
 * 選択集合から別ページ用ペイロード（id 振り直し済）と、移動時に消す元 id 一式を返す。
 * E-6b 後方互換（offset=0）。
 */
export function buildCrossPagePayload(
  canvasData: CanvasData,
  selectedIds: string[],
  genId: () => string = uuidv4,
): { payload: CrossPagePayload; sourceIds: string[] } {
  const { subset, sourceIds } = collectSelectionSubset(canvasData, selectedIds);
  return { payload: instantiateSubset(subset, { x: 0, y: 0 }, genId), sourceIds };
}

/** ペイロードを対象ページの canvas_data に追記した新しい CanvasData を返す（pure）。 */
export function mergePayloadIntoCanvas(canvasData: CanvasData, payload: CrossPagePayload): CanvasData {
  return {
    ...canvasData,
    buildings: [...canvasData.buildings, ...payload.buildings],
    roofOverhangs: [...canvasData.roofOverhangs, ...payload.roofOverhangs],
    roofs: [...(canvasData.roofs ?? []), ...payload.roofs],
    obstacles: [...canvasData.obstacles, ...payload.obstacles],
    handrails: [...canvasData.handrails, ...payload.handrails],
    posts: [...canvasData.posts, ...payload.posts],
    antis: [...canvasData.antis, ...payload.antis],
    memos: [...canvasData.memos, ...payload.memos],
    heightMarkers: [...(canvasData.heightMarkers ?? []), ...payload.heightMarkers],
    ridgeLines: [...(canvasData.ridgeLines ?? []), ...payload.ridgeLines],
    elevationViews: [...(canvasData.elevationViews ?? []), ...payload.elevationViews],
    magnetPins: [...(canvasData.magnetPins ?? []), ...payload.magnetPins],
    stairs: [...(canvasData.stairs ?? []), ...payload.stairs],
    pipes: [...(canvasData.pipes ?? []), ...payload.pipes],
    freeParts: [...(canvasData.freeParts ?? []), ...payload.freeParts],
  };
}

/** ペイロードの総オブジェクト数（UI の「N 個」表示・空判定用）。 */
export function payloadCount(payload: CrossPagePayload): number {
  return payloadIds(payload).length;
}
