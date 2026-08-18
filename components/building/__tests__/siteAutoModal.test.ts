// ============================================================
// S-3 (commit 2): 敷地の自動生成の入口。
//
// 入口は躯体メニューの「敷地」の隣。押すと距離を訊く小さいモーダルが開き、
// そこから generateSitePolygons を 1 回呼ぶだけ。生成の中身は
// lib/konva/siteAutoGenerate.ts（pure）とストアのテストで押さえてある。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { SITE_AUTO_DEFAULT_MM, SITE_AUTO_PRESET_MM } from '@/lib/konva/siteAutoGenerate';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const toolbar = read('components/toolbar/ModeToolbar.tsx');
const modal = read('components/building/SiteAutoModal.tsx');
const editor = read('app/editor/[id]/page.tsx');

beforeEach(() => {
  useCanvasStore.setState({ showSiteAutoModal: false });
});

describe('入口（躯体メニューの「敷地」の隣）', () => {
  it('「敷地自動」ボタンがある', () => {
    expect(toolbar).toMatch(/<span className="text-sm font-bold">敷地自動<\/span>/);
  });

  it('手描きの「敷地」の直後にある', () => {
    expect(toolbar).toMatch(/敷地<\/span>[^]*?敷地自動<\/span>/);
    // 「敷地」ボタン自体は S-2 までと同じ起動のまま
    expect(toolbar).toMatch(/setPendingTargetType\('site'\)/);
  });

  it('押すとモーダルを開くだけ（描画モードには入らない）', () => {
    const btn = toolbar.slice(toolbar.indexOf('kutai-site-auto'), toolbar.indexOf('敷地自動</span>'));
    expect(btn).toMatch(/setShowSiteAutoModal\(true\)/);
    expect(btn).not.toMatch(/setMode\(|setBuildingInputMethod\(|setPendingTargetType\(/);
  });

  it('モーダルが画面に置かれている', () => {
    expect(editor).toMatch(/<SiteAutoModal \/>/);
    expect(editor).toMatch(/import SiteAutoModal from '@\/components\/building\/SiteAutoModal'/);
  });
});

describe('モーダルの中身', () => {
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
    expect(modal).toMatch(/st\.generateSitePolygons\(distanceMm\)/);
    expect(modal).not.toMatch(/buildingsSitePolygons|addSitePolygon/);
  });

  it('建物が無いときは押せない', () => {
    expect(modal).toMatch(/disabled=\{buildingCount === 0\}/);
    expect(modal).toMatch(/建物がまだありません/);
  });

  it('置き換えではなく増えることを画面で伝える', () => {
    expect(modal).toMatch(/いまある敷地は消えません/);
  });
});

describe('モーダルの開閉', () => {
  it('ストアの旗で開く', () => {
    expect(useCanvasStore.getState().showSiteAutoModal).toBe(false);
    useCanvasStore.getState().setShowSiteAutoModal(true);
    expect(useCanvasStore.getState().showSiteAutoModal).toBe(true);
  });

  it('閉じられる', () => {
    useCanvasStore.getState().setShowSiteAutoModal(true);
    useCanvasStore.getState().setShowSiteAutoModal(false);
    expect(useCanvasStore.getState().showSiteAutoModal).toBe(false);
  });

  it('旗が立っていなければ何も描かない', () => {
    expect(modal).toMatch(/if \(!show\) return null;/);
  });
});
