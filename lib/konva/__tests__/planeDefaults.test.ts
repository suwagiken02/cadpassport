// ============================================================
// P-1-fix10 の既定値まわり:
//   ・単管の既定の長さを 5m にする（実務でいちばん使う長さ・鮎澤氏）
//   ・コーナーガイドを既定オフにする（全モード・全端末）
// どちらもユーザーが自分で変えられることは維持する。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  PIPE_DEFAULT_ANGLE_DEG, PIPE_DEFAULT_LENGTH_MM, PIPE_MAX_LENGTH_MM, PIPE_MIN_LENGTH_MM,
  PIPE_PRESET_LENGTHS_MM, clampPipeLengthMm,
} from '../planeParts';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

describe('単管の既定の長さは 5m', () => {
  it('既定値は 5000mm', () => {
    expect(PIPE_DEFAULT_LENGTH_MM).toBe(5000);
  });

  it('既製品の 1 つ（選択状態として成立する）', () => {
    expect(PIPE_PRESET_LENGTHS_MM).toContain(PIPE_DEFAULT_LENGTH_MM);
  });

  it('実用範囲に収まっている', () => {
    expect(PIPE_DEFAULT_LENGTH_MM).toBeGreaterThanOrEqual(PIPE_MIN_LENGTH_MM);
    expect(PIPE_DEFAULT_LENGTH_MM).toBeLessThanOrEqual(PIPE_MAX_LENGTH_MM);
    expect(clampPipeLengthMm(PIPE_DEFAULT_LENGTH_MM)).toBe(PIPE_DEFAULT_LENGTH_MM);
  });

  it('パレットの初期値に使われている', () => {
    expect(read('components/toolbar/PartSelector.tsx'))
      .toMatch(/useState<number>\(PIPE_DEFAULT_LENGTH_MM\)/);
  });

  it('角度の既定は 45° のまま（変更していない）', () => {
    expect(PIPE_DEFAULT_ANGLE_DEG).toBe(45);
  });

  it('他の長さも従来どおり選べる', () => {
    expect(PIPE_PRESET_LENGTHS_MM).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
    expect(clampPipeLengthMm(1234)).toBe(1234);
  });
});

describe('コーナーガイドは既定オフ', () => {
  it('store の初期値が false', () => {
    expect(useCanvasStore.getInitialState().showDimensions).toBe(false);
  });

  it('新しいセッションでも off から始まる', () => {
    // 画面状態なので保存されない＝毎回この初期値から始まる
    expect(read('types/index.ts')).not.toMatch(/showDimensions/);
  });

  it('ユーザーが自分でオンにできる', () => {
    const before = useCanvasStore.getState().showDimensions;
    useCanvasStore.getState().toggleShowDimensions();
    expect(useCanvasStore.getState().showDimensions).toBe(!before);
    useCanvasStore.getState().setShowDimensions(false);
    expect(useCanvasStore.getState().showDimensions).toBe(false);
  });

  it('端末で初期値を上書きする仕掛けは残っていない（全端末で off）', () => {
    // 以前はスマホだけ off にする ShowDimensionsInit があった。既定 off になったので不要。
    expect(fs.existsSync(path.resolve(__dirname, '../../../components/ShowDimensionsInit.tsx')))
      .toBe(false);
    expect(read('app/layout.tsx')).not.toMatch(/ShowDimensionsInit/);
  });

  it('グリッドガイドの既定は従来どおり off', () => {
    expect(useCanvasStore.getInitialState().showGridGuide).toBe(false);
  });
});
