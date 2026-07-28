// ============================================================
// 妻割の自動割付への適用 (M-1c・pure・node 安全)
//
// 割付チェーン（周回して離れを引き継ぐ）はセグメントの rails の「合計」だけで決まり、
// 面内の並びには依存しない（placeHandrailsForEdge は配列順に積むだけ）。よって妻面には
// 「同じ合計のまま、妻割エンジンの 1 位候補へ差し替える」ことができる。
//   ・両端の離れ・隣接面の端点接続という絶対制約はそのまま保たれる
//   ・多重集合まで差し替わるので 8500 のような例で確定の並び（1800 1800 400 900 1800 1800）になる
// 妻割候補が出せない長さ（列挙が空）のときは、元の多重集合をセンター割りで並べ替えるだけに
// フォールバックする（合計も本数も不変）。
// ============================================================
import type { HandrailLengthMm } from '@/types';
import type { FaceDir } from '../autoLayoutUtils';
import { arrangeTsumawari, generateTsumawariCandidates } from '../tsumawari';

/** 妻割を適用した rails（合計は不変）。適用できないときは元の rails をそのまま返す。 */
export function applyTsumawariToRails(
  rails: HandrailLengthMm[], sizes: HandrailLengthMm[],
): HandrailLengthMm[] {
  if (rails.length === 0) return rails;
  const total = rails.reduce((a, b) => a + b, 0);
  const usable = sizes.length > 0 ? sizes : Array.from(new Set(rails));

  // 同じ合計の妻割候補の 1 位（多重集合ごと差し替え）。
  const best = generateTsumawariCandidates(total, usable)[0];
  if (best && best.totalMm === total) return best.rails as HandrailLengthMm[];

  // 列挙できないときは元の多重集合を並べ替えるだけ。
  return arrangeTsumawari(rails).rails as HandrailLengthMm[];
}

/**
 * 面ごとの rails を決める。妻面なら妻割、それ以外は元のまま（通常割り）。
 * gableFaces は detectGableFaces の結果（面別トグルで差し引きした後の集合）。
 */
export function railsForFace(
  rails: HandrailLengthMm[],
  face: FaceDir,
  gableFaces: Set<FaceDir> | null | undefined,
  sizes: HandrailLengthMm[],
): HandrailLengthMm[] {
  if (!gableFaces || !gableFaces.has(face)) return rails;
  return applyTsumawariToRails(rails, sizes);
}
