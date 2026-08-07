// ============================================================
// 立面ビューの引き継ぎ (E-8d / E-8-v2e / E-8-v3f・pure・node 安全)
//
// 同じ面の旧ビューの手当て（編集差分・部材）を、作り直した新ビューへ引き継ぐ。
// 引き継げない分は勝手に消さず「孤立」として保持し、UI で一覧提示する。
//
// ここに置く理由 (= E-8-v3f):
//   引き継ぎの入口が 2 つある。
//     ・今のページへ配置   → canvasStore.addElevationViews
//     ・別/新しいページへ配置 → ElevationPlaceDialog が canvas_data を直接書く
//   後者は store を通らないので、引き継ぎが store の中にあると素通りしていた
//   （実機で「別ページに出し直すと手当てが消える」）。判断を pure な 1 箇所に
//   集約して、どちらの入口からも同じ引き継ぎが走るようにする。
// ============================================================
import type { ElevationView } from '@/types';
import { rematchElevationEdits } from './elevationRematch';
import { rematchElevationParts } from './elevationPartsRematch';

/** 旧ビューの手当てを新ビューへ引き継いだものを返す。prev が無ければ next のまま。 */
export function carryOverElevationView(
  prev: ElevationView | undefined, next: ElevationView,
): ElevationView {
  const hasManualParts = (prev?.parts ?? []).some((p) => p.origin === 'manual');
  if (!prev || ((prev.edits?.length ?? 0) === 0 && (prev.orphanEdits?.length ?? 0) === 0
    && (prev.orphanParts?.length ?? 0) === 0 && !hasManualParts)) return next;
  const r = rematchElevationEdits(prev.primitives, next.primitives, prev.edits);
  const orphans = [...(prev.orphanEdits ?? []), ...r.orphans];
  // E-8-v2e: 部材の手当て（追加・移動・削除の墓標）は意味データで引き継ぐ。
  let parts = next.parts;
  let orphanParts = prev.orphanParts ?? [];
  if (next.parts && next.geom) {
    const pr = rematchElevationParts(prev.parts, { parts: next.parts, geom: next.geom });
    parts = pr.parts;
    orphanParts = [...orphanParts, ...pr.orphans];
  }
  return {
    ...next,
    parts,
    edits: r.edits.length > 0 ? r.edits : undefined,
    orphanEdits: orphans.length > 0 ? orphans : undefined,
    orphanParts: orphanParts.length > 0 ? orphanParts : undefined,
  };
}

/**
 * 立面ビュー配列へ「面キーで置換」しながら差し込む。
 * 置き換えられる同じ面の旧ビューからは手当てを引き継ぐ（1 面 1 ビュー）。
 */
export function mergeElevationViews(
  existing: ElevationView[] | undefined, views: ElevationView[],
): ElevationView[] {
  const placed = new Set(views.map((v) => v.face));
  const all = existing ?? [];
  const kept = all.filter((e) => !placed.has(e.face));
  const carried = views.map((v) => carryOverElevationView(all.find((e) => e.face === v.face), v));
  return [...kept, ...carried];
}
