import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point } from '@/types';
import { heightToFloors } from '../../calculator';
import type { FaceSpanColumn } from '../faceReconstruction';
import {
  buildElevationLevels,
  buildElevationColumns,
  buildBuildingOutline,
  buildFaceElevation,
  DEFAULT_JACK_MM,
  KOMA_PITCH_MM,
  LAYER_HEIGHT_MM,
} from '../elevationEngine';

// 座標: 水平=グリッド(1grid=10mm)、高さ=mm(GL基準)。1800mm=180grid。
function bld(id: string, points: Point[], floor?: number): BuildingShape {
  return { id, type: 'polygon', points, fill: '#eee', floor };
}
// 矩形建物 (0,0)-(360,0)-(360,540)-(0,540)（北辺=edge0, y=0, x[0,360]）
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];

function scol(over: Partial<FaceSpanColumn>): FaceSpanColumn {
  return {
    face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
    rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
    ...over,
  };
}

describe('buildElevationLevels: 電卓 heightToFloors との整合', () => {
  it('H=5000 → スタート1400・2段・1800下がり・levels=[1400,3200]・天端5000', () => {
    const lv = buildElevationLevels(5000);
    expect(lv.startMm).toBe(1400);
    expect(lv.floors).toBe(2);
    expect(lv.sagariMm).toBe(1800);
    expect(lv.levels).toEqual([1400, 3200]);
    expect(lv.topRailMm).toBe(5000);
    // 電卓と厳密一致
    const ht = heightToFloors(5000);
    expect(lv.startMm).toBe(ht.startMm);
    expect(lv.floors).toBe(ht.floors);
  });

  it('H=6500 → スタート1100・3段・levels=[1100,2900,4700]・天端6500', () => {
    const lv = buildElevationLevels(6500);
    expect(lv.startMm).toBe(1100);
    expect(lv.floors).toBe(3);
    expect(lv.levels).toEqual([1100, 2900, 4700]);
    expect(lv.topRailMm).toBe(6500);
    expect(lv.sagariMm).toBe(1800);
  });

  it('H<1800（1000）→ 0段・levels空・下がり0', () => {
    const lv = buildElevationLevels(1000);
    expect(lv.floors).toBe(0);
    expect(lv.levels).toEqual([]);
    expect(lv.sagariMm).toBe(0);
    expect(lv.komaGridMm).toEqual([]);
  });

  it('pillarType 透過: H=3800 は既定(通常330)で {2000,1}・根がらみ140 で {200,2}', () => {
    const normal = buildElevationLevels(3800);
    expect(normal.startMm).toBe(2000);
    expect(normal.floors).toBe(1);
    const negarami = buildElevationLevels(3800, { pillarType: 'negarami' });
    expect(negarami.startMm).toBe(200);
    expect(negarami.floors).toBe(2);
  });

  it('コマ格子: ジャッキ上端(150)起点・450刻み・天端以下', () => {
    const lv = buildElevationLevels(5000);
    expect(lv.jackTopMm).toBe(DEFAULT_JACK_MM);
    expect(lv.komaGridMm[0]).toBe(150);
    for (let i = 1; i < lv.komaGridMm.length; i++) {
      expect(lv.komaGridMm[i] - lv.komaGridMm[i - 1]).toBe(KOMA_PITCH_MM);
    }
    expect(lv.komaGridMm[lv.komaGridMm.length - 1]).toBeLessThanOrEqual(lv.topRailMm);
  });

  it('opts で層/ジャッキ上書き可', () => {
    const lv = buildElevationLevels(3600, { jackMm: 300 });
    expect(lv.jackTopMm).toBe(300);
    expect(lv.komaGridMm[0]).toBe(300);
    expect(LAYER_HEIGHT_MM).toBe(1800);
  });
});

describe('buildElevationColumns: 支柱x = rails 累積', () => {
  it('北面 rails[1800×3] xStart=-90 → postXs=[-90,90,270,450]', () => {
    const { postXs, spans } = buildElevationColumns(scol({}));
    expect(postXs).toEqual([-90, 90, 270, 450]);
    expect(spans.map(s => s.lenMm)).toEqual([1800, 1800, 1800]);
    expect(spans[0]).toEqual({ x0: -90, x1: 90, lenMm: 1800 });
    expect(spans[2].x1).toBe(450); // = xEnd
  });

  it('混在長 [1800,600] も累積が正しい', () => {
    const { postXs } = buildElevationColumns(scol({ rails: [1800, 600], xEnd: 150 }));
    expect(postXs).toEqual([-90, 90, 150]); // -90 +180 +60
  });
});

describe('buildBuildingOutline: 高さマーカーあり/なしフォールバック', () => {
  const building = bld('B1', RECT, 1);

  it('マーカー1個 → 全周一定値で北面セグメントが出る', () => {
    const markers: HeightMarker[] = [
      { id: 'm1', buildingId: 'B1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
    ];
    const o = buildBuildingOutline(building, 'north', markers);
    expect(o.segments.length).toBe(1);
    expect(o.segments[0]).toEqual({ xStart: 0, xEnd: 360, heightStartMm: 5000, heightEndMm: 5000 });
    expect(o.floor).toBe(1);
  });

  it('マーカー無し + defaultHeightMm → 既定高さで出る', () => {
    const o = buildBuildingOutline(building, 'north', [], { defaultHeightMm: 3000 });
    expect(o.segments.length).toBe(1);
    expect(o.segments[0].heightStartMm).toBe(3000);
  });

  it('マーカー無し + 既定無し → 高さ不明でセグメント空', () => {
    const o = buildBuildingOutline(building, 'north', []);
    expect(o.segments).toEqual([]);
  });
});

describe('buildBuildingOutline: 辺内部マーカーで妻(折れ線)化', () => {
  const building = bld('G1', RECT, 1); // 北辺=edge0, x[0,360]

  it('中央 t=0.5 高マーカー＋両端低 → サブセグメント2本(三角の妻)', () => {
    const markers: HeightMarker[] = [
      { id: 'g0', buildingId: 'G1', edgeIndex: 0, t: 0, heightMm: 3000 },
      { id: 'gm', buildingId: 'G1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
      { id: 'g1', buildingId: 'G1', edgeIndex: 0, t: 1, heightMm: 3000 },
    ];
    const o = buildBuildingOutline(building, 'north', markers);
    expect(o.segments.length).toBe(2);
    // 左: x[0,180] 3000→5000、右: x[180,360] 5000→3000（頂点は中央 x=180・5000）
    expect(o.segments[0]).toEqual({ xStart: 0, xEnd: 180, heightStartMm: 3000, heightEndMm: 5000 });
    expect(o.segments[1]).toEqual({ xStart: 180, xEnd: 360, heightStartMm: 5000, heightEndMm: 3000 });
  });

  it('マーカー1個(全周一定) → 従来どおり1辺1セグメント不変', () => {
    const markers: HeightMarker[] = [
      { id: 'm1', buildingId: 'G1', edgeIndex: 0, t: 0.5, heightMm: 4000 },
    ];
    const o = buildBuildingOutline(building, 'north', markers);
    expect(o.segments.length).toBe(1);
    expect(o.segments[0]).toEqual({ xStart: 0, xEnd: 360, heightStartMm: 4000, heightEndMm: 4000 });
  });
});

describe('E-3.5-2b: 段数・天端は水下(樋面)基準', () => {
  const building = bld('W1', RECT, 1); // 北辺=edge0, x[0,360]
  const northCol = scol({}); // 北面 x[-90,450], rails[1800×3]

  it('妻(両端軒5000・棟7000) → 基準は水下5000（棟7000ではない）', () => {
    const markers: HeightMarker[] = [
      { id: 'w0', buildingId: 'W1', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'wm', buildingId: 'W1', edgeIndex: 0, t: 0.5, heightMm: 7000 },
      { id: 'w1', buildingId: 'W1', edgeIndex: 0, t: 1, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([northCol], [building], { markers });
    // 段数・天端は水下5000基準（heightToFloors(5000)）
    expect(fe.scaffolds[0].levels.topRailMm).toBe(5000);
    expect(fe.scaffolds[0].levels.levels).toEqual([1400, 3200]);
    // 建物外形は棟7000を保持（天端5000より上に突き出る）
    const apex = Math.max(...fe.buildingOutlines[0].segments.flatMap(s => [s.heightStartMm, s.heightEndMm]));
    expect(apex).toBe(7000);
  });

  it('フラット面(一定5000)は従来どおり', () => {
    const markers: HeightMarker[] = [
      { id: 'f1', buildingId: 'W1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([northCol], [building], { markers });
    expect(fe.scaffolds[0].levels.topRailMm).toBe(5000);
    expect(fe.scaffolds[0].levels.levels).toEqual([1400, 3200]);
  });
});

describe('buildFaceElevation: 矩形2階 × H=6500', () => {
  const building = bld('B1', RECT, 1);
  const northCol = scol({}); // 北面 floor1, rails[1800×3], x[-90,450]
  const fe = buildFaceElevation([northCol], [building], { defaultHeightMm: 6500 });

  it('段構成が電卓と整合・支柱x累積', () => {
    expect(fe.scaffolds.length).toBe(1);
    const sc = fe.scaffolds[0];
    expect(sc.levels.levels).toEqual([1100, 2900, 4700]);
    expect(sc.levels.topRailMm).toBe(6500);
    expect(sc.postXs).toEqual([-90, 90, 270, 450]);
  });

  it('踏板帯=段数・横線=コマ格子数', () => {
    const sc = fe.scaffolds[0];
    expect(sc.boards.length).toBe(sc.levels.floors); // 3
    expect(sc.boards.map(b => b.levelMm)).toEqual([1100, 2900, 4700]);
    expect(sc.rails.length).toBe(sc.levels.komaGridMm.length);
    expect(sc.boards[0].x0).toBe(-90);
    expect(sc.boards[0].x1).toBe(450);
  });

  it('建物輪郭が北面に出る（高さ6500）', () => {
    expect(fe.buildingOutlines.length).toBe(1);
    expect(fe.buildingOutlines[0].segments[0].heightStartMm).toBe(6500);
  });
});

describe('buildFaceElevation: L字上階の2列が別 scaffold', () => {
  // L 字南面の内側(depth270, x[90,450]) と 外側(depth450, x[-90,270]) の2列。
  const inner = scol({ face: 'south', floor: 2, depthCoord: 270, xStart: 90, xEnd: 450, rails: [1800, 1800] });
  const outer = scol({ face: 'south', floor: 2, depthCoord: 450, xStart: -90, xEnd: 270, rails: [1800, 1800] });
  const building = bld('L2', RECT, 2);
  const fe = buildFaceElevation([inner, outer], [building], { defaultHeightMm: 5000 });

  it('2列がそれぞれ別 scaffold で保持され、奥行き順が保たれる', () => {
    expect(fe.scaffolds.length).toBe(2);
    expect(fe.scaffolds.map(s => s.column.depthCoord)).toEqual([270, 450]);
  });

  it('各列の支柱x・段構成が独立に出る', () => {
    expect(fe.scaffolds[0].postXs).toEqual([90, 270, 450]);
    expect(fe.scaffolds[1].postXs).toEqual([-90, 90, 270]);
    expect(fe.scaffolds[0].levels.levels).toEqual([1400, 3200]); // H=5000
  });
});
