// ============================================================
// E-8-v5c: 立面部材パレットは開いた時点で「手摺」が選ばれている。
//
// 「何も選ばれていない段階」は要らない（鮎澤氏）。開いてすぐ置けるように、
// 長さ・角度・姿図も手摺の既定値で出る。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  DEFAULT_ELEVATION_PART_KIND, PALETTE_KINDS,
} from '../elevation/elevationSlots';
import { defaultPartSize, newElevationPart, partRangeMm } from '../elevation/elevationParts';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const palette = read('components/elevation/ElevationPartPalette.tsx');
const st = () => useCanvasStore.getState();

/** パレットを開いたときに起きること（ElevationPartPalette のマウント時の効果）。 */
const openPalette = () => {
  if (!st().elevationAddTool) st().setElevationAddTool(DEFAULT_ELEVATION_PART_KIND);
};

beforeEach(() => {
  useCanvasStore.setState({
    elevationAddTool: null, elevationAddSize: 1800, elevationAddAngle: 0, elevationAddFlip: false,
  });
});

describe('開いた時点で手摺が選ばれている', () => {
  it('既定の種類は手摺', () => {
    expect(DEFAULT_ELEVATION_PART_KIND).toBe('rail');
    expect(PALETTE_KINDS).toContain(DEFAULT_ELEVATION_PART_KIND);
  });

  it('開くと手摺が選択される', () => {
    expect(st().elevationAddTool).toBeNull();
    openPalette();
    expect(st().elevationAddTool).toBe('rail');
  });

  it('長さは手摺の既定値（1800mm）', () => {
    openPalette();
    expect(st().elevationAddSize).toBe(defaultPartSize('rail'));
    expect(st().elevationAddSize).toBe(1800);
  });

  it('角度は 0°（手摺の自然な向き＝水平）', () => {
    openPalette();
    expect(st().elevationAddAngle).toBe(0);
  });

  it('姿図が出る条件を満たす（種類が決まっている）', () => {
    openPalette();
    const tool = st().elevationAddTool;
    expect(tool).not.toBeNull();
    expect(tool).not.toBe('text');
    // その設定で実際に部材が作れる＝姿図に絵が出る
    const part = newElevationPart('rail', 'preview', 0, { xMm: 0, yMm: 0 }, { sizeMm: st().elevationAddSize });
    const r = partRangeMm(part, undefined)!;
    expect(r.x1Mm - r.x0Mm).toBeCloseTo(1800);
  });

  it('開くのは 1 回だけ（ユーザーが解除したら解除のまま）', () => {
    openPalette();
    st().setElevationAddTool(null);       // ユーザーが同じボタンをもう一度押した
    openPalette();                        // 再描画では選び直さない…が、
    // マウント時の 1 回だけなので、再描画では走らない。ここでは「解除できる」ことを固定する。
    expect(palette).toMatch(/if \(!s\.elevationAddTool\) s\.setElevationAddTool\(DEFAULT_ELEVATION_PART_KIND\);/);
    expect(palette).toMatch(/\}, \[\]\);/);
  });

  it('すでに選んでいる種類があれば上書きしない', () => {
    st().setElevationAddTool('post');
    st().setElevationAddSize(8);
    openPalette();
    expect(st().elevationAddTool).toBe('post');
    expect(st().elevationAddSize).toBe(8);
  });
});

describe('他の種類へ切り替えられる（従来どおり）', () => {
  it('パレットの全種へ切り替わる', () => {
    openPalette();
    for (const kind of PALETTE_KINDS) {
      st().setElevationAddTool(kind);
      expect(st().elevationAddTool, kind).toBe(kind);
      expect(st().elevationAddSize, kind).toBe(defaultPartSize(kind));
    }
  });

  it('同じ種類をもう一度押せば解除できる', () => {
    openPalette();
    expect(st().elevationAddTool).toBe('rail');
    // onKindDown: 同じ種類なら解除
    expect(palette).toMatch(/if \(useCanvasStore\.getState\(\)\.elevationAddTool === kind\) \{/);
    st().setElevationAddTool(null);
    expect(st().elevationAddTool).toBeNull();
  });

  it('手摺に戻せる', () => {
    openPalette();
    st().setElevationAddTool('brace');
    st().setElevationAddTool('rail');
    expect(st().elevationAddTool).toBe('rail');
    expect(st().elevationAddSize).toBe(1800);
  });
});

describe('平面部材パレットの初期状態は変わらない', () => {
  it('部材メニューは平面タブから始まる', () => {
    expect(useCanvasStore.getInitialState().partPaletteTab).toBe('plane');
  });

  it('平面の初期選択は従来どおり（勝手に部材を選ばない）', () => {
    const init = useCanvasStore.getInitialState();
    expect(init.selectedHandrailLength).toBe(1800);
    expect(init.mode).toBe('view');
  });

  it('平面パレットに「開いたら選ぶ」処理は入れていない', () => {
    const src = read('components/toolbar/PartSelector.tsx');
    expect(src).not.toMatch(/DEFAULT_ELEVATION_PART_KIND/);
    expect(src).not.toMatch(/setElevationAddTool\('rail'\)/);
  });
});
