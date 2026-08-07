// ============================================================
// P-1: 平面部材に足した「階段」と「単管」。
//
// 階段: 600×1800mm 固定。600 手摺 2 本 × 1800 手摺 2 本で囲まれる区画に
//       ぴったり納まる位置へ吸着する（手摺が実際に置いてあるかは見ない）。
// 単管: 1〜6m の既製品＋任意長さ。スナップ無し（どこにでも置ける）。既定 45°。
// ============================================================
import { describe, it, expect } from 'vitest';
import { gridToMm, mmToGrid } from '../gridUtils';
import {
  PIPE_DEFAULT_ANGLE_DEG, PIPE_MAX_LENGTH_MM, PIPE_MIN_LENGTH_MM, PIPE_PRESET_LENGTHS_MM,
  STAIR_LENGTH_MM, STAIR_WIDTH_MM, clampPipeLengthMm, normalizeStairAngle, pipeEndpointsGrid,
  snapStairToCellGrid, stairArrowGrid, stairCornersGrid, stairFootprintGrid, stairTreadLinesGrid,
} from '../planeParts';
import type { Pipe, Stair } from '@/types';

const stair = (over: Partial<Stair> = {}): Stair => ({ id: 's1', x: 0, y: 0, ...over });
const pipe = (over: Partial<Pipe> = {}): Pipe => ({ id: 'p1', x: 0, y: 0, lengthMm: 2000, ...over });

describe('階段: 寸法は 600×1800', () => {
  it('外形は 600×1800mm（600 手摺・1800 手摺と同じ）', () => {
    expect(STAIR_WIDTH_MM).toBe(600);
    expect(STAIR_LENGTH_MM).toBe(1800);
    const f = stairFootprintGrid(0);
    expect(gridToMm(f.w)).toBe(600);
    expect(gridToMm(f.h)).toBe(1800);
  });

  it('90°/270° は横長（1800×600）になる', () => {
    for (const deg of [90, 270]) {
      const f = stairFootprintGrid(deg);
      expect(gridToMm(f.w), `${deg}°`).toBe(1800);
      expect(gridToMm(f.h), `${deg}°`).toBe(600);
    }
  });

  it('0°/180° は縦長のまま', () => {
    for (const deg of [0, 180]) {
      const f = stairFootprintGrid(deg);
      expect(gridToMm(f.w), `${deg}°`).toBe(600);
      expect(gridToMm(f.h), `${deg}°`).toBe(1800);
    }
  });

  it('角度は 90° 刻みに丸める（未設定は 0）', () => {
    expect(normalizeStairAngle(undefined)).toBe(0);
    expect(normalizeStairAngle(0)).toBe(0);
    expect(normalizeStairAngle(89)).toBe(90);
    expect(normalizeStairAngle(200)).toBe(180);
    expect(normalizeStairAngle(360)).toBe(0);
    expect(normalizeStairAngle(-90)).toBe(270);
  });

  it('4 隅は外形どおり', () => {
    const c = stairCornersGrid(stair({ x: 10, y: 20 }));
    expect(c[0]).toEqual({ x: 10, y: 20 });
    expect(c[2]).toEqual({ x: 10 + mmToGrid(600), y: 20 + mmToGrid(1800) });
  });
});

describe('階段: 600×1800 の区画へ吸着する', () => {
  it('縦長は 600 ピッチ × 1800 ピッチの格子に乗る', () => {
    const at = snapStairToCellGrid({ x: 97, y: 260 }, 0);
    expect(gridToMm(at.x) % 600).toBe(0);
    expect(gridToMm(at.y) % 1800).toBe(0);
  });

  it('横長は 1800 ピッチ × 600 ピッチの格子に乗る', () => {
    const at = snapStairToCellGrid({ x: 260, y: 97 }, 90);
    expect(gridToMm(at.x) % 1800).toBe(0);
    expect(gridToMm(at.y) % 600).toBe(0);
  });

  it('区画の中央あたりを指せば、その区画に納まる', () => {
    // 区画 (600..1200mm, 1800..3600mm) の中央 = (900, 2700)
    const at = snapStairToCellGrid({ x: mmToGrid(900), y: mmToGrid(2700) }, 0);
    expect(gridToMm(at.x)).toBe(600);
    expect(gridToMm(at.y)).toBe(1800);
  });

  it('少しずれた位置でも同じ区画へ収まる（吸着している）', () => {
    const center = { x: mmToGrid(900), y: mmToGrid(2700) };
    for (const [dx, dy] of [[-20, -50], [20, 50], [-5, 80]]) {
      const at = snapStairToCellGrid({ x: center.x + dx, y: center.y + dy }, 0);
      expect(gridToMm(at.x), `${dx},${dy}`).toBe(600);
      expect(gridToMm(at.y), `${dx},${dy}`).toBe(1800);
    }
  });

  it('手摺が 1 本も無くても吸着する（区画グリッドに合わせる）', () => {
    // 引数に手摺を取らない＝配置状況に依存しない
    expect(snapStairToCellGrid({ x: 0, y: 0 }, 0)).toEqual({ x: -0, y: -0 });
    expect(snapStairToCellGrid({ x: 1000, y: 1000 }, 0)).toEqual({
      x: Math.round((1000 - 30) / 60) * 60,
      y: Math.round((1000 - 90) / 180) * 180,
    });
  });
});

describe('階段: 上る向きが分かる', () => {
  it('段板は長辺を等分する線として出る', () => {
    const lines = stairTreadLinesGrid(stair());
    expect(lines.length).toBeGreaterThan(0);
    // 縦長なら段板は横線（y が一定）
    for (const l of lines) expect(l.y1).toBe(l.y2);
  });

  it('横向きの階段では段板が縦線になる', () => {
    for (const l of stairTreadLinesGrid(stair({ angleDeg: 90 }))) expect(l.x1).toBe(l.x2);
  });

  it('矢印は上る側へ向く（0°は上向き）', () => {
    const a = stairArrowGrid(stair({ angleDeg: 0 }));
    expect(a.to.y).toBeLessThan(a.from.y);      // 画面の上へ
    expect(a.to.x).toBe(a.from.x);
  });

  it('flip で矢印が逆を向く（データが向きを持つ）', () => {
    const normal = stairArrowGrid(stair({ angleDeg: 0, flip: false }));
    const flipped = stairArrowGrid(stair({ angleDeg: 0, flip: true }));
    expect(flipped.to.y).toBeGreaterThan(flipped.from.y);
    expect(normal.to.y).not.toBe(flipped.to.y);
    // 起点と終点が入れ替わるだけで、場所は同じ
    expect(flipped.to).toEqual(normal.from);
    expect(flipped.from).toEqual(normal.to);
  });

  it('180° は 0° と逆向き', () => {
    const up = stairArrowGrid(stair({ angleDeg: 0 }));
    const down = stairArrowGrid(stair({ angleDeg: 180 }));
    expect(down.to.y).toBeGreaterThan(down.from.y);
    expect(up.to.y).toBeLessThan(up.from.y);
  });

  it('90°/270° は横向きに伸びる', () => {
    const right = stairArrowGrid(stair({ angleDeg: 90 }));
    const left = stairArrowGrid(stair({ angleDeg: 270 }));
    expect(right.to.y).toBe(right.from.y);
    expect(right.to.x).toBeGreaterThan(right.from.x);
    expect(left.to.x).toBeLessThan(left.from.x);
  });
});

describe('単管: 既製品と任意長さ', () => {
  it('既製品は 1/2/3/4/5/6m の 6 種', () => {
    expect(PIPE_PRESET_LENGTHS_MM).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
  });

  it('既製品の長さで作れる', () => {
    for (const mm of PIPE_PRESET_LENGTHS_MM) {
      const [a, b] = pipeEndpointsGrid(pipe({ lengthMm: mm, angleDeg: 0 }));
      expect(gridToMm(Math.hypot(b.x - a.x, b.y - a.y)), `${mm}`).toBeCloseTo(mm);
    }
  });

  it('任意の長さも作れる（既製品以外）', () => {
    const [a, b] = pipeEndpointsGrid(pipe({ lengthMm: 1234, angleDeg: 0 }));
    expect(gridToMm(Math.hypot(b.x - a.x, b.y - a.y))).toBeCloseTo(1234);
  });

  it('任意長さは実用範囲に丸める', () => {
    expect(clampPipeLengthMm(1234)).toBe(1234);
    expect(clampPipeLengthMm(0)).toBe(PIPE_MIN_LENGTH_MM);
    expect(clampPipeLengthMm(99999)).toBe(PIPE_MAX_LENGTH_MM);
    expect(clampPipeLengthMm(Number.NaN)).toBe(PIPE_PRESET_LENGTHS_MM[0]);
  });
});

describe('単管: 角度と自由配置', () => {
  it('既定の角度は 45°', () => {
    expect(PIPE_DEFAULT_ANGLE_DEG).toBe(45);
    // angleDeg 未設定なら既定の 45° で伸びる（x と y が同じだけ動く）
    const [a, b] = pipeEndpointsGrid(pipe({ lengthMm: 2000 }));
    expect(b.x - a.x).toBeCloseTo(b.y - a.y);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('角度を変えれば向きが変わる', () => {
    const [a0, b0] = pipeEndpointsGrid(pipe({ lengthMm: 1000, angleDeg: 0 }));
    expect(b0.y - a0.y).toBeCloseTo(0);
    const [a90, b90] = pipeEndpointsGrid(pipe({ lengthMm: 1000, angleDeg: 90 }));
    expect(b90.x - a90.x).toBeCloseTo(0);
    expect(b90.y).toBeGreaterThan(a90.y);
  });

  it('スナップしない（置いた座標がそのまま始点）', () => {
    // 中途半端な座標でも丸められない＝自由配置
    const p = pipe({ x: 7.3, y: -11.9, lengthMm: 1000, angleDeg: 0 });
    const [a] = pipeEndpointsGrid(p);
    expect(a).toEqual({ x: 7.3, y: -11.9 });
  });

  it('階段と違い、区画格子には乗らない', () => {
    const p = pipe({ x: 7, y: 13 });
    expect(pipeEndpointsGrid(p)[0]).toEqual({ x: 7, y: 13 });
    // 同じ座標を階段に渡すと格子へ丸められる（対比）
    expect(snapStairToCellGrid({ x: 7, y: 13 }, 0)).not.toEqual({ x: 7, y: 13 });
  });
});
