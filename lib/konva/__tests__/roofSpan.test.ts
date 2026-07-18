import { describe, it, expect } from 'vitest';
import type { BuildingShape, WallSpan } from '@/types';
import type { BuildingShape as BS } from '@/types';
import {
  perimeterGrid, posToArc, arcToPos, fullSpan, edgeRangeToSpan,
  spanSegments, spanCoveredEdges, spanPolylinePoints, offsetSpanPolyline, spanEquals,
  walkDirectionsAt, stepToVertex, snapArcToVertex,
} from '../roofSpan';

// RECT: e0 (0,0)->(360,0) len360, e1 ->(360,540) len540, e2 ->(0,540) len360, e3 ->(0,0) len540。
const RECT: BuildingShape = {
  id: 'B', type: 'polygon', fill: '#000',
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }],
};
const span = (startEdge: number, startT: number, endEdge: number, endT: number): WallSpan =>
  ({ startEdge, startT, endEdge, endT });

describe('arc 変換', () => {
  it('perimeter と pos↔arc', () => {
    expect(perimeterGrid(RECT)).toBe(1800);
    expect(posToArc(RECT, 1, 0)).toBe(360);       // 辺1の頭 = 辺0の長さ
    expect(posToArc(RECT, 0, 0.5)).toBe(180);
    expect(arcToPos(RECT, 180)).toEqual({ edge: 0, t: 0.5 });
    expect(arcToPos(RECT, 360)).toEqual({ edge: 1, t: 0 });
  });
});

describe('spanSegments / coveredEdges', () => {
  it('full は全辺 [0,1]', () => {
    const segs = spanSegments(RECT, fullSpan());
    expect(segs.map((s) => s.edge)).toEqual([0, 1, 2, 3]);
    expect(segs.every((s) => s.t0 === 0 && Math.abs(s.t1 - 1) < 1e-6)).toBe(true);
  });
  it('辺0だけ（0→360）→ 辺0 [0,1] のみ', () => {
    const segs = spanSegments(RECT, span(0, 0, 1, 0));
    expect(segs).toHaveLength(1);
    expect(segs[0].edge).toBe(0);
    expect(spanCoveredEdges(RECT, span(0, 0, 1, 0))).toEqual([0]);
  });
  it('辺の途中→途中（辺0の0.5から辺1の0.5）は 3 セグメント（辺0後半・辺1前半）', () => {
    const s = span(0, 0.5, 1, 0.5);
    const segs = spanSegments(RECT, s);
    expect(segs.map((x) => x.edge)).toEqual([0, 1]);
    expect(segs[0].t0).toBeCloseTo(0.5, 6); expect(segs[0].t1).toBeCloseTo(1, 6);
    expect(segs[1].t0).toBeCloseTo(0, 6); expect(segs[1].t1).toBeCloseTo(0.5, 6);
  });
  it('コーナーをまたぐ wrap（辺3後半→辺0前半）', () => {
    const s = span(3, 0.5, 0, 0.5);
    expect(spanCoveredEdges(RECT, s)).toEqual([0, 3]);
  });
});

describe('spanPolylinePoints', () => {
  it('辺0（0→360）は始点(0,0)→終点(360,0)', () => {
    expect(spanPolylinePoints(RECT, span(0, 0, 1, 0))).toEqual([{ x: 0, y: 0 }, { x: 360, y: 0 }]);
  });
});

describe('offsetSpanPolyline', () => {
  it('full は閉じたオフセット多角形（4 頂点・出幅60で外へ）', () => {
    const oh = [60, 60, 60, 60];
    const { points, closed } = offsetSpanPolyline(RECT, fullSpan(), oh);
    expect(closed).toBe(true);
    expect(points).toHaveLength(4);
    // 外へ広がる（左上頂点は (-60,-60) 付近）
    expect(points.some((p) => p.x < -50 && p.y < -50)).toBe(true);
  });
  it('部分区間は開いた折れ線（辺0を出幅60で北へ）', () => {
    const oh = [60, 0, 0, 0];
    const { points, closed } = offsetSpanPolyline(RECT, span(0, 0, 1, 0), oh);
    expect(closed).toBe(false);
    // 辺0の外向き法線は北(y-)なので y=-60 へ平行移動
    expect(points[0]).toEqual({ x: 0, y: -60 });
    expect(points[points.length - 1]).toEqual({ x: 360, y: -60 });
  });
});

describe('walkDirectionsAt / stepToVertex (R-1e-fix2)', () => {
  // RECT の辺: e0=右, e1=下, e2=左, e3=上。
  it('辺0の中央は 右(+arc)/左(-arc)', () => {
    expect(walkDirectionsAt(RECT, 180)).toEqual([{ compass: 'right', arcDir: 1 }, { compass: 'left', arcDir: -1 }]);
  });
  it('角(辺0→辺1)は 下(+arc)へ曲がり、戻り(-arc)は 左', () => {
    expect(walkDirectionsAt(RECT, 360)).toEqual([{ compass: 'down', arcDir: 1 }, { compass: 'left', arcDir: -1 }]);
  });
  it('外周ループなので常に2方向（行き止まりなし）', () => {
    expect(walkDirectionsAt(RECT, 900)).toHaveLength(2);
  });
  it('stepToVertex: 中央から±で辺途中まで / 角からは次辺長・前辺長', () => {
    expect(stepToVertex(RECT, 180, 1)).toBeCloseTo(180, 6);
    expect(stepToVertex(RECT, 180, -1)).toBeCloseTo(180, 6);
    expect(stepToVertex(RECT, 360, 1)).toBeCloseTo(540, 6); // 辺1の長さ
    expect(stepToVertex(RECT, 360, -1)).toBeCloseTo(360, 6); // 辺0の長さ
  });
});

describe('walkDirectionsAt: 4つの角で正しい2方向のみ (R-1e-fix3)', () => {
  // 座標系: 画面 y は下向き（点の y が大きいほど下）。RECT は時計回り。
  // 角では「その角に集まる2つの壁」の向き＝互いに直交する2方向だけが出る。
  const dirs = (arc: number) => walkDirectionsAt(RECT, arc).map((d) => d.compass).sort();
  it('左上角(0,0): 右(辺0)と下(辺3を戻る)', () => {
    expect(dirs(0)).toEqual(['down', 'right']);
  });
  it('右上角(360,0): 下(辺1)と左(辺0を戻る)', () => {
    expect(dirs(360)).toEqual(['down', 'left']);
  });
  it('右下角(360,540): 左(辺2)と上(辺1を戻る) ← 症状の角。↑が出る', () => {
    expect(dirs(900)).toEqual(['left', 'up']);
  });
  it('左下角(0,540): 上(辺3)と右(辺2を戻る)', () => {
    expect(dirs(1260)).toEqual(['right', 'up']);
  });
});

describe('walkDirectionsAt: L字の入隅角 (R-1e-fix3)', () => {
  // L字(時計回り): (0,0)-(360,0)-(360,180)-(180,180)-(180,360)-(0,360)。
  //   e0右, e1下, e2左, e3下, e4左, e5上。入隅=(180,180)（凹角）。
  const L: BS = { id: 'L', type: 'polygon', fill: '#000',
    points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 180 }, { x: 180, y: 180 }, { x: 180, y: 360 }, { x: 0, y: 360 }] };
  const arcAt = (edge: number, t: number) => posToArc(L, edge, t);
  it('入隅(180,180)=辺3始点: 下(辺3)と右(辺2を戻る)の2方向', () => {
    // 辺2は(360,180)→(180,180)で左向き。入隅で戻る＝右。辺3は(180,180)→(180,360)で下向き。
    expect(walkDirectionsAt(L, arcAt(3, 0)).map((d) => d.compass).sort()).toEqual(['down', 'right']);
  });
});

describe('snapArcToVertex (R-1e-fix3)', () => {
  it('角付近(下辺 t=0.02 → arc 907.2)は右下頂点 arc 900 へ吸着', () => {
    expect(snapArcToVertex(RECT, posToArc(RECT, 2, 0.02), 22)).toBe(900);
  });
  it('辺の中央付近は吸着しない（辺途中を維持）', () => {
    const mid = posToArc(RECT, 2, 0.5); // 1080
    expect(snapArcToVertex(RECT, mid, 22)).toBe(mid);
  });
});

describe('edgeRangeToSpan / spanEquals', () => {
  it('全辺 → full', () => {
    expect(edgeRangeToSpan(RECT, [0, 1, 2, 3]).full).toBe(true);
  });
  it('連続部分 → その区間', () => {
    const s = edgeRangeToSpan(RECT, [0, 1]);
    expect(s.startEdge).toBe(0); expect(s.endEdge).toBe(1); expect(s.endT).toBe(1);
  });
  it('spanEquals: 同一 arc 区間は true・full 同士 true', () => {
    expect(spanEquals(RECT, span(0, 0, 1, 0), span(0, 0, 1, 0))).toBe(true);
    expect(spanEquals(RECT, fullSpan(), fullSpan())).toBe(true);
    expect(spanEquals(RECT, span(0, 0, 1, 0), span(0, 0, 2, 0))).toBe(false);
  });
});
