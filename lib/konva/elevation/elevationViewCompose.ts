// ============================================================
// 立面ビューの描画合成 (E-8-v2b・pure・node 安全)
//
// parts(部材ブロック)を持つビューは「背景プリミティブ＋parts から都度生成した部材」で描く。
// 背景（建物シルエット・屋根・GL・寸法・文字）は保存済み primitives の並びをそのまま使い、
// 部材だけを parts 由来に差し替える。こうすると重なり順が生成時と完全に一致するため、
// 部材一次化しても立面図の見た目が変わらない。
//
// parts を持たない旧ビューは従来どおり primitives をそのまま描く（差分編集 E-8a も従来どおり）。
// ============================================================
import type { ElevationPrimitive, ElevationView } from '@/types';
import { isPartPrimitive, partsToPrimitives } from './elevationParts';
import { applyElevationEdits } from './elevationEdits';

/** 部材を持つビューか（＝v2 の編集対象になっているか）。 */
export function hasParts(view: ElevationView): boolean {
  return !!view.parts && !!view.geom;
}

/**
 * 描画用プリミティブ列を組み立てる。
 *  ・parts あり: 保存 primitives の「最初に部材が現れた位置」へ parts 由来の部材群を差し込み、
 *    元の部材プリミティブは捨てる（背景の順序は保存されたまま）。
 *  ・parts なし: 従来どおり（差分編集を適用した primitives）。
 * 文字上書き等の差分(E-8c)は合成後にも効く。
 */
export function composeViewPrimitives(view: ElevationView): ElevationPrimitive[] {
  if (!hasParts(view)) return applyElevationEdits(view);

  const partPrims = partsToPrimitives({ parts: view.parts!, geom: view.geom! });
  const out: ElevationPrimitive[] = [];
  let inserted = false;
  for (const p of view.primitives) {
    if (isPartPrimitive(p)) {
      if (!inserted) { out.push(...partPrims); inserted = true; }
      continue; // 生成時の部材プリミティブは parts 由来に置き換える
    }
    out.push(p);
  }
  if (!inserted) out.push(...partPrims);

  // 文字上書き・追加などの差分は合成後の配列に対して適用する。
  return applyElevationEdits({ ...view, primitives: out });
}
