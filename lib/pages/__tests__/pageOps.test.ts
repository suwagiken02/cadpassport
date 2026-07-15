import { describe, it, expect } from 'vitest';
import {
  sortPages,
  nextPageTitle,
  duplicateTitle,
  canDeletePage,
  nextActiveAfterDelete,
  type PageMeta,
} from '../pageOps';

const p = (id: string, title: string, created_at: string): PageMeta => ({ id, title, created_at });

// created_at 昇順を前提にした 3 ページ（A→B→C）。
const A = p('a', '平面図', '2026-01-01T00:00:00Z');
const B = p('b', 'ページ2', '2026-01-02T00:00:00Z');
const C = p('c', 'ページ3', '2026-01-03T00:00:00Z');

describe('sortPages', () => {
  it('created_at 昇順に並ぶ', () => {
    expect(sortPages([C, A, B]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('同時刻は id で安定化', () => {
    const x = p('y', 'x', '2026-01-01T00:00:00Z');
    const y = p('x', 'y', '2026-01-01T00:00:00Z');
    expect(sortPages([x, y]).map((v) => v.id)).toEqual(['x', 'y']);
  });
  it('元配列を破壊しない', () => {
    const arr = [C, A, B];
    sortPages(arr);
    expect(arr.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('nextPageTitle', () => {
  it('件数+1 の「ページN」', () => {
    expect(nextPageTitle([A, B, C])).toBe('ページ4');
  });
  it('衝突する番号はスキップ', () => {
    // 2 件だが「ページ3」が既にある → ページ3 は衝突、ページ4 でもなく…件数+1=3 から探索し 4 へ
    expect(nextPageTitle([A, p('z', 'ページ3', '2026-01-05T00:00:00Z')])).toBe('ページ4');
  });
  it('空リストは「ページ1」', () => {
    expect(nextPageTitle([])).toBe('ページ1');
  });
});

describe('duplicateTitle', () => {
  it('「<元> のコピー」', () => {
    expect(duplicateTitle('平面図', [A, B])).toBe('平面図 のコピー');
  });
  it('衝突時は連番', () => {
    const dup = p('d', '平面図 のコピー', '2026-01-04T00:00:00Z');
    expect(duplicateTitle('平面図', [A, dup])).toBe('平面図 のコピー 2');
  });
});

describe('canDeletePage', () => {
  it('2 ページ以上は削除可', () => {
    expect(canDeletePage([A, B])).toBe(true);
  });
  it('最後の 1 ページは削除不可', () => {
    expect(canDeletePage([A])).toBe(false);
  });
});

describe('nextActiveAfterDelete', () => {
  it('非アクティブを削除 → アクティブ据え置き', () => {
    expect(nextActiveAfterDelete([A, B, C], 'c', 'a')).toBe('a');
  });
  it('中間のアクティブを削除 → 直前', () => {
    expect(nextActiveAfterDelete([A, B, C], 'b', 'b')).toBe('a');
  });
  it('先頭のアクティブを削除 → 直後（先頭）', () => {
    expect(nextActiveAfterDelete([A, B, C], 'a', 'a')).toBe('b');
  });
  it('末尾のアクティブを削除 → 直前', () => {
    expect(nextActiveAfterDelete([A, B, C], 'c', 'c')).toBe('b');
  });
});
