import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout, computeBothmode1FLayout, bothmodeResultsToAutoLayoutResult,
  computeAutoLayoutSequential, sequentialResultToAutoLayoutResult,
  splitBuilding1FAtBuilding2FVertices, splitBuilding2FAt1FVertices,
  getBuildingEdgesClockwise, placeHandrailsForEdge,
} from '../autoLayoutUtils';
import { resolveScaffoldStartOnNormalized } from '../labelUtils';
import { findScaffoldViolations, type ScaffoldHandrail } from '../scaffoldViolations';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';

// ============================================================
// くさび式足場の物理ルール正式テスト(docs/足場基礎仕様.md)。
// 配置結果に T字 / 重複 / はみ出し が無いこと(findScaffoldViolations===[])を保証する。
// ============================================================

const mk = (id: string, pts: [number, number][], floor: 1 | 2): BuildingShape => ({
  id, type: 'polygon', floor, fill: '#000', points: pts.map(([x, y]) => ({ x, y })),
});
const ES = DEFAULT_ENABLED_SIZES, PC = DEFAULT_PRIORITY_CONFIG;

const collect = (adapted: { edgeLayouts: { candidates: { rails: number[] }[]; selectedIndex: number }[] }): ScaffoldHandrail[] => {
  const hs: ScaffoldHandrail[] = [];
  for (const lay of adapted.edgeLayouts) {
    const rails = lay.candidates[lay.selectedIndex]?.rails ?? [];
    hs.push(...placeHandrailsForEdge(lay as never, rails as never));
  }
  return hs;
};

function runBoth(b1: BuildingShape, b2: BuildingShape, nwCorner = false) {
  const norm1 = splitBuilding1FAtBuilding2FVertices(b1, b2);
  const norm2 = splitBuilding2FAt1FVertices(b1, b2);
  const e2cw = getBuildingEdgesClockwise(b2);
  // ⭐ 指定: nwCorner=true → NW(rawIdx=0系), false → NE頂点を探す
  const rawIdx = nwCorner
    ? 0
    : e2cw.findIndex(e => Math.abs(e.p1.x - Math.max(...b2.points.map(p => p.x))) < 0.01
        && Math.abs(e.p1.y - Math.min(...b2.points.map(p => p.y))) < 0.01);
  const idx = rawIdx < 0 ? 0 : rawIdx;
  const ss: ScaffoldStartConfig = {
    corner: nwCorner ? 'nw' : 'ne', startVertexIndex: idx,
    face1DistanceMm: 900, face2DistanceMm: 900,
    face1FirstHandrail: 1800, face2FirstHandrail: 1800, floor: 2,
  };
  const nss = { ...ss, startVertexIndex: resolveScaffoldStartOnNormalized(b2, norm2, idx).vertexIndex };
  const r2 = computeBothmode2FLayout(norm2, norm1, {}, {}, nss, ES, PC);
  const r1 = computeBothmode1FLayout(norm1, norm2, r2, {}, ES, PC);
  return bothmodeResultsToAutoLayoutResult(r2, r1);
}

describe('findScaffoldViolations — 物理ルール(T字/重複/はみ出し)', () => {
  it('(1) 凸型1F下屋 + 矩形2F・⭐NW: 違反0 (現状 t3+overlap2=5件)', () => {
    const b1 = mk('1f', [
      [-150, -250], [750, -250], [750, 450], [450, 450],
      [450, 650], [150, 650], [150, 450], [-150, 450],
    ], 1);
    const b2 = mk('2f', [[-150, 450], [750, 450], [750, -250], [-150, -250]], 2);
    const adapted = runBoth(b1, b2, true);
    const v = findScaffoldViolations(collect(adapted), [b1, b2]);
    expect(v).toEqual([]);
  });

  it('(2) L字+ノッチ1F × 矩形2F・⭐NE: 違反0', () => {
    const b1 = mk('1f', [
      [-150, -150], [750, -150], [750, 550], [450, 550],
      [450, 250], [150, 250], [150, 550], [-150, 550],
    ], 1);
    const b2 = mk('2f', [[750, -150], [450, -150], [450, 250], [750, 250]], 2);
    const adapted = runBoth(b1, b2, false);
    const v = findScaffoldViolations(collect(adapted), [b1, b2]);
    expect(v).toEqual([]);
  });

  it('(3) 単一階 矩形・⭐なし: 違反0 (regression)', () => {
    const sq = mk('1f', [[0, 0], [900, 0], [900, 900], [0, 900]], 1);
    const seq = computeAutoLayoutSequential(sq, { 0: 900, 1: 900, 2: 900, 3: 900 });
    const adapted = sequentialResultToAutoLayoutResult(seq);
    const v = findScaffoldViolations(collect(adapted), [sq]);
    expect(v).toEqual([]);
  });

  it('(3b) 単一階 L字・⭐なし: 違反0 (regression)', () => {
    const lshape = mk('1f', [
      [0, 0], [900, 0], [900, 400], [400, 400], [400, 900], [0, 900],
    ], 1);
    const seq = computeAutoLayoutSequential(lshape, { 0: 900, 1: 900, 2: 900, 3: 900, 4: 900, 5: 900 });
    const adapted = sequentialResultToAutoLayoutResult(seq);
    const v = findScaffoldViolations(collect(adapted), [lshape]);
    expect(v).toEqual([]);
  });
});
