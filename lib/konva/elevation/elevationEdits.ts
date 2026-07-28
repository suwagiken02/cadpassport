// ============================================================
// 立面の差分編集 (E-8b・pure・node 安全)
//
// 案B: 生成された primitives は書き換えず、ユーザーの編集を ElevationEdit[] として積む。
//   ・元データが保護される（平面を変えて立面を作り直しても、差分は残る）
//   ・undo は canvasData 経由で既存の履歴にそのまま乗る（edits 配列ごと巻き戻る）
// ここは「差分を primitives に適用して描画用の配列を作る」変換と、差分配列の組み立てだけ。
// 座標はすべてグループローカル（水平=グリッド、垂直=mm/10・GL=0・上が負）。
// ============================================================
import type { ElevationEdit, ElevationPrimitive, ElevationView } from '@/types';

/** プリミティブを (dx, dy) だけ平行移動した複製を返す（ローカル座標）。 */
export function translatePrimitive(p: ElevationPrimitive, dx: number, dy: number): ElevationPrimitive {
  if (dx === 0 && dy === 0) return p;
  switch (p.kind) {
    case 'line':
      return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case 'rect':
      return { ...p, x: p.x + dx, y: p.y + dy };
    case 'polygon': {
      const points = p.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
      return { ...p, points };
    }
    case 'text':
      return { ...p, x: p.x + dx, y: p.y + dy };
  }
}

/** プリミティブのローカル bbox（選択ハイライト・当たり判定用）。 */
export function primitiveBounds(
  p: ElevationPrimitive,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const see = (xs: number[], ys: number[]) => ({
    minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys),
  });
  switch (p.kind) {
    case 'line': return see([p.x1, p.x2], [p.y1, p.y2]);
    case 'rect': return see([p.x, p.x + p.w], [p.y, p.y + p.h]);
    case 'polygon': {
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < p.points.length; i += 2) { xs.push(p.points[i]); ys.push(p.points[i + 1]); }
      return see(xs, ys);
    }
    case 'text': {
      // 文字は概算（monospace 前提・renderPrim と同じ 0.6 係数）。単位は px なのでグリッドへ寄せる。
      const w = p.text.length * p.size * 0.6 / 10;
      const h = p.size / 10;
      const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
      return { minX: x0, minY: p.y - h, maxX: x0 + w, maxY: p.y + h };
    }
  }
}

/**
 * 差分を適用した描画用プリミティブ列。
 *   hide → 除外 / move → 平行移動 / text → 文字差し替え / add → 末尾に追加
 * 未編集（edits 無し）は元の配列をそのまま返す（参照も維持＝再レンダの無駄を作らない）。
 */
export function applyElevationEdits(view: ElevationView): ElevationPrimitive[] {
  const edits = view.edits;
  if (!edits || edits.length === 0) return view.primitives;

  const hidden = new Set<string>();
  const moves = new Map<string, { dx: number; dy: number }>();
  const texts = new Map<string, string>();
  const added: ElevationPrimitive[] = [];
  for (const e of edits) {
    if (e.op === 'hide') hidden.add(e.targetId);
    else if (e.op === 'move') {
      const cur = moves.get(e.targetId);
      moves.set(e.targetId, cur ? { dx: cur.dx + e.dx, dy: cur.dy + e.dy } : { dx: e.dx, dy: e.dy });
    } else if (e.op === 'text') texts.set(e.targetId, e.text);
    else added.push(e.primitive);
  }

  const out: ElevationPrimitive[] = [];
  for (const p of view.primitives) {
    const id = p.meta?.id;
    if (id && hidden.has(id)) continue;
    let q = p;
    if (id) {
      const mv = moves.get(id);
      if (mv) q = translatePrimitive(q, mv.dx, mv.dy);
      const tx = texts.get(id);
      if (tx != null && q.kind === 'text') q = { ...q, text: tx };
    }
    out.push(q);
  }
  // 追加分にも hide/move/text が効く（追加した部材を後から動かす・消せる）。
  for (const a of added) {
    const id = a.meta?.id;
    if (id && hidden.has(id)) continue;
    let q = a;
    if (id) {
      const mv = moves.get(id);
      if (mv) q = translatePrimitive(q, mv.dx, mv.dy);
      const tx = texts.get(id);
      if (tx != null && q.kind === 'text') q = { ...q, text: tx };
    }
    out.push(q);
  }
  return out;
}

// ── 差分配列の組み立て（すべて新しい配列を返す pure 関数）──

/** 指定 id を削除マークする（同じ id の hide は重複させない）。 */
export function withHide(edits: ElevationEdit[] | undefined, targetId: string): ElevationEdit[] {
  const cur = edits ?? [];
  if (cur.some((e) => e.op === 'hide' && e.targetId === targetId)) return cur;
  return [...cur, { op: 'hide', targetId }];
}

/** 移動量を加算する（既存の move があれば合成し、0 になったら取り除く）。 */
export function withMove(
  edits: ElevationEdit[] | undefined, targetId: string, dx: number, dy: number,
): ElevationEdit[] {
  const cur = edits ?? [];
  if (dx === 0 && dy === 0) return cur;
  const idx = cur.findIndex((e) => e.op === 'move' && e.targetId === targetId);
  if (idx < 0) return [...cur, { op: 'move', targetId, dx, dy }];
  const prev = cur[idx] as Extract<ElevationEdit, { op: 'move' }>;
  const next = { op: 'move' as const, targetId, dx: prev.dx + dx, dy: prev.dy + dy };
  const copy = [...cur];
  if (next.dx === 0 && next.dy === 0) copy.splice(idx, 1);
  else copy[idx] = next;
  return copy;
}

/** 文字を上書きする（同じ id の上書きは置換）。 */
export function withText(
  edits: ElevationEdit[] | undefined, targetId: string, text: string,
): ElevationEdit[] {
  const cur = (edits ?? []).filter((e) => !(e.op === 'text' && e.targetId === targetId));
  return [...cur, { op: 'text', targetId, text }];
}

/** プリミティブを追加する。 */
export function withAdd(
  edits: ElevationEdit[] | undefined, primitive: ElevationPrimitive,
): ElevationEdit[] {
  return [...(edits ?? []), { op: 'add', primitive }];
}

/**
 * 指定 id への編集をすべて取り消す（「元に戻す」）。
 * 追加プリミティブ自体もこれで消える。
 */
export function withoutEditsFor(
  edits: ElevationEdit[] | undefined, targetId: string,
): ElevationEdit[] {
  return (edits ?? []).filter((e) =>
    e.op === 'add' ? e.primitive.meta?.id !== targetId : e.targetId !== targetId);
}

/** その id に何らかの編集が入っているか（バッジ表示用）。 */
export function hasEditFor(edits: ElevationEdit[] | undefined, targetId: string): boolean {
  return (edits ?? []).some((e) =>
    e.op === 'add' ? e.primitive.meta?.id === targetId : e.targetId === targetId);
}

/** 追加プリミティブ用の id を採番する（既存と衝突しない連番）。 */
export function nextAddId(view: ElevationView, kindHint: string): string {
  const used = new Set<string>();
  for (const p of view.primitives) if (p.meta?.id) used.add(p.meta.id);
  for (const e of view.edits ?? []) if (e.op === 'add' && e.primitive.meta?.id) used.add(e.primitive.meta.id);
  let n = 1;
  while (used.has(`add:${kindHint}:${n}`)) n++;
  return `add:${kindHint}:${n}`;
}
