import { describe, it, expect } from 'vitest';
import { subtractIntervals, applyOcclusionCut, type ElevationScaffold } from '../elevationEngine';
import type { Face } from '../faceReconstruction';

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

describe('applyOcclusionCut: 視覚ギャップ (E-5-fix3)', () => {
  it('既定 gap=5(50mm): 奥列の切断端が手前列端から離れる(275 から始まる)', () => {
    const inner = sc(270, 90, 450, [1800]); // 奥
    const outer = sc(450, -90, 270, [1800]); // 手前(端 x=270)
    // 既定 gap で applyOcclusionCut（run は gap0 なので直接呼ぶ）。
    const [rInner, rOuter] = applyOcclusionCut([inner, outer], 'south');
    // 手前端 270 + gap5 = 275 から奥列が始まる → 270..275 が見える切れ目。
    expect(railsXs(rInner)).toEqual([[275, 450]]);
    expect(railsXs(rOuter)).toEqual([[-90, 270]]); // 手前は不変
  });

  it('gap=5: boards も手前端から離れる', () => {
    const inner = sc(270, 90, 450, [], [400]);
    const outer = sc(450, -90, 270, [], [400]);
    const [rInner] = applyOcclusionCut([inner, outer], 'south');
    expect(rInner.boards.map((b) => [b.x0, b.x1])).toEqual([[275, 450]]);
  });

  it('gap=5: 3列コの字は中央の奥列が両手前端から gap 分内側に残る', () => {
    const back = sc(0, 0, 300, [1800]);
    const midL = sc(10, 0, 100, [1800]);  // 手前左(端 100)
    const midR = sc(20, 200, 300, [1800]);// 手前右(端 200)
    const [rBack] = applyOcclusionCut([back, midL, midR], 'south');
    // 105..195（左端100+5 〜 右端200-5）
    expect(railsXs(rBack)).toEqual([[105, 195]]);
  });
});
