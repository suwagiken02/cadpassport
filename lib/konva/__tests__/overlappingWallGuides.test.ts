// ============================================================
// R-1m: 他建物と壁が重なる辺でも、対象階の建物の辺が完全に機能すること。
//
// 実機症状（鮎澤氏・2 棟物件）: 1F(下屋) の東辺が 2F の西壁と平面上で重なる物件で、
// その辺に中央・角のスナップガイドが出ず、妻の TOP マーカーが置けなかった。
//
// 根因: isPointInPolygon は ray-cast の `px <` 比較なので、**辺の上**の点の判定が
// 向きで非対称になる（右／東の辺の上は「外」、左／西の辺の上は「内」）。壁を共有する
// 2 棟では、共有線上の点は必ず「西側の建物の内・東側の建物の外」に落ちる。
// R-1h の階スコープと合わさると、1F を編集中にその壁を指しても「建物外」となり、
// 棟ツールはガイドもスナップも出さず、クリックも捨てていた。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import { isPointInPolygon } from '../autoLayoutUtils';
import {
  buildingAtPointOnFloor, distanceToPolygonEdges, isPointOnOrInPolygon, resolveFloorScope,
} from '../floorScope';
import {
  findClosestOutlineEdge, nearestOutlineGuide, outlineGuides, snapToMidpointIfNear,
} from '../heightMarkerUtils';
import { snapRidgeInput } from '../elevation/ridgeProjection';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const building = (id: string, floor: number, points: Point[]): BuildingShape =>
  ({ id, points, floor } as BuildingShape);

/** 実機相当: 1F 下屋(x 0..100 / y 20..80) の東辺 = 2F 本体(x 100..200 / y 0..100) の西壁。 */
const f1 = building('f1', 1, rect(0, 20, 100, 80));
const f2 = building('f2', 2, rect(100, 0, 200, 100));
const buildings = [f1, f2];
/** 1F 東辺（＝共有壁）の中点。妻の TOP を置きたい場所。 */
const eastMid: Point = { x: 100, y: 50 };
/** 棟ツールのスナップ距離相当（15px / gridPx=3 とする）。 */
const TOL = 5;

describe('根因: 辺の上の点は ray-cast だと東西で非対称', () => {
  it('共有壁の上の点は「1F の外・2F の内」になる（これが症状の入口）', () => {
    expect(isPointInPolygon(eastMid.x, eastMid.y, f1.points)).toBe(false);
    expect(isPointInPolygon(eastMid.x, eastMid.y, f2.points)).toBe(true);
  });

  it('西辺の上では逆に「内」になる（＝向きで挙動が違う）', () => {
    expect(isPointInPolygon(0, 50, f1.points)).toBe(true);
  });
});

describe('壁の上を指しても対象階の建物として解決する', () => {
  it('距離: 共有壁の上は 1F の外周から 0', () => {
    expect(distanceToPolygonEdges(eastMid, f1.points)).toBe(0);
  });

  it('isPointOnOrInPolygon は辺の上を内と同じに扱う', () => {
    expect(isPointOnOrInPolygon(eastMid, f1.points, 0.5)).toBe(true);
    expect(isPointOnOrInPolygon({ x: 130, y: 50 }, f1.points, 0.5)).toBe(false);  // 本当に外
  });

  it('1F 編集中に共有壁を指すと 1F が返る（従来は undefined＝建物外）', () => {
    expect(buildingAtPointOnFloor(eastMid, buildings, 1)).toBeUndefined();          // 許容なし＝従来
    expect(buildingAtPointOnFloor(eastMid, buildings, 1, TOL)?.id).toBe('f1');      // R-1m
  });

  it('壁の少し外側（許容内）も対象階の建物として拾う', () => {
    expect(buildingAtPointOnFloor({ x: 102, y: 50 }, buildings, 1, TOL)?.id).toBe('f1');
  });

  it('許容を超えて離れた点は従来どおり建物外', () => {
    expect(buildingAtPointOnFloor({ x: 130, y: 50 }, buildings, 1, TOL)).toBeUndefined();
  });

  it('内部に含む建物があればそちらが優先（壁の近さで奪われない）', () => {
    expect(buildingAtPointOnFloor({ x: 98, y: 50 }, buildings, 1, TOL)?.id).toBe('f1');
    expect(buildingAtPointOnFloor({ x: 102, y: 50 }, buildings, 2, TOL)?.id).toBe('f2');
  });

  it('階スコープは変わらない（2F 編集中に 1F は拾わない）', () => {
    expect(resolveFloorScope(buildings, 2).map((b) => b.id)).toEqual(['f2']);
    expect(buildingAtPointOnFloor({ x: 50, y: 50 }, buildings, 2, TOL)).toBeUndefined();
  });
});

describe('棟ツール: 重なり辺でも角・辺中点へ吸着できる', () => {
  it('共有壁の中点で解決した建物は 1F、そこへ吸着する', () => {
    const b = buildingAtPointOnFloor({ x: 101, y: 51 }, buildings, 1, TOL)!;
    expect(b.id).toBe('f1');
    const s = snapRidgeInput({ x: 101, y: 51 }, b.points, TOL);
    expect(s.snapped).toBe(true);
    expect(s.point).toEqual(eastMid);            // 東辺の中点 = 妻の中央
  });

  it('東辺の角にも吸着する', () => {
    const b = buildingAtPointOnFloor({ x: 101, y: 21 }, buildings, 1, TOL)!;
    const s = snapRidgeInput({ x: 101, y: 21 }, b.points, TOL);
    expect(s.snapped).toBe(true);
    expect(s.point).toEqual({ x: 100, y: 20 }); // 北東の角
  });

  it('吸着した点は「内部か壁の上」なので確定できる（建物外として捨てられない）', () => {
    const b = buildingAtPointOnFloor({ x: 101, y: 51 }, buildings, 1, TOL)!;
    const s = snapRidgeInput({ x: 101, y: 51 }, b.points, TOL);
    expect(isPointOnOrInPolygon(s.point, b.points, 0.5)).toBe(true);
  });
});

describe('高さマーカー: 重なり辺でも狙った建物の辺に付く', () => {
  it('1F だけを対象にすれば共有壁は 1F の東辺（edgeIndex=1）に解決する', () => {
    const scope = resolveFloorScope(buildings, 1);
    const r = findClosestOutlineEdge({ x: 101, y: 50 }, scope, 3)!;
    expect(r.buildingId).toBe('f1');
    expect(r.edgeIndex).toBe(1);                 // (100,20)→(100,80) が東辺
    expect(r.t).toBeCloseTo(0.5, 6);
  });

  it('妻の TOP（辺中点）へ吸着する', () => {
    const scope = resolveFloorScope(buildings, 1);
    const r = findClosestOutlineEdge({ x: 101, y: 52 }, scope, 3)!;
    // ポインタ screen 位置は grid×gridPx（pan 0・gridPx=3）
    const t = snapToMidpointIfNear(r.edgeIndex, r.t, 101 * 3, 52 * 3, f1, 3, 0, 0, 10);
    expect(t).toBe(0.5);
  });

  it('同じ階の 2 棟が壁を共有していても、配列順ではなく短い辺（狙った下屋）を採る', () => {
    // 下屋(y 20..80・辺長 60) と 母屋(y 0..100・辺長 100) が x=100 で壁を共有
    const annex = building('annex', 1, rect(0, 20, 100, 80));
    const main = building('main', 1, rect(100, 0, 200, 100));
    // 母屋が先にある配列でも、短い辺＝下屋の東辺が選ばれる
    const r = findClosestOutlineEdge(eastMid, [main, annex], 3)!;
    expect(r.buildingId).toBe('annex');
    expect(r.edgeIndex).toBe(1);
  });

  it('距離が違えば従来どおり近い方（同距離のときだけの決着）', () => {
    const annex = building('annex', 1, rect(0, 20, 100, 80));
    const main = building('main', 1, rect(110, 0, 210, 100));
    const r = findClosestOutlineEdge({ x: 101, y: 50 }, [main, annex], 5)!;
    expect(r.buildingId).toBe('annex');
  });
});

// ============================================================
// R-1m-fix: ガイドの「表示」も「スナップ判定」も outlineGuides が唯一の出所。
//
// 実機症状: R-1m 後、重なり辺でも角スナップ・マーカー設置はできるようになったが、
// 辺中央の ◆ だけが右辺（2F 壁と重なる辺）に出なかった。
// 表示は「建物の辺ごと」、判定は「クリックで決まった 1 辺の中央だけ」と別ロジックで、
// 重なり辺では判定側が隣（共線で長い）の辺に解決されると狙った ◆ が反応しない。
// 両方を 1 つのリストから作り、対象階の建物の全辺に必ず出ることを固定する。
// ============================================================
describe('ガイドの表示リスト（outlineGuides）', () => {
  it('対象階の建物の全辺に 角 ○ と 辺中央 ◆ が出る（重なり辺も欠けない）', () => {
    const gs = outlineGuides([f1]);
    expect(gs.filter((g) => g.kind === 'mid')).toHaveLength(4);
    expect(gs.filter((g) => g.kind === 'corner')).toHaveLength(4);
    // 2F と重なる東辺(edgeIndex=1)の中央 ◆ が必ずある
    const east = gs.find((g) => g.kind === 'mid' && g.edgeIndex === 1);
    expect(east?.point).toEqual(eastMid);
    // 左（西）辺の中央も従来どおり
    expect(gs.some((g) => g.kind === 'mid' && g.point.x === 0 && g.point.y === 50)).toBe(true);
  });

  it('他の建物の有無で内容が変わらない（重なりと無関係）', () => {
    const only = outlineGuides([f1]);
    const withNeighbour = outlineGuides([f1]).concat();  // 対象階に 2F は入らない
    expect(withNeighbour).toEqual(only);
    // 2F を対象にすれば 2F の全辺（＝別の中点）になる
    const g2 = outlineGuides([f2]).filter((g) => g.kind === 'mid');
    expect(g2).toHaveLength(4);
    expect(g2.some((g) => g.point.x === 100 && g.point.y === 50)).toBe(true);
  });

  it('長さ 0 の辺（重複頂点）は中央を作らない', () => {
    const dup = building('dup', 1, [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
    ]);
    const mids = outlineGuides([dup]).filter((g) => g.kind === 'mid');
    expect(mids).toHaveLength(3);
  });
});

describe('表示＝吸着（nearestOutlineGuide）', () => {
  const gs = outlineGuides([f1]);

  it('重なり辺の ◆ を狙えばその中央に吸着する', () => {
    const g = nearestOutlineGuide({ x: 101, y: 52 }, gs, 5)!;
    expect(g.kind).toBe('mid');
    expect(g.edgeIndex).toBe(1);
    expect(g.t).toBe(0.5);
    expect(g.point).toEqual(eastMid);
  });

  it('角の近くなら角（t=0）', () => {
    const g = nearestOutlineGuide({ x: 101, y: 21 }, gs, 5)!;
    expect(g.kind).toBe('corner');
    expect(g.point).toEqual({ x: 100, y: 20 });
  });

  it('どのガイドからも離れていれば null（従来の辺への射影に任せる）', () => {
    expect(nearestOutlineGuide({ x: 100, y: 35 }, gs, 5)).toBeNull();
  });

  it('同距離なら中央 ◆ を優先（◆ を狙う操作そのものなので）', () => {
    // 辺長 20 の正方形: 角(0,0) と 中央(10,0) から等距離の点 (5,0)
    const sq = building('sq', 1, rect(0, 0, 20, 20));
    const g = nearestOutlineGuide({ x: 5, y: 0 }, outlineGuides([sq]), 6)!;
    expect(g.kind).toBe('mid');
  });

  it('隣の建物の共線な辺があっても、対象階の建物の ◆ に吸着する', () => {
    // 対象は 1F だけ（階スコープ）。2F の西壁中点(100,50) と同座標でも 1F の辺に付く。
    const g = nearestOutlineGuide(eastMid, outlineGuides(resolveFloorScope(buildings, 1)), 5)!;
    expect(g.buildingId).toBe('f1');
    expect(g.kind).toBe('mid');
  });
});
