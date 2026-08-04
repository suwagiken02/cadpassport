// ============================================================
// E-8-v3c-fix4: 立面パレットが平面部材と同等の UI であること（構造として固定）。
//
// 経緯: 「パレットの入口」を揃えた fix2/fix3 と同じで、条件付きにすると実機で消える。
// 姿図・角度・長さの 3 点が立面パレットから抜けたら落ちるようにソースを走査する。
// （DOM が無い環境なので、レンダリング構造を検査する）
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../../', p), 'utf8');
const PALETTE = read('components/elevation/ElevationPartPalette.tsx');
const PLANE = read('components/toolbar/PartSelector.tsx');

describe('立面パレットの構成（平面部材と同等）', () => {
  it('姿図プレビューを出す（実部材の primitives をそのまま描く）', () => {
    expect(PALETTE).toContain('ElevationPartPreview');
    expect(read('components/elevation/ElevationPartPreview.tsx')).toContain('partPreview');
  });

  it('姿図からも掴んで引き出せる（指の配置導線）', () => {
    expect(/<ElevationPartPreview[\s\S]*?onPointerDown=\{\(e\) => startDragOut\(/.test(PALETTE)).toBe(true);
  });

  it('角度 UI がある（プリセット・数値入力・微調整）', () => {
    expect(PALETTE).toContain('anglePresetsForNatural');
    expect(PALETTE).toContain('ANGLE_STEPS');
    expect(PALETTE).toContain('NumInput');
    expect(PALETTE).toContain('setElevationAddAngle');
  });

  it('角度は部材の属性として置かれる（配置時に angleDeg が渡る）', () => {
    expect(read('components/canvas/ElevationViewLayer.tsx')).toContain('angleDeg: addAngle');
  });

  it('角度プリセットは平面と同じ 1 箇所を読む（定義の二重持ちをしない）', () => {
    expect(PLANE).toContain("from '@/lib/konva/placement/anglePresets'");
    expect(/const ANGLE_PRESETS[^=]*=\s*\[/.test(PLANE)).toBe(false);
  });

  it('立面のパネルは同時に 1 つだけ（E-8-v3c-fix5・重なりの再発防止）', () => {
    const BAR = read('components/elevation/ElevationEditBar.tsx');
    // 「部材」メニューの立面タブが開いている間は、立面バー側は自分を出さない
    expect(BAR).toContain("if (showPartSelector && paletteTab === 'elevation') return null;");
    // 操作行（削除/元に戻す）は独立したバーではなくパネルの中身
    expect(BAR).toContain('<ElevationPartActions');
    expect(PLANE).toContain('<ElevationPartActions');
    // 画面下へ固定した独立バーが復活していないこと
    expect(BAR.includes('fixed bottom-16')).toBe(false);
    expect(PLANE.includes('fixed bottom-16 left-1/2 -translate-x-1/2 z-[60]')).toBe(false);
  });

  it('立面パネルは掴んで動かせる（位置は入口をまたいで共有）', () => {
    const BAR = read('components/elevation/ElevationEditBar.tsx');
    for (const src of [BAR, PLANE]) {
      expect(src).toContain('<FloatingPanel');
      expect(src).toContain('setElevationPanelPos');
    }
    expect(read('components/ui/FloatingPanel.tsx')).toContain('clampPanelPos');
  });

  it('部材ボタンの選択は押した時点だけが持つ（E-8-v3c-fix6・1 クリックで解除される事故）', () => {
    // pointerdown で選び、click でも同じ処理をすると 1 回のクリックで選択→解除になる。
    expect(PALETTE).toContain('onKindDown');
    // click 側は必ずキーボード判定を通す（素の setElevationAddTool を click に置かない）
    // （種類ボタンの素の toggle。文字ボタンは pointerdown を持たないので対象外）
    const rawKindClick = /onClick=\{\(\) => useCanvasStore\.getState\(\)\.setElevationAddTool\(addTool === k /;
    expect(rawKindClick.test(PALETTE)).toBe(false);
    expect(PALETTE).toContain('onKeyboardClick(e, () =>');
    expect(PALETTE).toContain('isKeyboardClick');
  });

  it('パネル内の操作は外へ漏れない／閉じるのは明示操作だけ（E-8-v3c-fix6）', () => {
    const FP = read('components/ui/FloatingPanel.tsx');
    expect(FP).toContain('onPointerDown={(e) => e.stopPropagation()}');
    expect(FP).toContain('onClick={(e) => e.stopPropagation()}');
    expect(FP).toContain('aria-label="閉じる"');
    // × は 2 つの入口の両方にある
    expect(read('components/elevation/ElevationEditBar.tsx')).toContain('onClose=');
    expect(PLANE).toContain('onClose=');
  });

  it('部材を選んでいる間は常に出る（種類だけの表示に戻っていない）', () => {
    // `{part && (` で姿図・角度ブロックを出している＝立面の有無や折りたたみで隠さない
    expect(PALETTE).toContain('{part && (');
  });
});
