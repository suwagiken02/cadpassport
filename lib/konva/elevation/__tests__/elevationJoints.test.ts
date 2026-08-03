// ============================================================
// E-8-v3b: 接合吸着エンジン。
//
// 原則:
//   1. コマ（楔ポケット）と手摺の楔が吸着する
//   2. 支柱のホゾ（下端）と受け（上端）が吸着する
//   3. それ以外はどこにでも置ける（圏外なら補正 0 ＝ そのままの位置）
//   4. パレット由来でも自動生成でも扱いは同一
// 置ける/置けないの判定（占有・許可）は持たない＝重複配置も自由。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { GRID_MM, movePart, partRangeMm, postMemberBottomMm } from '../elevationParts';
import { partJoints, snapJoint } from '../elevationJoints';

const geom: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360],          // 面軸グリッド → 0 / 1800 / 3600 mm
    jackTopMm: 400,
    topRailMm: 6700,
    levelsMm: [1300, 3100, 4900],
    komaGridMm: Array.from({ length: 14 }, (_, k) => 650 + 450 * k),   // 650..6500
  }],
};
const sg = geom.scaffolds[0];
/** 画面 1mm = 0.12px（pxPerGrid 1.2 相当）、吸着 22px ≒ 183mm。 */
const opts = { pxPerMm: 0.12, tolPx: 22 };
const TOL_MM = opts.tolPx / opts.pxPerMm;      // ≒183mm

/** 支柱位置 1（x=1800mm）の自動支柱（皿〜天端の 1 本）。 */
const post1: ElevationPart = {
  id: 'post:0:1', kind: 'post', scaffoldIndex: 0, origin: 'auto',
  postIndex: 1, x0Mm: 1800, x1Mm: 1800,
};
/** 支柱位置 0（x=0mm）。 */
const post0: ElevationPart = { ...post1, id: 'post:0:0', postIndex: 0, x0Mm: 0, x1Mm: 0 };

describe('接合点（部材が持つオス・メス）', () => {
  it('手摺は両端に楔（オス）を持つ', () => {
    const rail: ElevationPart = {
      id: 'r', kind: 'rail', scaffoldIndex: 0, origin: 'auto',
      x0Mm: 0, x1Mm: 1800, levelMm: 1550,
    };
    const js = partJoints(rail, sg);
    expect(js.map((j) => j.kind)).toEqual(['wedge', 'wedge']);
    expect(js.map((j) => [j.xMm, j.yMm])).toEqual([[0, 1550], [1800, 1550]]);
  });

  it('支柱はホゾ（オス）・受け（メス）・コマ（メス）を持つ', () => {
    const js = partJoints(post1, sg);
    expect(js.filter((j) => j.kind === 'spigot')).toHaveLength(1);
    expect(js.filter((j) => j.kind === 'cup')).toHaveLength(1);
    const pockets = js.filter((j) => j.kind === 'pocket');
    expect(pockets.length).toBe(sg.komaGridMm.length);
    expect(pockets.every((j) => j.xMm === 1800)).toBe(true);
    expect(pockets.map((j) => j.yMm)).toEqual(sg.komaGridMm);
  });

  it('ジャッキは上端の受け（メス）だけ', () => {
    const jack: ElevationPart = {
      id: 'j', kind: 'jack', scaffoldIndex: 0, origin: 'auto', x0Mm: 1800, x1Mm: 1800,
    };
    expect(partJoints(jack, sg).map((j) => [j.kind, j.yMm])).toEqual([['cup', 400]]);
  });

  it('継ぎ足した支柱のコマは自分の下端基準（スロット表に依存しない）', () => {
    const stacked: ElevationPart = {
      id: 's', kind: 'post', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 1800, x1Mm: 1800, levelMm: 6700, komaCount: 4,
    };
    const pockets = partJoints(stacked, sg).filter((j) => j.kind === 'pocket');
    expect(pockets.map((j) => j.yMm)).toEqual([6950, 7400, 7850, 8300]);
  });
});

describe('原則1: 楔 ⇔ コマ が吸着する', () => {
  const rail: ElevationPart = {
    id: 'r', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
    x0Mm: 0, x1Mm: 1800, levelMm: 1550,
  };

  it('コマの近くまで運ぶと、楔がコマにぴったり合う', () => {
    // 右端の楔(1800,1550)を、支柱1のコマ 1550 のすぐ近く（+80mm, +60mm）へ
    const snap = snapJoint(rail, [post0, post1], sg, { dxMm: 80, dyMm: 60 }, opts);
    expect(snap.to?.kind).toBe('pocket');
    // 素直に動かした位置 + 補正 = コマの位置
    expect(80 + snap.dxMm).toBe(0);
    expect(1550 + 60 + snap.dyMm).toBe(1550);
  });

  it('1 コマ上のコマへも吸う（近い方が選ばれる）', () => {
    const snap = snapJoint(rail, [post0, post1], sg, { dxMm: 0, dyMm: 430 }, opts);
    expect(1550 + 430 + snap.dyMm).toBe(2000);   // 1550 の 1 つ上のコマ
  });

  it('原則3: 圏外なら吸わず、置いた場所にそのまま置かれる', () => {
    // コマは 450 刻み。ちょうど中間（225mm）へ置けば、上下どちらのコマからも
    // 吸着距離(≒183mm)より遠い＝どこにも吸わない。
    expect(225).toBeGreaterThan(TOL_MM);
    const snap = snapJoint(rail, [post0, post1], sg, { dxMm: 0, dyMm: 225 }, opts);
    expect(snap).toMatchObject({ dxMm: 0, dyMm: 0 });
    expect(snap.to).toBeUndefined();
  });

  it('支柱が無ければどこへでも自由に置ける', () => {
    const snap = snapJoint(rail, [], sg, { dxMm: 37, dyMm: 11 }, opts);
    expect(snap).toMatchObject({ dxMm: 0, dyMm: 0 });
  });

  it('重複配置を禁止しない（同じコマに 2 本目も吸着する）', () => {
    const first = movePart(rail, sg, { dxMm: 0, dyMm: 0 });
    const second: ElevationPart = { ...rail, id: 'r2' };
    const snap = snapJoint(second, [post0, post1, first], sg, { dxMm: 60, dyMm: 40 }, opts);
    expect(snap.to?.kind).toBe('pocket');        // 埋まっていても吸う
  });
});

describe('原則2: ホゾ ⇔ 受け / 下端 ⇔ ジャッキ', () => {
  it('支柱の下端が、別の支柱の頭（受け）に吸着する', () => {
    const head = 6700;                            // post1 の上端（天端）
    const free: ElevationPart = {
      id: 'p2', kind: 'post', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 1800, x1Mm: 1800, levelMm: head - 120, komaCount: 8,   // 頭の少し下
    };
    const snap = snapJoint(free, [post1], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap.to?.kind).toBe('cup');
    expect(postMemberBottomMm(free, sg) + snap.dyMm).toBe(head);
  });

  it('支柱の下端が、ジャッキの上端に吸着する', () => {
    const jack: ElevationPart = {
      id: 'j', kind: 'jack', scaffoldIndex: 0, origin: 'auto', x0Mm: 3600, x1Mm: 3600,
    };
    const free: ElevationPart = {
      id: 'p3', kind: 'post', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 3600, x1Mm: 3600, levelMm: 500, komaCount: 4,
    };
    const snap = snapJoint(free, [jack], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap.to?.kind).toBe('cup');
    expect(500 + snap.dyMm).toBe(sg.jackTopMm);
  });

  it('オス同士・メス同士は吸着しない', () => {
    const railA: ElevationPart = {
      id: 'a', kind: 'rail', scaffoldIndex: 0, origin: 'manual', x0Mm: 0, x1Mm: 1800, levelMm: 1550,
    };
    const railB: ElevationPart = { ...railA, id: 'b', levelMm: 1560 };
    // 楔(オス)同士なので、10mm しか離れていなくても吸わない
    expect(snapJoint(railA, [railB], sg, { dxMm: 0, dyMm: 0 }, opts)).toMatchObject({ dxMm: 0, dyMm: 0 });
  });
});

describe('原則4: 自動生成もパレット由来も同一に扱う', () => {
  it('origin が違っても接合点・吸着結果は同じ', () => {
    const auto: ElevationPart = {
      id: 'r', kind: 'rail', scaffoldIndex: 0, origin: 'auto', x0Mm: 0, x1Mm: 1800, levelMm: 1550,
    };
    const manual: ElevationPart = { ...auto, id: 'r', origin: 'manual' };
    expect(partJoints(manual, sg)).toEqual(partJoints(auto, sg));
    const move = { dxMm: 70, dyMm: 50 };
    expect(snapJoint(manual, [post1], sg, move, opts))
      .toEqual(snapJoint(auto, [post1], sg, move, opts));
  });

  it('スロット番号を持たない部材（パレット由来）でも吸着する', () => {
    const bare: ElevationPart = {
      id: 'new', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 100, x1Mm: 1900, levelMm: 1600,       // index 一切なし
    };
    const snap = snapJoint(bare, [post1], sg, { dxMm: 0, dyMm: 0 }, opts);
    expect(snap.to?.kind).toBe('pocket');
  });
});

describe('movePart: 自由座標を書き換えるだけ', () => {
  it('手摺は両端と高さが移動量ぶん動く', () => {
    const rail: ElevationPart = {
      id: 'r', kind: 'rail', scaffoldIndex: 0, origin: 'auto', x0Mm: 0, x1Mm: 1800, levelMm: 1550,
    };
    const moved = movePart(rail, sg, { dxMm: 250, dyMm: -450 });
    expect(partRangeMm(moved, sg)).toEqual({ x0Mm: 250, x1Mm: 2050 });
    expect(moved.levelMm).toBe(1100);
    expect(moved.origin).toBe('manual');
  });

  it('支柱は下端と長さを持つ自由な 1 本になる（段の縛りが外れる）', () => {
    const seg: ElevationPart = {
      id: 'p', kind: 'post', scaffoldIndex: 0, origin: 'auto',
      postIndex: 1, segmentIndex: 1, x0Mm: 1800, x1Mm: 1800,
    };
    const before = postMemberBottomMm(seg, sg);
    const moved = movePart(seg, sg, { dxMm: 900, dyMm: 450 });
    expect(moved.segmentIndex).toBeUndefined();
    expect(moved.levelMm).toBe(before + 450);
    expect(moved.komaCount).toBeGreaterThan(0);
    expect(partRangeMm(moved, sg)).toEqual({ x0Mm: 2700, x1Mm: 2700 });
  });

  it('スロットに無い中途半端な位置へも動かせる', () => {
    const rail: ElevationPart = {
      id: 'r', kind: 'rail', scaffoldIndex: 0, origin: 'auto', x0Mm: 0, x1Mm: 1800, levelMm: 1550,
    };
    const moved = movePart(rail, sg, { dxMm: 137, dyMm: 89 });
    expect(moved.x0Mm).toBe(137);
    expect(moved.levelMm).toBe(1639);
    // 面軸 mm はグリッドの 10 倍という関係だけは保つ
    expect(moved.x0Mm! / GRID_MM).toBeCloseTo(13.7);
  });
});
