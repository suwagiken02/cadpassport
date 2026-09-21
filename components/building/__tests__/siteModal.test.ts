// ============================================================
// S-4 (commit 1): 敷地の入口をひとつにまとめる。
//
// 躯体メニューのボタンは「敷地」ひとつ。押すとモーダルで
//   ・手で描く（方向入力を敷地として起動・S-1）
//   ・自動生成（建物の外周から一定距離・S-3）
// を選ばせる。**どちらを選んだあとの流れは 1 ミリも変えていない**ので、
// ここでは「起動の中身が移設前と同じであること」を押さえる。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { SITE_AUTO_DEFAULT_MM, SITE_AUTO_PRESET_MM } from '@/lib/konva/siteAutoGenerate';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const toolbar = read('components/toolbar/ModeToolbar.tsx');
const modal = read('components/building/SiteModal.tsx');
const editor = read('app/editor/[id]/page.tsx');

beforeEach(() => {
  useCanvasStore.setState({ showSiteModal: false });
});

// ============================================================
describe('入口はひとつ（躯体メニューの「敷地」）', () => {
  it('「敷地」ボタンがある', () => {
    expect(toolbar).toMatch(/<span className="text-sm font-bold">敷地<\/span>/);
  });

  it('「敷地自動」ボタンは無くなっている（2 つ並べない）', () => {
    expect(toolbar).not.toContain('敷地自動');
    expect((toolbar.match(/>敷地<\/span>/g) ?? [])).toHaveLength(1);
  });

  it('押すとモーダルを開くだけ（ここでは描画モードに入らない）', () => {
    const btn = toolbar.slice(toolbar.indexOf('kutai-site'), toolbar.indexOf('敷地</span>'));
    expect(btn).toMatch(/setShowSiteModal\(true\)/);
    expect(btn).not.toMatch(/setMode\(|setBuildingInputMethod\(|setPendingTargetType\(/);
  });

  it('モーダルが画面に置かれている', () => {
    expect(editor).toMatch(/<SiteModal \/>/);
    expect(editor).toMatch(/import SiteModal from '@\/components\/building\/SiteModal'/);
  });

  it('屋根・障害物など他の入口は従来のまま', () => {
    expect(toolbar).toMatch(/setPendingTargetType\('roof'\)/);
    expect(toolbar).toMatch(/<span className="text-sm font-bold">屋根<\/span>/);
    expect(toolbar).toMatch(/<span className="text-sm font-bold">障害物<\/span>/);
  });
});

// ============================================================
describe('選択画面（手で描く／自動生成）', () => {
  it('2 つの選択肢が出る', () => {
    expect(modal).toMatch(/手で描く/);
    expect(modal).toMatch(/自動生成/);
    expect(modal).toMatch(/data-tutorial-id="site-draw"/);
    expect(modal).toMatch(/data-tutorial-id="site-auto"/);
  });

  it('「手で描く」は S-1 の起動そのもの（4 つを同じ順で呼ぶ）', () => {
    const draw = modal.slice(modal.indexOf('const startDrawing'), modal.indexOf('const generate'));
    expect(draw).toMatch(/setPendingTargetType\('site'\)[^]*?setBuildingInputMethod\('direction'\)[^]*?setMode\('building'\)[^]*?clearDirectionPoints\(\)/);
  });

  it('「手で描く」は対象階を訊かない（敷地は階を持たない）', () => {
    expect(modal).not.toMatch(/promptFloorIfMulti|setFloorPromptTool/);
  });

  it('「自動生成」を選ぶと距離の画面へ進む（すぐには作らない）', () => {
    const auto = modal.slice(modal.indexOf('data-tutorial-id="site-auto"'), modal.indexOf('キャンセル'));
    expect(auto).toMatch(/setStep\('auto'\)/);
    expect(auto).not.toMatch(/generateSitePolygons/);
  });

  it('開くたびに選択画面から始まる', () => {
    expect(modal).toMatch(/if \(show\) setStep\('choose'\)/);
  });
});

// ============================================================
describe('自動生成の画面（S-3 から変えていない）', () => {
  it('既定は 1m', () => {
    expect(modal).toMatch(/useState\(SITE_AUTO_DEFAULT_MM\)/);
    expect(SITE_AUTO_DEFAULT_MM).toBe(1000);
  });

  it('距離プリセットと数値入力の両方がある', () => {
    expect(modal).toMatch(/SITE_AUTO_PRESET_MM\.map/);
    expect(modal).toMatch(/<NumInput value=\{distanceMm\}/);
    expect(SITE_AUTO_PRESET_MM).toEqual([500, 1000, 1500, 2000]);
  });

  it('プリセットは方向入力の距離プリセットと同じ作法', () => {
    expect(modal).toMatch(/SITE_AUTO_PRESET_MM\.map[^]*?rounded text-xs font-mono border/);
  });

  it('生成はストアの 1 本を呼ぶだけ（ここで幾何を組み立てない）', () => {
    expect(modal).toMatch(/s\.generateSitePolygons\(distanceMm\)/);
    expect(modal).not.toMatch(/buildingsSitePolygons|addSitePolygon/);
  });

  it('建物が無いときは押せない', () => {
    expect(modal).toMatch(/disabled=\{buildingCount === 0\}/);
    expect(modal).toMatch(/建物がまだありません/);
  });

  it('置き換えではなく増えることを画面で伝える', () => {
    expect(modal).toMatch(/いまある敷地は消えません/);
  });

  it('選択画面へ戻れる', () => {
    expect(modal).toMatch(/setStep\('choose'\)[^]*?戻る/);
  });
});

// ============================================================
describe('モーダルの開閉', () => {
  it('ストアの旗で開く', () => {
    expect(useCanvasStore.getState().showSiteModal).toBe(false);
    useCanvasStore.getState().setShowSiteModal(true);
    expect(useCanvasStore.getState().showSiteModal).toBe(true);
  });

  it('閉じられる', () => {
    useCanvasStore.getState().setShowSiteModal(true);
    useCanvasStore.getState().setShowSiteModal(false);
    expect(useCanvasStore.getState().showSiteModal).toBe(false);
  });

  it('旗が立っていなければ何も描かない', () => {
    expect(modal).toMatch(/if \(!show\) return null;/);
  });
});

// ============================================================
describe('S-10: 文言が実態を表している（数値で入力できることが読み取れる）', () => {
  // 有料のお客様から「敷地数字を直接入力したい」という要望が来た。
  // 調べると**距離の mm 入力も角度の指定も最初からできていた**が、
  // 「手で描く／キャラを方向で動かして外形を描く」という文言からは
  // 数値で入力できることが 1 ミリも読み取れなかった。機能ではなく文言の問題。
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../components/building/SiteModal.tsx'), 'utf8');

  it('「寸法を入力」と書いてある', () => {
    expect(src).toContain('寸法を入力して描く');
  });

  it('mm で 1 辺ずつ入れることが書いてある', () => {
    expect(src).toMatch(/測量図の辺の長さ\(mm\)を1辺ずつ入力/);
  });

  it('★ 斜めの辺に角度を指定できることが書いてある（敷地だけの強み）', () => {
    expect(src).toMatch(/斜めの辺は角度も指定できます/);
  });

  it('「手で描く」という誤解を招く言い方をやめている', () => {
    // コメントには経緯として残してあるので、**画面に出る文言だけ**を見る。
    const jsx = src.slice(src.indexOf('<h2 className="font-bold text-lg">敷地境界線'));
    expect(jsx).not.toContain('手で描く');
    expect(jsx).not.toContain('キャラを方向で動かして外形を描く');
  });

  it('自動生成の側も、数値を入れることが読み取れる（対比が成立する）', () => {
    expect(src).toContain('建物から自動で作る');
    expect(src).toMatch(/外壁からの距離\(mm\)を1つ入力/);
  });

  it('見出しで「どちらも数値」と分かる', () => {
    expect(src).toContain('どちらも数値で入力して作ります。');
  });

  it('起動する処理は変えていない（文言だけの変更）', () => {
    expect(src).toMatch(/s\.setPendingTargetType\('site'\)/);
    expect(src).toMatch(/s\.setBuildingInputMethod\('direction'\)/);
    expect(src).toMatch(/s\.setMode\('building'\)/);
  });

  it('入口の数は 2 つのまま（カードを増やしていない）', () => {
    expect((src.match(/data-tutorial-id="site-(draw|auto)"/g) ?? [])).toHaveLength(2);
  });
});
