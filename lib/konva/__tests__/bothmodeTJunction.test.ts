import { describe, it, expect } from 'vitest';
import {
  computeBothmode2FLayout, computeBothmode1FLayout, bothmodeResultsToAutoLayoutResult,
  splitBuilding1FAtBuilding2FVertices, splitBuilding2FAt1FVertices,
  getBuildingEdgesClockwise, placeHandrailsForEdge,
} from '../autoLayoutUtils';
import { resolveScaffoldStartOnNormalized } from '../labelUtils';
import { DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG } from '@/types';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';

// ============================================================
// bothmode 中間接続(T字) 検出:
//   くさび式足場は手摺端のくさびを支柱コマに打込む。角は支柱1本を縦横で共有するため、
//   隣接手摺は端点同士が同一座標で接続されねばならない。片方の手摺の中間(端点でない
//   線分上)に他方の端点が来る「中間接続(T字)」は支柱の無い場所に端=物理的に不能。
//   平行面一境界(1F北↔2F北)で端点継承が無く 1F北が突出 → 2F北と重複しT字(計4件)。
// ============================================================

type H = { x: number; y: number; lengthMm: number; direction: 'horizontal' | 'vertical' };
type Seg = { a: [number, number]; b: [number, number]; dir: 'horizontal' | 'vertical'; floor: number; ei: number };

const EPS = 1; // mm
const eq = (p: number, q: number) => Math.abs(p - q) < EPS;
const ptEq = (p: [number, number], q: [number, number]) => eq(p[0], q[0]) && eq(p[1], q[1]);

/** ある手摺の端点が、別手摺の内部(端点でない線分上)に乗るT字接続を列挙する純関数 */
function findTJunctions(segs: Seg[]): { ep: [number, number]; onIndex: number }[] {
  const out: { ep: [number, number]; onIndex: number }[] = [];
  const interiorHit = (p: [number, number], s: Seg): boolean => {
    const [px, py] = p; const [ax, ay] = s.a; const [bx, by] = s.b;
    // 軸並行線上にあるか
    if (s.dir === 'horizontal') { if (!eq(py, ay)) return false; }
    else { if (!eq(px, ax)) return false; }
    const lo = s.dir === 'horizontal' ? Math.min(ax, bx) : Math.min(ay, by);
    const hi = s.dir === 'horizontal' ? Math.max(ax, bx) : Math.max(ay, by);
    const v = s.dir === 'horizontal' ? px : py;
    // 開区間(端点を除く内部)に入る
    return v > lo + EPS && v < hi - EPS;
  };
  for (let i = 0; i < segs.length; i++) {
    for (const ep of [segs[i].a, segs[i].b]) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        if (interiorHit(ep, segs[j])) out.push({ ep, onIndex: j });
      }
    }
  }
  return out;
}

function run() {
  const mk = (id: string, pts: [number, number][], floor: 1 | 2): BuildingShape => ({
    id, type: 'polygon', floor, fill: '#000', points: pts.map(([x, y]) => ({ x, y })),
  });
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
  const adapted = bothmodeResultsToAutoLayoutResult(r2, r1);

  const segs: Seg[] = [];
  for (const lay of adapted.edgeLayouts) {
    const rails = lay.candidates[lay.selectedIndex]?.rails ?? [];
    for (const h of placeHandrailsForEdge(lay, rails) as H[]) {
      const a: [number, number] = [Math.round(h.x * 10), Math.round(h.y * 10)];
      const b: [number, number] = h.direction === 'horizontal'
        ? [a[0] + h.lengthMm, a[1]] : [a[0], a[1] + h.lengthMm];
      segs.push({ a, b, dir: h.direction, floor: lay.originFloor ?? 0, ei: lay.edge.index });
    }
  }
  return { r1, r2, segs };
}

describe('bothmode 中間接続(T字) 解消 — 平行面一境界の端点継承', () => {
  const { r1, r2, segs } = run();

  it('(A) 配置結果に中間接続(T字)が無い', () => {
    const t = findTJunctions(segs);
    expect(t).toEqual([]); // 現状4件で失敗(バグ捕捉)
  });

  it('(B) 北面一で 1F北終点 == 2F北始点 == (3600,-2400) (端点継承=支柱共有)', () => {
    // 2F北(north/horizontal) セグメント
    const n2 = r2.edgeSegments.find(s => s.face === 'north' && s.handrailDir === 'horizontal')!;
    // 1F北(north/horizontal) セグメント
    const n1 = r1.edgeSegments.find(s => s.face === 'north' && s.handrailDir === 'horizontal')!;
    // 2F北 始点側の進行軸座標(cursorStart) = 3600。1F北 の手摺最遠端 = 3600 で一致すべき
    const n1Last = (() => {
      const rails = n1.candidates[n1.selectedIndex]?.rails ?? [];
      // 1F北は cursorStart から進む。最終端 = cursorStart + sign*total。突出してないか確認用に最大xを取る
      const total = rails.reduce((a, b) => a + b, 0);
      const sign = n1.endPoint.x >= n1.startPoint.x ? 1 : -1;
      return Math.round((n1.cursorStart * 10) + sign * total);
    })();
    expect(Math.round(n2.cursorStart * 10)).toBe(3600);
    expect(n1Last).toBe(3600); // 現状 5400 で失敗
  });

  it('(C) 1F北の手摺が突出せず 2F北始点(3600)で止まる', () => {
    // 北ライン(y=-2400) の F1(1F) 手摺のみの最大x。1F北は 3600 で止まる(2F北が3600..担当)。
    const f1North = segs.filter(s => s.dir === 'horizontal' && s.floor === 1 && eq(s.a[1], -2400));
    const f1NorthMaxX = Math.max(...f1North.map(s => Math.max(s.a[0], s.b[0])));
    expect(f1NorthMaxX).toBe(3600); // 現状 5400 で失敗(壁端4500も越えて突出)
  });
});
