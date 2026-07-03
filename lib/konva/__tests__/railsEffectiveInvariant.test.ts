import { describe, it, expect } from 'vitest';
import { computeCascadeLayout, type FloorLayoutResult } from '../autolayout/cascade';
import { computeAutoLayoutSequential } from '../autoLayoutUtils';
import { sequentialResultToFloorResult } from '../autolayout/adapter';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';

// ============================================================
// 範囲離れ S-a: 「rails 合計(candidates[sel].totalMm) == cursor 枠(effectiveMm)」不変条件。
//   先頭辺(アンカー辺)の prevEdgeStartDistanceMm が実値でなく distances[前辺] ?? 900 に
//   フォールバックするため、mode='lower'(repDist=800)＋起点辺=anchor900 の下屋/L字/単一階で
//   先頭辺の rails 合計(10700) が cursor 枠(10600) と食い違い、北面が小物割り(900+600+200)になる。
//   S-b(最上階=北面) で bothmode(下屋矩形/L字下屋/北面specific)のバグは解消済＝通常 it で緑。
//   単一階は computeAutoLayoutSequential 由来のため S-b では未修正＝ it.fails のまま(S-e で緑化予定)。
//   center(repDist=900) は 900 フォールバックと偶然一致するため元から通常 it で緑。
// ============================================================

const ss: ScaffoldStartConfig = {
  corner: 'nw', startVertexIndex: 0,
  face1DistanceMm: 900, face2DistanceMm: 900,
  face1FirstHandrail: 1800, face2FirstHandrail: 1800,
};
const M = DEFAULT_ENABLED_SIZES, PC = DEFAULT_PRIORITY_CONFIG;
const TOL = 0.01;

const rect = (id: string, floor: number, w: number, h: number): BuildingShape => ({
  id, type: 'polygon', points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], fill: '#000', floor,
});
// 下屋のあるL字1F(東+南にはみ出す)。2Fは9000×4000(北9000出隅)。2F は割られず4辺。
const L1F: BuildingShape = {
  id: '1f', type: 'polygon',
  points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 400 }, { x: 1200, y: 400 }, { x: 1200, y: 700 }, { x: 0, y: 700 }],
  fill: '#000', floor: 1,
};
// 単一階L字(北9000出隅)
const Lsingle: BuildingShape = {
  id: 's', type: 'polygon',
  points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 400 }, { x: 1200, y: 400 }, { x: 1200, y: 700 }, { x: 0, y: 700 }],
  fill: '#000', floor: 1,
};

const fill = (n: number, v: number): Record<number, number> => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, v]));
// 起点2辺(NW: 北=index0 / 西=最終index)=anchorDist、他=repDist（実アプリの起点辺=face距離 を模す）
const anchorDist = (n: number, rep: number, anc: number): Record<number, number> => {
  const d = fill(n, rep); d[0] = anc; d[n - 1] = anc; return d;
};

/** 全 floor 全 segment で rails 合計 == effectiveMm を検証。違反行を列挙。 */
function railsViolations(res: Record<number, FloorLayoutResult>): string[] {
  const out: string[] = [];
  for (const f of Object.keys(res).map(Number).sort((a, b) => b - a)) {
    for (const s of res[f].edgeSegments) {
      const sel = s.candidates[s.selectedIndex];
      if (!sel) continue;
      if (Math.abs(sel.totalMm - s.effectiveMm) > TOL) {
        out.push(`F${f} e${s.edgeIndex} ${s.face} len=${s.segmentLengthMm}: railsTotal=${sel.totalMm} vs effectiveMm=${s.effectiveMm} rails=[${sel.rails.join('+')}]`);
      }
    }
  }
  return out;
}
function assertRailsMatchEffective(res: Record<number, FloorLayoutResult>, label: string) {
  const v = railsViolations(res);
  expect(v, `${label}: rails合計≠有効長 の辺があります:\n  ${v.join('\n  ')}`).toEqual([]);
}

describe('S-a 不変条件 rails合計==有効長（現状 lower×出隅 で赤＝バグ可視化）', () => {
  const f2 = rect('2f', 2, 900, 400);
  const bandLo = { lo: 800, hi: 1000, mode: 'lower' as const };
  const bandCe = { lo: 800, hi: 1000, mode: 'center' as const };

  it('[緑期待] 下屋(矩形) center 一律900', () => {
    const D = { 1: fill(4, 900), 2: fill(4, 900) };
    assertRailsMatchEffective(computeCascadeLayout({ 1: rect('1f', 1, 900, 700), 2: f2 }, D, ss, M, PC, undefined, undefined, bandCe), '下屋矩形 center');
  });

  it('[S-b緑化] 下屋(矩形) lower 起点辺900/他800', () => {
    const D = { 1: fill(4, 800), 2: anchorDist(4, 800, 900) };
    assertRailsMatchEffective(computeCascadeLayout({ 1: rect('1f', 1, 900, 700), 2: f2 }, D, ss, M, PC, undefined, undefined, bandLo), '下屋矩形 lower');
  });

  it('[緑期待] L字下屋 center 一律900', () => {
    const D = { 1: fill(6, 900), 2: fill(4, 900) };
    assertRailsMatchEffective(computeCascadeLayout({ 1: L1F, 2: f2 }, D, ss, M, PC, undefined, undefined, bandCe), 'L字下屋 center');
  });

  it('[S-b緑化] L字下屋 lower 起点辺900/他800', () => {
    const D = { 1: fill(6, 800), 2: anchorDist(4, 800, 900) };
    assertRailsMatchEffective(computeCascadeLayout({ 1: L1F, 2: f2 }, D, ss, M, PC, undefined, undefined, bandLo), 'L字下屋 lower');
  });

  it('[S-e緑化] 単一階L字 lower 起点辺900/他800', () => {
    const seq = computeAutoLayoutSequential(Lsingle, anchorDist(6, 800, 900), ss, M, PC, undefined, undefined, bandLo);
    assertRailsMatchEffective({ 1: sequentialResultToFloorResult(seq, 1) }, '単一階L字 lower');
  });
});

describe('S-a specific: 北9000出隅 下屋 lower の北面（現状 赤）', () => {
  it('北面 effectiveMm=10600・rails=1800×5+1200+400・railsTotal==effectiveMm（S-bで緑化）', () => {
    const D = { 1: fill(4, 800), 2: anchorDist(4, 800, 900) };
    const res = computeCascadeLayout({ 1: rect('1f', 1, 900, 700), 2: rect('2f', 2, 900, 400) }, D, ss, M, PC, undefined, undefined, { lo: 800, hi: 1000, mode: 'lower' });
    const north = res[2].edgeSegments.find(s => s.face === 'north' && s.segmentLengthMm === 9000);
    expect(north).toBeDefined();
    const sel = north!.candidates[north!.selectedIndex]!;
    // cursor 枠は正しい(=西800+9000+東800)。ここは緑のはず。
    expect(north!.effectiveMm).toBe(10600);
    // rails は先頭辺の 900 フォールバックで 10700 用の小物割りになっている → 現状 赤。
    expect(sel.rails).toEqual([1800, 1800, 1800, 1800, 1800, 1200, 400]);
    // 不変条件: rails合計 == 枠 → 現状 10700≠10600 で 赤。
    expect(sel.totalMm).toBe(north!.effectiveMm);
  });
});

// ============================================================
// 案X: 起点(アンカー)の離れも band 追従。起点900の band 迂回による隣辺(2B東)への漏れを解消。
//   S-a の rails合計==effectiveMm は「枠自体が誤り(frame value error)」を捕捉できなかったため、
//   「同寸の対辺で effectiveMm 一致」「全周 startDistanceMm 整合」の網で②を固定する。
// ============================================================
describe('案X 起点離れ band化: 起点900の隣辺漏れ解消（対辺一致・全周整合）', () => {
  // 2F=9000×7000(北9000/東西7000/南は下屋境界)、1F=9000×10000(南に下屋・同幅)
  const f2 = rect('2f', 2, 900, 700);
  const f1 = rect('1f', 1, 900, 1000);
  // 起点2辺=900(旧モーダル出力相当)でも、エンジンが band(lower=800)へ寄せることを検証
  const D = { 1: fill(4, 800), 2: anchorDist(4, 800, 900) };
  const run = () => computeCascadeLayout({ 1: f1, 2: f2 }, D, ss, M, PC, undefined, undefined, { lo: 800, hi: 1000, mode: 'lower' });

  it('同寸の対辺の effectiveMm が一致（東2B==西2D・北2A==南2C）', () => {
    const segs = run()[2].edgeSegments;
    const east = segs.find(s => s.face === 'east')!;
    const west = segs.find(s => s.face === 'west')!;
    const north = segs.find(s => s.face === 'north')!;
    const south = segs.find(s => s.face === 'south')!;
    expect(east.effectiveMm).toBe(west.effectiveMm);   // 修正前 8700≠8600
    expect(north.effectiveMm).toBe(south.effectiveMm); // 10600
  });

  it('range lower で全2F辺の startDistanceMm が単一値(=lo=800・アンカーも浮かない)', () => {
    const segs = run()[2].edgeSegments;
    const starts = Array.from(new Set(segs.map(s => s.startDistanceMm)));
    expect(starts).toEqual([800]);                     // 修正前は {900,800}
  });

  it('東2B: effectiveMm=8600・rails=1800×4+1200+200・railsTotal==effectiveMm', () => {
    const east = run()[2].edgeSegments.find(s => s.face === 'east')!;
    const sel = east.candidates[east.selectedIndex]!;
    expect(east.effectiveMm).toBe(8600);               // 修正前 8700
    expect(sel.rails).toEqual([1800, 1800, 1800, 1800, 1200, 200]);
    expect(sel.totalMm).toBe(east.effectiveMm);
  });
});
