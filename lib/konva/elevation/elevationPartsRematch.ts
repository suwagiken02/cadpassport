// ============================================================
// 部材ブロックの再マッチ (E-8-v2e・pure・node 安全)
//
// 平面を編集して立面を作り直すと、自動生成部材は総取っ替えになる。
// ユーザーの手当て（追加・移動・削除）は意味データ（kind＋スパン/支柱番号＋高さ）で
// 引き継ぐ。位置そのものが無くなった手当ては破棄せず「孤立」として持ち回り、
// UI で一覧提示してユーザーが削除する（勝手に消さない・勝手に別の場所へ付けない）。
//
// 手動の表現は 3 つだけ:
//   ・追加        → origin:'manual' の部材
//   ・移動        → 元の部材を動かしたもの（origin が manual になる。id は保持）
//   ・削除(自動分) → origin:'manual' + removed:true の墓標（同じスロットの自動部材を抑止）
// ============================================================
import type { ElevationPart, ElevationPartGeometry, ElevationPartsBundle } from './elevationParts';
import { buildElevationSlots } from './elevationSlots';

export type PartsRematchResult = {
  /** 新しいビューに載せる部材（新しい自動分＋引き継いだ手動分）。 */
  parts: ElevationPart[];
  /** 置き場所が無くなって引き継げなかった手動部材。 */
  orphans: ElevationPart[];
};

/** 部材の「置き場所」を表すキー（同じ場所なら同じ文字列）。 */
export function partSlotKey(p: {
  kind: ElevationPart['kind']; scaffoldIndex: number;
  postIndex?: number; spanIndex?: number; levelMm?: number;
}): string {
  const pos = p.postIndex != null ? `p${p.postIndex}` : `s${p.spanIndex ?? '-'}`;
  return `${p.kind}@${p.scaffoldIndex}:${pos}:${p.levelMm ?? '-'}`;
}

/** その部材の置き場所が新しい幾何にまだ存在するか。 */
function slotExists(p: ElevationPart, geom: ElevationPartGeometry): boolean {
  const key = partSlotKey(p);
  return buildElevationSlots(geom, p.kind).some((s) => partSlotKey({
    kind: s.kind, scaffoldIndex: s.scaffoldIndex,
    postIndex: s.postIndex, spanIndex: s.spanIndex, levelMm: s.levelMm,
  }) === key);
}

/** スロットからレンジ（x0/x1）を引き直す。支柱系はレンジを持たない。 */
function withFreshRange(p: ElevationPart, geom: ElevationPartGeometry): ElevationPart {
  if (p.kind === 'post' || p.kind === 'jack') {
    const { x0: _x0, x1: _x1, ...rest } = p;
    void _x0; void _x1;
    return rest;
  }
  const key = partSlotKey(p);
  const slot = buildElevationSlots(geom, p.kind).find((s) => partSlotKey({
    kind: s.kind, scaffoldIndex: s.scaffoldIndex,
    postIndex: s.postIndex, spanIndex: s.spanIndex, levelMm: s.levelMm,
  }) === key);
  return slot ? { ...p, x0: slot.x0, x1: slot.x1 } : p;
}

/**
 * 旧ビューの部材を、作り直した自動部材へ引き継ぐ。
 *  ・自動分は next のものを採用（平面の変更が素直に反映される）
 *  ・手動分（追加・移動・削除の墓標）は置き場所が残っていれば引き継ぐ
 *  ・墓標は同じ置き場所の自動部材を取り除く（削除がぶり返さない）
 *  ・置き場所が消えた手動分は orphans へ
 */
export function rematchElevationParts(
  prevParts: ElevationPart[] | undefined,
  next: ElevationPartsBundle,
): PartsRematchResult {
  const manual = (prevParts ?? []).filter((p) => p.origin === 'manual');
  if (manual.length === 0) return { parts: next.parts, orphans: [] };

  const kept: ElevationPart[] = [];
  const orphans: ElevationPart[] = [];
  for (const p of manual) {
    if (slotExists(p, next.geom)) kept.push(withFreshRange(p, next.geom));
    else orphans.push(p);
  }

  // 墓標の置き場所にある自動部材は取り除く（ユーザーの削除を維持）。
  const tombKeys = new Set(kept.filter((p) => p.removed).map(partSlotKey));
  // 手動で置いた/動かした部材と同じ置き場所の自動部材も重複するので取り除く。
  const takenKeys = new Set(kept.filter((p) => !p.removed).map(partSlotKey));

  const autos = next.parts.filter((p) => {
    const k = partSlotKey(p);
    return !tombKeys.has(k) && !takenKeys.has(k);
  });

  return { parts: [...autos, ...kept], orphans };
}

/** 孤立部材を人が読める1行に（一覧表示用）。 */
export function describePart(p: ElevationPart): string {
  const where = p.postIndex != null ? `支柱${p.postIndex + 1}` : `スパン${(p.spanIndex ?? 0) + 1}`;
  const h = p.levelMm != null ? ` ${p.levelMm}mm` : '';
  return `${p.removed ? '削除' : '追加/移動'}: ${p.kind} ${where}${h}`;
}
