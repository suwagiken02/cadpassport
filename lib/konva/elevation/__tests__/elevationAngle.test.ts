// ============================================================
// E-8-v3c-fix4: 立面パレットの姿図プレビューと角度。
//
// 決めごと:
//   ・角度は「その部材の自然な向きからの回転(度)」。手摺・踏板は水平が 0°、
//     支柱・ジャッキは垂直が 0°。正の値で反時計回り（右端が上がる）。
//   ・回転の中心は 手摺・踏板・筋交＝中央 / 支柱＝下端 / ジャッキ＝上端（＝置いた基準点）。
//   ・接合点も部材と一緒に回る＝斜めに掛けた手摺も端点で吸着する（吸着圏外なら自由配置）。
//   ・姿図は「実際に置かれる部材の primitives」そのもの。プレビュー専用の作図はしない。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPartGeometry } from '../elevationParts';
import {
  GRID_MM, newElevationPart, partPivotMm, partsToPrimitives, rotateAboutMm,
} from '../elevationParts';
import { partJoints, snapJoint } from '../elevationJoints';
import { partPreview } from '../elevationPartPreview';
import {
  ANGLE_PRESET_DEGS, ANGLE_STEPS, angleToDeg, anglePresetsForNatural,
  normalizeAngleDeg, stepAngle,
} from '../../placement/anglePresets';

const geom: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360],
    jackTopMm: 400,
    topRailMm: 6700,
    levelsMm: [1300, 3100],
    komaGridMm: Array.from({ length: 14 }, (_, k) => 650 + 450 * k),
  }],
};
const sg = geom.scaffolds[0];
const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('rotateAboutMm（mm 空間の回転）', () => {
  it('90° で右向きが上向きになる（正＝反時計回り）', () => {
    const p = rotateAboutMm({ xMm: 100, yMm: 0 }, { xMm: 0, yMm: 0 }, 90);
    near(p.xMm, 0);
    near(p.yMm, 100);
  });
  it('0° は何もしない（同じ値をそのまま返す）', () => {
    const p = { xMm: 37, yMm: -12 };
    expect(rotateAboutMm(p, { xMm: 5, yMm: 5 }, 0)).toBe(p);
  });
  it('軸まわりに回すので軸は動かない', () => {
    const pivot = { xMm: 1800, yMm: 1300 };
    const p = rotateAboutMm(pivot, pivot, 45);
    near(p.xMm, pivot.xMm);
    near(p.yMm, pivot.yMm);
  });
});

describe('回転の中心（partPivotMm）', () => {
  it('手摺は中央', () => {
    const rail = newElevationPart('rail', 'r', 0, { xMm: 900, yMm: 1300 }, { sizeMm: 1800 });
    expect(partPivotMm(rail, sg)).toEqual({ xMm: 900, yMm: 1300 });
  });
  it('支柱は下端（＝置いた基準点）', () => {
    const post = newElevationPart('post', 'p', 0, { xMm: 1800, yMm: 400 }, { komaCount: 4 });
    expect(partPivotMm(post, sg)).toEqual({ xMm: 1800, yMm: 400 });
  });
});

describe('接合点は部材と一緒に回る', () => {
  const rail0 = newElevationPart('rail', 'r', 0, { xMm: 900, yMm: 1300 }, { sizeMm: 1800 });
  it('90° の手摺は両端が中央の真上・真下へ来る', () => {
    const j = partJoints({ ...rail0, angleDeg: 90 }, sg);
    expect(j).toHaveLength(2);
    const ys = j.map((p) => p.yMm).sort((a, b) => a - b);
    near(j[0].xMm, 900);
    near(j[1].xMm, 900);
    near(ys[0], 1300 - 900);
    near(ys[1], 1300 + 900);
  });
  it('傾けても端点が近ければ吸着する（角度で禁止はしない）', () => {
    // 90° に立てた手摺（中央 1830mm・高さ 1590mm）の下端は (1830, 690)。
    // 支柱 x=1800 のコマ 650 まで hypot(30,40)=50mm ＝ 吸着圏内（≒183mm）。
    const post = {
      id: 'post:0:1', kind: 'post' as const, scaffoldIndex: 0, origin: 'auto' as const,
      postIndex: 1, x0Mm: 1800, x1Mm: 1800,
    };
    const tilted = { ...rail0, angleDeg: 90, x0Mm: 930, x1Mm: 2730, levelMm: 1590 };
    const snap = snapJoint(tilted, [post], sg, { dxMm: 0, dyMm: 0 },
      { pxPerMm: 0.12, tolPx: 22 });
    expect(snap.to?.kind).toBe('pocket');
    expect(Math.hypot(snap.dxMm, snap.dyMm)).toBeGreaterThan(0);
  });
  it('角度 0 の部材は従来どおり（回転前と同じ接合点）', () => {
    expect(partJoints({ ...rail0, angleDeg: 0 }, sg)).toEqual(partJoints(rail0, sg));
  });
});

describe('描画（partsToPrimitives）も回る', () => {
  const rail = newElevationPart('rail', 'r', 0, { xMm: 900, yMm: 1300 }, { sizeMm: 1800 });

  it('角度なしは水平、90° は垂直になる', () => {
    const flat = partsToPrimitives({ parts: [rail], geom })
      .filter((p): p is Extract<typeof p, { kind: 'line' }> => p.kind === 'line');
    const up = partsToPrimitives({ parts: [{ ...rail, angleDeg: 90 }], geom })
      .filter((p): p is Extract<typeof p, { kind: 'line' }> => p.kind === 'line');
    expect(flat.length).toBeGreaterThan(0);
    expect(up.length).toBe(flat.length);
    // 水平: 端点の y が同じ / 垂直: 端点の x が同じ
    near(flat[0].y1, flat[0].y2);
    near(up[0].x1, up[0].x2);
  });

  it('中央（回転の中心）は動かない', () => {
    const pivotLocal = { x: 900 / GRID_MM, y: -(1300 / GRID_MM) };
    for (const deg of [30, 90, -45]) {
      const prims = partsToPrimitives({ parts: [{ ...rail, angleDeg: deg }], geom })
        .filter((p): p is Extract<typeof p, { kind: 'line' }> => p.kind === 'line');
      const mid = { x: (prims[0].x1 + prims[0].x2) / 2, y: (prims[0].y1 + prims[0].y2) / 2 };
      near(mid.x, pivotLocal.x, 1e-6);
      near(mid.y, pivotLocal.y, 1e-6);
    }
  });

  it('長さは変わらない（回すだけ）', () => {
    const len = (deg: number) => {
      const l = partsToPrimitives({ parts: [{ ...rail, angleDeg: deg }], geom })
        .filter((p): p is Extract<typeof p, { kind: 'line' }> => p.kind === 'line')[0];
      return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    };
    near(len(37), len(0), 1e-6);
  });

  it('支柱は下端を軸に回る（下端は動かない）', () => {
    const post = newElevationPart('post', 'p', 0, { xMm: 1800, yMm: 400 }, { komaCount: 2 });
    const bottom = { x: 180, y: -40 };   // 1800mm / 400mm → ローカル
    const prims = partsToPrimitives({ parts: [{ ...post, angleDeg: 90 }], geom });
    const hit = prims.some((p) => p.kind === 'line'
      && ((Math.abs(p.x1 - bottom.x) < 1e-6 && Math.abs(p.y1 - bottom.y) < 1e-6)
        || (Math.abs(p.x2 - bottom.x) < 1e-6 && Math.abs(p.y2 - bottom.y) < 1e-6)));
    expect(hit).toBe(true);
  });
});

describe('姿図プレビュー（partPreview）', () => {
  it('実部材の primitives が出る（空にならない）', () => {
    for (const kind of ['post', 'rail', 'board', 'jack', 'brace'] as const) {
      const pv = partPreview(kind, { sizeMm: 1800, komaCount: 2 });
      expect(pv.prims.length).toBeGreaterThan(0);
      expect(pv.scale).toBeGreaterThan(0);
    }
  });
  it('枠は正方形（部材ごとに大きさが暴れない）', () => {
    const pv = partPreview('rail', { sizeMm: 1800 });
    near(pv.view.w, pv.view.h, 1e-9);
    expect(pv.view.w).toBeGreaterThan(0);
  });
  it('角度を変えると絵が変わる', () => {
    const a = JSON.stringify(partPreview('rail', { sizeMm: 1800, angleDeg: 0 }).prims);
    const b = JSON.stringify(partPreview('rail', { sizeMm: 1800, angleDeg: 45 }).prims);
    expect(a).not.toBe(b);
  });
  it('図面が無くても描ける（プレビューは保存データに依存しない）', () => {
    expect(() => partPreview('post', { komaCount: 8 })).not.toThrow();
  });
});

describe('角度プリセット（平面と共通）', () => {
  it('横=0 / 縦=90', () => {
    expect(angleToDeg('horizontal')).toBe(0);
    expect(angleToDeg('vertical')).toBe(90);
    expect(angleToDeg(45)).toBe(45);
  });
  it('プリセットは 横・縦・15/30/45/60/75', () => {
    expect(ANGLE_PRESET_DEGS.map((p) => p.deg)).toEqual([0, 90, 15, 30, 45, 60, 75]);
  });
  it('自然な向きが縦の部材はラベルだけ読み替える（数値は共通）', () => {
    const v = anglePresetsForNatural('vertical');
    expect(v.map((p) => p.deg)).toEqual(ANGLE_PRESET_DEGS.map((p) => p.deg));
    expect(v[0].label).toBe('縦');
    expect(v[1].label).toBe('横');
    expect(anglePresetsForNatural('horizontal')[0].label).toBe('横');
  });
  it('微調整は -10/-1/+1/+10', () => {
    expect([...ANGLE_STEPS]).toEqual([-10, -1, 1, 10]);
  });
  it('連打しても角度は (-180, 180] に畳まれる', () => {
    expect(normalizeAngleDeg(370)).toBe(10);
    expect(normalizeAngleDeg(-190)).toBe(170);
    expect(normalizeAngleDeg(180)).toBe(180);
    expect(normalizeAngleDeg(-180)).toBe(180);
    expect(Object.is(normalizeAngleDeg(-360), 0)).toBe(true);
    expect(stepAngle(175, 10)).toBe(-175);
    expect(stepAngle(0, -1)).toBe(-1);
  });
});
