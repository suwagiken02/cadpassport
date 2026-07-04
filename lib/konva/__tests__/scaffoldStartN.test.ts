import { describe, it, expect } from 'vitest';
import { getScaffoldStartByFloor, type ScaffoldStartConfig, type CanvasData } from '@/types';

// ============================================================
// S-5e-3: 星 UI の N 化（setScaffoldStartFloor 書込）と distances seed 一般化の
//   {1,2} byte 不変 + N 階拡張を pure に固定。
// ============================================================

const mk = (floor: number): ScaffoldStartConfig => ({
  corner: 'nw', startVertexIndex: floor, face1DistanceMm: 900, face2DistanceMm: 900,
  face1FirstHandrail: 1800, face2FirstHandrail: 1800, floor,
});

type Data = Pick<CanvasData, 'scaffoldStart1F' | 'scaffoldStart2F' | 'scaffoldStartByFloor' | 'scaffoldStart'>;

// 旧 setScaffoldStart(config) の canvasData 変異（config.floor 駆動）
function oldSet(data: Data, config: ScaffoldStartConfig): Data {
  const floor = config.floor ?? 1;
  const next: Data = { ...data, scaffoldStart: config };
  if (floor === 1) next.scaffoldStart1F = config; else next.scaffoldStart2F = config;
  return next;
}
// 新 setScaffoldStartFloor(floor, config) の canvasData 変異（byFloor + 1/2 両建て）
function newSet(data: Data, floor: number, config: ScaffoldStartConfig | undefined): Data {
  const nextByFloor = { ...(data.scaffoldStartByFloor ?? {}) };
  if (config) nextByFloor[floor] = config; else delete nextByFloor[floor];
  const next: Data = { ...data, scaffoldStartByFloor: nextByFloor };
  if (floor === 1) next.scaffoldStart1F = config; else if (floor === 2) next.scaffoldStart2F = config;
  return next;
}

describe('星保存 読取不変: OLD setScaffoldStart vs NEW setScaffoldStartFloor（floor 1/2・4パタン）', () => {
  it('1F を新規設定', () => {
    const cfg = mk(1);
    const o = getScaffoldStartByFloor(oldSet({}, cfg));
    const n = getScaffoldStartByFloor(newSet({}, 1, cfg));
    expect(n).toEqual(o);
    expect(n[1]).toBe(cfg);
  });
  it('2F を新規設定', () => {
    const cfg = mk(2);
    expect(getScaffoldStartByFloor(newSet({}, 2, cfg))).toEqual(getScaffoldStartByFloor(oldSet({}, cfg)));
  });
  it('1F→2F の両方設定', () => {
    const c1 = mk(1), c2 = mk(2);
    const o = getScaffoldStartByFloor(oldSet(oldSet({}, c1), c2));
    const n = getScaffoldStartByFloor(newSet(newSet({}, 1, c1), 2, c2));
    expect(n).toEqual(o);
    expect(n).toEqual({ 1: c1, 2: c2 });
  });
  it('1F を上書き', () => {
    const c1 = mk(1), c1b = { ...mk(1), face1DistanceMm: 700 };
    const o = getScaffoldStartByFloor(oldSet(oldSet({}, c1), c1b));
    const n = getScaffoldStartByFloor(newSet(newSet({}, 1, c1), 1, c1b));
    expect(n).toEqual(o);
    expect(n[1]).toBe(c1b);
  });
});

describe('3F 星 一気通貫（保存→合成アクセサ→modal 読取→topStart）', () => {
  it('setScaffoldStartFloor(3) → getScaffoldStartByFloor[3] → effectiveFloor=topFloor で取得', () => {
    const c3 = mk(3);
    // 3F 建物あり・{1,2,3} present、'all' → effectiveFloor = topFloor = 3
    const data = newSet({ scaffoldStart1F: mk(1), scaffoldStart2F: mk(2) }, 3, c3);
    const byFloor = getScaffoldStartByFloor(data);
    expect(byFloor[3]).toBe(c3); // 保存が合成アクセサに載る（旧 setScaffoldStart では載らなかった）
    // modal の読取(S-5c): stored = getScaffoldStartByFloor(canvasData)[effectiveFloor]
    const effectiveFloor = 3; // targetFloor==='all' → Math.max(presentFloors=[1,2,3])
    const topStart = byFloor[effectiveFloor];
    expect(topStart).toBe(c3); // → cascadeInput.topStart に到達
  });
});

// ---- distances seed 一般化 ----
type Edge = { index: number };
function seedNonTop(
  prev: Record<number, Record<number, number>>,
  floorsDesc: number[], topFloor: number,
  uncoveredEdgesByFloor: Record<number, Edge[]>, repDist: number,
): Record<number, Record<number, number>> {
  const nextAll = { ...prev };
  for (const f of floorsDesc) {
    if (f === topFloor) continue;
    const d: Record<number, number> = {};
    (uncoveredEdgesByFloor[f] ?? []).forEach(e => { d[e.index] = repDist; });
    nextAll[f] = d;
  }
  return nextAll;
}

describe('distances seed 一般化', () => {
  const REP = 825;
  it('{1,2}: 従来 [subFloor(1)]=uncoveredEdges1F seed と deep equal', () => {
    const uncov1: Edge[] = [{ index: 4 }, { index: 6 }, { index: 10 }];
    // OLD: { ...prev, [1]: {4:REP,6:REP,10:REP} }
    const oldResult = { 2: { 0: REP }, 1: { 4: REP, 6: REP, 10: REP } };
    const newResult = seedNonTop({ 2: { 0: REP } }, [2, 1], 2, { 1: uncov1 }, REP);
    expect(newResult).toEqual(oldResult);
  });
  it('{1,2,3}: 中間階(2)と最下階(1)の下屋を seed・top(3)は非書込', () => {
    const uncov: Record<number, Edge[]> = { 1: [{ index: 5 }], 2: [{ index: 3 }] };
    const res = seedNonTop({ 3: { 0: REP } }, [3, 2, 1], 3, uncov, REP);
    expect(res[3]).toEqual({ 0: REP }); // top 保持
    expect(res[2]).toEqual({ 3: REP }); // 中間階下屋
    expect(res[1]).toEqual({ 5: REP }); // 最下階下屋
  });
});
