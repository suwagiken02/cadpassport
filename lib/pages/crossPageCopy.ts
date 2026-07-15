// ============================================================
// ページまたぎコピー/移動の pure ロジック（E-6b）。
// 選択オブジェクト集合から、別ページへ差し込む「ペイロード」を組み立てる。
//   ・全オブジェクトに新 id を採番（コピー先での衝突回避）。
//   ・建物を選ぶと、その建物に紐づく roofOverhang / ridgeLine / heightMarker
//     （buildingId 参照）を自動同梱し、buildingId を新 building id へ追随させる。
//   ・roof は BuildingShape に内包のため建物ごと自動で運ばれる（remap 不要）。
//   ・handrail/post/anti/obstacle/memo/elevationView は選択された id のみ、新 id 採番。
//   ・sourceIds = 移動(move)時に元ページから削除すべき元 id 一式（選択＋自動同梱の依存）。
// DB I/O は持たない（呼び出し側が対象ページの canvas_data へ merge して保存）。
// ============================================================
import type {
  CanvasData, BuildingShape, RoofOverhang, Obstacle, Handrail, Post, Anti, Memo,
  HeightMarker, RidgeLine, ElevationView,
} from '@/types';
import { v4 as uuidv4 } from 'uuid';

/** 別ページへ差し込むオブジェクト群（CanvasData の配列サブセット）。 */
export type CrossPagePayload = {
  buildings: BuildingShape[];
  roofOverhangs: RoofOverhang[];
  obstacles: Obstacle[];
  handrails: Handrail[];
  posts: Post[];
  antis: Anti[];
  memos: Memo[];
  heightMarkers: HeightMarker[];
  ridgeLines: RidgeLine[];
  elevationViews: ElevationView[];
};

/** 空ペイロード。 */
function emptyPayload(): CrossPagePayload {
  return {
    buildings: [], roofOverhangs: [], obstacles: [], handrails: [], posts: [],
    antis: [], memos: [], heightMarkers: [], ridgeLines: [], elevationViews: [],
  };
}

/** プレーンデータの deep clone（関数を含まないため JSON で十分・安全）。 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * 選択集合から別ページ用ペイロードと、移動時に消す元 id 一式を組み立てる。
 * @param genId 新 id 生成器（既定 uuid。テストで決定的に差し替え可能）。
 */
export function buildCrossPagePayload(
  canvasData: CanvasData,
  selectedIds: string[],
  genId: () => string = uuidv4,
): { payload: CrossPagePayload; sourceIds: string[] } {
  const sel = new Set(selectedIds);
  const payload = emptyPayload();
  const sourceIds: string[] = [];

  // 建物: 選択された building。old→new id マップを作る。
  const buildingIdMap = new Map<string, string>();
  for (const b of canvasData.buildings) {
    if (!sel.has(b.id)) continue;
    const newId = genId();
    buildingIdMap.set(b.id, newId);
    payload.buildings.push({ ...clone(b), id: newId });
    sourceIds.push(b.id);
  }

  // 建物依存（buildingId 参照）: 選択建物に紐づくものを自動同梱し buildingId を追随。
  for (const r of canvasData.roofOverhangs) {
    const newBid = buildingIdMap.get(r.buildingId);
    if (!newBid) continue;
    payload.roofOverhangs.push({ ...clone(r), id: genId(), buildingId: newBid });
    sourceIds.push(r.id);
  }
  for (const m of canvasData.heightMarkers ?? []) {
    const newBid = buildingIdMap.get(m.buildingId);
    if (!newBid) continue;
    payload.heightMarkers.push({ ...clone(m), id: genId(), buildingId: newBid });
    sourceIds.push(m.id);
  }
  for (const rl of canvasData.ridgeLines ?? []) {
    const newBid = buildingIdMap.get(rl.buildingId);
    if (!newBid) continue;
    payload.ridgeLines.push({ ...clone(rl), id: genId(), buildingId: newBid });
    sourceIds.push(rl.id);
  }

  // buildingId 参照を持たない独立オブジェクト: 選択された id のみ。
  const pushSelected = <T extends { id: string }>(src: T[], dst: T[]) => {
    for (const o of src) {
      if (!sel.has(o.id)) continue;
      dst.push({ ...clone(o), id: genId() });
      sourceIds.push(o.id);
    }
  };
  pushSelected(canvasData.obstacles, payload.obstacles);
  pushSelected(canvasData.handrails, payload.handrails);
  pushSelected(canvasData.posts, payload.posts);
  pushSelected(canvasData.antis, payload.antis);
  pushSelected(canvasData.memos, payload.memos);
  pushSelected(canvasData.elevationViews ?? [], payload.elevationViews);

  return { payload, sourceIds };
}

/** ペイロードを対象ページの canvas_data に追記した新しい CanvasData を返す（pure）。 */
export function mergePayloadIntoCanvas(canvasData: CanvasData, payload: CrossPagePayload): CanvasData {
  return {
    ...canvasData,
    buildings: [...canvasData.buildings, ...payload.buildings],
    roofOverhangs: [...canvasData.roofOverhangs, ...payload.roofOverhangs],
    obstacles: [...canvasData.obstacles, ...payload.obstacles],
    handrails: [...canvasData.handrails, ...payload.handrails],
    posts: [...canvasData.posts, ...payload.posts],
    antis: [...canvasData.antis, ...payload.antis],
    memos: [...canvasData.memos, ...payload.memos],
    heightMarkers: [...(canvasData.heightMarkers ?? []), ...payload.heightMarkers],
    ridgeLines: [...(canvasData.ridgeLines ?? []), ...payload.ridgeLines],
    elevationViews: [...(canvasData.elevationViews ?? []), ...payload.elevationViews],
  };
}

/** ペイロードの総オブジェクト数（UI の「N 個」表示・空判定用）。 */
export function payloadCount(payload: CrossPagePayload): number {
  return (
    payload.buildings.length + payload.roofOverhangs.length + payload.obstacles.length +
    payload.handrails.length + payload.posts.length + payload.antis.length +
    payload.memos.length + payload.heightMarkers.length + payload.ridgeLines.length +
    payload.elevationViews.length
  );
}
