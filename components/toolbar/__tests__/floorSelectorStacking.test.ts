// ============================================================
// 階セレクタが暗幕に覆われて押せない件。
//
// ■ 原因
// 躯体・足場のメニューを開くと `fixed inset-0 bg-black/30 z-40` の暗幕が出るが、
// 階セレクタは z-30 だった。暗幕が上に乗るため暗く沈み、押しても暗幕が反応して
// メニューが閉じるだけ（階は変わらない）。
//
// ■ なぜ直すべきか
// 躯体メニューの項目（建物1F / 上の階を追加 / 高さ / 棟 / 屋根）は**どれも階に
// 依存する**。メニューを開いている間こそ階を変えたい。
// コードにも「隅の FloorSelector は気づきにくく、1F のまま 2F の屋根/高さを作る
// 誤爆が起きていた」と残っており、実際の事故がある箇所。
//
// ■ 直し方
//   暗幕 z-40 ＜ 階セレクタ z-45 ＜ メニュー本体 z-50
// 役割の順番をそのまま z の順番にする。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const floorSelector = read('components/toolbar/FloorSelector.tsx');
const toolbar = read('components/toolbar/ModeToolbar.tsx');
const settingsPanel = read('components/toolbar/SettingsPanel.tsx');

/** className から z の値を読む（z-30 / z-[45] の両方の書き方に対応）。 */
function zOf(src: string, marker: string): number | null {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const around = src.slice(i, i + 400);
  const m = around.match(/\bz-\[?(\d+)\]?/);
  return m ? Number(m[1]) : null;
}

const Z_SCRIM = zOf(toolbar, 'fixed inset-0 bg-black/30');
const Z_MENU = zOf(toolbar, 'POPOVER_MENU_CLASS =');
const Z_FLOOR = zOf(floorSelector, 'fixed top-2 left-1/2');

// ============================================================
describe('重なりの順', () => {
  it('値が読み取れている（テストの前提）', () => {
    expect(Z_SCRIM).not.toBeNull();
    expect(Z_MENU).not.toBeNull();
    expect(Z_FLOOR).not.toBeNull();
  });

  it('暗幕は z-40', () => {
    expect(Z_SCRIM).toBe(40);
  });

  it('メニュー本体は z-50', () => {
    expect(Z_MENU).toBe(50);
  });

  it('階セレクタは暗幕より上（覆われない）', () => {
    expect(Z_FLOOR!).toBeGreaterThan(Z_SCRIM!);
  });

  it('階セレクタはメニュー本体より下（メニューを隠さない）', () => {
    expect(Z_FLOOR!).toBeLessThan(Z_MENU!);
  });

  it('暗幕 ＜ 階セレクタ ＜ メニュー の順になっている', () => {
    expect([Z_SCRIM, Z_FLOOR, Z_MENU]).toEqual([40, 45, 50]);
  });
});

// ============================================================
describe('足場メニューと設定パネルの暗幕でも同じ', () => {
  it('躯体と足場の暗幕は同じ z（片方だけ覆われない）', () => {
    const scrims = toolbar.match(/fixed inset-0 bg-black\/30 z-40/g) ?? [];
    expect(scrims).toHaveLength(2);   // 躯体 + 足場
  });

  it('設定パネル（狭い画面）の暗幕も z-40 なので同じく上に出る', () => {
    expect(settingsPanel).toMatch(/fixed inset-0 bg-black\/30 z-40 sm:hidden/);
    expect(Z_FLOOR!).toBeGreaterThan(40);
  });
});

// ============================================================
describe('挙動を変えていないこと', () => {
  it('暗幕をクリックしたらメニューが閉じる（従来どおり）', () => {
    expect(toolbar).toMatch(/onClick=\{\(\) => setShowKutaiMenu\(false\)\}/);
    expect(toolbar).toMatch(/onClick=\{\(\) => setShowAshibaMenu\(false\)\}/);
  });

  it('階を切り替えてもメニューは閉じない（閉じる処理を足していない）', () => {
    const onClick = floorSelector.slice(
      floorSelector.indexOf('onClick={() => setActiveFloor(f)}'),
      floorSelector.indexOf('onClick={() => setActiveFloor(f)}') + 60,
    );
    expect(onClick).toContain('setActiveFloor(f)');
    expect(floorSelector).not.toMatch(/setShowKutaiMenu|setShowAshibaMenu/);
  });

  it('表示の条件は従来どおり（2 階以上のときだけ出す）', () => {
    expect(floorSelector).toMatch(/if \(maxFloor < 2\) return null;/);
  });

  it('位置と見た目は 1 ミリも変えていない', () => {
    for (const c of ['fixed', 'top-2', 'left-1/2', '-translate-x-1/2',
      'bg-dark-surface', 'border', 'rounded-xl', 'shadow-2xl', 'px-1.5', 'py-1', 'flex', 'gap-1']) {
      expect(floorSelector, c).toContain(c);
    }
  });

  it('モーダル（z-50）が開いている間は従来どおり下に隠れる', () => {
    // 建物モーダルなどは z-50。触らせない方が正しいので、上に出してはいけない
    expect(Z_FLOOR!).toBeLessThan(50);
  });
});
