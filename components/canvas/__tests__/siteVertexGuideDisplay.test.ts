// ============================================================
// S-5: 距離ガイドを出す条件と、指の動きへの追従。
//
// ・敷地の頂点を**ドラッグしている間だけ**出す（離せば消える）
// ・建物が無い図面では何も出さない（落ちない）
// ・敷地の頂点ドラッグ以外（部材の移動・建物の操作）では一切出さない
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { buildingCornersGrid, nearestBuildingCornerGuide } from '@/lib/konva/siteVertexGuide';
import type { CanvasData, Point } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const siteLayer = read('components/canvas/SiteLayer.tsx');

const st = () => useCanvasStore.getState();

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/**
 * SiteLayer がガイドを出すかどうかの式そのもの。
 *   const guide = drag ? nearestBuildingCornerGuide(drag.point, buildingCorners) : null;
 *   {drag && guide && (...)}
 * ドラッグ中かどうか（drag）と、相手が居るかどうか（guide）の両方で決まる。
 */
const guideFor = (dragPoint: Point | null) => {
  const corners = buildingCornersGrid(st().canvasData.buildings);
  return dragPoint ? nearestBuildingCornerGuide(dragPoint, corners) : null;
};

beforeEach(() => {
  st().setCanvasData({
    ...blank(),
    buildings: [{ id: 'b1', type: 'polygon', points: rect(0, 0, 100, 80), fill: '#3d3d3a' }],
    sitePolygons: [{ id: 'site:1', points: rect(-100, -100, 300, 280) }],
  } as CanvasData);
});

// ============================================================
describe('ドラッグ中だけ出て、離すと消える', () => {
  it('掴む前は出ない', () => {
    expect(guideFor(null)).toBeNull();
  });

  it('掴んでいる間は出る', () => {
    expect(guideFor({ x: -100, y: -100 })).not.toBeNull();
  });

  it('離すと消える（drag が null に戻る）', () => {
    expect(guideFor({ x: -50, y: -50 })).not.toBeNull();
    expect(guideFor(null)).toBeNull();
  });

  it('離した時点で drag を捨てている', () => {
    expect(siteLayer).toMatch(/onDragEnd=\{\(e\) => \{[^]*?setDrag\(null\);/);
  });

  it('出す条件はドラッグ中であること＋相手が居ること', () => {
    expect(siteLayer).toMatch(/const guide = drag \? nearestBuildingCornerGuide\(drag\.point, buildingCorners\) : null;/);
    expect(siteLayer).toMatch(/\{drag && guide && \(\(\) => \{/);
  });
});

// ============================================================
describe('指の動きに追従して数値が変わる', () => {
  it('動かすたびに X / Y の距離が変わる', () => {
    const a = guideFor({ x: -100, y: -100 })!;
    const b = guideFor({ x: -50, y: -100 })!;
    const c = guideFor({ x: -50, y: -30 })!;
    expect(a.dxMm).toBe(1000);
    expect(b.dxMm).toBe(500);
    expect(b.dyMm).toBe(a.dyMm);      // Y だけ動かしていない
    expect(c.dyMm).toBe(300);
  });

  it('動かして最寄りが変われば、相手の角も切り替わる', () => {
    expect(guideFor({ x: -20, y: -20 })!.corner).toEqual({ x: 0, y: 0 });
    expect(guideFor({ x: 120, y: -20 })!.corner).toEqual({ x: 100, y: 0 });
    expect(guideFor({ x: 120, y: 100 })!.corner).toEqual({ x: 100, y: 80 });
  });

  it('建物の角へ吸着した瞬間は 0mm（S-4 の吸着と共存する）', () => {
    const g = guideFor({ x: 0, y: 0 })!;
    expect(g.dxMm).toBe(0);
    expect(g.dyMm).toBe(0);
  });

  it('建物が増減すれば相手も変わる', () => {
    st().setCanvasData({
      ...st().canvasData,
      buildings: [
        ...st().canvasData.buildings,
        { id: 'b2', type: 'polygon', points: rect(-300, -300, 50, 50), fill: '#3d3d3a' },
      ],
    } as CanvasData);
    expect(guideFor({ x: -280, y: -280 })!.corner).toEqual({ x: -300, y: -300 });
  });
});

// ============================================================
describe('建物が無い図面', () => {
  beforeEach(() => {
    st().setCanvasData({
      ...blank(), sitePolygons: [{ id: 'site:1', points: rect(0, 0, 100, 100) }],
    } as CanvasData);
  });

  it('掴んでも何も出ない（落ちない）', () => {
    expect(() => guideFor({ x: 10, y: 10 })).not.toThrow();
    expect(guideFor({ x: 10, y: 10 })).toBeNull();
  });

  it('頂点ドラッグ自体は従来どおりできる', () => {
    st().pushHistory();
    st().setSitePolygonPoint('site:1', 0, { x: -30, y: -40 });
    expect(st().canvasData.sitePolygons![0].points[0]).toEqual({ x: -30, y: -40 });
    st().undo();
    expect(st().canvasData.sitePolygons![0].points[0]).toEqual({ x: 0, y: 0 });
  });
});

// ============================================================
describe('敷地の頂点ドラッグ以外では出さない', () => {
  it('ガイドを描いているのは SiteLayer だけ', () => {
    for (const f of [
      'components/canvas/ScaffoldLayer.tsx', 'components/canvas/PlanePartLayer.tsx',
      'components/canvas/BuildingLayer.tsx', 'components/canvas/ObstacleLayer.tsx',
      'components/canvas/FreePartLayer.tsx', 'components/canvas/GridCanvas.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/nearestBuildingCornerGuide/);
    }
  });

  it('ガイドは drag（＝敷地の頂点つまみ）からしか立たない', () => {
    // drag を立てるのは頂点つまみの onDragStart / onDragMove だけ
    const starts = (siteLayer.match(/setDrag\(\{/g) ?? []).length;
    expect(starts).toBe(2);
    expect(siteLayer).toMatch(/onDragStart=\{\(\) => \{[^]*?setDrag\(\{ id: site\.id, index, point: p \}\)/);
  });

  it('ガイドは触れない（当たり判定を持たない＝操作を邪魔しない）', () => {
    const block = siteLayer.slice(siteLayer.indexOf('{drag && guide &&'));
    expect((block.match(/listening=\{false\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(block).not.toMatch(/draggable|onClick|onTap/);
  });
});

// ============================================================
describe('重くしないための作り', () => {
  it('建物の角は建物が変わったときだけ作り直す（毎フレーム作らない）', () => {
    expect(siteLayer).toMatch(/useMemo\(\(\) => buildingCornersGrid\(buildings\), \[buildings\]\)/);
  });

  it('吸着の相手にも同じ一覧を使い回している', () => {
    expect(siteLayer).toMatch(/const snapTargets = \(id: string\): Point\[\] => \[\s*\.\.\.buildingCorners,/);
  });

  it('最寄りの選定は角の数ぶんだけ（総当たりでも角は数十）', () => {
    const many = buildingCornersGrid(
      Array.from({ length: 20 }, (_, i) => ({ points: rect(i * 200, 0, 100, 80) })),
    );
    expect(many).toHaveLength(80);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) nearestBuildingCornerGuide({ x: i, y: i }, many);
    // 2000 フレームぶんでも軽い（実際のドラッグは 1 フレーム 1 回）
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

// ============================================================
describe('見た目は計測ツールに合わせる', () => {
  it('赤の破線', () => {
    expect(siteLayer).toMatch(/const GUIDE_COLOR = '#EF4444';/);
    expect(siteLayer).toMatch(/const GUIDE_DASH = \[6, 4\];/);
    expect(read('components/canvas/GridCanvas.tsx')).toContain("stroke=\"#EF4444\"");
  });

  it('数値は mm 表記の monospace 太字（計測ツールと同じ）', () => {
    expect(siteLayer).toMatch(/text=\{xLabel\}/);
    expect(siteLayer).toMatch(/\$\{guide\.dxMm\}mm/);
    expect(siteLayer).toMatch(/fontFamily="monospace" fontStyle="bold"/);
  });

  it('数値は脚の中点から外へずらす（指に隠れない）', () => {
    expect(siteLayer).toMatch(/y=\{cy - 18\}/);
    expect(siteLayer).toMatch(/x=\{px \+ ySide \* 14\}/);
  });

  it('水平と垂直の 2 本で L 字に結ぶ', () => {
    expect(siteLayer).toMatch(/points=\{\[cx, cy, px, cy\]\}/);
    expect(siteLayer).toMatch(/points=\{\[px, cy, px, py\]\}/);
  });
});
