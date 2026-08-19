// ============================================================
// S-8: 敷地の手描きは交点に縛らず、タップした場所に置ける。
//
// 躯体・屋根・障害物は従来どおり交点縛り（建物は「建物と足場は必ず平行」の世界で、
// 壁の位置が半端だと足場の割付が崩れる）。変わっていないことをここで固定する。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { directionTowards, snapDirectionPoint } from '@/lib/konva/directionStartSnap';
import type { BuildingShape, CanvasData, DirectionInputTarget, Point } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const interaction = read('lib/konva/useCanvasInteraction.ts');
const gridCanvas = read('components/canvas/GridCanvas.tsx');

const st = () => useCanvasStore.getState();

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const building = (points: Point[]): BuildingShape => ({
  id: 'b1', type: 'polygon', points, fill: '#3d3d3a',
});

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** 起点タップ 1 回ぶん（useCanvasInteraction の building+direction ブロックと同じ手順）。 */
const tapStart = (rawPos: Point) => {
  const s = useCanvasStore.getState();
  s.addDirectionPoint(snapDirectionPoint(rawPos, {
    target: s.pendingTargetType,
    buildings: s.canvasData.buildings,
    obstacles: s.canvasData.obstacles,
    zoom: s.zoom,
  }));
  s.setShowDirectionInputModal(true);
};

/** 起点のあとに「空いているところをタップ」1 回ぶん（敷地だけの経路）。 */
const tapNext = (rawPos: Point) => {
  const s = useCanvasStore.getState();
  const at = snapDirectionPoint(rawPos, {
    target: s.pendingTargetType,
    buildings: s.canvasData.buildings,
    obstacles: s.canvasData.obstacles,
    zoom: s.zoom,
  });
  const last = s.directionCursor ?? s.directionPoints[s.directionPoints.length - 1];
  s.setPendingDirection(directionTowards(last, at));
  s.setPendingDirectionTarget(at);
  s.setShowDirectionInputModal(true);
};

const startDrawing = (target: DirectionInputTarget) => {
  const s = st();
  s.setPendingTargetType(target);
  s.setBuildingInputMethod('direction');
  s.setMode('building');
  s.clearDirectionPoints();
};

/** 交点にも 1 グリッドにも乗らない座標。 */
const ODD: Point = { x: 123.456, y: -78.912 };

beforeEach(() => {
  st().setCanvasData(blank());
  st().clearDirectionPoints();
  useCanvasStore.setState({ zoom: 1, pendingTargetType: 'building', mode: 'select' });
});

// ============================================================
describe('敷地: タップした場所が起点になる', () => {
  it('交点から外れた座標でも、その座標がそのまま入る', () => {
    startDrawing('site');
    tapStart(ODD);
    expect(st().directionPoints).toEqual([ODD]);
  });

  it('小数の座標でも丸められない', () => {
    startDrawing('site');
    tapStart({ x: 0.5, y: -0.25 });
    expect(st().directionPoints[0]).toEqual({ x: 0.5, y: -0.25 });
  });

  it('起点を打つとモーダルが開く（従来どおり）', () => {
    startDrawing('site');
    tapStart(ODD);
    expect(st().showDirectionInputModal).toBe(true);
  });
});

// ============================================================
describe('敷地: 建物の角の近くは従来どおり吸着する', () => {
  beforeEach(() => {
    st().setCanvasData({ ...blank(), buildings: [building(rect(0, 0, 100, 80))] } as CanvasData);
    startDrawing('site');
  });

  it('角のすぐ近くをタップすれば角に乗る', () => {
    tapStart({ x: 2, y: 3 });
    expect(st().directionPoints).toEqual([{ x: 0, y: 0 }]);
  });

  it('角から離れればタップ座標のまま', () => {
    tapStart({ x: 50.3, y: 40.7 });
    expect(st().directionPoints).toEqual([{ x: 50.3, y: 40.7 }]);
  });
});

// ============================================================
describe('敷地: 起点のあともタップした場所へ進める', () => {
  beforeEach(() => {
    startDrawing('site');
    tapStart({ x: 0, y: 0 });
    st().setShowDirectionInputModal(false);
  });

  it('タップした座標がそのまま行き先になる', () => {
    tapNext(ODD);
    expect(st().pendingDirectionTarget).toEqual(ODD);
  });

  it('行き先に向かってキャラが向く', () => {
    tapNext({ x: 500, y: 10 });
    expect(st().pendingDirection).toBe('right');
    tapNext({ x: 10, y: -500 });
    expect(st().pendingDirection).toBe('up');
  });

  it('距離モーダルが開く（交点タップと同じ受け口）', () => {
    tapNext(ODD);
    expect(st().showDirectionInputModal).toBe(true);
  });

  it('建物の角の近くなら、行き先も角に吸着する', () => {
    st().setCanvasData({ ...st().canvasData, buildings: [building(rect(200, 200, 100, 80))] } as CanvasData);
    tapNext({ x: 201, y: 202 });
    expect(st().pendingDirectionTarget).toEqual({ x: 200, y: 200 });
  });
});

// ============================================================
describe('躯体・屋根は従来どおり交点に丸められる（不変の固定）', () => {
  it.each(['building', 'roof'] as const)('%s の起点は交点へ丸められる', (target) => {
    startDrawing(target);
    tapStart(ODD);
    const p = st().directionPoints[0];
    expect(Number.isInteger(p.x)).toBe(true);
    expect(Number.isInteger(p.y)).toBe(true);
    expect(p).not.toEqual(ODD);
  });

  it('障害物の壁方向入力も従来どおり', () => {
    startDrawing('obstacle');
    tapStart(ODD);
    expect(Number.isInteger(st().directionPoints[0].x)).toBe(true);
  });

  it('躯体では「起点のあとのタップで進む」経路が無い（従来どおり方向パッドだけ）', () => {
    // 実装側で敷地に絞っていることを固定する
    expect(interaction).toMatch(/else if \(s\.pendingTargetType === 'site' && e\.target === stage\)/);
  });

  it('同じ座標でも、敷地と躯体で結果が違う', () => {
    startDrawing('site');
    tapStart(ODD);
    const sitePoint = st().directionPoints[0];
    startDrawing('building');
    tapStart(ODD);
    expect(st().directionPoints[0]).not.toEqual(sitePoint);
  });
});

// ============================================================
describe('ガイド交点は敷地では出さない', () => {
  it('十字ガイドの一覧が空になる', () => {
    expect(gridCanvas).toMatch(/if \(!showsDirectionGrid\(pendingTargetType\)\) return \[\];/);
    expect((gridCanvas.match(/if \(!showsDirectionGrid\(pendingTargetType\)\) return \[\];/g) ?? []))
      .toHaveLength(2);   // guideXs と guideYs の両方
  });

  it('交点マーカーも出さない', () => {
    expect(gridCanvas).toMatch(/\{showDirectionGuide && showsDirectionGrid\(pendingTargetType\) && \(/);
  });

  it('対象が切り替われば作り直す（依存に入っている）', () => {
    expect((gridCanvas.match(/buildingInputMethod, pendingTargetType, directionPoints/g) ?? []))
      .toHaveLength(2);
  });

  it('方向パッドそのものは敷地でも出る（進む手段は残る）', () => {
    expect(gridCanvas).toMatch(/<DirectionPad/);
    expect(gridCanvas).toMatch(/diagonal=\{pendingTargetType === 'site'\}/);
  });
});

// ============================================================
describe('寄せ方の判断は 1 本にまとまっている', () => {
  it('タップの処理が snapDirectionPoint を通る', () => {
    expect(interaction).toMatch(/snapDirectionPoint\(rawPos, snapCtx\)/);
    expect((interaction.match(/snapDirectionPoint\(rawPos, snapCtx\)/g) ?? [])).toHaveLength(2);
  });

  it('古い寄せ方の直書きが残っていない', () => {
    expect(interaction).not.toMatch(/snapToGridIntersection\(rawPos/);
    expect(interaction).not.toMatch(/snapToVertex\(rawPos/);
    expect(interaction).not.toMatch(/snapToEdge\(rawPos/);
  });
});
