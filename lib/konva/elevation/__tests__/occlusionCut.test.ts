import { describe, it, expect } from 'vitest';
import { subtractIntervals, applyOcclusionCut, buildFaceElevation, type ElevationScaffold } from '../elevationEngine';
import { reconstructFaces, type Face } from '../faceReconstruction';
import type { Handrail, HandrailLengthMm, BuildingShape } from '@/types';

/** テスト用 ElevationScaffold（applyOcclusionCut が使う column/rails/boards のみ実装）。 */
function sc(depthCoord: number, xStart: number, xEnd: number, railHeights: number[], boardLevels: number[] = []): ElevationScaffold {
  return {
    column: { face: 'south', floor: 1, depthCoord, xStart, xEnd, rails: [], handrailIds: [] },
    postXs: [xStart, xEnd],
    levels: {} as never,
    boards: boardLevels.map((levelMm) => ({ levelMm, x0: xStart, x1: xEnd })),
    rails: railHeights.map((heightMm) => ({ heightMm, x0: xStart, x1: xEnd })),
    spanRaises: [],
  } as unknown as ElevationScaffold;
}
const railsXs = (s: ElevationScaffold) => s.rails.map((r) => [r.x0, r.x1]);
// 純粋な切断ロジック検証は gap=0 で（ギャップは別 describe で検証）。
const run = (arr: ElevationScaffold[], face: Face) => applyOcclusionCut(arr, face, 0);

describe('subtractIntervals (E-5)', () => {
  it('部分重なり → 残り小区間', () => {
    expect(subtractIntervals(90, 450, [[-90, 270]])).toEqual([[270, 450]]);
  });
  it('中抜き → 2 分割', () => {
    expect(subtractIntervals(0, 300, [[100, 200]])).toEqual([[0, 100], [200, 300]]);
  });
  it('完全被覆 → 空', () => {
    expect(subtractIntervals(0, 100, [[-10, 110]])).toEqual([]);
  });
  it('重なりなし → そのまま', () => {
    expect(subtractIntervals(0, 50, [[100, 150]])).toEqual([[0, 50]]);
  });
  it('複数 holes の和で分割', () => {
    expect(subtractIntervals(0, 300, [[0, 100], [200, 300]])).toEqual([[100, 200]]);
  });
});

describe('applyOcclusionCut: 入隅の前後で奥列の横線を切る (E-5)', () => {
  it('南面 2列(部分重なり): 大 depth=手前、奥列の rails を切る', () => {
    const inner = sc(270, 90, 450, [1800]); // 奥
    const outer = sc(450, -90, 270, [1800]); // 手前
    const [rInner, rOuter] = run([inner, outer], 'south');
    expect(railsXs(rInner)).toEqual([[270, 450]]); // 手前(-90..270)で切られ残り
    expect(railsXs(rOuter)).toEqual([[-90, 270]]); // 手前は不変
  });

  it('boards も同様に切る', () => {
    const inner = sc(270, 90, 450, [], [400]); // 奥・踏板1本
    const outer = sc(450, -90, 270, [], [400]);
    const [rInner] = run([inner, outer], 'south');
    expect(rInner.boards.map((b) => [b.x0, b.x1])).toEqual([[270, 450]]);
  });

  it('完全重なり → 奥列 rails は空', () => {
    const back = sc(0, 0, 100, [1800]);
    const front = sc(10, -10, 110, [1800]);
    const [rBack] = run([back, front], 'south');
    expect(railsXs(rBack)).toEqual([]);
  });

  it('重なりなし → 変化なし', () => {
    const a = sc(0, 0, 50, [1800]);
    const b = sc(10, 100, 150, [1800]);
    const [ra, rb] = run([a, b], 'south');
    expect(railsXs(ra)).toEqual([[0, 50]]);
    expect(railsXs(rb)).toEqual([[100, 150]]);
  });

  it('3列(コの字): 最奥列は手前2列の和で切られ中央だけ残る', () => {
    const back = sc(0, 0, 300, [1800]);   // 最奥
    const midL = sc(10, 0, 100, [1800]);  // 手前・左
    const midR = sc(20, 200, 300, [1800]);// 手前・右
    const [rBack] = run([back, midL, midR], 'south');
    expect(railsXs(rBack)).toEqual([[100, 200]]);
  });

  it('北面は depth 小が手前（符号が逆）', () => {
    const back = sc(90, 90, 450, [1800]);   // 奥(depth 大)
    const front = sc(-90, -90, 270, [1800]);// 手前(depth 小)
    const [rBack, rFront] = run([back, front], 'north');
    expect(railsXs(rBack)).toEqual([[270, 450]]);
    expect(railsXs(rFront)).toEqual([[-90, 270]]);
  });
});

describe('applyOcclusionCut: 視覚ギャップ (E-5-fix4: 全幅比例)', () => {
  it('既定ギャップは面の全幅比例(span540→gap8): 奥列は 278 から始まる', () => {
    const inner = sc(270, 90, 450, [1800]); // 奥
    const outer = sc(450, -90, 270, [1800]); // 手前(端 x=270)
    // 既定ギャップ = round(全幅540 × 0.015) = 8。手前端 270 + 8 = 278 から奥列 → 270..278 が見える切れ目。
    const [rInner, rOuter] = applyOcclusionCut([inner, outer], 'south');
    expect(railsXs(rInner)).toEqual([[278, 450]]);
    expect(railsXs(rOuter)).toEqual([[-90, 270]]); // 手前は不変
  });

  it('既定ギャップ: boards も手前端から離れる(278)', () => {
    const inner = sc(270, 90, 450, [], [400]);
    const outer = sc(450, -90, 270, [], [400]);
    const [rInner] = applyOcclusionCut([inner, outer], 'south');
    expect(rInner.boards.map((b) => [b.x0, b.x1])).toEqual([[278, 450]]);
  });

  it('全幅比例: 物件が大きいほどギャップ(グリッド)も広がる(固定 50mm では潰れる問題の対策)', () => {
    // 同じ入隅構造を 3 倍幅に拡大 → span=1620 → gap=round(1620×0.015)=24。奥列は 810+24=834 から。
    const inner = sc(810, 270, 1350, [1800]); // 奥 x[270,1350]
    const outer = sc(1350, -270, 810, [1800]); // 手前 x[-270,810](端 810)
    const [rInner] = applyOcclusionCut([inner, outer], 'south');
    expect(railsXs(rInner)).toEqual([[834, 1350]]);
  });

  it('下限クランプ: 極小面(span60)でもギャップは 50mm(=5grid)を下回らない', () => {
    const inner = sc(20, 10, 50, [1800]); // 奥 x[10,50]
    const outer = sc(50, -10, 20, [1800]); // 手前 x[-10,20](端 20)
    // round(60×0.015)=1 だが下限 5 に切り上げ → 奥列は 20+5=25 から。
    const [rInner] = applyOcclusionCut([inner, outer], 'south');
    expect(railsXs(rInner)).toEqual([[25, 50]]);
  });

  it('3列コの字(span300→gap5): 中央の奥列が両手前端から gap 分内側に残る', () => {
    const back = sc(0, 0, 300, [1800]);
    const midL = sc(10, 0, 100, [1800]);  // 手前左(端 100)
    const midR = sc(20, 200, 300, [1800]);// 手前右(端 200)
    const [rBack] = applyOcclusionCut([back, midL, midR], 'south');
    // 105..195（左端100+5 〜 右端200-5）
    expect(railsXs(rBack)).toEqual([[105, 195]]);
  });
});

// ============================================================
// E-5-fix4: 実機と同じ自動配置形式の手摺を reconstructFaces→buildFaceElevation に通し、
// 南面の奥列が「切断され、かつ手前列端から離れた（＝突き合わない）」ことを一気通貫で固定する。
// 実機データ形式 = placeHandrailsForEdge / segmentsToHandrails の出力（1 rail = 1 Handrail）。
// ============================================================
describe('E-5-fix4 end-to-end: L字南面の奥列が実機形式でも切断＋離間される', () => {
  let seq = 0;
  const hr = (x: number, y: number, lengthMm: number, direction: 'horizontal' | 'vertical'): Handrail =>
    ({ id: `h${seq++}`, x, y, lengthMm: lengthMm as HandrailLengthMm, direction, color: '#000', floor: 2 });

  // L字 (0,0)-(360,0)-(360,180)-(180,180)-(180,360)-(0,360)、離れ90 の自動配置リング。
  const handrails: Handrail[] = [
    hr(-90, -90, 1800, 'horizontal'), hr(90, -90, 1800, 'horizontal'), hr(270, -90, 1800, 'horizontal'),
    hr(90, 270, 1800, 'horizontal'), hr(270, 270, 1800, 'horizontal'),   // 南内側(奥) y=270
    hr(-90, 450, 1800, 'horizontal'), hr(90, 450, 1800, 'horizontal'),   // 南外側(手前) y=450
    hr(450, -90, 1800, 'vertical'), hr(450, 90, 1800, 'vertical'),
    hr(270, 90, 1800, 'vertical'), hr(270, 270, 1800, 'vertical'),
    hr(-90, -90, 1800, 'vertical'), hr(-90, 90, 1800, 'vertical'), hr(-90, 270, 1800, 'vertical'),
  ];
  const building: BuildingShape = {
    id: 'B1', type: 'polygon', fill: '#333', floor: 2,
    points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 180 }, { x: 180, y: 180 }, { x: 180, y: 360 }, { x: 0, y: 360 }],
  };

  const cols = reconstructFaces(handrails).filter((c) => c.face === 'south');
  const fe = buildFaceElevation(cols, [building], { defaultHeightMm: 4800, pillarType: 'normal', face: 'south' });

  it('南面は奥(depth270)・手前(depth450)の2 scaffold に分離する', () => {
    expect(fe.scaffolds.map((s) => s.column.depthCoord).sort((a, b) => a - b)).toEqual([270, 450]);
  });

  it('奥列の rails/boards は手前区間で切断され、手前端(270)から離れて始まる(≠全幅・≠突き合い)', () => {
    const back = fe.scaffolds.find((s) => s.column.depthCoord === 270)!;
    const front = fe.scaffolds.find((s) => s.column.depthCoord === 450)!;
    // 全幅 540(=col.xEnd450 − 手前 col.xStart-90) の span → gap=round(540×0.015)=8 → 奥列は 278 から。
    expect(back.rails.every((r) => Math.min(r.x0, r.x1) === 278)).toBe(true);
    expect(back.boards.every((b) => Math.min(b.x0, b.x1) === 278)).toBe(true);
    // 手前列は元の 270 端のまま。奥列開始 278 との間に 270..278(=80mm) の見える切れ目。
    // E-8-v2l: 手摺は 1 スパン 1 本になったので、列の右端を持つのは最終スパンだけ。
    expect(Math.max(...front.rails.map((r) => Math.max(r.x0, r.x1)))).toBe(270);
    const gap = Math.min(...back.rails.map((r) => Math.min(r.x0, r.x1))) - Math.max(...front.rails.map((r) => Math.max(r.x0, r.x1)));
    expect(gap).toBe(8); // グリッド=80mm、固定 50mm より広く描画スケールでも視認できる
  });

  it('奥列は全幅[90,450]のまま残っていない(切断が失われていないことの明示)', () => {
    const back = fe.scaffolds.find((s) => s.column.depthCoord === 270)!;
    // もし切断が失われていれば奥列 rails は元の col 全幅[90,450]で残る。278 開始ならその心配なし。
    expect(back.rails.some((r) => Math.min(r.x0, r.x1) === 90)).toBe(false);
  });
});
