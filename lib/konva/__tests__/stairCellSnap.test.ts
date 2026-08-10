// ============================================================
// P-1-fix10: 階段は「実際に配置されている手摺が作る枡」に納まること。
//
// P-1 では「手摺が有るかに関わらず抽象的な 600×1800 の格子へ吸着する」と
// 決めたが、その格子は実際に置かれた手摺の位置と一致しないので、
// 目の前に枡があるのに階段が入らなかった（実機の指摘）。仕様を変える。
//
//   実在の枡 > 抽象格子 の優先順位
//   向きは自動で変えない（選んだ向きの外形に合う枡だけを探す）
//   ゴーストの位置 = 実際に置かれる位置
// ============================================================
import { describe, it, expect } from 'vitest';
import { mmToGrid } from '../gridUtils';
import {
  snapStairToCell, snapStairToCellGrid, stairCellsFromHandrails, stairFootprintGrid,
} from '../planeParts';
import type { Handrail, HandrailLengthMm } from '@/types';

const W = mmToGrid(600);    // 60
const H = mmToGrid(1800);   // 180

let seq = 0;
const rail = (
  x: number, y: number, lengthMm: HandrailLengthMm, direction: 'horizontal' | 'vertical',
): Handrail => ({ id: `h${seq++}`, x, y, lengthMm, direction, color: '#000' });

/**
 * (x, y) を左上とする 600×1800 の枡（縦長）。
 * 上下は 600 手摺、左右は 1800 手摺。
 */
const cellRails = (x: number, y: number): Handrail[] => [
  rail(x, y, 600, 'horizontal'),
  rail(x, y + H, 600, 'horizontal'),
  rail(x, y, 1800, 'vertical'),
  rail(x + W, y, 1800, 'vertical'),
];

/** 横長（1800×600）の枡。 */
const cellRailsWide = (x: number, y: number): Handrail[] => [
  rail(x, y, 1800, 'horizontal'),
  rail(x, y + W, 1800, 'horizontal'),
  rail(x, y, 600, 'vertical'),
  rail(x + H, y, 600, 'vertical'),
];

describe('手摺が作る枡を見つける', () => {
  it('4 辺そろっていれば枡として拾う', () => {
    const cells = stairCellsFromHandrails(cellRails(100, 200), { w: W, h: H });
    expect(cells).toEqual([{ x: 100, y: 200, w: W, h: H }]);
  });

  it('1 辺でも欠けていれば枡ではない', () => {
    for (let i = 0; i < 4; i++) {
      const rails = cellRails(0, 0).filter((_, k) => k !== i);
      expect(stairCellsFromHandrails(rails, { w: W, h: H }), `${i} 本目を抜いた`).toEqual([]);
    }
  });

  it('辺より長い手摺でも枡になる（通り過ぎる手摺）', () => {
    const rails = [
      rail(0, 0, 1800, 'horizontal'),          // 上辺（枡より長い）
      rail(0, H, 1800, 'horizontal'),          // 下辺（枡より長い）
      rail(0, 0, 1800, 'vertical'),
      rail(W, 0, 1800, 'vertical'),
    ];
    expect(stairCellsFromHandrails(rails, { w: W, h: H })).toContainEqual({ x: 0, y: 0, w: W, h: H });
  });

  it('斜めの手摺は枡を作らない', () => {
    const rails: Handrail[] = [
      { id: 'a', x: 0, y: 0, lengthMm: 1800, direction: 45, color: '#000' },
      ...cellRails(0, 0).slice(1),
    ];
    expect(stairCellsFromHandrails(rails, { w: W, h: H })).toEqual([]);
  });

  it('外形が違えば拾わない（縦長の枡は横長の階段の枡ではない）', () => {
    expect(stairCellsFromHandrails(cellRails(0, 0), { w: H, h: W })).toEqual([]);
  });

  it('手摺が 1 本も無ければ枡は無い', () => {
    expect(stairCellsFromHandrails([], { w: W, h: H })).toEqual([]);
  });
});

describe('実在の枡にぴったり納まる', () => {
  it('枡の中を指せば、枡の左上に吸着する', () => {
    const rails = cellRails(100, 200);
    // 枡の中心あたり（抽象格子の目とは合わない位置）
    const at = snapStairToCell({ x: 100 + W / 2, y: 200 + H / 2 }, 0, rails);
    expect(at).toEqual({ x: 100, y: 200 });
  });

  it('抽象格子だけでは枡に入らなかった（今回の指摘そのもの）', () => {
    const rails = cellRails(100, 200);
    const cursor = { x: 100 + W / 2, y: 200 + H / 2 };
    // 従来の抽象格子は枡の位置を知らないので別の場所へ寄せてしまう
    expect(snapStairToCellGrid(cursor, 0)).not.toEqual({ x: 100, y: 200 });
    // 実在の枡を見れば納まる
    expect(snapStairToCell(cursor, 0, rails)).toEqual({ x: 100, y: 200 });
  });

  it('枡の中ならどこを指しても同じ位置に入る', () => {
    const rails = cellRails(37, 91);
    for (const [dx, dy] of [[1, 1], [W - 1, H - 1], [W / 2, 5], [3, H - 3]]) {
      expect(snapStairToCell({ x: 37 + dx, y: 91 + dy }, 0, rails), `${dx},${dy}`)
        .toEqual({ x: 37, y: 91 });
    }
  });

  it('枡が複数あれば、指した枡に入る', () => {
    const rails = [...cellRails(0, 0), ...cellRails(300, 0), ...cellRails(0, 400)];
    expect(snapStairToCell({ x: 10, y: 10 }, 0, rails)).toEqual({ x: 0, y: 0 });
    expect(snapStairToCell({ x: 310, y: 10 }, 0, rails)).toEqual({ x: 300, y: 0 });
    expect(snapStairToCell({ x: 10, y: 410 }, 0, rails)).toEqual({ x: 0, y: 400 });
  });

  it('枡の少し外を指しても、近ければその枡へ寄る', () => {
    const rails = cellRails(500, 500);
    const at = snapStairToCell({ x: 500 + W + 10, y: 500 + H / 2 }, 0, rails);
    expect(at).toEqual({ x: 500, y: 500 });
  });
});

describe('向きは自動で変えない', () => {
  it('縦長を選んでいるとき、横長の枡には入らない（抽象格子へ落ちる）', () => {
    const rails = cellRailsWide(100, 200);
    const cursor = { x: 100 + H / 2, y: 200 + W / 2 };
    const at = snapStairToCell(cursor, 0, rails);   // 0° = 縦長
    expect(at).toEqual(snapStairToCellGrid(cursor, 0));
    expect(at).not.toEqual({ x: 100, y: 200 });
  });

  it('横向き(90°)を選べば、横長の枡に納まる', () => {
    const rails = cellRailsWide(100, 200);
    const at = snapStairToCell({ x: 100 + H / 2, y: 200 + W / 2 }, 90, rails);
    expect(at).toEqual({ x: 100, y: 200 });
  });

  it('外形は選んだ向きのまま（勝手に入れ替わらない）', () => {
    expect(stairFootprintGrid(0)).toEqual({ w: W, h: H });
    expect(stairFootprintGrid(90)).toEqual({ w: H, h: W });
    // 縦長の枡があっても 90° の外形は横長のまま
    const rails = cellRails(0, 0);
    snapStairToCell({ x: 10, y: 10 }, 90, rails);
    expect(stairFootprintGrid(90)).toEqual({ w: H, h: W });
  });

  it('180°/270° も同じ外形の枡を見る', () => {
    expect(snapStairToCell({ x: 110, y: 210 }, 180, cellRails(100, 200))).toEqual({ x: 100, y: 200 });
    expect(snapStairToCell({ x: 110, y: 210 }, 270, cellRailsWide(100, 200))).toEqual({ x: 100, y: 200 });
  });
});

describe('手摺が無い場所にも置ける（従来どおり）', () => {
  it('手摺ゼロなら抽象格子へ寄る', () => {
    const cursor = { x: 97, y: 263 };
    expect(snapStairToCell(cursor, 0, [])).toEqual(snapStairToCellGrid(cursor, 0));
  });

  it('枡から遠い場所では抽象格子へ寄る', () => {
    const rails = cellRails(0, 0);
    const far = { x: 5000, y: 5000 };
    expect(snapStairToCell(far, 0, rails)).toEqual(snapStairToCellGrid(far, 0));
  });

  it('枡を作らない手摺だけがあっても置ける', () => {
    const rails = [rail(0, 0, 1800, 'horizontal'), rail(0, 500, 1800, 'horizontal')];
    const cursor = { x: 30, y: 260 };
    expect(snapStairToCell(cursor, 0, rails)).toEqual(snapStairToCellGrid(cursor, 0));
  });
});

describe('ゴーストの位置 = 置かれる位置', () => {
  it('同じ引数なら必ず同じ答え（ゴーストとドロップは同じ関数を通す）', () => {
    const rails = [...cellRails(100, 200), ...cellRailsWide(400, 700)];
    for (const deg of [0, 90, 180, 270]) {
      for (const c of [{ x: 120, y: 250 }, { x: 450, y: 720 }, { x: 9000, y: 9000 }]) {
        const a = snapStairToCell(c, deg, rails);
        const b = snapStairToCell(c, deg, rails);
        expect(b, `${deg}/${c.x},${c.y}`).toEqual(a);
      }
    }
  });

  it('ゴーストもドロップも snapStairToCell を通している', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../components/toolbar/PartSelector.tsx'), 'utf8');
    expect((src.match(/snapStairToCell\(gridPos, toolbarDrag\.angleDeg, /g) ?? []).length).toBe(2);
    // 抽象格子を直接呼ぶ経路は残っていない
    expect(src).not.toMatch(/snapStairToCellGrid\(/);
  });
});
