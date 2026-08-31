// ============================================================
// U-1 commit 2: 下図の画像の保存と表示。
//
// 画像の読み込み・表示そのものはブラウザの API（createImageBitmap / Image /
// URL.createObjectURL / Supabase Storage）を使うため node では検証できない。
// ここで押さえるのは **node で確かめられる骨組み**:
//   ・Blob URL の帳簿（どれを取っておき、どれを解放するか）
//   ・保存する場所（パスの組み立て）
//   ・レイヤーの置き場所と、読めなかったときに画面を壊さない作り（ソース走査）
// 実際の見え方・アップロード・出力は実機確認に回す。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { LruCache, UNDERLAY_CACHE_SIZE } from '../imageCache';
import {
  underlayDrawingPrefix, underlayExtFor, underlayProjectPrefix, underlayStoragePath,
} from '@/lib/konva/underlay';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

/** 捨てられたものを記録する入れ物（revokeObjectURL の代わり）。 */
const makeCache = (cap = 3) => {
  const evicted: string[] = [];
  const c = new LruCache<string>(cap, (k) => { evicted.push(k); });
  return { c, evicted };
};

// ============================================================
describe('Blob URL の帳簿 — 使い回しと解放', () => {
  it('入れたものを取り出せる', () => {
    const { c } = makeCache();
    c.set('a', 'url-a');
    expect(c.get('a')).toBe('url-a');
  });

  it('無いものは undefined', () => {
    const { c } = makeCache();
    expect(c.get('nope')).toBeUndefined();
  });

  it('あふれたら古いものから捨て、そのとき解放される', () => {
    const { c, evicted } = makeCache(3);
    c.set('a', 'ua'); c.set('b', 'ub'); c.set('c', 'uc');
    expect(evicted).toEqual([]);
    c.set('d', 'ud');
    expect(evicted).toEqual(['a']);          // いちばん古い a が解放された
    expect(c.keys()).toEqual(['b', 'c', 'd']);
  });

  it('使ったものは新しい扱いになる（行き来しても捨てられない）', () => {
    const { c, evicted } = makeCache(3);
    c.set('a', 'ua'); c.set('b', 'ub'); c.set('c', 'uc');
    c.get('a');                               // a をもう一度使った
    c.set('d', 'ud');
    expect(evicted).toEqual(['b']);          // 捨てられるのは a ではなく b
    expect(c.get('a')).toBe('ua');
  });

  it('同じキーに入れ直すと、古い方が解放される（画像の差し替え）', () => {
    const { c, evicted } = makeCache();
    c.set('a', 'ua');
    c.set('a', 'ua2');
    expect(evicted).toEqual(['a']);
    expect(c.get('a')).toBe('ua2');
    expect(c.size).toBe(1);
  });

  it('同じ値を入れ直しても解放しない（使っている URL を落とさない）', () => {
    const { c, evicted } = makeCache();
    c.set('a', 'ua');
    c.set('a', 'ua');
    expect(evicted).toEqual([]);
  });

  it('1 つ捨てられる', () => {
    const { c, evicted } = makeCache();
    c.set('a', 'ua'); c.set('b', 'ub');
    c.delete('a');
    expect(evicted).toEqual(['a']);
    expect(c.keys()).toEqual(['b']);
  });

  it('無いものを捨てても何も起きない', () => {
    const { c, evicted } = makeCache();
    c.delete('nope');
    expect(evicted).toEqual([]);
  });

  it('全部捨てると全部解放される（作図画面を離れるとき）', () => {
    const { c, evicted } = makeCache();
    c.set('a', 'ua'); c.set('b', 'ub'); c.set('c', 'uc');
    c.clear();
    expect(evicted.sort()).toEqual(['a', 'b', 'c']);
    expect(c.size).toBe(0);
  });

  it('捨てられた枚数だけ解放される（漏れも二重解放も無い）', () => {
    const { c, evicted } = makeCache(2);
    for (const k of ['a', 'b', 'c', 'd', 'e']) c.set(k, `u-${k}`);
    c.clear();
    // 5 枚入れて 2 枚だけ残る → 解放は 5 回（あふれ 3 ＋ 最後の 2）
    expect(evicted).toHaveLength(5);
    expect(new Set(evicted).size).toBe(5);
  });

  it('取っておく枚数（ページを行き来しても取り直さない程度）', () => {
    expect(UNDERLAY_CACHE_SIZE).toBe(3);
  });
});

// ============================================================
describe('保存する場所', () => {
  it('パスは 物件 / ページ / 画像 の 3 段', () => {
    expect(underlayStoragePath('p1', 'd1', 'x1', 'jpg')).toBe('p1/d1/x1.jpg');
  });

  it('先頭が物件（RLS が projects へ問い合わせて持ち主を見る）', () => {
    expect(underlayStoragePath('p1', 'd1', 'x1', 'jpg').split('/')[0]).toBe('p1');
  });

  it('物件・ページごとに一括で消せる', () => {
    expect(underlayProjectPrefix('p1')).toBe('p1');
    expect(underlayDrawingPrefix('p1', 'd1')).toBe('p1/d1');
    expect(underlayStoragePath('p1', 'd1', 'x1', 'jpg').startsWith(underlayProjectPrefix('p1')))
      .toBe(true);
  });

  it('JPEG と PNG だけ受ける', () => {
    expect(underlayExtFor('image/jpeg')).toBe('jpg');
    expect(underlayExtFor('image/png')).toBe('png');
    expect(underlayExtFor('application/pdf')).toBeNull();
    expect(underlayExtFor('image/gif')).toBeNull();
  });
});

// ============================================================
describe('Blob URL の作り所と解放（ソースで固定）', () => {
  const img = read('lib/underlay/underlayImage.ts');
  const store = read('lib/underlay/underlayStorage.ts');

  it('公開 URL も署名 URL も使わない', () => {
    expect(store).not.toMatch(/getPublicUrl|createSignedUrl/);
  });

  it('認証つきでダウンロードして Blob URL を作る', () => {
    expect(store).toMatch(/\.download\(storagePath\)/);
    expect(store).toMatch(/URL\.createObjectURL\(data\)/);
  });

  it('作るのは 1 か所だけ', () => {
    expect((store.match(/URL\.createObjectURL/g) ?? [])).toHaveLength(1);
    expect(img).not.toMatch(/URL\.createObjectURL/);
  });

  it('あふれたら解放する', () => {
    expect(img).toMatch(/new LruCache<Loaded>\(UNDERLAY_CACHE_SIZE, \(_key, v\) => \{\s*URL\.revokeObjectURL\(v\.url\);/);
  });

  it('読めなかった URL もその場で解放する（帳簿に載らず誰も解放しないため）', () => {
    expect(img).toMatch(/catch \(e\) \{[^]*?URL\.revokeObjectURL\(url\);[^]*?throw e;/);
  });

  it('全部解放する出口がある（作図画面を離れるとき）', () => {
    expect(img).toMatch(/export const clearUnderlayImages = \(\): void => cache\.clear\(\);/);
  });

  it('差し替えのために 1 枚だけ捨てられる', () => {
    expect(img).toMatch(/export const forgetUnderlayImage/);
  });

  it('同じパスを二重にダウンロードしない', () => {
    expect(img).toMatch(/const inflight = new Map<string, Promise<HTMLImageElement>>\(\);/);
    expect(img).toMatch(/const running = inflight\.get\(storagePath\);\s*if \(running\) return running;/);
  });
});

// ============================================================
describe('出力のときに読み込みが間に合わない件', () => {
  const img = read('lib/underlay/underlayImage.ts');

  it('出力の直前に待てる出口がある', () => {
    expect(img).toMatch(/export async function whenUnderlayReady/);
  });

  it('下図が無ければ何もしない', () => {
    expect(img).toMatch(/if \(!storagePath\) return;/);
  });

  it('読めなくても投げない（背景なしで出力は通す）', () => {
    expect(img).toMatch(/await loadUnderlayImage\(storagePath\);\s*\} catch \{/);
  });
});

// ============================================================
describe('縮小はアップロードの前に行う', () => {
  const store = read('lib/underlay/underlayStorage.ts');

  it('ブラウザ側で縮めてから上げる', () => {
    expect(store).toMatch(/export async function prepareUnderlayImage/);
    expect(store).toMatch(/canvas\.toBlob/);
    // upload に渡すのは縮めたあとの blob
    expect(store).toMatch(/\.upload\(path, prepared\.blob/);
  });

  it('上限を超えるファイルは受けない', () => {
    expect(store).toMatch(/if \(file\.size > UNDERLAY_MAX_BYTES\)/);
  });

  it('JPEG / PNG 以外は受けない', () => {
    expect(store).toMatch(/if \(!underlayExtFor\(file\.type\)\)/);
  });

  it('上限以下ならそのまま上げる（無駄な再圧縮をしない）', () => {
    expect(store).toMatch(/if \(!fit\.scaled\) \{[^]*?return \{ blob: file/);
  });
});

// ============================================================
describe('レイヤーの置き場所と、壊れない作り', () => {
  const layer = read('components/canvas/UnderlayLayer.tsx');
  const grid = read('components/canvas/GridCanvas.tsx');

  it('背景色の上・グリッド線の下に描く', () => {
    // 背景 Rect → 下図 → グリッド線 の順
    const i = grid.indexOf('<UnderlayLayer />');
    expect(i).toBeGreaterThan(grid.indexOf('fill={colorCanvasBg} />'));
    expect(i).toBeLessThan(grid.indexOf('{gridLines()}'));
  });

  it('建物・足場より背面', () => {
    expect(grid.indexOf('<UnderlayLayer />')).toBeLessThan(grid.indexOf('<BuildingLayer />'));
    expect(grid.indexOf('<UnderlayLayer />')).toBeLessThan(grid.indexOf('<AidLayer />'));
  });

  it('レイヤーを増やしていない（静的な層は 1 canvas に統合されている）', () => {
    expect(layer).not.toMatch(/<Layer/);
  });

  it('出力で隠せるよう名前が付いている', () => {
    expect(layer).toMatch(/export const UNDERLAY_GROUP_NAME = 'underlay-group';/);
    expect(layer).toMatch(/name=\{UNDERLAY_GROUP_NAME\}/);
  });

  it('下図が無ければ何も描かない（既存の図面はノードが増えない）', () => {
    // U-1 commit 4 で「隠す」はノードを外さず visible で切るようにした
    //   （外すと出力側から出せなくなるため）。描かない条件そのものは不変。
    expect(layer).toMatch(/if \(!underlay \|\| !image\) return null;/);
  });

  it('読めなくても画面を壊さない（背景を出さないだけ）', () => {
    expect(layer).toMatch(/\.catch\(\(\) => \{[^]*?setImage\(null\); setUnderlayStatus\('error'\);/);
  });

  it('取ってあれば最初の描画から出す（ページを戻ってちらつかない）', () => {
    expect(layer).toMatch(/useState<HTMLImageElement \| null>\(\s*\(\) => \(path \? getCachedUnderlayImage\(path\) : null\),/);
  });

  it('合わせ込みの値を丸めずに画面へ乗せる', () => {
    expect(layer).toMatch(/x=\{t\.originGrid\.x \* gridPx \+ panX\}/);
    expect(layer).toMatch(/rotation=\{t\.rotationDeg\}/);
    expect(layer).not.toMatch(/Math\.round|toFixed/);
  });

  it('濃さが効く', () => {
    expect(layer).toMatch(/opacity=\{underlay\.opacity\}/);
  });

  it('取得の状態は保存データ（CanvasData）に入れない', () => {
    // 図面データではないので型に入れない＝履歴の複製にも保存 JSON にも乗らない
    expect(read('types/index.ts')).not.toMatch(/underlayStatus/);
    // ストアの最上位に置く
    expect(read('stores/canvasStore.ts')).toMatch(/^  underlayStatus: 'idle',$/m);
  });
});

// ============================================================
describe('Storage のポリシー（migration として残す）', () => {
  const sql = read('lib/supabase/migrations/0011_add_underlay_storage_policies.sql');

  it('4 つの操作すべてにポリシーがある', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql, op).toMatch(new RegExp(`for ${op} to authenticated`));
    }
  });

  it('物件の持ち主だけ（owner_id で判定）', () => {
    expect((sql.match(/select id::text from projects where owner_id = auth\.uid\(\)/g) ?? []))
      .toHaveLength(4);
  });

  it('パスの 1 段目（物件 ID）で判定する', () => {
    expect((sql.match(/\(storage\.foldername\(name\)\)\[1\]/g) ?? [])).toHaveLength(4);
  });

  it('このバケットだけに効く（他のバケットへ及ばない）', () => {
    expect((sql.match(/bucket_id = 'underlays'/g) ?? [])).toHaveLength(4);
  });

  it('作り直せる（同名があれば落としてから作る）', () => {
    expect((sql.match(/drop policy if exists/g) ?? [])).toHaveLength(4);
  });

  it('物件削除の順序が書いてある（逆にすると孤児が確実に出る）', () => {
    expect(sql).toMatch(/① Storage の画像を消す → ② drawings と projects の行を消す/);
  });
});
