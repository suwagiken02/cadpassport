import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout, computeBothmode1FLayout,
  splitBuilding1FAtBuilding2FVertices, splitBuilding2FAt1FVertices,
  getBuildingEdgesClockwise, placeHandrailsForEdge, bothmodeResultsToAutoLayoutResult,
} from '../autoLayoutUtils';
import { resolveScaffoldStartOnNormalized } from '../labelUtils';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';

// ============================================================
// bothmode 1F 割付: 面一境界でも通常の始点終点ルール(特別な始点細工なし)。
//   1A(1F東 下段) と 1C/1E(ノッチ縦壁) は 同方向・同始点終点・同長(3000) なので
//   rails も effective も一致すべき (= [1200,1800], effective 3000)。
//   現状は 1A が pillar-from-2F 結合で始点に +900 残り effective 3900=[1800,1800,300]。
//   接続は「1F手摺端点 == 2F手摺端点」で満たす(中間接続しない)。
// ============================================================

const mk = (id: string, pts: [number, number][], floor: 1 | 2): BuildingShape => ({
  id, type: 'polygon', floor, fill: '#000', points: pts.map(([x, y]) => ({ x, y })),
});

function run() {
  const b1 = mk('1f', [
    [-150, -150], [750, -150], [750, 550], [450, 550],
    [450, 250], [150, 250], [150, 550], [-150, 550],
  ], 1);
  const b2 = mk('2f', [[750, -150], [450, -150], [450, 250], [750, 250]], 2);
  const norm1 = splitBuilding1FAtBuilding2FVertices(b1, b2);
  const norm2 = splitBuilding2FAt1FVertices(b1, b2);
  const e2raw = getBuildingEdgesClockwise(b2);
  const rawIdx = e2raw.findIndex(e => Math.abs(e.p1.x - 750) < 0.01 && Math.abs(e.p1.y + 150) < 0.01);
  const ss: ScaffoldStartConfig = {
    corner: 'ne', startVertexIndex: rawIdx, face1DistanceMm: 900, face2DistanceMm: 900,
    face1FirstHandrail: 1800, face2FirstHandrail: 1800, floor: 2,
  };
  const nss = { ...ss, startVertexIndex: resolveScaffoldStartOnNormalized(b2, norm2, rawIdx).vertexIndex };
  const ES = DEFAULT_ENABLED_SIZES, PC = DEFAULT_PRIORITY_CONFIG;
  const r2 = computeBothmode2FLayout(norm2, norm1, {}, {}, nss, ES, PC);
  const r1 = computeBothmode1FLayout(norm1, norm2, r2, {}, ES, PC);
  return { r1, r2 };
}

const seg1 = (r1: ReturnType<typeof run>['r1'], idx: number) =>
  r1.edgeSegments.find(s => s.edge1FIndex === idx)!;
const railsOf = (s: { candidates: { rails: number[] }[]; selectedIndex: number }) =>
  [...(s.candidates[s.selectedIndex]?.rails ?? [])].sort((a, b) => a - b);

describe('bothmode 面一境界の1F辺を通常ルールで割付 (1A=1C=1E)', () => {
  const { r1, r2 } = run();
  const A = seg1(r1, 3); // 1A 1F東 下段 (7500,2500)->(7500,5500)
  const C = seg1(r1, 5); // 1C ノッチ西 (4500,5500)->(4500,2500)
  const E = seg1(r1, 7); // 1E ノッチ東 (1500,2500)->(1500,5500)

  it('(A) 1A の effective/rails が 1C・1E と一致 (= 3000 / [1200,1800])', () => {
    expect(C.effectiveMm).toBe(3000);
    expect(E.effectiveMm).toBe(3000);
    expect(railsOf(C)).toEqual([1200, 1800]);
    // 本丸: 1A も同値 (現状 3900=[1800,1800,300] で失敗)
    expect(A.effectiveMm).toBe(3000);
    expect(railsOf(A)).toEqual([1200, 1800]);
    expect(railsOf(A)).toEqual(railsOf(C));
    expect(railsOf(A)).toEqual(railsOf(E));
  });

  it('(B) 接続: 1A(1F東)の端点が 2F東手摺の端点と一致 (中間接続しない)', () => {
    // 2F東セグメント (east/vertical)
    const e2 = r2.edgeSegments.find(s => s.handrailDir === 'vertical' && s.face === 'east')!;
    const adapted = bothmodeResultsToAutoLayoutResult(r2, r1);
    const layA = adapted.edgeLayouts.find(l => l.originFloor === 1 && l.edge.index === 3)!;
    const layA2F = adapted.edgeLayouts.find(l => l.originFloor === 2 && l.edge.index === e2.edge2FIndex)!;
    const railsA = layA.candidates[layA.selectedIndex]?.rails ?? [];
    const rails2 = layA2F.candidates[layA2F.selectedIndex]?.rails ?? [];
    const hsA = placeHandrailsForEdge(layA, railsA);   // 1F東
    const hs2 = placeHandrailsForEdge(layA2F, rails2); // 2F東
    // どちらも x 固定の縦ライン。境界Yで端点一致を確認
    const ysA = hsA.flatMap(h => [h.y * 10, (h.y + h.lengthMm / 10) * 10]);
    const ys2 = hs2.flatMap(h => [h.y * 10, (h.y + h.lengthMm / 10) * 10]);
    const minA = Math.min(...ysA), max2 = Math.max(...ys2);
    // 1F東の上端 == 2F東の下端 (端点一致 / gap も重複もなし)
    expect(minA).toBe(max2);
  });

  it('(C) 幾何一体性: 1A の足場ライン x == 2F東の足場ライン x', () => {
    const e2 = r2.edgeSegments.find(s => s.handrailDir === 'vertical' && s.face === 'east')!;
    expect(Math.round(A.scaffoldCoord * 10)).toBe(Math.round(e2.scaffoldCoord * 10));
  });
});
