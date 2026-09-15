// ============================================================
// 本番の不具合: 「躯体ボタンを押すと、一階のボタンが画面から消えてしまいます」
//
// ■ 実際の原因
// 躯体・足場の下メニューは `fixed bottom-20` で**下端を固定して上へ伸びる**。
// 躯体は項目が 8 つ（建物1F / 上の階を追加 / 障害物 / 高さ / 棟 / 屋根 / 敷地 / 下図）
// あり、狭い画面では 1 行 2 個 × 4 行になる。メニューの高さ（452px）＋下の余白（80px）が
// 表示領域を超えると**上の行が画面の外へ出る**。「建物1F」は 1 番目＝最上行の左端なので
// 真っ先に消える。
//
// 高さの上限とスクロールが無かったことが原因なので、両方を入れた。
// ここでは「どの画面でも上端が画面内に残る」ことを計算で固定する。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { POPOVER_MENU_CLASS, POPOVER_MENU_STYLE } from '../ModeToolbar';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const toolbar = read('components/toolbar/ModeToolbar.tsx');

// CSS から読み取った実寸（p-4=16 / gap-3=12 / w-24,h-24=96 / bottom-20=80 / 上限の余白=96）
const PAD = 16, GAP = 12, BTN = 96, BOTTOM = 80, MAXW = 32, CAP = 96;

/** そのメニューが画面のどこに出るか。cap=false は直す前の状態。 */
function layout(vw: number, vh: number, items: number, cap = true) {
  const innerMax = vw - MAXW - PAD * 2;
  const perRow = Math.max(1, Math.floor((innerMax + GAP) / (BTN + GAP)));
  const rows = Math.ceil(items / perRow);
  let h = PAD * 2 + rows * BTN + (rows - 1) * GAP;
  const maxH = vh - CAP;
  const scrolls = cap && h > maxH;
  if (cap) h = Math.min(h, maxH);
  return { perRow, rows, height: h, top: vh - BOTTOM - h, scrolls };
}

/** 実際に使われる端末（幅 × ブラウザの表示領域の高さ）。 */
const DEVICES: [string, number, number][] = [
  ['iPhone SE', 375, 527],
  ['iPhone 12 mini', 375, 672],
  ['iPhone 14', 390, 704],
  ['iPhone 14 横', 844, 290],
  ['Android 標準', 360, 660],
  ['Android 小型', 360, 500],
  ['iPad mini 縦', 744, 1013],
  ['iPad 横', 1024, 648],
  ['PC 1280x800', 1280, 800],
  ['PC 縦に縮めた', 1280, 500],
];

// ============================================================
describe('不具合の再現 — 高さの上限が無いと上の行が画面の外へ出る', () => {
  it('躯体メニューは 8 項目ある', () => {
    const block = toolbar.slice(toolbar.indexOf('{showKutaiMenu &&'), toolbar.indexOf('{/* 足場メニュー'));
    const labels = block.match(/text-sm font-bold">([^<]*)</g) ?? [];
    expect(labels).toHaveLength(8);
  });

  it('狭い画面では 4 行になり、上限が無いと上端が画面の外（負）になる', () => {
    const before = layout(375, 527, 8, false);
    expect(before.rows).toBe(4);
    expect(before.top).toBeLessThan(0);      // ← これが起きていた
  });

  it('上限が無いと複数の端末で起きる（報告と一致）', () => {
    const ng = DEVICES.filter(([, w, h]) => layout(w, h, 8, false).top < 0);
    expect(ng.length).toBeGreaterThan(0);
    expect(ng.map(([n]) => n)).toContain('iPhone SE');
  });

  it('消えるのは 1 番目のボタン＝「建物1F」（最上行の左端）', () => {
    const block = toolbar.slice(toolbar.indexOf('{showKutaiMenu &&'));
    const first = (block.match(/text-sm font-bold">([^<]*)</) ?? [])[1];
    expect(first).toBe('建物1F');
  });
});

// ============================================================
describe('直したあと — どの画面でも上端が画面内に残る', () => {
  it.each(DEVICES)('%s (%ix%i)', (_name, w, h) => {
    expect(layout(w, h, 8).top).toBeGreaterThanOrEqual(0);
  });

  it('極端に低い画面でも収まる', () => {
    for (const vh of [200, 300, 360, 420]) {
      expect(layout(360, vh, 8).top, `vh=${vh}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('項目が今後増えても収まる（12 個でも）', () => {
    for (const [name, w, h] of DEVICES) {
      expect(layout(w, h, 12).top, name).toBeGreaterThanOrEqual(0);
    }
  });

  it('収まらないぶんはスクロールで見せる（切り捨てない）', () => {
    expect(layout(375, 527, 8).scrolls).toBe(true);
    expect(POPOVER_MENU_CLASS).toContain('overflow-y-auto');
  });

  it('余裕がある画面では今までどおり（スクロールを出さない）', () => {
    expect(layout(1280, 800, 8).scrolls).toBe(false);
    expect(layout(390, 704, 8).top).toBe(layout(390, 704, 8, false).top);
  });
});

// ============================================================
describe('指定の中身', () => {
  it('高さの上限がある', () => {
    expect(POPOVER_MENU_CLASS).toContain('max-h-[calc(100vh-96px)]');
  });

  it('実際に見えている高さ（dvh）を優先する', () => {
    // iOS はアドレスバーぶん 100vh が実際より大きく、それだけでは上限が甘い
    expect(POPOVER_MENU_STYLE.maxHeight).toBe('calc(100dvh - 96px)');
  });

  it('dvh に対応していない環境でも効く（class 側が残る）', () => {
    expect(POPOVER_MENU_CLASS).toMatch(/max-h-\[calc\(100vh-96px\)\]/);
  });

  it('幅の上限は従来どおり', () => {
    expect(POPOVER_MENU_CLASS).toContain('max-w-[calc(100vw-32px)]');
  });

  it('位置と見た目は従来どおり（対象外は変えない）', () => {
    for (const c of ['fixed', 'bottom-20', 'left-1/2', '-translate-x-1/2', 'z-50',
      'bg-dark-surface', 'rounded-2xl', 'shadow-2xl', 'p-4', 'flex', 'gap-3', 'flex-wrap']) {
      expect(POPOVER_MENU_CLASS, c).toContain(c);
    }
  });
});

// ============================================================
describe('躯体と足場で同じ指定を使う（片方だけ直らない、が起きない）', () => {
  it('2 つのメニューとも同じ定数を通る', () => {
    expect((toolbar.match(/className=\{POPOVER_MENU_CLASS\} style=\{POPOVER_MENU_STYLE\}/g) ?? []))
      .toHaveLength(2);
  });

  it('直書きの指定が残っていない（定数の 1 か所だけ）', () => {
    const occurrences = toolbar.match(/fixed bottom-20 left-1\/2 -translate-x-1\/2 z-50 bg-dark-surface/g) ?? [];
    expect(occurrences).toHaveLength(1);   // 定数の定義のみ
    expect(toolbar).toMatch(/export const POPOVER_MENU_CLASS =/);
  });
});
