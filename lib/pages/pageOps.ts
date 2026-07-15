// ============================================================
// ページ(シート)操作の pure ロジック（E-6a）。
// 1 物件 = 複数 drawing 行。タブ = drawing。ここでは DB I/O を持たず、
// 並び順・命名・削除可否・削除後アクティブ選択だけを純粋関数として切り出す（テスト対象）。
// ページ名は drawings.title を流用、表示順は created_at 昇順（sort_order 列は E-6a では未使用）。
// ============================================================

export type PageMeta = { id: string; title: string; created_at: string };

/** created_at 昇順にページを並べる（同時刻は id で安定化）。元配列は変更しない。 */
export function sortPages<T extends PageMeta>(pages: T[]): T[] {
  return [...pages].sort((a, b) => {
    const t = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

/** 新規空ページのタイトル「ページN」。既存タイトルと衝突しない最小 N（N は件数+1 から探索）。 */
export function nextPageTitle(pages: PageMeta[]): string {
  const titles = new Set(pages.map((p) => p.title));
  let n = pages.length + 1;
  while (titles.has(`ページ${n}`)) n++;
  return `ページ${n}`;
}

/** 複製ページのタイトル「<元> のコピー」。衝突時は連番（… のコピー 2, 3 …）。 */
export function duplicateTitle(sourceTitle: string, pages: PageMeta[]): string {
  const titles = new Set(pages.map((p) => p.title));
  const base = `${sourceTitle} のコピー`;
  if (!titles.has(base)) return base;
  let n = 2;
  while (titles.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** 最後の 1 ページは削除不可。 */
export function canDeletePage(pages: PageMeta[]): boolean {
  return pages.length > 1;
}

/**
 * 削除後にアクティブにすべきページ id を返す。
 * - 削除対象がアクティブでなければアクティブ据え置き。
 * - アクティブを削除する場合は並び順で直前（無ければ直後=先頭）を選ぶ。
 * - 残りが無ければ null（呼び出し側は canDeletePage で事前ガード）。
 */
export function nextActiveAfterDelete(pages: PageMeta[], deletedId: string, activeId: string): string | null {
  if (deletedId !== activeId) return activeId;
  const sorted = sortPages(pages);
  const idx = sorted.findIndex((p) => p.id === deletedId);
  if (idx === -1) return activeId;
  const remaining = sorted.filter((p) => p.id !== deletedId);
  if (remaining.length === 0) return null;
  const prev = sorted[idx - 1];
  return prev ? prev.id : remaining[0].id;
}
