import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout,
  computeBothmode1FLayout,
  bothmodeResultsToAutoLayoutResult,
  splitBuilding1FAtBuilding2FVertices,
  splitBuilding2FAt1FVertices,
  getBuildingEdgesClockwise,
  placeHandrailsForEdge,
} from '../autoLayoutUtils';
import { resolveScaffoldStartOnNormalized } from '../labelUtils';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';

// ============================================================
// bothmode 同一壁の隣接継続バグ (調査レポート):
//   L字+ノッチ 1F × 凸 2F。東壁(x=9000)は 2F東(y0-4000) と 1F東(y4000-7000) が
//   面一で1枚の連続壁。⭐=2F NE 角、face1=face2=1800、全辺離れ900。
//   バグ:
//   (1) 東の面一継ぎ目が途切れ、角手前に 400 破片＋隙間が出る
//   (2) 右下角(9000,7000)の外側に余分な手摺がぶら下がり突出する
//   正常部(北面一/2C縦通し/西)は現状を固定する。
// ============================================================

const g = (mm: number) => mm / 10; // mm -> grid
const mk = (id: string, pts: [number, number][], floor: 1 | 2): BuildingShape => ({
  id, type: 'polygon', floor, fill: '#000',
  points: pts.map(([x, y]) => ({ x: g(x), y: g(y) })),
});

// 1 本の足場ライン (同 direction・同 固定軸座標mm) の被覆区間 (mm) を求める
type Seg = { lo: number; hi: number; len: number };
function lineSegments(
  rails: { x: number; y: number; lengthMm: number; direction: 'horizontal' | 'vertical' }[],
  dir: 'horizontal' | 'vertical',
  fixedMm: number,
): Seg[] {
  const segs: Seg[] = [];
  for (const h of rails) {
    if (h.direction !== dir) continue;
    const fixed = Math.round((dir === 'horizontal' ? h.y : h.x) * 10);
    if (fixed !== fixedMm) continue;
    const lo = Math.round((dir === 'horizontal' ? h.x : h.y) * 10);
    segs.push({ lo, hi: lo + h.lengthMm, len: h.lengthMm });
  }
  segs.sort((a, b) => a.lo - b.lo);
  return segs;
}
// 連続(gapなし)か。隙間があれば最初の隙間 [prevHi, nextLo] を返す
function firstGap(segs: Seg[]): [number, number] | null {
  let maxHi = segs.length ? segs[0].hi : 0;
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].lo > maxHi) return [maxHi, segs[i].lo];
    maxHi = Math.max(maxHi, segs[i].hi);
  }
  return null;
}
const cover = (segs: Seg[]) => ({
  min: segs.length ? segs[0].lo : NaN,
  max: segs.reduce((m, s) => Math.max(m, s.hi), -Infinity),
});

function runPipeline() {
  const building1F = mk('1f', [
    [0, 0], [9000, 0], [9000, 7000], [6000, 7000],
    [6000, 4000], [3000, 4000], [3000, 7000], [0, 7000],
  ], 1);
  const building2F = mk('2f', [[6000, 0], [9000, 0], [9000, 4000], [6000, 4000]], 2);

  const normalized1F = splitBuilding1FAtBuilding2FVertices(building1F, building2F);
  const normalized2F = splitBuilding2FAt1FVertices(building1F, building2F);

  const edges2Fraw = getBuildingEdgesClockwise(building2F);
  const rawIdx = edges2Fraw.findIndex(e => Math.abs(e.p1.x - g(9000)) < 0.01 && Math.abs(e.p1.y) < 0.01);
  const baseSS: ScaffoldStartConfig = {
    corner: 'ne', startVertexIndex: rawIdx,
    face1DistanceMm: 1800, face2DistanceMm: 1800,
    face1FirstHandrail: 1800, face2FirstHandrail: 1800, floor: 2,
  };
  const { vertexIndex } = resolveScaffoldStartOnNormalized(building2F, normalized2F, rawIdx);
  const nss: ScaffoldStartConfig = { ...baseSS, startVertexIndex: vertexIndex };

  const ES = DEFAULT_ENABLED_SIZES, PC = DEFAULT_PRIORITY_CONFIG;
  const r2 = computeBothmode2FLayout(normalized2F, normalized1F, {}, {}, nss, ES, PC);
  const r1 = computeBothmode1FLayout(normalized1F, normalized2F, r2, {}, ES, PC);
  const adapted = bothmodeResultsToAutoLayoutResult(r2, r1);

  const all: { x: number; y: number; lengthMm: number; direction: 'horizontal' | 'vertical' }[] = [];
  for (const layout of adapted.edgeLayouts) {
    const rails = layout.candidates[layout.selectedIndex]?.rails ?? [];
    all.push(...placeHandrailsForEdge(layout, rails));
  }
  return all;
}

describe('bothmode 同一壁の隣接継続 (東面一・右下角)', () => {
  const rails = runPipeline();

  it('(a)(d) 東ライン(x=10800)は隙間も角手前の破片も無く連続する', () => {
    const east = lineSegments(rails, 'vertical', 10800);
    expect(east.length).toBeGreaterThan(0);
    expect(firstGap(east)).toBeNull(); // 旧: y3100→4000 に隙間(+末端400破片)
  });

  it('(b) 東ラインの被覆は y=-900〜7900 (上下とも離れ張り出しで終端)', () => {
    const east = lineSegments(rails, 'vertical', 10800);
    const c = cover(east);
    expect(c.min).toBe(-900);
    expect(c.max).toBe(7900); // 旧: 9700 まで突出
  });

  it('(c) 右下角(9000,7000)の外へ突出する手摺が無い (東ライン y は 7900 以下)', () => {
    const east = lineSegments(rails, 'vertical', 10800);
    const overshoot = east.filter(s => s.hi > 7900);
    expect(overshoot).toEqual([]); // 旧: [7600,9400],[9400,9700] が突出
  });

  it('(e) 正常部は不変: 北ライン(y=-900) は x=-900〜9900 連続', () => {
    const north = lineSegments(rails, 'horizontal', -900);
    expect(firstGap(north)).toBeNull();
    expect(cover(north)).toEqual({ min: -900, max: 9900 });
  });

  it('(e) 正常部は不変: 2C(2F西/ノッチ縦通し x=5100) は y=-900〜7900 連続', () => {
    const w2c = lineSegments(rails, 'vertical', 5100);
    expect(firstGap(w2c)).toBeNull();
    expect(cover(w2c)).toEqual({ min: -900, max: 7900 });
  });

  it('(e) 正常部は不変: 1F西ライン(x=-900) は y=-900〜7900 連続', () => {
    const w1 = lineSegments(rails, 'vertical', -900);
    expect(firstGap(w1)).toBeNull();
    expect(cover(w1)).toEqual({ min: -900, max: 7900 });
  });
});
