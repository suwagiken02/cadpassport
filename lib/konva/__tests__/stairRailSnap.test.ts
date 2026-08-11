// ============================================================
// P-1-fix11: 階段は「辺が近くの手摺にぴったり沿う位置」へ吸着する。
//
// P-1-fix10 では「4 辺が手摺で囲まれた枡」を探したが、実務では階段の周りが
// 3 方向・2 方向しか囲われていないことも多く、囲まれていないと吸着しないのでは
// 使えなかった（実機の指摘）。手摺 1 本で成立する形にする。
//
//   ・辺が手摺に重なる位置に置く（手摺の長さは問わない）
//   ・沿う方向は「角が手摺の端点に揃う位置」を優先、遠ければカーソルに合わせる
//   ・どちら側へ出すかはカーソルのある側
//   ・向きは自動で変えない（P-1-fix10 の判断を維持）
//   ・手摺が無ければ 600×1800 の格子（実在の手摺 > 抽象格子）
// ============================================================
import { describe, it, expect } from 'vitest';
import { mmToGrid } from '../gridUtils';
import { snapStairToCell, snapStairToCellGrid, stairFootprintGrid } from '../planeParts';
import type { Handrail, HandrailLengthMm } from '@/types';

const W = mmToGrid(600);    // 60 = 階段の短手
const H = mmToGrid(1800);   // 180 = 階段の長手

let seq = 0;
const rail = (
  x: number, y: number, lengthMm: HandrailLengthMm, direction: 'horizontal' | 'vertical',
): Handrail => ({ id: `h${seq++}`, x, y, lengthMm, direction, color: '#000' });

/** 4 辺を手摺で囲んだ 600×1800 の枡（縦長）。 */
const cellRails = (x: number, y: number): Handrail[] => [
  rail(x, y, 600, 'horizontal'),
  rail(x, y + H, 600, 'horizontal'),
  rail(x, y, 1800, 'vertical'),
  rail(x + W, y, 1800, 'vertical'),
];

describe('手摺 1 本でも吸着する（囲まれていなくてよい）', () => {
  it('水平の手摺 1 本に、階段の辺が沿う', () => {
    const rails = [rail(100, 200, 1800, 'horizontal')];
    // 手摺のすぐ下を指す → 上辺が手摺に乗る
    const at = snapStairToCell({ x: 130, y: 210 }, 0, rails);
    expect(at.y).toBe(200);
  });

  it('垂直の手摺 1 本でも沿う', () => {
    const rails = [rail(100, 200, 1800, 'vertical')];
    // 手摺のすぐ右を指す → 左辺が手摺に乗る
    const at = snapStairToCell({ x: 110, y: 280 }, 0, rails);
    expect(at.x).toBe(100);
  });

  it('2 方向しか無くても両方に沿う（L 字の隅）', () => {
    const rails = [rail(100, 200, 1800, 'horizontal'), rail(100, 200, 1800, 'vertical')];
    // 隅の内側を指す
    const at = snapStairToCell({ x: 110, y: 215 }, 0, rails);
    // どちらか近い方の手摺に沿う。ここでは縦の手摺（x 方向に 10）が近い
    expect(at.x).toBe(100);
  });

  it('3 方向でも吸着する', () => {
    const rails = cellRails(100, 200).slice(0, 3);
    const at = snapStairToCell({ x: 100 + W / 2, y: 200 + H / 2 }, 0, rails);
    expect(at).toEqual({ x: 100, y: 200 });
  });
});

describe('短手が沿う場合・長手が沿う場合の両方', () => {
  it('縦長のとき、水平の手摺には短手(600)が沿う', () => {
    const rails = [rail(0, 0, 1800, 'horizontal')];
    const at = snapStairToCell({ x: 30, y: 20 }, 0, rails);
    expect(at.y).toBe(0);
    expect(stairFootprintGrid(0).w).toBe(W);   // 手摺に乗るのは短手
  });

  it('縦長のとき、垂直の手摺には長手(1800)が沿う', () => {
    const rails = [rail(0, 0, 1800, 'vertical')];
    const at = snapStairToCell({ x: 20, y: 90 }, 0, rails);
    expect(at.x).toBe(0);
    expect(stairFootprintGrid(0).h).toBe(H);   // 手摺に乗るのは長手
  });

  it('横向き(90°)なら関係が入れ替わる', () => {
    const rails = [rail(0, 0, 1800, 'horizontal')];
    const at = snapStairToCell({ x: 90, y: 20 }, 90, rails);
    expect(at.y).toBe(0);
    expect(stairFootprintGrid(90).w).toBe(H);   // 水平の手摺に長手が乗る
  });
});

describe('手摺の長さは問わない', () => {
  it.each([1800, 1200, 900, 600, 400, 300] as HandrailLengthMm[])('%dmm の手摺にも沿う', (mm) => {
    const rails = [rail(500, 700, mm, 'horizontal')];
    const at = snapStairToCell({ x: 510, y: 710 }, 0, rails);
    expect(at.y, `${mm}`).toBe(700);
  });

  it('階段の辺より短い手摺でも沿う（400 の手摺に 600 の辺）', () => {
    const rails = [rail(0, 0, 400, 'horizontal')];
    const at = snapStairToCell({ x: 20, y: 10 }, 0, rails);
    expect(at.y).toBe(0);
  });

  it('階段の辺より長い手摺なら、上を滑らせられる', () => {
    const rails = [rail(0, 0, 1800, 'horizontal')];
    // 手摺の中ほど。角合わせの範囲外なのでカーソルに合わせて滑る
    const a = snapStairToCell({ x: 90, y: 10 }, 0, rails);
    const b = snapStairToCell({ x: 120, y: 10 }, 0, rails);
    expect(a.y).toBe(0);
    expect(b.y).toBe(0);
    expect(b.x).toBeGreaterThan(a.x);
  });
});

describe('角が手摺の端点に揃う位置を優先する', () => {
  it('手摺の端の近くでは角合わせになる', () => {
    const rails = [rail(100, 200, 1800, 'horizontal')];
    // 左端のすぐ内側 → 階段の左角が手摺の左端に揃う
    expect(snapStairToCell({ x: 105, y: 210 }, 0, rails).x).toBe(100);
    // 右端のすぐ内側 → 階段の右角が手摺の右端に揃う
    expect(snapStairToCell({ x: 100 + H - 5, y: 210 }, 0, rails).x).toBe(100 + H - W);
  });

  it('端から遠ければカーソルに合わせる（角合わせに引きずられない）', () => {
    const rails = [rail(0, 0, 1800, 'horizontal')];
    const at = snapStairToCell({ x: 90, y: 10 }, 0, rails);
    expect(at.x).toBe(90 - W / 2);
  });
});

describe('カーソルのある側に置かれる', () => {
  it('水平の手摺: 下側を指せば下、上側を指せば上', () => {
    const rails = [rail(0, 500, 1800, 'horizontal')];
    expect(snapStairToCell({ x: 30, y: 510 }, 0, rails).y).toBe(500);        // 下に出る
    expect(snapStairToCell({ x: 30, y: 490 }, 0, rails).y).toBe(500 - H);    // 上に出る
  });

  it('垂直の手摺: 右側を指せば右、左側を指せば左', () => {
    const rails = [rail(500, 0, 1800, 'vertical')];
    expect(snapStairToCell({ x: 510, y: 90 }, 0, rails).x).toBe(500);        // 右に出る
    expect(snapStairToCell({ x: 490, y: 90 }, 0, rails).x).toBe(500 - W);    // 左に出る
  });

  it('どちら側でも手摺には必ず沿う（辺が線に乗る）', () => {
    const rails = [rail(0, 500, 1800, 'horizontal')];
    for (const y of [505, 495]) {
      const at = snapStairToCell({ x: 30, y }, 0, rails);
      expect([at.y, at.y + H], `${y}`).toContain(500);
    }
  });
});

describe('囲まれた枡では結果的にぴったり納まる', () => {
  it('4 辺が手摺の枡の中心を指せば、枡に一致する', () => {
    const rails = cellRails(100, 200);
    expect(snapStairToCell({ x: 100 + W / 2, y: 200 + H / 2 }, 0, rails)).toEqual({ x: 100, y: 200 });
  });

  it('枡の中ならどこを指しても枡に納まる', () => {
    const rails = cellRails(37, 91);
    for (const [dx, dy] of [[5, 5], [W - 5, H - 5], [W / 2, 10], [3, H - 10]]) {
      expect(snapStairToCell({ x: 37 + dx, y: 91 + dy }, 0, rails), `${dx},${dy}`)
        .toEqual({ x: 37, y: 91 });
    }
  });

  it('枡が並んでいれば、指した枡に納まる', () => {
    const rails = [...cellRails(0, 0), ...cellRails(300, 0)];
    expect(snapStairToCell({ x: W / 2, y: H / 2 }, 0, rails)).toEqual({ x: 0, y: 0 });
    expect(snapStairToCell({ x: 300 + W / 2, y: H / 2 }, 0, rails)).toEqual({ x: 300, y: 0 });
  });
});

describe('近い手摺を優先する', () => {
  it('2 本あればカーソルに近い方に沿う', () => {
    const rails = [rail(0, 0, 1800, 'horizontal'), rail(0, 400, 1800, 'horizontal')];
    expect(snapStairToCell({ x: 90, y: 20 }, 0, rails).y).toBe(0);
    expect(snapStairToCell({ x: 90, y: 380 }, 0, rails).y).toBe(400 - H);
  });

  it('遠い手摺には吸着しない（格子へ落ちる）', () => {
    const rails = [rail(0, 0, 1800, 'horizontal')];
    const far = { x: 90, y: 5000 };
    expect(snapStairToCell(far, 0, rails)).toEqual(snapStairToCellGrid(far, 0));
  });
});

describe('向きは自動で変えない', () => {
  it('外形は選んだ向きのまま', () => {
    expect(stairFootprintGrid(0)).toEqual({ w: W, h: H });
    expect(stairFootprintGrid(90)).toEqual({ w: H, h: W });
    expect(stairFootprintGrid(180)).toEqual({ w: W, h: H });
    expect(stairFootprintGrid(270)).toEqual({ w: H, h: W });
  });

  it('横長の枡でも、縦長を選んでいれば縦長のまま置かれる', () => {
    // 横長(1800×600)の枡
    const rails = [
      rail(100, 200, 1800, 'horizontal'), rail(100, 200 + W, 1800, 'horizontal'),
      rail(100, 200, 600, 'vertical'), rail(100 + H, 200, 600, 'vertical'),
    ];
    const at = snapStairToCell({ x: 100 + H / 2, y: 200 + W / 2 }, 0, rails);
    // 縦長のまま、どちらかの水平手摺に辺が沿うだけ。
    // 横長の枡に収まる＝向きが変わる、にはならない。
    const railYs = [200, 200 + W];
    expect(railYs.some((y) => at.y === y || at.y + H === y)).toBe(true);
    // 横長の枡（1800×600）にぴったり収まってはいない＝向きを変えていない
    expect({ x: at.x, y: at.y }).not.toEqual({ x: 100, y: 200 });
  });

  it('180°/270° でも同じ規則で沿う', () => {
    const rails = [rail(0, 500, 1800, 'horizontal')];
    expect(snapStairToCell({ x: 30, y: 510 }, 180, rails).y).toBe(500);
    expect(snapStairToCell({ x: 90, y: 510 }, 270, rails).y).toBe(500);
  });
});

describe('手摺が無い場所（従来どおり）', () => {
  it('手摺ゼロなら格子へ寄る', () => {
    const cursor = { x: 97, y: 263 };
    expect(snapStairToCell(cursor, 0, [])).toEqual(snapStairToCellGrid(cursor, 0));
  });

  it('斜めの手摺しか無ければ格子へ寄る（辺を沿わせられない）', () => {
    const rails: Handrail[] = [{ id: 'd', x: 0, y: 0, lengthMm: 1800, direction: 45, color: '#000' }];
    const cursor = { x: 30, y: 30 };
    expect(snapStairToCell(cursor, 0, rails)).toEqual(snapStairToCellGrid(cursor, 0));
  });

  it('格子の位置にも置ける（何もない場所に置けることは維持）', () => {
    expect(snapStairToCell({ x: 1000, y: 1000 }, 0, [])).toBeTruthy();
  });
});

describe('ゴーストの位置 = 置かれる位置', () => {
  it('同じ引数なら必ず同じ答え', () => {
    const rails = [...cellRails(100, 200), rail(400, 700, 1200, 'horizontal')];
    for (const deg of [0, 90, 180, 270]) {
      for (const c of [{ x: 120, y: 250 }, { x: 420, y: 710 }, { x: 9000, y: 9000 }]) {
        expect(snapStairToCell(c, deg, rails), `${deg}/${c.x},${c.y}`)
          .toEqual(snapStairToCell(c, deg, rails));
      }
    }
  });

  it('ゴーストもドロップも snapStairToCell を通している', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../placement/planePlacement.ts'), 'utf8');
    // ゴーストと配置の 2 箇所。どちらも同じ関数・同じ引数。
    expect((src.match(/snapStairToCell\(gridPos, drag\.angleDeg, /g) ?? []).length).toBe(2);
    expect(src).not.toMatch(/snapStairToCellGrid\(/);
  });
});
