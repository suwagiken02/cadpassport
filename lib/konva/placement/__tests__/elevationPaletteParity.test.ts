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

  it('部材を選んでいる間は常に出る（種類だけの表示に戻っていない）', () => {
    // `{part && (` で姿図・角度ブロックを出している＝立面の有無や折りたたみで隠さない
    expect(PALETTE).toContain('{part && (');
  });
});
