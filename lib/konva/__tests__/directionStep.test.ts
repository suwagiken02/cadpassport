// ============================================================
// S-2: 方向入力の 1 歩ぶんの終点。
//
// 実際の敷地は直角ばかりではないので、敷地だけ「斜め 4 方向」と「選んだ方向から
// さらに左右へ傾ける」を足した。躯体・屋根は 4 方向のままなので、
// **傾き 0 の上下左右が従来と 1 ビットも変わらないこと**がいちばん大事。
// ここは pure なので、その一致を厳密比較で固定できる。
//
// 座標系: x は右が正、y は**下**が正（画面と同じ）。1 グリッド = 10mm。
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  DIR_BASE_DEG, DIR_FACING_ROTATION, DIR_LABEL, PAD_DIRS_4, PAD_DIRS_8, PAD_DIRS_DIAGONAL,
  TILT_MAX_DEG, TILT_PRESET_DEG, clampTiltDeg, headingDeg, isDiagonalDir, stepEndpoint,
  type PadDir8,
} from '../directionStep';
import { GRID_UNIT_MM } from '../gridUtils';

const O = { x: 0, y: 0 };
/** mm → グリッド。 */
const g = (mm: number) => mm / GRID_UNIT_MM;

// ============================================================
describe('傾き 0 の上下左右は従来とまったく同じ（厳密一致）', () => {
  /** 変更前の実装そのもの。 */
  const legacy = (from: { x: number; y: number }, dir: string, distanceMm: number) => {
    const d = distanceMm / GRID_UNIT_MM;
    const next = { ...from };
    if (dir === 'up') next.y -= d;
    if (dir === 'down') next.y += d;
    if (dir === 'left') next.x -= d;
    if (dir === 'right') next.x += d;
    return next;
  };

  it.each(PAD_DIRS_4)('%s は従来の足し算と同じ値', (dir) => {
    for (const from of [{ x: 0, y: 0 }, { x: 5, y: 7 }, { x: -12.5, y: 33 }]) {
      for (const mm of [100, 1000, 2345, 3000, 91000]) {
        expect(stepEndpoint(from, dir, mm)).toEqual(legacy(from, dir, mm));
      }
    }
  });

  it('端数のある距離でも一致する（丸めを挟んでいない）', () => {
    expect(stepEndpoint({ x: 0, y: 0 }, 'up', 2345)).toEqual({ x: 0, y: -234.5 });
    expect(stepEndpoint({ x: 0, y: 0 }, 'right', 1)).toEqual({ x: 0.1, y: 0 });
  });

  it('-0 のような紛らわしい値を作らない', () => {
    const p = stepEndpoint(O, 'up', 3000);
    expect(Object.is(p.x, 0)).toBe(true);
  });
});

// ============================================================
describe('斜め 4 方向', () => {
  it('↗ 右上は右へ＋・上へ－（同じ量）', () => {
    const p = stepEndpoint(O, 'upRight', 1000);
    expect(p.x).toBeCloseTo(g(1000) / Math.SQRT2, 3);
    expect(p.y).toBeCloseTo(-g(1000) / Math.SQRT2, 3);
  });

  it('↙ 左下は左へ－・下へ＋', () => {
    const p = stepEndpoint(O, 'downLeft', 1000);
    expect(p.x).toBeCloseTo(-g(1000) / Math.SQRT2, 3);
    expect(p.y).toBeCloseTo(g(1000) / Math.SQRT2, 3);
  });

  it('4 つの斜めは符号だけが違う', () => {
    const r = g(2000) / Math.SQRT2;
    for (const [dir, sx, sy] of [
      ['upLeft', -1, -1], ['upRight', 1, -1], ['downLeft', -1, 1], ['downRight', 1, 1],
    ] as const) {
      const p = stepEndpoint(O, dir, 2000);
      expect(p.x, dir).toBeCloseTo(sx * r, 3);
      expect(p.y, dir).toBeCloseTo(sy * r, 3);
    }
  });

  it('距離はちゃんと指定どおり（斜めでも長さが縮まない）', () => {
    for (const dir of PAD_DIRS_8) {
      const p = stepEndpoint(O, dir, 5000);
      expect(Math.hypot(p.x, p.y), dir).toBeCloseTo(g(5000), 3);
    }
  });

  it('斜めの判定', () => {
    expect(PAD_DIRS_DIAGONAL.every(isDiagonalDir)).toBe(true);
    expect(PAD_DIRS_4.some((d) => isDiagonalDir(d))).toBe(false);
    expect(PAD_DIRS_8).toHaveLength(8);
  });
});

// ============================================================
describe('傾き（進む向きに対して画面で見た左右）', () => {
  it('↑ を左に 5°: 真上から少し左（西）へ', () => {
    const p = stepEndpoint(O, 'up', 3000, 5, 'left');
    expect(p.x).toBeCloseTo(-g(3000) * Math.sin((5 * Math.PI) / 180), 4);
    expect(p.y).toBeCloseTo(-g(3000) * Math.cos((5 * Math.PI) / 180), 4);
    expect(p.x).toBeLessThan(0);     // 左へ寄る
    expect(p.y).toBeLessThan(0);     // まだ上へ向かっている
  });

  it('↑ を右に 10°: 真上から少し右（東）へ', () => {
    const p = stepEndpoint(O, 'up', 3000, 10, 'right');
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0);
    expect(p.x).toBeCloseTo(g(3000) * Math.sin((10 * Math.PI) / 180), 4);
  });

  it('左と右は base をはさんで鏡像', () => {
    const l = stepEndpoint(O, 'up', 3000, 12.5, 'left');
    const r = stepEndpoint(O, 'up', 3000, 12.5, 'right');
    expect(l.x).toBeCloseTo(-r.x, 3);
    expect(l.y).toBeCloseTo(r.y, 3);
  });

  it('→ を左に 5°: 進行方向の左＝画面の上へ寄る', () => {
    const p = stepEndpoint(O, 'right', 3000, 5, 'left');
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it('↓ を左に 5°: 進行方向の左＝画面の右へ寄る', () => {
    const p = stepEndpoint(O, 'down', 3000, 5, 'left');
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it('← を左に 5°: 進行方向の左＝画面の下へ寄る', () => {
    const p = stepEndpoint(O, 'left', 3000, 5, 'left');
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it('傾けても距離は変わらない', () => {
    for (const deg of [0, 5, 22.5, 45, 80]) {
      for (const side of ['left', 'right'] as const) {
        const p = stepEndpoint(O, 'up', 4000, deg, side);
        expect(Math.hypot(p.x, p.y), `${deg}/${side}`).toBeCloseTo(g(4000), 3);
      }
    }
  });

  it('小数の角度も効く（22.5°）', () => {
    const p = stepEndpoint(O, 'up', 1000, 22.5, 'left');
    expect(p.x).toBeCloseTo(-g(1000) * Math.sin((22.5 * Math.PI) / 180), 4);
  });

  it('45° 傾けると隣の斜め方向と同じになる', () => {
    const tilted = stepEndpoint(O, 'up', 2000, 45, 'right');
    const diagonal = stepEndpoint(O, 'upRight', 2000);
    expect(tilted.x).toBeCloseTo(diagonal.x, 3);
    expect(tilted.y).toBeCloseTo(diagonal.y, 3);
  });

  it('傾き 0 を明示しても従来の値', () => {
    expect(stepEndpoint({ x: 3, y: 4 }, 'up', 3000, 0, 'right')).toEqual({ x: 3, y: 4 - 300 });
  });

  it('起点からの相対で動く（起点を足すだけ）', () => {
    const from = { x: 100, y: -50 };
    const rel = stepEndpoint(O, 'upRight', 1500, 7, 'left');
    const abs = stepEndpoint(from, 'upRight', 1500, 7, 'left');
    expect(abs.x).toBeCloseTo(from.x + rel.x, 3);
    expect(abs.y).toBeCloseTo(from.y + rel.y, 3);
  });
});

// ============================================================
describe('角度の受け取り方', () => {
  it('負の角度・NaN は 0 として扱う（従来どおりに落ちる）', () => {
    expect(clampTiltDeg(-5)).toBe(0);
    expect(clampTiltDeg(NaN)).toBe(0);
    expect(clampTiltDeg(Infinity)).toBe(0);
    expect(stepEndpoint(O, 'up', 3000, -5)).toEqual({ x: 0, y: -300 });
  });

  it('上限で止める（隣の方向を選んだ方が早い角度は入れない）', () => {
    expect(clampTiltDeg(120)).toBe(TILT_MAX_DEG);
    expect(TILT_MAX_DEG).toBeLessThan(90);
  });

  it('進む向き（度）は基準角 ± 傾き', () => {
    expect(headingDeg('up')).toBe(DIR_BASE_DEG.up);
    expect(headingDeg('up', 5, 'left')).toBe(DIR_BASE_DEG.up - 5);
    expect(headingDeg('up', 5, 'right')).toBe(DIR_BASE_DEG.up + 5);
  });

  it('プリセットは 0（なし）から始まる', () => {
    expect(TILT_PRESET_DEG[0]).toBe(0);
    expect(TILT_PRESET_DEG).toContain(45);
    expect(TILT_PRESET_DEG.every((d) => d >= 0 && d <= TILT_MAX_DEG)).toBe(true);
  });
});

// ============================================================
describe('基準角と表示', () => {
  it('基準角は 45° 刻みで 8 方向ぶん', () => {
    const degs = PAD_DIRS_8.map((d) => DIR_BASE_DEG[d]).sort((a, b) => a - b);
    expect(degs).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('基準角と実際に進む向きが合っている', () => {
    for (const dir of PAD_DIRS_8) {
      const rad = (DIR_BASE_DEG[dir] * Math.PI) / 180;
      const p = stepEndpoint(O, dir, 1000);
      expect(p.x, dir).toBeCloseTo(g(1000) * Math.cos(rad), 3);
      expect(p.y, dir).toBeCloseTo(g(1000) * Math.sin(rad), 3);
    }
  });

  it('キャラの向きは ↑ が 0 で 45° 刻み', () => {
    expect(DIR_FACING_ROTATION.up).toBe(0);
    expect(DIR_FACING_ROTATION.right).toBe(90);
    expect(DIR_FACING_ROTATION.down).toBe(180);
    expect(DIR_FACING_ROTATION.left).toBe(270);
    for (const dir of PAD_DIRS_8) {
      expect(DIR_FACING_ROTATION[dir] % 45, dir).toBe(0);
    }
  });

  it('従来の 4 方向の回転角は変わっていない', () => {
    // 変更前: { down: 180, left: 270, up: 0, right: 90 }
    expect({
      up: DIR_FACING_ROTATION.up, down: DIR_FACING_ROTATION.down,
      left: DIR_FACING_ROTATION.left, right: DIR_FACING_ROTATION.right,
    }).toEqual({ down: 180, left: 270, up: 0, right: 90 });
  });

  it('表示名は 8 方向ぶんあり、従来の 4 つは同じ文言', () => {
    expect(DIR_LABEL.up).toBe('↑ 上方向');
    expect(DIR_LABEL.down).toBe('↓ 下方向');
    expect(DIR_LABEL.left).toBe('← 左方向');
    expect(DIR_LABEL.right).toBe('→ 右方向');
    for (const dir of PAD_DIRS_8) {
      expect(DIR_LABEL[dir as PadDir8].length, dir).toBeGreaterThan(0);
    }
  });
});
