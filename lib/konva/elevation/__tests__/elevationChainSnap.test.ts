// ============================================================
// E-8-v3e: 部材同士の連鎖スナップ（支柱が無くても整列する）。
//
// 現場ルール（鮎澤氏）: 手摺→柱→手摺と 1 本ずつ交互には組まない。手摺を先に
// バーッと並べ、後から柱を差す。よって支柱がまだ無くても、手摺同士が
// 「間に柱が入る前提の間隔」で吸着して綺麗に並ぶ必要がある。
//
// 仕組み: 既存部材の楔は「そこに立つはずの支柱のポケット」を仮想接合点として提供する。
//   ・同じ高さ … 隣の手摺が続く（＝同じ支柱の左右のポケットに刺さる間隔）
//   ・450 刻み … 上下段が揃う
//   ・支柱     … 隣の支柱の位置（標準スパン 1800）
// 優先順位: 実在の接合点 ＞ 仮想接合点（距離が同等なら実在）。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { movePart, newElevationPart, partRangeMm } from '../elevationParts';
import { partJoints, partVirtualJoints, snapJoint } from '../elevationJoints';

const geom: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360],          // 0 / 1800 / 3600 mm
    jackTopMm: 400,
    topRailMm: 6700,
    levelsMm: [1300, 3100],
    komaGridMm: Array.from({ length: 14 }, (_, k) => 650 + 450 * k),   // 650..6500
  }],
};
const sg = geom.scaffolds[0];
/** 画面 1mm = 0.12px（pxPerGrid 1.2 相当）、吸着 22px ≒ 183mm。 */
const opts = { pxPerMm: 0.12, tolPx: 22 };
const TOL_MM = opts.tolPx / opts.pxPerMm;

/** 面軸 x0..x1(mm)・高さ level(mm) の手摺。 */
const rail = (id: string, x0Mm: number, x1Mm: number, levelMm: number): ElevationPart => ({
  id, kind: 'rail', scaffoldIndex: 0, origin: 'manual', x0Mm, x1Mm, levelMm,
});
const board = (id: string, x0Mm: number, x1Mm: number, levelMm: number): ElevationPart => ({
  ...rail(id, x0Mm, x1Mm, levelMm), kind: 'board',
});
/** 吸着後の部材。 */
const snapped = (p: ElevationPart, others: ElevationPart[]) =>
  movePart(p, sg, snapJoint(p, others, sg, { dxMm: 0, dyMm: 0 }, opts));

describe('仮想接合点（将来そこに入る支柱の受け口）', () => {
  it('手摺の楔は同じ位置に仮想ポケットを出す（＝そこに柱が立つ）', () => {
    const a = rail('a', 0, 1800, 1300);
    const v = partVirtualJoints(a, sg);
    expect(v.every((j) => j.virtual && j.kind === 'pocket')).toBe(true);
    // 両端に、同じ高さの仮想ポケットがある
    for (const x of [0, 1800]) {
      expect(v.some((j) => j.xMm === x && j.yMm === 1300)).toBe(true);
    }
  });

  it('縦は 450 刻み（上下段も揃う）', () => {
    const v = partVirtualJoints(rail('a', 0, 1800, 1300), sg);
    for (const y of [1300 - 450, 1300 + 450, 1300 + 900]) {
      expect(v.some((j) => j.xMm === 0 && j.yMm === y)).toBe(true);
    }
  });

  it('支柱は隣の支柱の位置（標準スパン 1800）を出す', () => {
    const post = newElevationPart('post', 'p', 0, { xMm: 1800, yMm: 400 }, { komaCount: 4 });
    const v = partVirtualJoints(post, sg);
    expect(v.map((j) => j.xMm).sort((x, y) => x - y)).toEqual([0, 3600]);
    expect(v.every((j) => j.kind === 'cup' && j.yMm === 400 && j.virtual)).toBe(true);
  });

  it('実在の接合点には virtual が付かない', () => {
    const post = newElevationPart('post', 'p', 0, { xMm: 1800, yMm: 400 }, { komaCount: 4 });
    expect(partJoints(post, sg).every((j) => !j.virtual)).toBe(true);
  });
});

describe('手摺⇔手摺の横連鎖（支柱がまだ無い状態）', () => {
  const a = rail('a', 0, 1800, 1300);          // 既に並べてある 1 本目

  it('右隣に置いた手摺が、柱が入る前提の間隔で吸着する', () => {
    // 少しズレた位置（右へ 60mm・上へ 40mm）に置いた 2 本目
    const b = snapped(rail('b', 1860, 3660, 1340), [a]);
    const rb = partRangeMm(b, sg)!;
    const ra = partRangeMm(a, sg)!;
    expect(rb.x0Mm).toBe(ra.x1Mm);            // 端がぴったり合う
    expect(b.levelMm).toBe(a.levelMm);        // 高さも揃う
    expect(rb.x1Mm - rb.x0Mm).toBe(1800);     // 長さは変わらない
  });

  it('その継ぎ目に支柱を立てると、両方の手摺がその支柱のポケットに刺さる', () => {
    // 皿(400)基準のコマ列は 650/1100/1550…。ここでは実際のコマ高さ 1550 で並べる。
    const a1550 = rail('a', 0, 1800, 1550);
    const b = snapped(rail('b', 1860, 3660, 1590), [a1550]);
    const joint = partRangeMm(b, sg)!.x0Mm;
    // 継ぎ目に立てた支柱（下端＝皿）
    const post = newElevationPart('post', 'p', 0, { xMm: joint, yMm: 400 }, { komaCount: 8 });
    const pockets = partJoints(post, sg).filter((j) => j.kind === 'pocket');
    // 手摺 A の右楔・手摺 B の左楔が、どちらも同じ実在ポケットに一致する
    const wedgeA = partJoints(a1550, sg).find((j) => j.xMm === partRangeMm(a1550, sg)!.x1Mm)!;
    const wedgeB = partJoints(b, sg).find((j) => j.xMm === joint)!;
    for (const w of [wedgeA, wedgeB]) {
      expect(pockets.some((p) => p.xMm === w.xMm && Math.abs(p.yMm - w.yMm) < 1e-6)).toBe(true);
    }
  });

  it('左隣へ置いても同じ（どちらから寄せても同じ結果）', () => {
    const b = snapped(rail('b', -1840, -40, 1290), [a]);
    expect(partRangeMm(b, sg)!.x1Mm).toBe(0);
    expect(b.levelMm).toBe(1300);
  });

  it('吸着圏外なら動かない（自由配置・禁止しない）', () => {
    const far = rail('b', 1800 + TOL_MM + 100, 3600 + TOL_MM + 100, 1300);
    const snap = snapJoint(far, [a], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap).toEqual({ dxMm: 0, dyMm: 0 });
  });
});

describe('上下の連鎖（450 刻み）', () => {
  it('手摺の上に置いた手摺が、同じ位置で 450 上へ揃う', () => {
    const a = rail('a', 0, 1800, 1300);
    const b = snapped(rail('b', 40, 1840, 1700), [a]);   // 450 上へ 50mm ずれて置いた
    expect(partRangeMm(b, sg)!.x0Mm).toBe(0);
    expect(b.levelMm).toBe(1750);                        // 1300 + 450
  });
});

describe('踏板⇔踏板も同じ横連鎖', () => {
  it('踏板の端に踏板が続く', () => {
    const a = board('a', 0, 1800, 1300);
    const b = snapped(board('b', 1850, 3650, 1330), [a]);
    expect(partRangeMm(b, sg)!.x0Mm).toBe(1800);
    expect(b.levelMm).toBe(1300);
  });
});

describe('支柱⇔支柱の横連鎖（標準スパン 1800）', () => {
  it('隣に立てた支柱が 1800 ピッチへ揃う', () => {
    const p1 = newElevationPart('post', 'p1', 0, { xMm: 1800, yMm: 400 }, { komaCount: 4 });
    const p2raw = newElevationPart('post', 'p2', 0, { xMm: 3660, yMm: 450 }, { komaCount: 4 });
    const p2 = snapped(p2raw, [p1]);
    expect(partRangeMm(p2, sg)!.x0Mm).toBe(3600);
    expect(p2.levelMm).toBe(400);
  });
});

describe('手摺の楔へ支柱を差す（v3b から効いている経路の確認）', () => {
  it('並べた手摺の継ぎ目へ支柱を寄せると、コマが楔に吸着する', () => {
    // コマ高さ 1550 に並べた 2 本（皿 400 → コマは 650/1100/1550…）
    const a = rail('a', 0, 1800, 1550);
    const b = rail('b', 1800, 3600, 1550);
    // 継ぎ目(1800) の少し左・少し下から寄せる
    const post = snapped(
      newElevationPart('post', 'p', 0, { xMm: 1740, yMm: 380 }, { komaCount: 8 }), [a, b]);
    expect(partRangeMm(post, sg)!.x0Mm).toBe(1800);
    // 支柱のコマのどれかが手摺の高さに一致する
    const pockets = partJoints(post, sg).filter((j) => j.kind === 'pocket');
    expect(pockets.some((p) => Math.abs(p.yMm - 1550) < 1e-6)).toBe(true);
  });
});

describe('優先順位: 実在 ＞ 仮想', () => {
  const post = {
    id: 'post:1', kind: 'post' as const, scaffoldIndex: 0, origin: 'auto' as const,
    postIndex: 1, x0Mm: 1800, x1Mm: 1800,
  };

  it('同じ距離なら実在の支柱のコマを選ぶ', () => {
    // 支柱 1800 のコマ 1550 に刺さっている手摺（右端が 1800）
    const a = rail('a', 0, 1800, 1550);
    const b = rail('b', 1810, 3610, 1560);            // どちらへも近い位置
    const snap = snapJoint(b, [a, post], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap.to?.virtual).toBeFalsy();
    expect(snap.to?.partId).toBe('post:1');
  });

  it('実在が圏外・仮想が圏内なら仮想へ吸着する（柱がまだ無い所でも並ぶ）', () => {
    // 支柱から遠く離れた高さ・位置に並べた手摺どうし
    const a = rail('a', 10000, 11800, 5000);
    const b = rail('b', 11850, 13650, 5030);
    const snap = snapJoint(b, [a, post], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap.to?.virtual).toBe(true);
    expect(snap.to?.partId).toBe('a');
  });

  it('仮想が明らかに近ければ仮想を選ぶ（実在は 1px の余裕ぶんだけ優先）', () => {
    const a = rail('a', 0, 1800, 3000);              // 支柱のコマ(2900/3350)から離れた高さ
    const b = rail('b', 1805, 3605, 3005);
    const snap = snapJoint(b, [a, post], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap.to?.virtual).toBe(true);
    expect(snap.dxMm).toBe(-5);
    expect(snap.dyMm).toBe(-5);
  });
});
