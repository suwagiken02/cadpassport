import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToPrimitives, initialPlacementOrigin } from '../elevationToObjects';
import { ELEV_PART_COLORS, ELEV_PART_STYLE, railColorForSpanMm } from '../elevationPartStyle';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 });
const northCol: FaceSpanColumn = {
  face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};

describe('faceElevationToPrimitives: FaceElevation → プリミティブ(E-4a)', () => {
  const fe = buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 });
  const prims = faceElevationToPrimitives(fe);

  it('プリミティブが生成される', () => {
    expect(prims.length).toBeGreaterThan(0);
  });

  it('建物シルエットの polygon（左端0基準・GL0・上は負）', () => {
    // minXg=-90(支柱), 建物北辺 x[0,360] → lx=90..450、天端6500 → ly=-650。
    const bo = prims.find((p) => p.kind === 'polygon' && p.fillOpacity === 0.22);
    expect(bo).toBeDefined();
    expect(bo && bo.kind === 'polygon' && bo.points).toEqual([90, 0, 90, -650, 450, -650, 450, 0]);
  });

  // E-8-v2f: 部材は「太い色線＋丸ハンドル」になった（平面と同じ視覚言語）。
  //   太さ・色は elevationPartStyle が single source なので、テストもそこから引く。
  it('支柱4本（太い縦線）が jackTop〜topRail に', () => {
    const posts = prims.filter((p) =>
      p.meta?.kind === 'post' && p.kind === 'line' && p.stroke === ELEV_PART_COLORS.post
      && p.widthGrid === ELEV_PART_STYLE.postWidthGrid);
    expect(posts).toHaveLength(4); // postXs [-90,90,270,450]、嵩上げ無し
    // px=-90 → lx=0、topRail6500→ly=-650。
    // E-8-v2h-fix: 皿はスタートから逆算（H=6500 → スタート1100 → 皿400）→ ly=-40。
    expect(fe.scaffolds[0].levels.jackTopMm).toBe(400);
    const p0 = posts.find((p) => p.kind === 'line' && p.x1 === 0);
    expect(p0 && p0.kind === 'line' && [p0.y1, p0.y2]).toEqual([-40, -650]);
  });

  it('GL 線＋GL テキスト、天端寸法テキストを含む', () => {
    expect(prims.some((p) => p.kind === 'text' && p.text === 'GL')).toBe(true);
    expect(prims.some((p) => p.kind === 'line' && p.dash?.[0] === 4)).toBe(true); // GL 破線
    expect(prims.some((p) => p.kind === 'text' && p.text.startsWith('天端'))).toBe(true);
  });

  it('高さ情報が無ければ空配列', () => {
    const empty = buildFaceElevation([], [bld('B')], { face: 'north' }); // マーカー無し・既定無し
    expect(faceElevationToPrimitives(empty)).toEqual([]);
  });
});

describe('initialPlacementOrigin: 立面の初期配置位置(E-4b)', () => {
  it('建物 bbox の右側 +30、GL を下端 y に', () => {
    // RECT max x=360, max y=540 → { x: 390, y: 540 }
    expect(initialPlacementOrigin([bld('B')])).toEqual({ x: 390, y: 540 });
  });
  it('建物なしは既定', () => {
    expect(initialPlacementOrigin([])).toEqual({ x: 100, y: 200 });
  });
});

describe('E-5-fix2: 配置版プリミティブ(切断・セグメント縦線)', () => {
  const L: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 180 }, { x: 180, y: 180 }, { x: 180, y: 360 }, { x: 0, y: 360 }];
  const lbld: BuildingShape = { id: 'L', type: 'polygon', points: L, fill: '#3d3d3a', floor: 2 };
  // 南面2列(L字): 内側 depth270 x[90,450](奥)、外側 depth450 x[-90,270](手前)。
  const inner: FaceSpanColumn = { face: 'south', floor: 2, depthCoord: 270, xStart: 90, xEnd: 450, rails: [1800, 1800], handrailIds: ['a', 'b'] };
  const outer: FaceSpanColumn = { face: 'south', floor: 2, depthCoord: 450, xStart: -90, xEnd: 270, rails: [1800, 1800], handrailIds: ['c', 'd'] };
  const fe = buildFaceElevation([inner, outer], [lbld], { defaultHeightMm: 5000 });
  const prims = faceElevationToPrimitives(fe);

  it('建物シルエットはセグメントごとに polygon(段差の縦線を保持・stroke あり)', () => {
    const bpolys = prims.filter((p) => p.kind === 'polygon' && p.fillOpacity === 0.22);
    // 南面外形は x=180 で2セグメントに分割 → 2 polygon。各 polygon は縦辺(段差線)を持つ。
    expect(bpolys.length).toBe(fe.buildingOutlines[0].segments.length);
    expect(bpolys.length).toBeGreaterThanOrEqual(2);
    expect(bpolys.every((p) => p.kind === 'polygon' && p.stroke === '#8a8a86' && p.width === 1.5)).toBe(true);
  });

  it('奥列の手摺が手前区間で切断され、幅の異なる rail 線として現れる', () => {
    const rails = prims.filter((p) =>
      p.kind === 'line' && p.stroke === railColorForSpanMm(1800)
      && p.widthGrid === ELEV_PART_STYLE.railWidthGrid);
    // E-8-v2h: 支柱位置に切れ目を作るため両端を railInsetGrid ずつ内側に寄せて描く。
    const inset = ELEV_PART_STYLE.railInsetGrid * 2;
    const widths = new Set(rails.map((p) => (p.kind === 'line' ? Math.round(Math.abs(p.x2 - p.x1)) : 0)));
    expect(widths.has(360 - inset)).toBe(true); // 手前列 [-90,270] 幅360
    // E-5-fix4: 既定ギャップ=round(全幅540×0.015)=8。奥列は 270+8=278 から → [278,450] 幅172。
    expect(widths.has(172 - inset)).toBe(true); // 奥列(切断+ギャップ後) 幅172
  });
});
