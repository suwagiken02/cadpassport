// くさび式足場の物理ルール検証（docs/足場基礎仕様.md 準拠）。
// 配置済み手摺(placeHandrailsForEdge 出力)に対し、物理的に組めない配置を検出する純関数。
//   - t-junction(中間接続): 端点が他手摺の開区間内部(端点でない線上)に乗る
//   - overlap(重複): 同方向・同固定軸の2手摺の区間が部分的にでも重なる
//   - overshoot(はみ出し): 手摺が建物範囲を大きく超えて飛び出す(角の離れラップは許容)
import type { BuildingShape } from '@/types';

/** placeHandrailsForEdge の出力形式（x,y は grid 単位、lengthMm は mm） */
export type ScaffoldHandrail = {
  x: number;
  y: number;
  lengthMm: number;
  direction: 'horizontal' | 'vertical';
};

export type ScaffoldViolation = {
  kind: 't-junction' | 'overlap' | 'overshoot';
  idA: number;
  idB?: number;
  coord: [number, number]; // mm
  amountMm: number;
};

const EPS = 1; // mm

type Seg = {
  fixed: number;          // 固定軸座標(mm): horizontal→y, vertical→x
  lo: number; hi: number; // 可変軸の範囲(mm)
  a: [number, number]; b: [number, number]; // 端点(mm)
  dir: 'horizontal' | 'vertical';
};

const toSeg = (h: ScaffoldHandrail): Seg => {
  const ax = Math.round(h.x * 10), ay = Math.round(h.y * 10);
  const bx = h.direction === 'horizontal' ? ax + h.lengthMm : ax;
  const by = h.direction === 'horizontal' ? ay : ay + h.lengthMm;
  const fixed = h.direction === 'horizontal' ? ay : ax;
  const v0 = h.direction === 'horizontal' ? ax : ay;
  const v1 = h.direction === 'horizontal' ? bx : by;
  return { fixed, lo: Math.min(v0, v1), hi: Math.max(v0, v1), a: [ax, ay], b: [bx, by], dir: h.direction };
};

const variableOf = (p: [number, number], dir: 'horizontal' | 'vertical') =>
  dir === 'horizontal' ? p[0] : p[1];
const fixedOf = (p: [number, number], dir: 'horizontal' | 'vertical') =>
  dir === 'horizontal' ? p[1] : p[0];

/**
 * 物理違反(t-junction / overlap / overshoot)を全て列挙する。
 * @param handrails 配置済み手摺
 * @param buildings overshoot 判定用(任意)。建物境界 + 余裕を大きく超える手摺を検出
 */
export function findScaffoldViolations(
  handrails: ScaffoldHandrail[],
  buildings?: BuildingShape[],
): ScaffoldViolation[] {
  const segs = handrails.map(toSeg);
  const out: ScaffoldViolation[] = [];

  // (a) t-junction: ある手摺の端点が、別手摺の同軸・開区間内部に乗る
  for (let i = 0; i < segs.length; i++) {
    for (const ep of [segs[i].a, segs[i].b]) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const t = segs[j];
        if (Math.abs(fixedOf(ep, t.dir) - t.fixed) > EPS) continue; // 同一線上か
        const v = variableOf(ep, t.dir);
        if (v > t.lo + EPS && v < t.hi - EPS) {
          out.push({ kind: 't-junction', idA: i, idB: j, coord: ep, amountMm: Math.min(v - t.lo, t.hi - v) });
        }
      }
    }
  }

  // (b) overlap: 同方向・同固定軸の2手摺の区間が部分重複
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.dir !== t.dir) continue;
      if (Math.abs(s.fixed - t.fixed) > EPS) continue;
      const ov = Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo);
      if (ov > EPS) {
        out.push({ kind: 'overlap', idA: i, idB: j, coord: [Math.max(s.lo, t.lo), s.fixed], amountMm: ov });
      }
    }
  }

  // (c) overshoot: 建物境界を大きく超えて飛び出す手摺(角の離れラップは許容するため余裕大)
  if (buildings && buildings.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of buildings) {
      for (const p of b.points) {
        minX = Math.min(minX, p.x * 10); minY = Math.min(minY, p.y * 10);
        maxX = Math.max(maxX, p.x * 10); maxY = Math.max(maxY, p.y * 10);
      }
    }
    const M = 2000; // 角の離れラップ(最大2離れ≒1800)を許容する余裕
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const xLo = s.dir === 'horizontal' ? s.lo : s.fixed;
      const xHi = s.dir === 'horizontal' ? s.hi : s.fixed;
      const yLo = s.dir === 'vertical' ? s.lo : s.fixed;
      const yHi = s.dir === 'vertical' ? s.hi : s.fixed;
      const over = Math.max(
        minX - M - xLo, xHi - (maxX + M),
        minY - M - yLo, yHi - (maxY + M),
      );
      if (over > EPS) {
        out.push({ kind: 'overshoot', idA: i, coord: s.a, amountMm: over });
      }
    }
  }

  return out;
}
