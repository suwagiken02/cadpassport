// ============================================================
// 立面の差分再マッチ (E-8d・pure・node 安全)
//
// 平面を編集して立面を作り直すと primitives は総取っ替えになり、安定 id も
// （スパン数や高さが変われば）変わりうる。ユーザーの編集を捨てないために、
// 旧プリミティブの meta（kind＋高さ/添字/面軸座標）を手がかりに新 id へ引き継ぐ。
//
// 引き継げなかった編集は破棄せず「孤立(orphan)」として持ち回り、UI で一覧提示して
// ユーザーが削除できるようにする（勝手に消さない・勝手に別部材へ付けない）。
// 追加(add)は生成 id に紐づかないユーザー資産なので常に残す。
// ============================================================
import type { ElevationEdit, ElevationPrimitive, ElevationPrimitiveMeta } from '@/types';

/** 面軸座標が同じとみなす許容（グリッド）。 */
const X_TOLERANCE = 0.5;

/** 一致度スコア。高さが最強の手がかり、次いで添字、面軸座標。 */
function matchScore(a: ElevationPrimitiveMeta, b: ElevationPrimitiveMeta): number {
  if (a.kind !== b.kind) return -1;
  let s = 0;
  if (a.heightMm != null && b.heightMm != null) {
    if (a.heightMm === b.heightMm) s += 4; else return -1; // 高さが食い違うなら別物
  }
  // 添字は同種内で一意（支柱番号・段番号）。食い違うなら別物として弾く。
  //   ※支柱の heightMm は列内で全本同じ(天端)なので、これが無いと別の支柱に吸い付いてしまう。
  if (a.index != null && b.index != null && a.index !== b.index) return -1;
  if (a.index != null && b.index != null) s += 2;
  if (a.x != null && b.x != null && Math.abs(a.x - b.x) <= X_TOLERANCE) s += 1;
  if (a.buildingId && b.buildingId && a.buildingId === b.buildingId) s += 1;
  return s;
}

/** 引き継ぎに必要な最低スコア（手がかりが1つも合わないものは孤立にする）。 */
const MIN_SCORE = 2;

export type RematchResult = {
  /** 新しい primitives に対して有効な編集（id は新 id へ差し替え済み）。 */
  edits: ElevationEdit[];
  /** 引き継げなかった編集（削除も自動ではしない）。 */
  orphans: ElevationEdit[];
};

/**
 * 旧 primitives 上の編集を、新 primitives の id へ引き継ぐ。
 *  ・同じ id が新側にもある → そのまま
 *  ・kind＋ヒントで最良の相手が見つかる → 新 id へ差し替え
 *  ・見つからない → orphans へ
 * add はユーザーが描き足した実体なので常に edits 側へ残す。
 */
export function rematchElevationEdits(
  prevPrims: ElevationPrimitive[],
  nextPrims: ElevationPrimitive[],
  edits: ElevationEdit[] | undefined,
): RematchResult {
  const src = edits ?? [];
  if (src.length === 0) return { edits: [], orphans: [] };

  const prevById = new Map<string, ElevationPrimitiveMeta>();
  for (const p of prevPrims) if (p.meta) prevById.set(p.meta.id, p.meta);
  const nextIds = new Set<string>();
  for (const p of nextPrims) if (p.meta) nextIds.add(p.meta.id);

  // 追加プリミティブは生成 id に紐づかず常に残るので、その id は「自分自身」へ解決する
  // （追加した部材への移動・文字・削除の差分もそのまま生きる）。
  const addedIds = new Set<string>();
  for (const e of src) {
    if (e.op === 'add' && e.primitive.meta) {
      addedIds.add(e.primitive.meta.id);
      prevById.set(e.primitive.meta.id, e.primitive.meta);
    }
  }

  /** 旧 id → 新 id の対応（同じ旧 id を複数の編集が参照するので memo 化）。 */
  const resolved = new Map<string, string | null>();
  const resolve = (oldId: string): string | null => {
    if (resolved.has(oldId)) return resolved.get(oldId)!;
    let out: string | null = null;
    if (addedIds.has(oldId)) {
      out = oldId; // 追加分は常に生きる
    } else if (nextIds.has(oldId)) {
      out = oldId; // 同じ id が生き残っている（安定 id が効いた）
    } else {
      const meta = prevById.get(oldId);
      if (meta) {
        let best: { id: string; score: number } | null = null;
        for (const p of nextPrims) {
          if (!p.meta) continue;
          const s = matchScore(meta, p.meta);
          if (s < MIN_SCORE) continue;
          if (!best || s > best.score) best = { id: p.meta.id, score: s };
        }
        out = best ? best.id : null;
      }
    }
    resolved.set(oldId, out);
    return out;
  };

  const kept: ElevationEdit[] = [];
  const orphans: ElevationEdit[] = [];
  for (const e of src) {
    if (e.op === 'add') {
      // 追加分は生成 id に紐づかない＝常に残る。
      kept.push(e);
      continue;
    }
    const newId = resolve(e.targetId);
    if (!newId) { orphans.push(e); continue; }
    if (newId === e.targetId) kept.push(e);
    else if (e.op === 'hide') kept.push({ op: 'hide', targetId: newId });
    else if (e.op === 'move') kept.push({ op: 'move', targetId: newId, dx: e.dx, dy: e.dy });
    else kept.push({ op: 'text', targetId: newId, text: e.text });
  }
  return { edits: kept, orphans };
}

/** 編集を人が読める1行に（孤立一覧の表示用）。 */
export function describeEdit(e: ElevationEdit): string {
  switch (e.op) {
    case 'hide': return `削除: ${e.targetId}`;
    case 'move': return `移動: ${e.targetId} (${e.dx.toFixed(1)}, ${e.dy.toFixed(1)})`;
    case 'text': return `文字: ${e.targetId} → 「${e.text}」`;
    case 'add': return `追加: ${e.primitive.meta?.id ?? '(id なし)'}`;
  }
}
