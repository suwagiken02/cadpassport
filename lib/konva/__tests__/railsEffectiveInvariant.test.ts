import { describe, it, expect } from 'vitest';
import { computeCascadeLayout, normalizeBuildingsByFloor, LOOP_FIT_META, type FloorLayoutResult, type LoopFitMeta } from '../autolayout/cascade';
import { computeAutoLayoutSequential } from '../autoLayoutUtils';
import { autoStartVertexIndex } from '../labelUtils';
import { sequentialResultToFloorResult, segmentsToHandrails } from '../autolayout/adapter';
import { findScaffoldViolations } from '../scaffoldViolations';
import { mmToGrid } from '../gridUtils';
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

// ============================================================
// S-2: N≥3 中間/下階の run で rails合計==有効長 が破れる問題。
//   上階runの離れ非対称(band centerや半端寸法)で子runの startContribution が実角(上階segの
//   actEndD)と乖離し total!=eff → center=overshoot→重複(違反)。
//   ・S-2b(壁継続 startContribution を actEndD へ source-align)で「下屋積層(成長=一方向)」
//     の R2/NB2 は緑化（通常 it）。
//   ・R1(成長=両方向)は west が same-wall-line 分岐(cascade.ts:766) の残で total!=eff が残る。
//     これは pillar/継続とは別経路のため S-2c 候補として it.fails で据え置き（現状赤の可視化）。
// ============================================================
describe('S-2 N=3 run: rails合計==有効長（S-2b=継続緑化／R1 same-wall-lineはS-2c残）', () => {
  const bandCe = { lo: 800, hi: 950, mode: 'center' as const };
  const stack3 = (w3: number, h3: number, w2: number, h2: number, w1: number, h1: number) =>
    ({ 3: rect('3f', 3, w3, h3), 2: rect('2f', 2, w2, h2), 1: rect('1f', 1, w1, h1) });
  const D3 = { 1: fill(4, 900), 2: fill(4, 900), 3: fill(4, 900) };
  const allH = (res: Record<number, FloorLayoutResult>) =>
    Object.keys(res).map(Number).sort((a, b) => b - a)
      .flatMap(f => segmentsToHandrails(res[f].edgeSegments));

  // R2: 288/544/733・center[800,950]（下屋積層=成長一方向）→ S-2b で緑化
  it('R2 288/544/733 center: rails合計==有効長', () => {
    const b = stack3(288, 266, 544, 622, 733, 844);
    assertRailsMatchEffective(computeCascadeLayout(b, D3, ss, M, PC, undefined, undefined, bandCe), 'R2 center');
  });
  it('R2 288/544/733 center: findScaffoldViolations===[]', () => {
    const b = stack3(288, 266, 544, 622, 733, 844);
    const res = computeCascadeLayout(b, D3, ss, M, PC, undefined, undefined, bandCe);
    expect(findScaffoldViolations(allH(res), Object.values(b))).toEqual([]);
  });

  // NB2: 288/544/733・band未指定（band固有でない証跡）→ S-2b で緑化
  it('NB2 288/544/733 band未指定: rails合計==有効長', () => {
    const b = stack3(288, 266, 544, 622, 733, 844);
    assertRailsMatchEffective(computeCascadeLayout(b, D3, ss, M, PC), 'NB2 noband');
  });

  // R1: 410/620/900・center[800,950]（成長両方向）→ west が same-wall-line/collinear-with-upper。
  //   S-2c で collinear 終端 endContrib を上階実カーソルwrapへ pin し緑化（d=100→0）。
  it('R1 410/620/900 center: rails合計==有効長', () => {
    const b = stack3(410, 390, 620, 650, 900, 910);
    assertRailsMatchEffective(computeCascadeLayout(b, D3, ss, M, PC, undefined, undefined, bandCe), 'R1 center');
  });
  it('R1 410/620/900 center: findScaffoldViolations===[]', () => {
    const b = stack3(410, 390, 620, 650, 900, 910);
    const res = computeCascadeLayout(b, D3, ss, M, PC, undefined, undefined, bandCe);
    expect(findScaffoldViolations(allH(res), Object.values(b))).toEqual([]);
  });

  // R3(S-2c回帰): 成長両方向・半端寸法の別形状。同一壁線(west/south)を跨ぐ collinear 終端で
  //   total==eff と 物理違反0 を固定（S-2c の endpin が効くことのガード）。
  it('R3 357x283/551x517/743x817 center: rails合計==有効長 & 違反0', () => {
    const b = stack3(357, 283, 551, 517, 743, 817);
    const res = computeCascadeLayout(b, D3, ss, M, PC, undefined, undefined, bandCe);
    assertRailsMatchEffective(res, 'R3 center');
    expect(findScaffoldViolations(allH(res), Object.values(b))).toEqual([]);
  });
});

// ============================================================
// S-2d: 実物件 U字50mm北ズレ（children が上階/prev seg の「実着地」でなく「START離れ」を継承）。
//   建物: 1F L字下屋 [(-150,-150),(750,-150),(750,550),(150,550),(150,250),(-150,250)]
//         2F矩形   [(150,550),(750,550),(750,-150),(150,-150)]、band[700,950] center、自動起点(北西)。
//   band center の下屋積層で 2F west run が非対称(startD=825/actEnd=875)になり、
//   ・2F側: 2D1→2D2 straight-continuation の 2nd-pass 接合 cursor が 2D1 の実 cursorEnd(337.5)
//           でなく prevSeg.startDistanceMm 由来の wrap(332.5) を使う → 接合点が 50mm ズレ。
//   ・1F側: 1A(下屋 south)の pillar-from-upper が上階 2D1 の startDistanceMm(825) を継承し、
//           実着地 875 で無いため scaffoldCoord が 332.5(正=337.5)。1B(下屋 west)は total≠eff。
//   findScaffoldViolations は縦→横の角超過を検出しない(0件)ため、total==eff と接合点整合で固定。
//   S-2d-b で真因を source-align 済（1F 柱起点辺の離れ線を上階実着地へ／2F 直線継続の接合を
//   前辺実 cursorEnd へ、いずれも band 指定時のみ＝非band/非分割は byte 不変）→通常 it で緑。
// ============================================================
describe('S-2d 実物件U字: children離れ source-align（S-2d-bで緑化）', () => {
  const b1r: BuildingShape = {
    id: '1f', type: 'polygon', fill: '#000', floor: 1,
    points: [{ x: -150, y: -150 }, { x: 750, y: -150 }, { x: 750, y: 550 }, { x: 150, y: 550 }, { x: 150, y: 250 }, { x: -150, y: 250 }],
  };
  const b2r: BuildingShape = {
    id: '2f', type: 'polygon', fill: '#000', floor: 2,
    points: [{ x: 150, y: 550 }, { x: 750, y: 550 }, { x: 750, y: -150 }, { x: 150, y: -150 }],
  };
  const bandCe = { lo: 700, hi: 950, mode: 'center' as const };
  const rep = 825; // center 代表値 = round((700+950)/2)
  const ssR: ScaffoldStartConfig = {
    corner: 'nw', startVertexIndex: 0,
    face1DistanceMm: rep, face2DistanceMm: rep,
    face1FirstHandrail: 1800, face2FirstHandrail: 1800,
  };
  const D = { 1: fill(7, rep), 2: fill(5, rep) }; // 正規化後 1F=7辺/2F=5辺・一律 rep
  const run = () => computeCascadeLayout({ 1: b1r, 2: b2r }, D, ssR, M, PC, undefined, undefined, bandCe);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const seg2D1 = (res: Record<number, FloorLayoutResult>) => res[2].edgeSegments.find(s => s.face === 'west' && near(s.startPoint.y, 550))!;
  const seg2D2 = (res: Record<number, FloorLayoutResult>) => res[2].edgeSegments.find(s => s.face === 'west' && near(s.startPoint.y, 250))!;
  const seg1A = (res: Record<number, FloorLayoutResult>) => res[1].edgeSegments.find(s => s.face === 'south' && near(s.startPoint.x, 150) && near(s.startPoint.y, 250))!;
  const seg1B = (res: Record<number, FloorLayoutResult>) => res[1].edgeSegments.find(s => s.face === 'west' && near(s.startPoint.x, -150))!;

  it('1B(下屋west) total==eff（修正後 5700==5700）', () => {
    const s = seg1B(run()); const sel = s.candidates[s.selectedIndex]!;
    expect(sel.totalMm).toBe(s.effectiveMm);
  });
  it('接合: 2D1.cursorEnd == 2D2.cursorStart（修正後 337.5==337.5）', () => {
    const res = run();
    expect(seg2D1(res).cursorEnd).toBe(seg2D2(res).cursorStart);
  });
  it('1A.scaffoldCoord == 250 + mmToGrid(2D1実着地)（修正後 337.5）', () => {
    const res = run();
    const d1 = seg2D1(res);
    const actEnd = d1.candidates[d1.selectedIndex]!.actualEndDistanceMm;
    expect(seg1A(res).scaffoldCoord).toBe(250 + mmToGrid(actEnd));
  });
  // 全周 rails合計==有効長 & 物理違反0（U字の他辺への波及がないことも同時に固定）。
  it('全floor rails合計==有効長 & findScaffoldViolations===[]', () => {
    const res = run();
    assertRailsMatchEffective(res, 'S-2d 実物件');
    const allHandrails = [2, 1].flatMap(f => segmentsToHandrails(res[f].edgeSegments));
    expect(findScaffoldViolations(allHandrails, [b1r, b2r])).toEqual([]);
  });
});

// ============================================================
// S-2d-b 回帰網補強: 別形状の「N=2 下屋分割×band×pillar」。1F L字下屋の切欠き頂点が 2F 西壁を
//   正規化分割し(=直線継続 run)、下屋 south が pillar-from-upper になる形。band center の
//   非対称でも 全floor total==eff・物理違反0・U字接合連続 を固定する（source-align のガード）。
// ============================================================
describe('S-2d-b 回帰: 別形状 N=2 下屋分割×band×pillar', () => {
  const g1: BuildingShape = {
    id: '1f', type: 'polygon', fill: '#000', floor: 1,
    points: [{ x: -100, y: -200 }, { x: 800, y: -200 }, { x: 800, y: 600 }, { x: 300, y: 600 }, { x: 300, y: 200 }, { x: -100, y: 200 }],
  };
  const g2: BuildingShape = {
    id: '2f', type: 'polygon', fill: '#000', floor: 2,
    points: [{ x: 300, y: 600 }, { x: 800, y: 600 }, { x: 800, y: -200 }, { x: 300, y: -200 }],
  };
  const bandCe = { lo: 800, hi: 1000, mode: 'center' as const };
  const rep = 900;
  const ssR: ScaffoldStartConfig = {
    corner: 'nw', startVertexIndex: 0,
    face1DistanceMm: rep, face2DistanceMm: rep,
    face1FirstHandrail: 1800, face2FirstHandrail: 1800,
  };
  const D = { 1: fill(8, rep), 2: fill(6, rep) };
  const run = () => computeCascadeLayout({ 1: g1, 2: g2 }, D, ssR, M, PC, undefined, undefined, bandCe);

  it('全floor rails合計==有効長 & findScaffoldViolations===[]', () => {
    const res = run();
    assertRailsMatchEffective(res, '別形状 下屋分割');
    const allHandrails = [2, 1].flatMap(f => segmentsToHandrails(res[f].edgeSegments));
    expect(findScaffoldViolations(allHandrails, [g1, g2])).toEqual([]);
  });
});

// ============================================================
// S-2e: 上階（N=2 の 2F 含む）が入隅（reentrant/凹角＝L字/U字）を持つとき、入隅から出る辺の
//   非タイル eff を修正（S-2e-b: 案A' 実着地 source-align）。
//   機構: candidates.ts の concave startContribution が前辺 start(prevEdgeStartDist) を使う一方、
//   walkFloorUpperRole 2nd-pass cursor(concave)は自 startDistanceMm(=前辺 actualEnd) を使い、
//   band で前辺が非対称(start≠actualEnd)だと d = 前辺 actualEnd − 前辺 start ≠ 0 だった。
//   → walkFloorUpperRole の入隅辺で候補の start 寄与を「前辺 start」から「自 startDistanceMm
//     (=前辺の実着地)」へ source-align（支柱共有＝手摺は実着地の角から敷き始める）。
//   結果: 入隅辺 total==eff（d==0）。convex/straight-continuation/前辺対称は byte 不変。
//   NB(既知・別スコープ): center 帯では入隅を直すと 25mm の位相的余りが loop 閉じの west 辺
//   (アンカー隣接・sp=(0,y)) へ移る（findScaffoldViolations は 0＝物理違反なし）。lower 帯は全辺 d==0。
//   ここでは task の受入基準（入隅辺 d==0 & findScaffoldViolations==[]）を固定する。
// ============================================================
describe('S-2e 上階入隅辺の非タイルeff（S-2e-b source-align で緑化）', () => {
  const Lshape = (id: string, floor: number, w: number, h: number, nx: number, ny: number): BuildingShape => ({
    id, type: 'polygon', fill: '#000', floor,
    points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: ny }, { x: nx, y: ny }, { x: nx, y: h }, { x: 0, y: h }],
  });
  // 入隅辺 = 上階 east 辺・startPoint=(495,495)
  const innerEdge = (res: Record<number, FloorLayoutResult>, floor: number) =>
    res[floor].edgeSegments.find(s => s.face === 'east' && Math.abs(s.startPoint.x - 495) < 0.1 && Math.abs(s.startPoint.y - 495) < 0.1)!;
  const allHof = (res: Record<number, FloorLayoutResult>) =>
    Object.keys(res).map(Number).sort((a, b) => b - a).flatMap(f => segmentsToHandrails(res[f].edgeSegments));

  const n2Blds = (): BuildingShape[] => [Lshape('2f', 2, 900, 900, 495, 495), rect('1f', 1, 2250, 2350)];
  const n3Blds = (): BuildingShape[] => [Lshape('3f', 3, 900, 900, 495, 495), Lshape('2f', 2, 1575, 1625, 832, 858), Lshape('1f', 1, 2250, 2350, 1169, 1221)];
  const n2 = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => computeCascadeLayout(
    { 2: n2Blds()[0], 1: n2Blds()[1] }, { 1: fill(8, 900), 2: fill(8, 900) }, ss, M, PC, undefined, undefined, band);
  const n3 = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => computeCascadeLayout(
    { 3: n3Blds()[0], 2: n3Blds()[1], 1: n3Blds()[2] }, { 1: fill(16, 900), 2: fill(16, 900), 3: fill(16, 900) }, ss, M, PC, undefined, undefined, band);

  const bands: { lo: number; hi: number; mode: 'center' | 'lower' }[] = [
    { lo: 800, hi: 950, mode: 'center' }, // 修正前 d=-25 だったケース
    { lo: 800, hi: 950, mode: 'lower' },
    { lo: 820, hi: 940, mode: 'center' },
  ];
  for (const band of bands) {
    const tag = `[${band.lo},${band.hi}]${band.mode}`;
    it(`N=2 上階L字 ${tag}: 入隅辺 d==0 & 違反0`, () => {
      const res = n2(band);
      const s = innerEdge(res, 2); const sel = s.candidates[s.selectedIndex]!;
      expect(sel.totalMm).toBe(s.effectiveMm);
      expect(findScaffoldViolations(allHof(res), n2Blds())).toEqual([]);
    });
    it(`N=3 上階L字両成長 ${tag}: 入隅辺 d==0 & 違反0`, () => {
      const res = n3(band);
      const s = innerEdge(res, 3); const sel = s.candidates[s.selectedIndex]!;
      expect(sel.totalMm).toBe(s.effectiveMm);
      expect(findScaffoldViolations(allHof(res), n3Blds())).toEqual([]);
    });
  }

  // lower 帯は全辺 d==0（位相的余りが出ない＝入隅 fix が全周整合）を固定
  it('lower 帯: N=2/N=3 とも全辺 rails合計==有効長（余りゼロ）', () => {
    assertRailsMatchEffective(n2({ lo: 800, hi: 950, mode: 'lower' }), 'S-2e N=2 lower 全辺');
    assertRailsMatchEffective(n3({ lo: 800, hi: 950, mode: 'lower' }), 'S-2e N=3 lower 全辺');
  });
});

// ============================================================
// S-2f: center 帯の「一周整合」＝全floor全辺 d==0（S-2f-b: driver のアンカー start 探索で緑化）。
//   S-2e-b で入隅は d==0 になったが、center[800,950] では 25mm の位相的余りが直下 floor の
//   loop 閉じ辺へ移った（N=2:F1 / N=3:F2）。根本は per-edge 逐次確定でアンカー辺 start を
//   帯中央(mid=875)に固定し一周の帳尻を強制していないこと。
//   S-2f-b: computeCascadeLayout が band(center) 時にアンカー start を band 内で探索し、
//   全floor全辺 d==0 に閉じる解を center 最寄りで採用（現 mid で閉じるなら現状維持＝byte 不変）。
//   実測: 既定帯[800,950]で L字 185/185 が 0-seam（chosen=900・center から 25）。
// ============================================================
describe('S-2f center帯の一周整合（S-2f-b アンカー探索で緑化）', () => {
  const Lshape = (id: string, floor: number, w: number, h: number, nx: number, ny: number): BuildingShape => ({
    id, type: 'polygon', fill: '#000', floor,
    points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: ny }, { x: nx, y: ny }, { x: nx, y: h }, { x: 0, y: h }],
  });
  const allHof = (res: Record<number, FloorLayoutResult>) =>
    Object.keys(res).map(Number).sort((a, b) => b - a).flatMap(f => segmentsToHandrails(res[f].edgeSegments));
  const n2Blds = (): BuildingShape[] => [Lshape('2f', 2, 900, 900, 495, 495), rect('1f', 1, 2250, 2350)];
  const n3Blds = (): BuildingShape[] => [Lshape('3f', 3, 900, 900, 495, 495), Lshape('2f', 2, 1575, 1625, 832, 858), Lshape('1f', 1, 2250, 2350, 1169, 1221)];
  const n2 = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => computeCascadeLayout(
    { 2: n2Blds()[0], 1: n2Blds()[1] }, { 1: fill(8, 900), 2: fill(8, 900) }, ss, M, PC, undefined, undefined, band);
  const n3 = (band: { lo: number; hi: number; mode: 'center' | 'lower' }) => computeCascadeLayout(
    { 3: n3Blds()[0], 2: n3Blds()[1], 1: n3Blds()[2] }, { 1: fill(16, 900), 2: fill(16, 900), 3: fill(16, 900) }, ss, M, PC, undefined, undefined, band);

  for (const band of [{ lo: 800, hi: 950, mode: 'center' as const }, { lo: 820, hi: 940, mode: 'center' as const }, { lo: 800, hi: 1000, mode: 'center' as const }]) {
    const tag = `[${band.lo},${band.hi}]${band.mode}`;
    it(`N=2 上階L字 ${tag}: 全floor全辺 d==0 & 違反0`, () => {
      const res = n2(band);
      assertRailsMatchEffective(res, `S-2f N=2 ${tag}`);
      expect(findScaffoldViolations(allHof(res), n2Blds())).toEqual([]);
    });
    it(`N=3 L字両成長 ${tag}: 全floor全辺 d==0 & 違反0`, () => {
      const res = n3(band);
      assertRailsMatchEffective(res, `S-2f N=3 ${tag}`);
      expect(findScaffoldViolations(allHof(res), n3Blds())).toEqual([]);
    });
  }

  it('メタ情報: 既定帯[800,950]center で一周整合が成立（S-2e-c-b 案B 後は base=mid で閉じる）', () => {
    const res = n2({ lo: 800, hi: 950, mode: 'center' });
    const meta = (res as Record<number, FloorLayoutResult> & { [LOOP_FIT_META]?: LoopFitMeta })[LOOP_FIT_META];
    // S-2e-c-b 前は mid(875)で閉じず search が chosen=900 を選んでいたが、案B(入隅 concave の
    // scaffold線基準統一)で入隅由来の一周残差が解消し mid=base で閉じる → search 不要(searched=[])。
    expect(meta?.closed).toBe(true);
    expect(meta?.searched).toEqual([]);
    expect(meta?.baseResidual).toBe(0);
  });
});

// ============================================================
// S-2e-c: 入隅の「角接続整合」（S-2e-c-b 案B: 前辺 scaffold線基準に統一で緑化）。
//   実物件(2F=l_se L字/1F=矩形/band[700,950]center/自動起点)で入隅横 e2 が非対称(startD 875≠
//   actualEnd 775)のとき、S-2e-b の「実着地(775)基準」だと入隅縦 e3 の cursorStart=303.5 が e2 の
//   scaffold線(875)=313.5 を 100mm 突き抜けた。案B(candidate/cursor とも prevEdgeStartDist=前辺の
//   scaffold線離れ基準に統一)で cursorStart=313.5＝2線交点で止まる。前辺対称は no-op=byte 不変。
//   total==eff だけでは角接続を検査できなかったため、新不変条件で恒久固定する。
// ============================================================
describe('S-2e-c 入隅の角接続整合（案B: 前辺 scaffold線基準）', () => {
  const b1: BuildingShape = { id: '1f', type: 'polygon', fill: '#000', floor: 1, points: [{ x: -300, y: -400 }, { x: 900, y: -400 }, { x: 900, y: 800 }, { x: -300, y: 800 }] };
  const b2: BuildingShape = { id: '2f', type: 'polygon', fill: '#000', floor: 2, points: [{ x: -159, y: -174 }, { x: 741, y: -174 }, { x: 741, y: 226 }, { x: 441, y: 226 }, { x: 441, y: 526 }, { x: -159, y: 526 }] };
  const band = { lo: 700, hi: 950, mode: 'center' as const };
  const run = () => {
    const norm = normalizeBuildingsByFloor({ 1: b1, 2: b2 });
    const ssR: ScaffoldStartConfig = { corner: 'nw', startVertexIndex: autoStartVertexIndex(norm[2]), face1DistanceMm: 825, face2DistanceMm: 825, face1FirstHandrail: 1800, face2FirstHandrail: 1800 };
    return computeCascadeLayout({ 1: b1, 2: b2 }, { 1: fill(8, 825), 2: fill(10, 825) }, ssR, M, PC, undefined, undefined, band);
  };
  // 入隅縦 = 2F east 辺で直前(周回prev)が south。角接続: cursorStart が入隅横(prev)の scaffoldCoord に一致すべき。
  const innerVert = (res: Record<number, FloorLayoutResult>) => {
    const segs = res[2].edgeSegments;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], prev = segs[(i - 1 + segs.length) % segs.length];
      if (s.face === 'east' && prev.face === 'south') return { s, prev };
    }
    throw new Error('入隅縦(east,prev=south)が見つからない');
  };
  const twoF = (res: Record<number, FloorLayoutResult>) => segmentsToHandrails(res[2].edgeSegments);

  it('入隅縦 cursorStart == 入隅横 scaffoldCoord（突き抜け0・2線交点で止まる）', () => {
    const { s, prev } = innerVert(run());
    expect(s.cursorStart).toBe(prev.scaffoldCoord); // 313.5==313.5（修正前 303.5）
  });
  it('入隅縦 e3 total==eff（角接続整合下でも成立）', () => {
    const { s } = innerVert(run());
    const sel = s.candidates[s.selectedIndex]!;
    expect(sel.totalMm).toBe(s.effectiveMm);
  });
  it('2F 全辺 total==eff & findScaffoldViolations===[]（実物件 band[700,950]center）', () => {
    const res = run();
    // 2F にスコープ（1F は実アプリ距離では閉じる。uniform-825 前提の 1F は別途）
    for (const s of res[2].edgeSegments) {
      const sel = s.candidates[s.selectedIndex]; if (!sel) continue;
      expect(Math.abs(sel.totalMm - s.effectiveMm)).toBeLessThanOrEqual(0.01);
    }
    expect(findScaffoldViolations(twoF(res), [b2])).toEqual([]);
  });
});
