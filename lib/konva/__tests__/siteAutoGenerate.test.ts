// ============================================================
// S-3: 敷地境界線の自動生成（建物の外周から一定距離）。
//
// 多角形を直接オフセットすると L 字の凹角で自己交差する。ここでは
// 「矩形へ分解 → 広げる → 和集合の輪郭」という、そもそも交差が生まれない
// 道順を通している。テストの主眼は
//   ・単純な矩形で座標が厳密に合うこと
//   ・L 字で自己交差しないこと（凹角がちゃんと凹んだまま）
//   ・接する 2 棟がひとつの外形にまとまること
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  SITE_AUTO_DEFAULT_MM, SITE_AUTO_MAX_MM, SITE_AUTO_MIN_MM, SITE_AUTO_PRESET_MM,
  buildingsSitePolygons, clampSiteAutoMm, decomposeToRects, signedArea,
} from '../siteAutoGenerate';
import type { Point } from '@/types';

/** グリッド 1 = 10mm。 */
const G = (mm: number) => mm / 10;

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

/** 頂点集合として比較する（始点や向きの違いに引っかからない）。 */
const asSet = (pts: Point[]) => new Set(pts.map((p) => `${p.x},${p.y}`));

/** 線分が交差するか（端点の共有は除く）＝自己交差の検出用。 */
function segmentsProperlyIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d = (p: Point, q: Point, r: Point) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const d1 = d(a1, a2, b1), d2 = d(a1, a2, b2), d3 = d(b1, b2, a1), d4 = d(b1, b2, a2);
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4;
}

/** その多角形は自分自身と交差していないか。 */
function isSimplePolygon(ring: Point[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsProperlyIntersect(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return false;
    }
  }
  // 同じ頂点が 2 回出てこない（1 点で自分に触れていない）
  return new Set(ring.map((p) => `${p.x},${p.y}`)).size === n;
}

// ============================================================
describe('単純な矩形の建物 1 棟', () => {
  const b = { points: rect(0, 0, G(10000), G(8000)) };   // 10m × 8m

  it('各辺が指定距離だけ外側の矩形になる（1m）', () => {
    const [ring] = buildingsSitePolygons([b], 1000);
    expect(ring).toHaveLength(4);
    expect(asSet(ring)).toEqual(asSet([
      { x: -G(1000), y: -G(1000) },
      { x: G(11000), y: -G(1000) },
      { x: G(11000), y: G(9000) },
      { x: -G(1000), y: G(9000) },
    ]));
  });

  it('距離を変えるとそのぶん外へ出る', () => {
    for (const mm of [500, 1500, 2000]) {
      const [ring] = buildingsSitePolygons([b], mm);
      const xs = ring.map((p) => p.x);
      const ys = ring.map((p) => p.y);
      expect(Math.min(...xs), `${mm}`).toBe(-G(mm));
      expect(Math.min(...ys), `${mm}`).toBe(-G(mm));
      expect(Math.max(...xs), `${mm}`).toBe(G(10000) + G(mm));
      expect(Math.max(...ys), `${mm}`).toBe(G(8000) + G(mm));
    }
  });

  it('角は直角のまま（丸めない・頂点は 4 つだけ）', () => {
    const [ring] = buildingsSitePolygons([b], 1000);
    expect(ring).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      const a = ring[i], c = ring[(i + 1) % 4];
      expect(a.x === c.x || a.y === c.y).toBe(true);   // 全辺が軸に平行
    }
  });

  it('生成されるのは 1 枚だけ', () => {
    expect(buildingsSitePolygons([b], 1000)).toHaveLength(1);
  });

  it('自己交差しない', () => {
    expect(isSimplePolygon(buildingsSitePolygons([b], 1000)[0])).toBe(true);
  });

  it('建物を完全に含む（敷地が建物へ食い込まない）', () => {
    const [ring] = buildingsSitePolygons([b], 1000);
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    for (const p of b.points) {
      expect(p.x).toBeGreaterThan(Math.min(...xs));
      expect(p.x).toBeLessThan(Math.max(...xs));
      expect(p.y).toBeGreaterThan(Math.min(...ys));
      expect(p.y).toBeLessThan(Math.max(...ys));
    }
  });
});

// ============================================================
describe('L 字の建物（凹角で自己交差しない）', () => {
  //  (0,0)┌──────┐(120,0)
  //       │      │
  //       │      └──┐(200,60)
  //       │         │
  //  (0,200)└───────┘(200,200)
  const L: Point[] = [
    { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 },
    { x: 200, y: 60 }, { x: 200, y: 200 }, { x: 0, y: 200 },
  ];
  const [ring] = buildingsSitePolygons([{ points: L }], 1000);   // d = 100 グリッド

  it('自己交差しない', () => {
    expect(isSimplePolygon(ring)).toBe(true);
  });

  it('全辺が軸に平行（角が丸まっていない）', () => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      expect(a.x === b.x || a.y === b.y, `${i}`).toBe(true);
    }
  });

  it('外へ張り出した角は d だけ外に出る', () => {
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    expect(Math.min(...xs)).toBe(-100);
    expect(Math.min(...ys)).toBe(-100);
    expect(Math.max(...xs)).toBe(300);
    expect(Math.max(...ys)).toBe(300);
  });

  it('凹んだ角が残る（外周が単なる長方形に潰れていない）', () => {
    expect(ring.length).toBeGreaterThan(4);
    // 凹角 (120,60) は d だけ外＝(220,-40) 側へ寄る。長方形なら現れない点。
    expect(asSet(ring).has('220,-40')).toBe(true);
  });

  it('面積が外接長方形より小さい（凹みが埋まっていない）', () => {
    const area = Math.abs(signedArea(ring));
    expect(area).toBeLessThan(400 * 400);
    expect(area).toBeGreaterThan(0);
  });

  it('L 字の全頂点が敷地の内側にある', () => {
    // 敷地は建物を包む。凹角も含めて外へ出ていないこと。
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    for (const p of L) {
      expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(p.x).toBeLessThanOrEqual(Math.max(...xs));
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys));
      expect(p.y).toBeLessThanOrEqual(Math.max(...ys));
    }
  });

  it('向きが逆の L 字（時計回りに描いた建物）でも同じ結果', () => {
    const reversed = [...L].reverse();
    const [r2] = buildingsSitePolygons([{ points: reversed }], 1000);
    expect(asSet(r2)).toEqual(asSet(ring));
  });
});

// ============================================================
describe('複数棟', () => {
  it('接する 2 棟はひとつの外形にまとまる', () => {
    const a = { points: rect(0, 0, 100, 100) };
    const b = { points: rect(100, 0, 100, 100) };   // 辺で接する
    const rings = buildingsSitePolygons([a, b], 1000);
    expect(rings).toHaveLength(1);
    expect(asSet(rings[0])).toEqual(asSet([
      { x: -100, y: -100 }, { x: 300, y: -100 }, { x: 300, y: 200 }, { x: -100, y: 200 },
    ]));
  });

  it('重なる 2 棟（総二階のような 1F/2F）もひとつ', () => {
    const a = { points: rect(0, 0, 200, 150) };
    const b = { points: rect(50, 30, 100, 90) };
    const rings = buildingsSitePolygons([a, b], 1000);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it('広げると届く程度に離れた 2 棟もひとつにまとまる', () => {
    const a = { points: rect(0, 0, 100, 100) };
    const b = { points: rect(150, 0, 100, 100) };   // 隙間 50 < 2d(=200)
    expect(buildingsSitePolygons([a, b], 1000)).toHaveLength(1);
  });

  it('広げても届かない棟は別々の外形になる（無いものを繋がない）', () => {
    const a = { points: rect(0, 0, 100, 100) };
    const b = { points: rect(1000, 0, 100, 100) };
    const rings = buildingsSitePolygons([a, b], 1000);
    expect(rings).toHaveLength(2);
    for (const r of rings) expect(isSimplePolygon(r)).toBe(true);
  });

  it('まとまった外形も自己交差しない', () => {
    const a = { points: rect(0, 0, 200, 100) };
    const b = { points: rect(80, 100, 100, 200) };   // T 字に接する
    const rings = buildingsSitePolygons([a, b], 1000);
    expect(rings).toHaveLength(1);
    expect(isSimplePolygon(rings[0])).toBe(true);
    expect(rings[0].length).toBeGreaterThan(4);   // T 字の凹みが残る
  });
});

// ============================================================
describe('入力の受け取り方', () => {
  it('建物が無ければ何も作らない', () => {
    expect(buildingsSitePolygons([], 1000)).toEqual([]);
  });

  it('点が足りない建物は無視する', () => {
    expect(buildingsSitePolygons([{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], 1000)).toEqual([]);
  });

  it('つぶれた建物（面積ゼロ）は無視する', () => {
    expect(buildingsSitePolygons([{ points: rect(0, 0, 100, 0) }], 1000)).toEqual([]);
  });

  it('距離の丸め（0 以下・大きすぎ・NaN）', () => {
    expect(clampSiteAutoMm(0)).toBe(SITE_AUTO_MIN_MM);
    expect(clampSiteAutoMm(-500)).toBe(SITE_AUTO_MIN_MM);
    expect(clampSiteAutoMm(NaN)).toBe(SITE_AUTO_DEFAULT_MM);
    expect(clampSiteAutoMm(1e9)).toBe(SITE_AUTO_MAX_MM);
    expect(clampSiteAutoMm(1000)).toBe(1000);
  });

  it('既定は 1m、プリセットに 1000 が入っている', () => {
    expect(SITE_AUTO_DEFAULT_MM).toBe(1000);
    expect(SITE_AUTO_PRESET_MM).toContain(1000);
    expect(SITE_AUTO_PRESET_MM.every((mm) => mm >= SITE_AUTO_MIN_MM)).toBe(true);
  });

  it('小数の距離も通る', () => {
    const [ring] = buildingsSitePolygons([{ points: rect(0, 0, 100, 100) }], 1250);
    expect(Math.min(...ring.map((p) => p.x))).toBe(-125);
  });
});

// ============================================================
describe('斜めの辺を持つ建物（交点タップで作れてしまう形）', () => {
  // 上辺が斜めの五角形
  const poly: Point[] = [
    { x: 0, y: 0 }, { x: 200, y: 60 }, { x: 200, y: 200 }, { x: 0, y: 200 },
  ];

  it('落ちずに外形が作れる', () => {
    const rings = buildingsSitePolygons([{ points: poly }], 1000);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    expect(isSimplePolygon(rings[0])).toBe(true);
  });

  it('建物を必ず包む（安全側に取り込む）', () => {
    const [ring] = buildingsSitePolygons([{ points: poly }], 1000);
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(p.x).toBeLessThanOrEqual(Math.max(...xs));
      expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys));
      expect(p.y).toBeLessThanOrEqual(Math.max(...ys));
    }
  });

  it('軸に平行な建物では余計な取り込みが起きない（矩形は矩形のまま）', () => {
    expect(decomposeToRects(rect(0, 0, 100, 100))).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
  });

  it('L 字の分解は 2 枚（凹み側のマスを取り込まない）', () => {
    const L: Point[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
      { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ];
    const rects = decomposeToRects(L);
    const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area).toBe(200 * 200 - 100 * 100);   // 右上の凹みぶんだけ欠ける
  });
});

// ============================================================
describe('出力の形', () => {
  it('外周だけ（穴は返さない）＝面積の符号がそろっている', () => {
    for (const rings of [
      buildingsSitePolygons([{ points: rect(0, 0, 100, 100) }], 1000),
      buildingsSitePolygons([{ points: rect(0, 0, 100, 100) }, { points: rect(500, 500, 100, 100) }], 1000),
    ]) {
      for (const r of rings) expect(signedArea(r)).toBeGreaterThan(0);
    }
  });

  it('同じ入力なら同じ出力（始点も向きも安定）', () => {
    const b = [{ points: rect(3, 7, 111, 222) }];
    expect(buildingsSitePolygons(b, 1000)).toEqual(buildingsSitePolygons(b, 1000));
  });

  it('大きい外形から順に返る', () => {
    const rings = buildingsSitePolygons([
      { points: rect(0, 0, 100, 100) },
      { points: rect(1000, 0, 400, 400) },
    ], 1000);
    expect(rings).toHaveLength(2);
    expect(Math.abs(signedArea(rings[0]))).toBeGreaterThan(Math.abs(signedArea(rings[1])));
  });
});
