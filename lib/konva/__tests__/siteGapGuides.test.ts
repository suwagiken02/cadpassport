// ============================================================
// S-6: 建物と敷地のすき間の距離。
//
//   ・建物の出隅から外向きに伸ばして、最初にぶつかる敷地の辺まで（水平・垂直）
//   ・敷地の入隅から水平に伸ばして、最初にぶつかる建物の壁まで
// ぶつからない向きは出さない。
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  buildingCornerGuides, convexFlags, gapGuides, outwardDirs, polygonSegments,
  polygonSignedArea, rayFirstHit, siteConcaveGuides,
} from '../siteGapGuides';
import { buildingsSitePolygons } from '../siteAutoGenerate';
import type { Point } from '@/types';

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

/** L 字（凹角は (120,60) の 1 つだけ）。 */
const L: Point[] = [
  { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 },
  { x: 200, y: 60 }, { x: 200, y: 200 }, { x: 0, y: 200 },
];

// ============================================================
describe('出隅・入隅の判定', () => {
  it('矩形は 4 つとも出隅', () => {
    expect(convexFlags(rect(0, 0, 100, 80))).toEqual([true, true, true, true]);
  });

  it('描く向きが逆でも同じ（時計回り・反時計回りに依らない）', () => {
    expect(convexFlags([...rect(0, 0, 100, 80)].reverse())).toEqual([true, true, true, true]);
  });

  it('L 字は 5 つが出隅で、凹んだ 1 つだけ入隅', () => {
    const flags = convexFlags(L);
    expect(flags).toEqual([true, true, false, true, true, true]);
    expect(flags.filter(Boolean)).toHaveLength(5);
  });

  it('L 字を逆向きに描いても凹むのは同じ頂点', () => {
    const rev = [...L].reverse();
    const flags = convexFlags(rev);
    const concaveIndex = flags.indexOf(false);
    expect(rev[concaveIndex]).toEqual({ x: 120, y: 60 });
  });

  it('一直線に並んだ点は角として数えない', () => {
    const withMid: Point[] = [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 },
    ];
    expect(convexFlags(withMid)[1]).toBe(false);
  });

  it('点が足りない／つぶれた形では何も立たない', () => {
    expect(convexFlags([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([false, false]);
    expect(convexFlags(rect(0, 0, 100, 0))).toEqual([false, false, false, false]);
  });

  it('符号つき面積の向き', () => {
    expect(polygonSignedArea(rect(0, 0, 100, 80))).toBe(8000);
    expect(polygonSignedArea([...rect(0, 0, 100, 80)].reverse())).toBe(-8000);
  });
});

// ============================================================
describe('外向きの決め方', () => {
  const r = rect(0, 0, 100, 80);

  it('矩形の 4 隅はそれぞれ外へ向く', () => {
    expect(outwardDirs(r, 0)).toEqual({ x: -1, y: -1 });   // 左上
    expect(outwardDirs(r, 1)).toEqual({ x: 1, y: -1 });    // 右上
    expect(outwardDirs(r, 2)).toEqual({ x: 1, y: 1 });     // 右下
    expect(outwardDirs(r, 3)).toEqual({ x: -1, y: 1 });    // 左下
  });

  it('斜めの辺しか持たない角は向きを出さない（嘘の向きを出さない）', () => {
    const tri: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 100 }];
    expect(outwardDirs(tri, 1)).toEqual({});
  });
});

// ============================================================
describe('レイと辺の交差', () => {
  const segs = polygonSegments(rect(-100, -100, 400, 400));   // -100..300

  it('右へ伸ばすと右の辺に当たる', () => {
    expect(rayFirstHit({ x: 0, y: 0 }, 'x', 1, segs)).toEqual({ x: 300, y: 0 });
  });

  it('左・上・下も同じ', () => {
    expect(rayFirstHit({ x: 0, y: 0 }, 'x', -1, segs)).toEqual({ x: -100, y: 0 });
    expect(rayFirstHit({ x: 0, y: 0 }, 'y', -1, segs)).toEqual({ x: 0, y: -100 });
    expect(rayFirstHit({ x: 0, y: 0 }, 'y', 1, segs)).toEqual({ x: 0, y: 300 });
  });

  it('手前にある辺を採る（いちばん最初にぶつかる方）', () => {
    const two = [...polygonSegments(rect(-10, -500, 40, 1000)), ...segs];
    expect(rayFirstHit({ x: 0, y: 0 }, 'x', 1, two)).toEqual({ x: 30, y: 0 });
  });

  it('後ろ側の辺は拾わない（伸ばした向きだけ）', () => {
    const hit = rayFirstHit({ x: 0, y: 0 }, 'x', 1, segs)!;
    expect(hit.x).toBeGreaterThan(0);
  });

  it('ぶつからなければ null', () => {
    expect(rayFirstHit({ x: 1000, y: 1000 }, 'x', 1, segs)).toBeNull();
    expect(rayFirstHit({ x: 0, y: 0 }, 'x', 1, [])).toBeNull();
  });

  it('自分の真上にある辺（距離ゼロ）は拾わない', () => {
    expect(rayFirstHit({ x: -100, y: 0 }, 'x', -1, segs)).toBeNull();
  });

  it('レイと重なっている辺は「ぶつかった」としない', () => {
    const horizontal: [Point, Point][] = [[{ x: 10, y: 0 }, { x: 50, y: 0 }]];
    expect(rayFirstHit({ x: 0, y: 0 }, 'x', 1, horizontal)).toBeNull();
  });

  it('斜めの辺にも当たる', () => {
    const diag: [Point, Point][] = [[{ x: 100, y: -50 }, { x: 100, y: 50 }]];
    expect(rayFirstHit({ x: 0, y: 0 }, 'x', 1, diag)).toEqual({ x: 100, y: 0 });
  });
});

// ============================================================
describe('矩形の建物 ＋ 自動生成の敷地', () => {
  const building = { points: rect(0, 0, 1000, 800) };
  const sites = buildingsSitePolygons([building], 1000).map((points) => ({ points }));

  it('出隅 4 つ × 水平・垂直 ＝ 8 本', () => {
    const gs = buildingCornerGuides([building], polygonSegments(sites[0].points));
    expect(gs).toHaveLength(8);
  });

  it('どれも指定した離れ（1000mm）になる', () => {
    const gs = buildingCornerGuides([building], polygonSegments(sites[0].points));
    for (const g of gs) expect(g.mm).toBe(1000);
  });

  it('水平と垂直が 4 本ずつ', () => {
    const gs = buildingCornerGuides([building], polygonSegments(sites[0].points));
    expect(gs.filter((g) => g.axis === 'x')).toHaveLength(4);
    expect(gs.filter((g) => g.axis === 'y')).toHaveLength(4);
  });

  it('矩形の敷地に入隅は無いので、敷地側の表示は 0 本', () => {
    expect(siteConcaveGuides(sites, polygonSegments(building.points))).toHaveLength(0);
  });

  it('全部あわせて 8 本', () => {
    expect(gapGuides([building], sites)).toHaveLength(8);
  });

  it('敷地を広げれば数値も増える', () => {
    const wide = buildingsSitePolygons([building], 2000).map((points) => ({ points }));
    for (const g of gapGuides([building], wide)) expect(g.mm).toBe(2000);
  });
});

// ============================================================
describe('L 字の建物 ＋ 自動生成の敷地', () => {
  const building = { points: L };
  const sites = buildingsSitePolygons([building], 1000).map((points) => ({ points }));

  it('出隅は 5 つ（凹角は数えない）', () => {
    expect(convexFlags(L).filter(Boolean)).toHaveLength(5);
  });

  it('出隅 5 つ × 2 方向で 10 本（すべて当たる形）', () => {
    const gs = buildingCornerGuides([building], polygonSegments(sites[0].points));
    expect(gs).toHaveLength(10);
  });

  it('切り欠きに面した向きは、その先の辺まで届く（離れより長くなるのが正しい）', () => {
    const gs = buildingCornerGuides([building], polygonSegments(sites[0].points));
    const at = (x: number, y: number, axis: 'x' | 'y') =>
      gs.find((g) => g.from.x === x && g.from.y === y && g.axis === axis)!.mm;
    // 素直に外を向いている角は離れそのもの
    expect(at(0, 0, 'x')).toBe(1000);
    expect(at(0, 0, 'y')).toBe(1000);
    expect(at(200, 200, 'x')).toBe(1000);
    expect(at(200, 200, 'y')).toBe(1000);
    // 切り欠き（L のへこみ）へ向く 2 本は、へこみを通り抜けて先の辺に当たる
    expect(at(120, 0, 'x')).toBe(1800);     // 右へ伸ばすと敷地の右端 x=300 まで
    expect(at(200, 60, 'y')).toBe(1600);    // 上へ伸ばすと敷地の上端 y=-100 まで
  });

  it('どの向きも離れ（1000mm）より短くはならない', () => {
    for (const g of buildingCornerGuides([building], polygonSegments(sites[0].points))) {
      expect(g.mm).toBeGreaterThanOrEqual(1000);
    }
  });

  it('凹角からは伸ばさない（出隅だけ）', () => {
    const gs = buildingCornerGuides([building], polygonSegments(sites[0].points));
    expect(gs.some((g) => g.from.x === 120 && g.from.y === 60)).toBe(false);
  });

  it('敷地側の入隅は 1 つ（建物の凹角に対応）', () => {
    expect(convexFlags(sites[0].points).filter((c) => !c)).toHaveLength(1);
  });

  it('入隅から水平に建物へ当たらない配置では出さない', () => {
    // 自動生成の入隅 (220,-40) は建物の上（y<0）にあるので、水平には当たらない
    expect(siteConcaveGuides(sites, polygonSegments(L))).toHaveLength(0);
  });
});

// ============================================================
describe('敷地の入隅から建物まで（当たる配置）', () => {
  const building = { points: rect(0, 0, 100, 100) };
  // 建物の右側に食い込む切り欠きを持つ敷地
  const site = {
    points: [
      { x: -200, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 30 },
      { x: 200, y: 30 }, { x: 200, y: 70 }, { x: 400, y: 70 },
      { x: 400, y: 300 }, { x: -200, y: 300 },
    ],
  };

  it('入隅は 2 つ', () => {
    expect(convexFlags(site.points).filter((c) => !c)).toHaveLength(2);
  });

  it('入隅から左へ伸ばして建物の右壁に当たる', () => {
    const gs = siteConcaveGuides([site], polygonSegments(building.points));
    expect(gs).toHaveLength(2);
    for (const g of gs) {
      expect(g.to.x).toBe(100);          // 建物の右壁
      expect(g.mm).toBe(1000);           // 200 - 100 = 100 グリッド = 1000mm
      expect(g.axis).toBe('x');
      expect(g.kind).toBe('site');
    }
  });

  it('近い方の向きを採る（左右どちらも見る）', () => {
    const gs = siteConcaveGuides([site], polygonSegments(building.points));
    for (const g of gs) expect(g.to.x).toBeLessThan(g.from.x);
  });

  it('縦に当たらない切り欠きでは、縦は出さない（水平だけ）', () => {
    // 切り欠きの奥は y 30〜70 なので、真上・真下に伸ばしても建物(x 0〜100)には当たらない
    const gs = siteConcaveGuides([site], polygonSegments(building.points));
    expect(gs.every((g) => g.axis === 'x')).toBe(true);
  });
});

// ============================================================
describe('敷地の入隅から建物まで・垂直 (= S-6-fix1)', () => {
  const building = { points: rect(0, 0, 100, 100) };
  // 建物の下側から上へ食い込む切り欠きを持つ敷地（水平の例を 90° 回したもの）
  const site = {
    points: [
      { x: -200, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 300 },
      { x: 70, y: 300 }, { x: 70, y: 200 }, { x: 30, y: 200 },
      { x: 30, y: 300 }, { x: -200, y: 300 },
    ],
  };

  it('入隅は 2 つ', () => {
    expect(convexFlags(site.points).filter((c) => !c)).toHaveLength(2);
  });

  it('入隅から上へ伸ばして建物の下壁に当たる', () => {
    const gs = siteConcaveGuides([site], polygonSegments(building.points));
    expect(gs).toHaveLength(2);
    for (const g of gs) {
      expect(g.axis).toBe('y');
      expect(g.kind).toBe('site');
      expect(g.to.y).toBe(100);          // 建物の下壁
      expect(g.mm).toBe(1000);           // 200 - 100 = 100 グリッド = 1000mm
    }
  });

  it('近い方の向きを採る（上下どちらも見る）', () => {
    const gs = siteConcaveGuides([site], polygonSegments(building.points));
    for (const g of gs) expect(g.to.y).toBeLessThan(g.from.y);
  });

  it('横に当たらない切り欠きでは、横は出さない（垂直だけ）', () => {
    // 切り欠きの奥は x 30〜70 なので、真横に伸ばしても建物(y 0〜100)には当たらない
    const gs = siteConcaveGuides([site], polygonSegments(building.points));
    expect(gs.every((g) => g.axis === 'y')).toBe(true);
  });

  it('横向きと縦向きの切り欠きが両方あれば、水平・垂直が同時に出る', () => {
    // 右から食い込む切り欠き（y 30〜70）と、下から食い込む切り欠き（x 30〜70）
    const both = {
      points: [
        { x: -200, y: -200 }, { x: 400, y: -200 },
        { x: 400, y: 30 }, { x: 200, y: 30 }, { x: 200, y: 70 }, { x: 400, y: 70 },
        { x: 400, y: 300 }, { x: 70, y: 300 }, { x: 70, y: 200 }, { x: 30, y: 200 },
        { x: 30, y: 300 }, { x: -200, y: 300 },
      ],
    };
    const gs = siteConcaveGuides([both], polygonSegments(building.points));
    expect(gs.filter((g) => g.axis === 'x')).toHaveLength(2);
    expect(gs.filter((g) => g.axis === 'y')).toHaveLength(2);
    for (const g of gs) expect(g.mm).toBe(1000);
  });

  it('1 つの入隅から出るのは、当たった軸だけ（両方当たる配置は敷地の外側では起きない）', () => {
    // 水平の切り欠きの奥（200,30）からは、真上・真下に伸ばしても建物(x 0〜100)に当たらない
    const sideNotch = {
      points: [
        { x: -200, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 30 },
        { x: 200, y: 30 }, { x: 200, y: 70 }, { x: 400, y: 70 },
        { x: 400, y: 300 }, { x: -200, y: 300 },
      ],
    };
    const gs = siteConcaveGuides([sideNotch], polygonSegments(building.points));
    expect(gs.filter((g) => g.from.x === 200 && g.from.y === 30).map((g) => g.axis)).toEqual(['x']);
  });

  it('建物が無ければ何も出ない', () => {
    expect(siteConcaveGuides([site], [])).toEqual([]);
  });

  it('入隅がまったく無い敷地では何も出ない', () => {
    expect(siteConcaveGuides([{ points: rect(-200, -200, 600, 600) }],
      polygonSegments(building.points))).toEqual([]);
  });
});

// ============================================================
describe('何も出ないケース（落ちない）', () => {
  it('建物が無ければ空', () => {
    expect(gapGuides([], [{ points: rect(0, 0, 100, 100) }])).toEqual([]);
  });

  it('敷地が無ければ空', () => {
    expect(gapGuides([{ points: rect(0, 0, 100, 100) }], [])).toEqual([]);
  });

  it('どちらも無ければ空', () => {
    expect(gapGuides([], [])).toEqual([]);
  });

  it('点が足りない形は無視する', () => {
    expect(() => gapGuides(
      [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
      [{ points: [{ x: 0, y: 0 }] }],
    )).not.toThrow();
    expect(gapGuides([{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }], [{ points: rect(-10, -10, 100, 100) }])).toEqual([]);
  });

  it('建物が敷地の外にあって当たらない向きは出さない', () => {
    const far = { points: rect(5000, 5000, 100, 100) };
    const site = { points: rect(0, 0, 100, 100) };
    expect(gapGuides([far], [site])).toEqual([]);
  });

  it('斜めの辺だけの建物（三角）は向きが決まらないので出さない', () => {
    const tri = { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 100 }] };
    const site = { points: rect(-200, -200, 600, 600) };
    const gs = gapGuides([tri], [site]);
    // 軸に平行な辺を持つ角（(0,0) と (0,100) は縦辺を持つ）だけが出る
    expect(gs.every((g) => g.axis === 'y')).toBe(true);
  });
});

// ============================================================
describe('形が変われば数値も変わる', () => {
  const building = { points: rect(0, 0, 100, 100) };

  it('敷地の辺を動かすと、その向きの距離だけ変わる', () => {
    const before = gapGuides([building], [{ points: rect(-100, -100, 300, 300) }]);
    const after = gapGuides([building], [{ points: rect(-200, -100, 400, 300) }]);
    const leftBefore = before.filter((g) => g.axis === 'x' && g.to.x < 0).map((g) => g.mm);
    const leftAfter = after.filter((g) => g.axis === 'x' && g.to.x < 0).map((g) => g.mm);
    expect(leftBefore).toEqual([1000, 1000]);
    expect(leftAfter).toEqual([2000, 2000]);
    // 上下は変わっていない
    expect(before.filter((g) => g.axis === 'y').map((g) => g.mm))
      .toEqual(after.filter((g) => g.axis === 'y').map((g) => g.mm));
  });

  it('複数棟でも全部の出隅から出る', () => {
    const two = [{ points: rect(0, 0, 100, 100) }, { points: rect(400, 0, 100, 100) }];
    const site = [{ points: rect(-100, -100, 700, 300) }];
    expect(gapGuides(two, site)).toHaveLength(16);   // 4 隅 × 2 方向 × 2 棟
  });
});
