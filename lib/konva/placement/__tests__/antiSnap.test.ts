// ============================================================
// P-4: アンチの基点を、左上固定から「スナップ先のどちら側か」で選ぶ形に変える。
//
// ■ 何が困っていたか（実機）
// アンチは手摺と同じ吸着を通し、返る「線の始点」をそのまま anti.x/y
// （＝矩形の**左上**）に入れていた。そのため通り芯に合わせると
// **必ず線の下側にぶら下がる**形でしか置けなかった。
//
// ■ どう決めるか
// 吸着**先**は従来とまったく同じ。変えるのは「その点に矩形のどの隅を合わせるか」。
//   カーソルが線より下 → 上辺を乗せる（線の下側に置かれる）
//   カーソルが線より上 → 下辺を乗せる（線の上側に置かれる）
//
// ■ なぜ「四隅までの距離」ではないか
// 距離だと境界が**矩形の中心を通る十字**に来る。アンチは 400×1800 のように
// 細長いので、少し動かすだけで基点が入れ替わる。「どちら側か」なら境界は
// **線そのもの**にあり、切り替わりは 1 回で済む。
// ここはその判断の記録なので、**切り替わり回数**をテストで固定してある。
// ============================================================
import { describe, it, expect } from 'vitest';
import { antiCornerAt, antiSizeGrid, snapAntiPlacement } from '../antiSnap';
import { rectLeadingEdge, snapSideOf } from '../snapSide';
import { mmToGrid } from '@/lib/konva/gridUtils';
import type { Handrail } from '@/types';

/** 水平の手摺 1 本（y = at の線）。 */
const hRail = (at: number, x = 0, lengthMm: 1800 = 1800): Handrail =>
  ({ id: 'h', x, y: at, lengthMm, direction: 'horizontal', color: '#000' });
/** 垂直の手摺 1 本（x = at の線）。 */
const vRail = (at: number, y = 0, lengthMm: 1800 = 1800): Handrail =>
  ({ id: 'v', x: at, y, lengthMm, direction: 'vertical', color: '#000' });

const RADIUS = 30;
const ANTI_LEN = 1800 as const;
const ANTI_W = 400;

// ============================================================
describe('どちら側かの判定（共有の 1 本）', () => {
  it('線と同じか奥なら、矩形は奥へ伸びる（先頭辺が線に乗る）', () => {
    expect(rectLeadingEdge(100, 100, 40)).toBe(100);
    expect(rectLeadingEdge(120, 100, 40)).toBe(100);
  });

  it('手前なら、矩形は手前へ伸びる（末尾辺が線に乗る）', () => {
    expect(rectLeadingEdge(99, 100, 40)).toBe(60);
    expect(rectLeadingEdge(0, 100, 40)).toBe(60);
  });

  it('境界（ちょうど線の上）は奥へ倒す＝値が揺れない', () => {
    expect(rectLeadingEdge(100, 100, 40)).toBe(100);
    expect(snapSideOf(100, 100)).toBe('far');
    expect(snapSideOf(99.999, 100)).toBe('near');
  });

  it('どちら側でも、矩形のいずれかの辺が必ず線に乗る', () => {
    for (const cursor of [0, 50, 99, 100, 101, 200]) {
      const lead = rectLeadingEdge(cursor, 100, 40);
      const onLine = lead === 100 || lead + 40 === 100;
      expect(onLine, `cursor=${cursor}`).toBe(true);
    }
  });
});

// ============================================================
describe('アンチの外形', () => {
  it('横向きは 長さ × 幅', () => {
    expect(antiSizeGrid(1800, 400, 'horizontal'))
      .toEqual({ w: mmToGrid(1800), h: mmToGrid(400) });
  });

  it('縦向きは 幅 × 長さ', () => {
    expect(antiSizeGrid(1800, 400, 'vertical'))
      .toEqual({ w: mmToGrid(400), h: mmToGrid(1800) });
  });
});

// ============================================================
describe('★ 上下: どちらから近づけるかで基点が変わる', () => {
  // 水平な手摑 (0,0)-(180,0)。端点 (0,0) を狙う。
  const rails = [hRail(0, 0)];
  const h = mmToGrid(ANTI_W);            // 横向きアンチの高さ = 40

  it('下から近づける（上辺が端点の近く）→ 上辺が乗る＝線の下側に置かれる', () => {
    const r = snapAntiPlacement({ x: 3, y: 4 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
    expect(r).not.toBeNull();
    expect(r.anchor).toBe('topLeft');
    expect(r.topLeft.y).toBe(0);
  });

  it('★ 上から近づける（下辺が端点の近く）→ 下辺が乗る＝線の上側に置かれる', () => {
    const r = snapAntiPlacement({ x: 3, y: -h + 4 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
    expect(r).not.toBeNull();
    expect(r.anchor).toBe('bottomLeft');
    expect(r.topLeft.y + h).toBe(0);
    expect(r.topLeft.y).toBeLessThan(0);
  });

  it('同じ線でも、近づけ方で上下どちらにも置ける（今回の目的）', () => {
    const below = snapAntiPlacement({ x: 3, y: 4 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
    const above = snapAntiPlacement({ x: 3, y: -h + 4 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
    expect(below.topLeft.y).toBe(0);
    expect(above.topLeft.y).toBe(-h);
  });
});

// ============================================================
describe('★ 左右: 同じ考え方で効く', () => {
  const rails = [vRail(0, 0)];
  const w = mmToGrid(ANTI_W);

  it('右から近づける → 左辺が乗る', () => {
    const r = snapAntiPlacement({ x: 4, y: 3 }, ANTI_LEN, ANTI_W, 'vertical', rails, RADIUS)!;
    expect(r.anchor).toBe('topLeft');
    expect(r.topLeft.x).toBe(0);
  });

  it('左から近づける → 右辺が乗る', () => {
    const r = snapAntiPlacement({ x: -w + 4, y: 3 }, ANTI_LEN, ANTI_W, 'vertical', rails, RADIUS)!;
    expect(r.anchor).toBe('topRight');
    expect(r.topLeft.x + w).toBe(0);
    expect(r.topLeft.x).toBeLessThan(0);
  });
});

// ============================================================
describe('★ 狙った隅が、吸着先にぴったり一致する', () => {
  const { w, h } = antiSizeGrid(ANTI_LEN, ANTI_W, 'horizontal');

  it('4 通りの隅すべてで、その隅の座標が吸着先と一致する', () => {
    // 隅ごとに、その隅の近くだけに端点がある配置を作る（競合させない）。
    const cases: [string, { x: number; y: number }, string][] = [
      ['左上を寄せる', { x: 3, y: 4 }, 'topLeft'],
      ['右上を寄せる', { x: -w + 3, y: 4 }, 'topRight'],
      ['左下を寄せる', { x: 3, y: -h + 4 }, 'bottomLeft'],
      ['右下を寄せる', { x: -w + 3, y: -h + 4 }, 'bottomRight'],
    ];
    for (const [name, cursor, expected] of cases) {
      const rails = [hRail(0, 0)];   // 端点 (0,0) と (180,0)
      const r = snapAntiPlacement(cursor, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
      expect(r, name).not.toBeNull();
      expect(r.anchor, name).toBe(expected);
      const corner = antiCornerAt(r.topLeft, ANTI_LEN, ANTI_W, 'horizontal', r.anchor);
      expect(corner.x, name + ' x').toBeCloseTo(r.snapIndicator.x, 9);
      expect(corner.y, name + ' y').toBeCloseTo(r.snapIndicator.y, 9);
    }
  });

  it('どの隅が基点でも、その隅は必ず吸着先に乗る', () => {
    const rails = [hRail(0, 0), vRail(0, 0)];
    for (let dy = -h - 5; dy <= 5; dy += 5) {
      for (let dx = -w - 5; dx <= 5; dx += 5) {
        const r = snapAntiPlacement({ x: dx, y: dy }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS);
        if (!r) continue;
        const corner = antiCornerAt(r.topLeft, ANTI_LEN, ANTI_W, 'horizontal', r.anchor);
        expect(corner.x, `dx=${dx} dy=${dy}`).toBeCloseTo(r.snapIndicator.x, 9);
        expect(corner.y, `dx=${dx} dy=${dy}`).toBeCloseTo(r.snapIndicator.y, 9);
      }
    }
  });
});

// ============================================================
describe('★ 切り替わりは 1 回だけ（B を選んだ理由そのもの）', () => {
  function switchCount(
    move: (t: number) => { x: number; y: number },
    from: number, to: number, rails: Handrail[],
    direction: 'horizontal' | 'vertical' = 'horizontal',
  ): number {
    let prev: string | null = null;
    let n = 0;
    for (let t = from; t <= to; t++) {
      const r = snapAntiPlacement(move(t), ANTI_LEN, ANTI_W, direction, rails, RADIUS);
      const a = r ? r.anchor : 'none';
      if (prev !== null && a !== prev) n++;
      prev = a;
    }
    return n;
  }

  const h = mmToGrid(ANTI_W);

  it('上から下へ通しで動かしても、切り替わりは 1 回', () => {
    const rails = [hRail(0, 0)];
    expect(switchCount((t) => ({ x: 3, y: t }), -h - 10, 10, rails)).toBe(1);
  });

  it('左から右へ通しでも、切り替わりは 1 回', () => {
    const rails = [vRail(0, 0)];
    const w = mmToGrid(ANTI_W);
    expect(switchCount((t) => ({ x: t, y: 3 }), -w - 10, 10, rails, 'vertical')).toBe(1);
  });

  it('同じ位置を 2 回聞いても結果が変わらない（値が揺れない）', () => {
    const rails = [hRail(0, 0)];
    const a = snapAntiPlacement({ x: 3, y: -h / 2 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS);
    const b = snapAntiPlacement({ x: 3, y: -h / 2 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS);
    expect(a).toEqual(b);
  });
});

// ============================================================
describe('吸着先は従来と同じ（回帰）', () => {
  it('手摺が無ければ吸着しない', () => {
    expect(snapAntiPlacement({ x: 10, y: 10 }, ANTI_LEN, ANTI_W, 'horizontal', [], RADIUS)).toBeNull();
  });

  it('遠い手摺には吸着しない', () => {
    const far = [hRail(1000)];
    expect(snapAntiPlacement({ x: 0, y: 0 }, ANTI_LEN, ANTI_W, 'horizontal', far, 5)).toBeNull();
  });

  it('吸着先は手摺の端点（従来の snapToHandrail が返す点そのもの）', () => {
    const rails = [hRail(0, 0)];               // (0,0)-(180,0)
    const r = snapAntiPlacement({ x: 3, y: 4 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
    const ends = [{ x: 0, y: 0 }, { x: mmToGrid(1800), y: 0 }];
    expect(ends.some((e) => e.x === r.snapIndicator.x && e.y === r.snapIndicator.y)).toBe(true);
  });

  it('既存アンチにも吸着する（従来どおり antis を見る）', () => {
    const antis = [{
      id: 'a1', x: 0, y: 0, width: 400 as const, lengthMm: 1800, direction: 'horizontal' as const,
    }];
    const r = snapAntiPlacement({ x: 3, y: 4 }, ANTI_LEN, ANTI_W, 'horizontal', [], RADIUS, antis);
    expect(r).not.toBeNull();
  });

  it('★ 下側から近づけた場合は、従来とまったく同じ位置に置かれる', () => {
    // 従来は必ず「左上を吸着先に合わせる」。下側から近づけたときはそれと同じになる。
    const rails = [hRail(0, 0)];
    const r = snapAntiPlacement({ x: 3, y: 4 }, ANTI_LEN, ANTI_W, 'horizontal', rails, RADIUS)!;
    expect(r.anchor).toBe('topLeft');
    expect(r.topLeft).toEqual(r.snapIndicator);   // 左上＝吸着先（従来と同じ）
  });
});

// ============================================================
describe('階段と考え方を共有している（ばらつかない）', () => {
  const read = (rel: string) =>
    require('fs').readFileSync(require('path').resolve(__dirname, rel), 'utf8');

  it('階段は共有の rectLeadingEdge を使っている', () => {
    const src = read('../../planeParts.ts');
    expect(src).toMatch(/rectLeadingEdge\(cursor\.y, s\.at, h\)/);
    expect(src).toMatch(/rectLeadingEdge\(cursor\.x, s\.at, w\)/);
  });

  it('アンチは相互参照のコメントを持っている（どちらを直す人も見落とさない）', () => {
    const src = read('../antiSnap.ts');
    expect(src).toMatch(/snapStairToCell/);
    expect(src).toMatch(/どちらを直すときも、もう一方を必ず見ること/);
  });

  it('共有の定義がアンチ・階段の両方から参照されている', () => {
    const shared = read('../snapSide.ts');
    expect(shared).toMatch(/アンチ/);
    expect(shared).toMatch(/階段/);
  });
});
