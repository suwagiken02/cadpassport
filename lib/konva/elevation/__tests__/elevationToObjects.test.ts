import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToPrimitives } from '../elevationToObjects';

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

  it('支柱4本（#FFD700・線）が jackTop〜topRail に', () => {
    const posts = prims.filter((p) => p.kind === 'line' && p.stroke === '#FFD700' && p.width === 1.6);
    expect(posts).toHaveLength(4); // postXs [-90,90,270,450]、嵩上げ無し
    // px=-90 → lx=0、jackTop150→ly=-15、topRail6500→ly=-650
    const p0 = posts.find((p) => p.kind === 'line' && p.x1 === 0);
    expect(p0 && p0.kind === 'line' && [p0.y1, p0.y2]).toEqual([-15, -650]);
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
