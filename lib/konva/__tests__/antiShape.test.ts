// ============================================================
// P-3 (A): アンチの外形・色は 1 か所（antiShape.ts）だけが知っている。
//
// これまで「アンチの姿」を知っているのは ScaffoldLayer だけで、配置シャドーは
// 手摺の入れ物に相乗りして 3px の青い細線で出ていた＝置かれる板とまるで別物。
// ここでは pure な定義そのものを固定し、実物とゴーストの両方がここを通ることを見る。
//
// 数値はすべて移設前の ScaffoldLayer と同じ。見た目を変えていないことの記録でもある。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ANTI_COLORS, ANTI_CORNER_RADIUS, ANTI_OPACITY,
  antiFill, antiRectGrid, antiSeamGrid, antiStroke, antiStrokeWidth, isWideAnti,
} from '../antiShape';
import { mmToGrid } from '../gridUtils';
import type { AntiShape } from '../antiShape';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

const anti = (o: Partial<AntiShape> = {}): AntiShape => ({
  x: 10, y: 20, width: 400, lengthMm: 1800, direction: 'horizontal', ...o,
});

describe('外形（グリッド単位）', () => {
  it('横置きは長さが横、幅が縦', () => {
    expect(antiRectGrid(anti())).toEqual({
      x: 10, y: 20, w: mmToGrid(1800), h: mmToGrid(400),
    });
  });

  it('縦置きは入れ替わる', () => {
    expect(antiRectGrid(anti({ direction: 'vertical' }))).toEqual({
      x: 10, y: 20, w: mmToGrid(400), h: mmToGrid(1800),
    });
  });

  it('左上が基準（x/y をそのまま持つ）', () => {
    const r = antiRectGrid(anti({ x: -5, y: 7 }));
    expect({ x: r.x, y: r.y }).toEqual({ x: -5, y: 7 });
  });

  it('インチ規格の幅もそのまま外形になる', () => {
    expect(antiRectGrid(anti({ width: 500, lengthMm: 1829 })).h).toBe(mmToGrid(500));
    expect(antiRectGrid(anti({ width: 240, lengthMm: 1829 })).h).toBe(mmToGrid(240));
  });

  it('目に見える大きさになる（潰れない）', () => {
    const { w, h } = antiRectGrid(anti());
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

describe('内側の破線（板の継ぎ目）', () => {
  it('横置きは真ん中を水平に走る', () => {
    const a = anti();
    const { w, h } = antiRectGrid(a);
    expect(antiSeamGrid(a)).toEqual({
      x1: 10 + 1, y1: 20 + h / 2, x2: 10 + w - 1, y2: 20 + h / 2,
    });
  });

  it('縦置きは上端寄りから下端寄りへ斜めに走る（移設前と同じ式）', () => {
    const a = anti({ direction: 'vertical' });
    const { w, h } = antiRectGrid(a);
    expect(antiSeamGrid(a)).toEqual({
      x1: 10 + 1, y1: 20 + 1, x2: 10 + w - 1, y2: 20 + h - 1,
    });
  });

  it('外形の内側に収まる', () => {
    for (const dir of ['horizontal', 'vertical'] as const) {
      const a = anti({ direction: dir });
      const r = antiRectGrid(a);
      const s = antiSeamGrid(a);
      for (const [px, py] of [[s.x1, s.y1], [s.x2, s.y2]]) {
        expect(px).toBeGreaterThanOrEqual(r.x);
        expect(px).toBeLessThanOrEqual(r.x + r.w);
        expect(py).toBeGreaterThanOrEqual(r.y);
        expect(py).toBeLessThanOrEqual(r.y + r.h);
      }
    }
  });
});

describe('色（移設前の判定をそのまま保つ）', () => {
  it('幅 400 だけが濃い側', () => {
    expect(isWideAnti({ width: 400 })).toBe(true);
    for (const w of [250, 500, 240] as const) expect(isWideAnti({ width: w })).toBe(false);
  });

  it('面の色', () => {
    expect(antiFill({ width: 400 })).toBe('#F59E0B');
    expect(antiFill({ width: 250 })).toBe('#FCD34D');
  });

  it('枠の色', () => {
    expect(antiStroke({ width: 400 })).toBe('#B45309');
    expect(antiStroke({ width: 250 })).toBe('#A16207');
  });

  it('選択色・継ぎ目の色', () => {
    expect(ANTI_COLORS.selected).toBe('#FF6B35');
    expect(ANTI_COLORS.seam).toBe('#b8860b');
  });

  it('背景（白・黒）に溶けない', () => {
    for (const [name, c] of Object.entries(ANTI_COLORS)) {
      expect(['#ffffff', '#0a0a0a'], name).not.toContain(c.toLowerCase());
    }
  });

  it('不透明度・角丸・枠の太さは移設前と同じ', () => {
    expect(ANTI_OPACITY).toBe(0.85);
    expect(ANTI_CORNER_RADIUS).toBe(2);
    expect(antiStrokeWidth(1, false)).toBe(12);
    expect(antiStrokeWidth(1, true)).toBe(16);
    expect(antiStrokeWidth(2, false)).toBe(24);   // zoom に比例
  });
});

describe('実物とゴーストが同じ定義を通る', () => {
  const scaffold = read('components/canvas/ScaffoldLayer.tsx');
  const planePart = read('components/canvas/PlanePartLayer.tsx');

  it('実物（ScaffoldLayer）が antiShape を使う', () => {
    expect(scaffold).toMatch(/from '@\/lib\/konva\/antiShape'/);
    expect(scaffold).toMatch(/antiRectGrid\(anti\)/);
    expect(scaffold).toMatch(/fill=\{antiFill\(anti\)\}/);
  });

  it('ゴースト（PlanePartLayer）が同じ antiShape を使う', () => {
    expect(planePart).toMatch(/from '@\/lib\/konva\/antiShape'/);
    expect(planePart).toMatch(/antiRectGrid\(anti\)/);
    expect(planePart).toMatch(/fill=\{antiFill\(anti\)\}/);
  });

  it('実物側に色や寸法の直書きが残っていない（二重定義を作らない）', () => {
    const antiBlock = scaffold.slice(
      scaffold.indexOf('canvasData.antis.map'), scaffold.indexOf('{/* 手摺 */}'),
    );
    expect(antiBlock.length).toBeGreaterThan(100);   // 切り出しが効いていることの確認
    for (const literal of ['#F59E0B', '#FCD34D', '#B45309', '#A16207', '#b8860b']) {
      expect(antiBlock, literal).not.toContain(literal);
    }
  });
});
