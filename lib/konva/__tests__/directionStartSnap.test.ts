// ============================================================
// S-8: 方向入力でタップした位置をどこへ寄せるか。
//
// 躯体・屋根・障害物はガイドの交点に縛る（建物は「建物と足場は必ず平行」の世界で、
// 壁の位置が半端だと足場の割付が崩れる）。**敷地だけ**は自由座標なので、
// 交点への丸めをやめてタップした場所そのままにする。
// 建物・障害物の角への強スナップはどちらにも残す。
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  EDGE_SNAP_PX, VERTEX_SNAP_PX, directionTowards, showsDirectionGrid, snapDirectionPoint,
} from '../directionStartSnap';
import { snapToGridIntersection } from '../snapUtils';
import type { BuildingShape, DirectionInputTarget, Obstacle, Point } from '@/types';

const building = (points: Point[]): BuildingShape => ({
  id: 'b1', type: 'polygon', points, fill: '#3d3d3a',
});
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const ctx = (target: DirectionInputTarget, over: Partial<{
  buildings: BuildingShape[]; obstacles: Obstacle[]; zoom: number;
}> = {}) => ({
  target,
  buildings: over.buildings ?? [],
  obstacles: over.obstacles ?? [],
  zoom: over.zoom ?? 1,
});

/** 交点にも 1 グリッドにも乗らない、中途半端な座標。 */
const ODD: Point = { x: 123.456, y: -78.912 };

// ============================================================
describe('敷地: タップした座標そのまま (= S-8)', () => {
  it('交点から外れた座標がそのまま返る（丸めない）', () => {
    expect(snapDirectionPoint(ODD, ctx('site'))).toEqual({ x: 123.456, y: -78.912 });
  });

  it('小数の座標もそのまま', () => {
    for (const p of [{ x: 0.5, y: 0.5 }, { x: -3.25, y: 7.75 }, { x: 1000.1, y: -2000.9 }]) {
      expect(snapDirectionPoint(p, ctx('site'))).toEqual(p);
    }
  });

  it('交点のすぐ近くでも寄せない（自由が原則）', () => {
    // 100 の倍数は「太い線の交点」。従来ならここへ吸着していた
    const near = { x: 100.4, y: 200.4 };
    expect(snapDirectionPoint(near, ctx('site'))).toEqual(near);
  });

  it('建物が居ても、角から遠ければそのまま', () => {
    const b = [building(rect(0, 0, 100, 80))];
    expect(snapDirectionPoint(ODD, ctx('site', { buildings: b }))).toEqual(ODD);
  });
});

// ============================================================
describe('建物・障害物の角への吸着は敷地でも残る', () => {
  const b = [building(rect(0, 0, 100, 80))];

  it('角のすぐ近くをタップすれば角に吸着する', () => {
    expect(snapDirectionPoint({ x: 2, y: 3 }, ctx('site', { buildings: b }))).toEqual({ x: 0, y: 0 });
  });

  it('どの角にも吸着する', () => {
    for (const corner of rect(0, 0, 100, 80)) {
      const near = { x: corner.x + 1.5, y: corner.y - 1.5 };
      expect(snapDirectionPoint(near, ctx('site', { buildings: b })), `${corner.x},${corner.y}`)
        .toEqual(corner);
    }
  });

  it('角から離れれば吸着しない', () => {
    const far = { x: 50.3, y: 40.7 };
    expect(snapDirectionPoint(far, ctx('site', { buildings: b }))).toEqual(far);
  });

  it('障害物の角にも吸着する', () => {
    const o: Obstacle[] = [{ id: 'o1', type: 'aircon', x: 300, y: 300, width: 80, height: 30,
      points: rect(300, 300, 80, 30) }];
    expect(snapDirectionPoint({ x: 301, y: 301 }, ctx('site', { obstacles: o }))).toEqual({ x: 300, y: 300 });
  });

  it('躯体でも同じ角へ吸着する（共通の作法）', () => {
    expect(snapDirectionPoint({ x: 2, y: 3 }, ctx('building', { buildings: b }))).toEqual({ x: 0, y: 0 });
  });
});

// ============================================================
describe('躯体・屋根・障害物は従来どおり交点に縛る（不変の固定）', () => {
  /** 移設前の実装そのもの（角に当たらない場合の枝）。 */
  const legacy = (raw: Point, zoom: number) => snapToGridIntersection(raw.x, raw.y, zoom);

  it.each(['building', 'roof', 'obstacle'] as const)('%s は交点へ丸められる', (target) => {
    expect(snapDirectionPoint(ODD, ctx(target))).toEqual(legacy(ODD, 1));
  });

  it('中途半端な座標が敷地とは違う結果になる', () => {
    const site = snapDirectionPoint(ODD, ctx('site'));
    const b = snapDirectionPoint(ODD, ctx('building'));
    expect(site).not.toEqual(b);
    expect(Number.isInteger(b.x)).toBe(true);
    expect(Number.isInteger(b.y)).toBe(true);
  });

  it('太い線の交点（100 の倍数）へ寄る', () => {
    expect(snapDirectionPoint({ x: 100.4, y: 200.4 }, ctx('building'))).toEqual({ x: 100, y: 200 });
  });

  it('細い線の交点（50 の倍数）へ寄る', () => {
    expect(snapDirectionPoint({ x: 150.2, y: 250.2 }, ctx('building'))).toEqual({ x: 150, y: 250 });
  });

  it('どちらにも寄らなければ 1 グリッドへ丸める', () => {
    expect(snapDirectionPoint({ x: 123.4, y: 77.6 }, ctx('building'))).toEqual({ x: 123, y: 78 });
  });

  it('ズームが変わっても従来の計算どおり', () => {
    for (const zoom of [0.25, 1, 3]) {
      expect(snapDirectionPoint(ODD, ctx('building', { zoom })), `${zoom}`)
        .toEqual(legacy(ODD, zoom));
    }
  });

  it('吸着の距離は移設前の値のまま', () => {
    expect(VERTEX_SNAP_PX).toBe(30);
    expect(EDGE_SNAP_PX).toBe(10);
  });
});

// ============================================================
describe('ガイド交点を出すか', () => {
  it('敷地では出さない', () => {
    expect(showsDirectionGrid('site')).toBe(false);
  });

  it('躯体・屋根・障害物では従来どおり出す', () => {
    for (const t of ['building', 'roof', 'obstacle'] as const) {
      expect(showsDirectionGrid(t), t).toBe(true);
    }
  });
});

// ============================================================
describe('タップ先へのキャラの向き', () => {
  const O = { x: 0, y: 0 };

  it('横のずれが大きければ左右', () => {
    expect(directionTowards(O, { x: 100, y: 10 })).toBe('right');
    expect(directionTowards(O, { x: -100, y: 10 })).toBe('left');
  });

  it('縦のずれが大きければ上下', () => {
    expect(directionTowards(O, { x: 10, y: 100 })).toBe('down');
    expect(directionTowards(O, { x: 10, y: -100 })).toBe('up');
  });

  it('ちょうど斜め 45° は左右を採る（交点タップと同じ決め方）', () => {
    expect(directionTowards(O, { x: 100, y: 100 })).toBe('right');
  });
});
