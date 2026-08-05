// ============================================================
// E-9a: 手前建物シルエット（面軸 x → 遮蔽上端高さ）の pure 実装。
//
// 実機症状（鮎澤氏）: 2 棟（手前=高い 2F 棟 / 奥=低い 1F 下屋棟）の東立面で、
// 奥の 1F が透けて全部描かれていた。E-5 の遮蔽は足場列にしか効かず、しかも高さを
// 見ない x 区間切断なので「奥が高い → 上だけ見える」を表現できない。
//
// ここでは「x 区間 × 高さしきい値」を pure に用意する:
//   ある高さ h の要素は、手前の上端が h 以上の x 区間では隠れる。
// エンジンにはまだ接続しない（この刻みでは挙動は変わらない）。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import type { BuildingOutline, RoofBand } from '../elevationEngine';
import {
  buildingFrontness, clipSpanByProfile, depthFrontness, hiddenIntervalsAt, outlineSpans,
  roofBandSpans, stepTopAt, subtractIntervals, toStepProfile, visibleIntervalsAt,
} from '../occlusion';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const bld = (id: string, pts: Point[]): BuildingShape => ({ id, points: pts } as BuildingShape);
const outline = (id: string, segs: BuildingOutline['segments']): BuildingOutline =>
  ({ buildingId: id, floor: 1, face: 'east', segments: segs } as BuildingOutline);

describe('深度（frontness）', () => {
  /** 東西に並ぶ 2 棟: 手前(東寄り) x 200..300 / 奥 x 0..200。 */
  const front = bld('front', rect(200, 0, 300, 100));
  const back = bld('back', rect(0, 0, 200, 100));

  it('東面は x が大きいほど手前', () => {
    expect(buildingFrontness(front, 'east')).toBeGreaterThan(buildingFrontness(back, 'east'));
  });

  it('西面は逆（x が小さいほど手前）', () => {
    expect(buildingFrontness(back, 'west')).toBeGreaterThan(buildingFrontness(front, 'west'));
  });

  it('南面は y が大きいほど手前 / 北面は逆', () => {
    const south = bld('s', rect(0, 200, 100, 300));
    const north = bld('n', rect(0, 0, 100, 100));
    expect(buildingFrontness(south, 'south')).toBeGreaterThan(buildingFrontness(north, 'south'));
    expect(buildingFrontness(north, 'north')).toBeGreaterThan(buildingFrontness(south, 'north'));
  });

  it('壁面が揃う建物（総二階の 1F/2F）は同じ深度＝前後を作らない', () => {
    const f1 = bld('f1', rect(0, 0, 200, 100));
    const f2 = bld('f2', rect(0, 0, 200, 100));
    expect(buildingFrontness(f1, 'east')).toBe(buildingFrontness(f2, 'east'));
  });

  it('足場列の深さも同じ符号規約（E-5 と整合）', () => {
    expect(depthFrontness(450, 'south')).toBeGreaterThan(depthFrontness(270, 'south'));
    expect(depthFrontness(270, 'north')).toBeGreaterThan(depthFrontness(450, 'north'));
  });
});

describe('上端プロファイルの階段化', () => {
  it('水平な壁はそのまま 1 段', () => {
    const steps = toStepProfile(outlineSpans(outline('b', [
      { xStart: 0, xEnd: 100, heightStartMm: 6000, heightEndMm: 6000 },
    ])));
    expect(steps).toEqual([{ x0: 0, x1: 100, mm: 6000 }]);
  });

  it('妻（斜面）は刻みごとの階段になり、各段はその区間の最大を採る（安全側）', () => {
    const steps = toStepProfile(outlineSpans(outline('b', [
      { xStart: 0, xEnd: 60, heightStartMm: 3000, heightEndMm: 6000 },
    ])), 30);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({ x0: 0, x1: 30, mm: 4500 });    // 0..30 の最大
    expect(steps[1]).toEqual({ x0: 30, x1: 60, mm: 6000 });   // 30..60 の最大
  });

  it('重なる区間は高い方が残る', () => {
    const steps = toStepProfile([
      { x0: 0, x1: 100, mm0: 3000, mm1: 3000 },
      { x0: 40, x1: 60, mm0: 8000, mm1: 8000 },
    ]);
    expect(stepTopAt(steps, 10)).toBe(3000);
    expect(stepTopAt(steps, 50)).toBe(8000);
    expect(stepTopAt(steps, 90)).toBe(3000);
  });

  it('区間外は 0（何も隠さない）', () => {
    const steps = toStepProfile([{ x0: 0, x1: 100, mm0: 3000, mm1: 3000 }]);
    expect(stepTopAt(steps, -10)).toBe(0);
    expect(stepTopAt(steps, 200)).toBe(0);
  });

  it('屋根バンドは塗る面（軒→棟）の高さまで隠す側になる', () => {
    const band: RoofBand = {
      buildingId: 'b', xStart: 0, xEnd: 100, ridgeMm: 7000,
      profile: [{ x: 0, mm: 5000 }, { x: 100, mm: 5000 }], filledToRidge: true,
    };
    const steps = toStepProfile(roofBandSpans(band));
    expect(stepTopAt(steps, 50)).toBe(7000);
  });

  it('線のみのバンド（けらば）はプロファイルの高さ', () => {
    const band: RoofBand = {
      buildingId: 'b', xStart: 0, xEnd: 100, ridgeMm: 7000,
      profile: [{ x: 0, mm: 4000 }, { x: 100, mm: 4000 }], filledToRidge: false,
    };
    expect(stepTopAt(toStepProfile(roofBandSpans(band)), 50)).toBe(4000);
  });
});

describe('x 区間 × 高さしきい値', () => {
  //  手前: x 0..100 が 6000、x 100..200 が 3000
  const steps = toStepProfile([
    { x0: 0, x1: 100, mm0: 6000, mm1: 6000 },
    { x0: 100, x1: 200, mm0: 3000, mm1: 3000 },
  ]);

  it('低い要素は手前の全体で隠れる', () => {
    expect(hiddenIntervalsAt(steps, 2000)).toEqual([[0, 200]]);
  });

  it('中くらいの要素は高い方だけで隠れる', () => {
    expect(hiddenIntervalsAt(steps, 5000)).toEqual([[0, 100]]);
  });

  it('手前より高い要素はどこでも隠れない', () => {
    expect(hiddenIntervalsAt(steps, 8000)).toEqual([]);
  });

  it('見える区間は「全体 − 隠れる区間」', () => {
    expect(visibleIntervalsAt(-50, 250, steps, 5000)).toEqual([[-50, 0], [100, 250]]);
    expect(visibleIntervalsAt(0, 100, steps, 5000)).toEqual([]);
  });

  it('区間の引き算（穴が内側・外側・全体）', () => {
    expect(subtractIntervals(0, 100, [[40, 60]])).toEqual([[0, 40], [60, 100]]);
    expect(subtractIntervals(0, 100, [[-10, 10]])).toEqual([[10, 100]]);
    expect(subtractIntervals(0, 100, [[0, 100]])).toEqual([]);
    expect(subtractIntervals(0, 100, [[200, 300]])).toEqual([[0, 100]]);
  });
});

describe('シルエットのクリップ（完全に隠れる / 上だけ出る / 隠れない）', () => {
  /** 手前の建物: x 0..200 で高さ 6000。 */
  const front = toStepProfile([{ x0: 0, x1: 200, mm0: 6000, mm1: 6000 }]);

  it('低い奥の壁は完全に消える（実機の症状: 東面で 1F が見えないはず）', () => {
    const span = { x0: 0, x1: 200, mm0: 3000, mm1: 3000 };
    expect(clipSpanByProfile(span, front)).toEqual([]);
  });

  it('高い奥の壁は「上だけ」残る（下端が手前の上端まで持ち上がる）', () => {
    const span = { x0: 0, x1: 200, mm0: 9000, mm1: 9000 };
    const out = clipSpanByProfile(span, front);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      x0: 0, x1: 200, topStartMm: 9000, topEndMm: 9000, baseStartMm: 6000, baseEndMm: 6000,
    });
  });

  it('手前が無い範囲はそのまま（下端 GL のまま）', () => {
    const span = { x0: 300, x1: 400, mm0: 3000, mm1: 3000 };
    expect(clipSpanByProfile(span, front)).toEqual([{
      x0: 300, x1: 400, topStartMm: 3000, topEndMm: 3000, baseStartMm: 0, baseEndMm: 0,
    }]);
  });

  it('はみ出した部分だけ残る（手前の端から先はフルで見える）', () => {
    const span = { x0: 100, x1: 300, mm0: 3000, mm1: 3000 };
    const out = clipSpanByProfile(span, front);
    expect(out).toEqual([{
      x0: 200, x1: 300, topStartMm: 3000, topEndMm: 3000, baseStartMm: 0, baseEndMm: 0,
    }]);
  });

  it('斜めの壁は交点で割れて、上に出た側だけ残る', () => {
    // 0..200 で 3000 → 9000 の妻。手前 6000 を超えるのは中央(x=100)から先。
    const out = clipSpanByProfile({ x0: 0, x1: 200, mm0: 3000, mm1: 9000 }, front);
    expect(out).toHaveLength(1);
    expect(out[0].x0).toBeCloseTo(100, 6);
    expect(out[0].x1).toBe(200);
    expect(out[0].baseStartMm).toBe(6000);
    expect(out[0].topEndMm).toBe(9000);
  });

  it('手前が無ければ何も変わらない（単棟は不変）', () => {
    const span = { x0: 0, x1: 200, mm0: 3000, mm1: 3000 };
    expect(clipSpanByProfile(span, [])).toEqual([{
      x0: 0, x1: 200, topStartMm: 3000, topEndMm: 3000, baseStartMm: 0, baseEndMm: 0,
    }]);
  });
});
