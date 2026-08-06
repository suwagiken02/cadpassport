// ============================================================
// E-9-fix4: 継ぎ目の縦線を描かない／西面の軒の出の遮蔽。
//
// 実機物件（鮎澤氏・スクショで位置特定済み）:
//   西=2F 棟（軒 6100 / 棟 8000・東西妻）と 東=1F 下屋（軒 3300 / 棟 5100・東西妻）が接触。
//
// 症状 A（継ぎ目縦線）: 建物の特徴点（棟の頂点・壁の角）の X で、屋根線から GL まで
//   走る縦線が東面 3 本・西面 1 本。原因は「妻の頂点で分かれた 2 辺」「遮蔽で切れた区間」を
//   それぞれ閉じたポリゴンとして描き、その**継ぎ目の辺まで輪郭線として引いていた**こと。
//   → 連続して見える範囲は 1 枚にまとめ、輪郭線は元の建物の輪郭（上端＋実在する壁の角）だけ。
//
// 症状 B（西面の 1F）: 1F の壁・棟は 2F に完全に隠れるのに、軒の出の区間に
//   「軒〜棟の塗り＋棟線＋棟ラベル」が出ていた。軒の出は屋根の**面**ではなく板の小口なので、
//   そこに棟までの面を描いてはいけない（R-1n の「壁≠屋根」と同じ考え方）。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { BuildingShape, HeightMarker, Point, Roof } from '@/types';
import { buildFaceElevation } from '../elevationEngine';
// E-9-fix5: プレビュー(ElevationModal)が実際に呼ぶ入口。ここを検証する。
import { buildingAndRoofPrimitives, outlineRuns } from '../elevationToObjects';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
/** 西=2F 棟 / 東=1F 下屋。x=300 で接触。どちらも y 0..400（南北の幅は同じ）。 */
const b2f = { id: 'f2', points: rect(0, 0, 300, 400), floor: 2 } as BuildingShape;
const b1f = { id: 'f1', points: rect(300, 0, 500, 400), floor: 1 } as BuildingShape;
/** 東西妻＝東西の壁が三角（中央が棟）。南北の壁は軒高で一定。 */
const gableMarks = (id: string, eave: number, ridge: number): HeightMarker[] => [
  { id: `${id}n`, buildingId: id, edgeIndex: 0, t: 0.5, heightMm: eave },
  { id: `${id}e`, buildingId: id, edgeIndex: 1, t: 0.5, heightMm: ridge },
  { id: `${id}s`, buildingId: id, edgeIndex: 2, t: 0.5, heightMm: eave },
  { id: `${id}w`, buildingId: id, edgeIndex: 3, t: 0.5, heightMm: ridge },
];
const bld2 = (id: string, pts: Point[]): BuildingShape => ({ id, points: pts } as BuildingShape);
const roof = (id: string, bid: string, poly: Point[]): Roof =>
  ({ id, buildingId: bid, polygon: poly, roofShape: 'gable', uniformMm: 500 } as Roof);
const roofs = [roof('r2', 'f2', b2f.points), roof('r1', 'f1', b1f.points)];

const face = (f: 'east' | 'west', markers: HeightMarker[]) =>
  buildFaceElevation([], [b1f, b2f], { face: f, floor: 1, markers, roofs });
const prims = (f: 'east' | 'west', markers: HeightMarker[]) =>
  buildingAndRoofPrimitives(face(f, markers), () => '#888');

/** 両棟とも妻 TOP が東西両側にある（正しい入力）。 */
const MARKERS = [...gableMarks('f2', 6100, 8000), ...gableMarks('f1', 3300, 5100)];
/** 1F の妻 TOP を東側だけに置いた入力（実機の症状 B が出る条件）。 */
const MARKERS_ONE_SIDED: HeightMarker[] = [
  ...gableMarks('f2', 6100, 8000),
  { id: 'f1n', buildingId: 'f1', edgeIndex: 0, t: 0.5, heightMm: 3300 },
  { id: 'f1e', buildingId: 'f1', edgeIndex: 1, t: 0.5, heightMm: 5100 },
  { id: 'f1s', buildingId: 'f1', edgeIndex: 2, t: 0.5, heightMm: 3300 },
];

/** 建物の輪郭線のうち垂直なもの（x1===x2）。 */
const verticalWallLines = (ps: ReturnType<typeof prims>) => ps.filter(
  (p): p is Extract<typeof p, { kind: 'line' }> =>
    p.kind === 'line' && p.meta?.kind === 'building' && Math.abs(p.x1 - p.x2) < 1e-6,
);

describe('症状A: 特徴点の X に継ぎ目の縦線を描かない', () => {
  for (const f of ['east', 'west'] as const) {
    it(`${f}面: 棟の頂点(局所 x=250)を通る縦線が無い`, () => {
      const vs = verticalWallLines(prims(f, MARKERS));
      expect(vs.some((v) => Math.abs(v.x1 - 250) < 1e-6)).toBe(false);
    });

    it(`${f}面: 縦の輪郭線は実在する壁の角だけ（局所 x=50 / 450）`, () => {
      const vs = verticalWallLines(prims(f, MARKERS));
      for (const v of vs) expect([50, 450]).toContain(v.x1);
    });
  }

  it('東面: 妻は 1 枚の五角形（頂点で 2 枚に割れない）', () => {
    const ps = prims('east', MARKERS);
    const polys = ps.filter((p) => p.kind === 'polygon' && p.meta?.buildingId === 'f1');
    expect(polys).toHaveLength(1);
    // 五角形（GL の 2 点＋上端 3 点）。頂点 -510 を含む。
    expect(polys[0].kind === 'polygon' && polys[0].points).toContain(-510);
  });

  it('東面: 奥の 2F も 1 枚で、下端(1F の上端)には輪郭線を引かない', () => {
    const ps = prims('east', MARKERS);
    const polys = ps.filter((p) => p.kind === 'polygon' && p.meta?.buildingId === 'f2');
    expect(polys).toHaveLength(1);
    // 下端は 1F の上端(-390〜-510)。そこに水平・斜めの輪郭線は無い（上端の 2 本だけ）。
    const lines = ps.filter((p) => p.kind === 'line' && p.meta?.buildingId === 'f2');
    expect(lines.filter((l) => l.kind === 'line' && l.meta?.id?.includes(':t'))).toHaveLength(2);
  });

  it('遮蔽が無ければ従来どおり（矩形の左右に縦線・上端に 1 本）', () => {
    const only = { id: 'solo', points: rect(0, 0, 300, 400) } as BuildingShape;
    const fe = buildFaceElevation([], [only], {
      face: 'north', floor: 1,
      markers: [
        { id: 'a', buildingId: 'solo', edgeIndex: 0, t: 0.5, heightMm: 3000 },
        { id: 'b', buildingId: 'solo', edgeIndex: 2, t: 0.5, heightMm: 3000 },
      ],
    });
    const ps = buildingAndRoofPrimitives(fe, () => '#888');
    expect(ps.filter((p) => p.kind === 'polygon' && p.meta?.kind === 'building')).toHaveLength(1);
    expect(verticalWallLines(ps)).toHaveLength(2);
  });
});

describe('outlineRuns: 連続する範囲を 1 枚にまとめる', () => {
  it('妻（頂点で分かれた 2 辺）は 1 つの run になる', () => {
    const runs = outlineRuns([
      { xStart: 0, xEnd: 150, heightStartMm: 3000, heightEndMm: 5000 },
      { xStart: 150, xEnd: 300, heightStartMm: 5000, heightEndMm: 3000 },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].top.map((p) => p.mm)).toEqual([3000, 5000, 3000]);
    expect(runs[0].clippedStart).toBe(false);
    expect(runs[0].clippedEnd).toBe(false);
  });

  it('離れている区間は別の run（＝別の面）', () => {
    const runs = outlineRuns([
      { xStart: 0, xEnd: 100, heightStartMm: 3000, heightEndMm: 3000 },
      { xStart: 200, xEnd: 300, heightStartMm: 3000, heightEndMm: 3000 },
    ]);
    expect(runs).toHaveLength(2);
  });

  it('遮蔽で切れた端の印は run に伝わる（その側に縦線を引かないため）', () => {
    const runs = outlineRuns([
      { xStart: 0, xEnd: 100, heightStartMm: 3000, heightEndMm: 3000, clippedEnd: true },
    ]);
    expect(runs[0].clippedEnd).toBe(true);
    expect(runs[0].clippedStart).toBe(false);
  });

  it('下端が違えば別の run（手前の建物の際で分かれる）', () => {
    const runs = outlineRuns([
      { xStart: 0, xEnd: 100, heightStartMm: 9000, heightEndMm: 9000, clippedEnd: true },
      {
        xStart: 100, xEnd: 200, heightStartMm: 9000, heightEndMm: 9000,
        baseStartMm: 3000, baseEndMm: 3000, clippedStart: true,
      },
    ]);
    expect(runs).toHaveLength(2);
  });
});

describe('症状B: 西面の 1F は軒の出の線だけ', () => {
  const west = () => prims('west', MARKERS_ONE_SIDED);
  const f1Prims = () => west().filter((p) => p.meta?.buildingId === 'f1');

  it('1F の壁（シルエット）は 1 つも描かれない＝完全に隠れる', () => {
    expect(face('west', MARKERS_ONE_SIDED).buildingOutlines
      .find((o) => o.buildingId === 'f1')!.segments).toEqual([]);
    expect(f1Prims().filter((p) => p.meta?.kind === 'building')).toHaveLength(0);
  });

  it('1F 由来は「軒の出のはみ出し分」の線だけ（塗り・棟線・ラベル無し）', () => {
    const ps = f1Prims();
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.every((p) => p.kind === 'line' && p.meta?.kind === 'roof')).toBe(true);
    // 棟線（kind:'ridge'）も「棟 5100」ラベルも出ない
    expect(west().some((p) => p.meta?.kind === 'ridge')).toBe(false);
    expect(west().some((p) => p.kind === 'text' && p.text.includes('棟'))).toBe(false);
  });

  it('その線は 2F の壁の外（軒の出ぶん）だけに在る', () => {
    // 2F の壁は局所 x 50..450。軒の出 500mm=50 グリッドぶんの 0..50 と 450..500 が残る。
    const xs = f1Prims().flatMap((p) => (p.kind === 'line' ? [p.x1, p.x2] : []));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(500);
    for (const x of xs) expect(x <= 50 + 1e-6 || x >= 450 - 1e-6).toBe(true);
  });

  it('高さは軒より下（棟 5100 の高さには何も描かれない）', () => {
    const ys = f1Prims().flatMap((p) => (p.kind === 'line' ? [p.y1, p.y2] : []));
    // ly(mm) = -mm/10。棟 5100 → -510。軒 3300 → -330 より下（0 に近い）に収まる。
    for (const y of ys) expect(y).toBeGreaterThan(-330);
  });

  it('両側の妻 TOP がある正しい入力でも、西面の 1F は軒の出の線だけ', () => {
    const ps = prims('west', MARKERS).filter((p) => p.meta?.buildingId === 'f1');
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.every((p) => p.kind === 'line' && p.meta?.kind === 'roof')).toBe(true);
  });
});

describe('東面の骨格（確認済みの表示）を壊さない', () => {
  const east = () => prims('east', MARKERS);

  it('1F の妻・2F の見える上部・両方の屋根線が揃っている', () => {
    const ps = east();
    expect(ps.filter((p) => p.kind === 'polygon' && p.meta?.buildingId === 'f1')).toHaveLength(1);
    expect(ps.filter((p) => p.kind === 'polygon' && p.meta?.buildingId === 'f2')).toHaveLength(1);
    expect(ps.some((p) => p.meta?.kind === 'roof' && p.meta?.buildingId === 'f1')).toBe(true);
    expect(ps.some((p) => p.meta?.kind === 'roof' && p.meta?.buildingId === 'f2')).toBe(true);
  });

  it('2F は 1F の上端から上だけが見える（下端が 1F の輪郭）', () => {
    const segs = face('east', MARKERS).buildingOutlines.find((o) => o.buildingId === 'f2')!.segments;
    expect(segs.every((s) => (s.baseStartMm ?? 0) > 0 && (s.baseEndMm ?? 0) > 0)).toBe(true);
    // 1F の妻の形（3900→5100→3900）が 2F の下端になっている
    const bases = segs.flatMap((s) => [s.baseStartMm!, s.baseEndMm!]);
    expect(Math.max(...bases)).toBe(5100);
    expect(Math.min(...bases)).toBe(3900);
  });
});

// ============================================================
// E-9-fix5: 「検証した層」と「プレビューが描く層」を一致させる。
//
// fix4 まではプレビュー(ElevationModal)が独自の SVG を持ち、遮蔽の下端(baseStartMm/
// basePath)も継ぎ目の印(clippedStart/End)も無視して「セグメントごとに GL から立つ
// 閉じた矩形」を描いていた。だからテストが通っても実機の縦線は消えなかった。
// 建物・屋根の絵は buildingAndRoofPrimitives が唯一の出所（部材は E-8-v2l で先に統一済み）。
// ============================================================
describe('プレビューとキャンバスが同じ経路を使う', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../../', p), 'utf8');

  it('ElevationModal は共有の入口を呼ぶ', () => {
    const modal = read('components/elevation/ElevationModal.tsx');
    expect(modal).toContain('buildingAndRoofPrimitives(faceElevation, fillOf, partMinXg)');
  });

  it('ElevationModal は建物・屋根の SVG を自前で組み立てない', () => {
    const modal = read('components/elevation/ElevationModal.tsx');
    // 独自実装の痕跡（建物セグメントを直接 polygon 化する / バンドの 3 形態を分岐する）
    expect(modal.includes('o.segments.map')).toBe(false);
    expect(modal.includes('band.filledToRidge')).toBe(false);
    expect(modal.includes('棟 {band.ridgeMm}')).toBe(false);
  });

  it('キャンバス配置版も同じ関数から作る', () => {
    const src = read('lib/konva/elevation/elevationToObjects.ts');
    expect(src).toContain('prims.push(...buildingAndRoofPrimitives(fe, fillOf, minXg));');
  });
});

describe('東面と西面は左右反転で一致する（同一建物の鏡像）', () => {
  /** 単棟（東西妻の切妻）。前後関係が無いので東西は完全な鏡像になるはず。 */
  const solo = { id: 'solo', points: rect(0, 0, 300, 400) } as BuildingShape;
  const soloMarks = gableMarks('solo', 6100, 8000);
  const soloRoof = [roof('rs', 'solo', solo.points)];
  const facePrims = (f: 'east' | 'west') => buildingAndRoofPrimitives(
    buildFaceElevation([], [solo], { face: f, floor: 1, markers: soloMarks, roofs: soloRoof }),
    () => '#888',
  );
  /** 変軸を反転して正規化（左端 0 基準に戻す）。 */
  const mirrorNorm = (ps: ReturnType<typeof facePrims>) => {
    const xs = ps.flatMap((p) => (
      p.kind === 'line' ? [p.x1, p.x2] : p.kind === 'polygon' ? p.points.filter((_, i) => i % 2 === 0) : [p.x]
    ));
    const max = Math.max(...xs);
    const fx = (x: number) => Math.round((max - x) * 1000) / 1000;
    const fy = (y: number) => Math.round(y * 1000) / 1000;
    return ps.map((p) => (
      p.kind === 'line' ? { k: 'line', a: [fx(p.x2), fy(p.y2)], b: [fx(p.x1), fy(p.y1)], id: p.meta?.kind }
        : p.kind === 'polygon'
          ? { k: 'poly', pts: p.points.map((v, i) => (i % 2 === 0 ? fx(v) : fy(v))).sort(), id: p.meta?.kind }
          : { k: p.kind, id: p.meta?.kind }
    )).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };

  it('建物輪郭のプリミティブが左右反転で一致する', () => {
    expect(mirrorNorm(facePrims('east').filter((p) => p.meta?.kind === 'building')))
      .toEqual(mirrorNorm(facePrims('west').filter((p) => p.meta?.kind === 'building')));
  });

  it('屋根バンドも左右反転で一致する', () => {
    expect(mirrorNorm(facePrims('east').filter((p) => p.meta?.kind === 'roof')))
      .toEqual(mirrorNorm(facePrims('west').filter((p) => p.meta?.kind === 'roof')));
  });

  it('どちらの面にも継ぎ目の縦線が無い（妻の頂点で割れない）', () => {
    for (const f of ['east', 'west'] as const) {
      const ps = facePrims(f);
      expect(ps.filter((p) => p.kind === 'polygon' && p.meta?.kind === 'building')).toHaveLength(1);
      expect(verticalWallLines(ps)).toHaveLength(2);   // 左右の壁の角だけ
    }
  });
});

describe('北面・南面は遮蔽で壊れない（fix4 の回帰の再発防止）', () => {
  /** 1F 下屋が北へ張り出す配置＝北面で 1F が手前（2F の屋根バンドの軒先に掛かる）。 */
  const back = bld2('f2', rect(0, 0, 300, 400));
  const front = bld2('f1', rect(300, -100, 500, 400));
  const ms = [...gableMarks('f2', 6100, 8000), ...gableMarks('f1', 3300, 5100)];
  const rs = [roof('r2', 'f2', back.points), roof('r1', 'f1', front.points)];
  const feOf = (f: 'north' | 'south', buildings: BuildingShape[]) =>
    buildFaceElevation([], buildings, { face: f, floor: 1, markers: ms, roofs: rs });

  for (const f of ['north', 'south'] as const) {
    it(`${f}面: 2F の屋根バンドは 1 枚のまま（矩形に割れない）`, () => {
      const bands = feOf(f, [front, back]).roofBands.filter((b) => b.buildingId === 'f2');
      expect(bands).toHaveLength(1);
      expect(bands[0].filledToRidge).toBe(true);
    });

    it(`${f}面: 隣の棟が無いときと同じバンドになる（＝遮蔽で形が変わらない）`, () => {
      const withNeighbour = feOf(f, [front, back]).roofBands.filter((b) => b.buildingId === 'f2');
      const alone = buildFaceElevation([], [back], {
        face: f, floor: 1, markers: ms, roofs: rs,
      }).roofBands.filter((b) => b.buildingId === 'f2');
      expect(withNeighbour).toEqual(alone);
    });
  }
});

// ============================================================
// E-9-fix6: 西面で 1F の軒の出が「水平線」に化ける。
//
// 実機（鏡像比較で確定）: 東面の左端には 2F と 1F の屋根勾配の斜線が平行に 2 本出る（正）。
// 西面は同じ場所を反対から見るので右端に左右反転で同じ 2 本が出るのが正しいのに、
// 1F 側が高さ 3300 の水平線になっていた。
//
// 根因: 1F の屋根がその面に壁を持たない（屋根領域が 2F との境まで届かない）とき、
// エンジンが「屋根の軒高で水平プロファイル」に潰していた。反対面（同じ変軸）の
// 壁区間から切り出せば、屋根の投影の形はそのまま得られる。
// ============================================================
describe('E-9-fix6: 壁を持たない面の屋根は水平線に潰さない', () => {
  /** 1F の屋根が西端（2F との境）まで届かない＝西面に壁を持たない屋根。 */
  const roofsGap = [
    roof('r2', 'f2', b2f.points),
    { ...roof('r1', 'f1', rect(320, 0, 500, 400)) },
  ];
  const feOf = (f: 'east' | 'west') => buildFaceElevation([], [b1f, b2f], {
    face: f, floor: 1, markers: MARKERS, roofs: roofsGap,
  });
  const linesOf = (f: 'east' | 'west') =>
    buildingAndRoofPrimitives(feOf(f), () => '#888')
      .filter((p): p is Extract<typeof p, { kind: 'line' }> =>
        p.kind === 'line' && p.meta?.buildingId === 'f1' && p.meta?.kind === 'roof');
  /** 2F の壁は局所 x 50..450。その外＝軒の出のはみ出し。 */
  const outside = (p: { x1: number; x2: number }) =>
    Math.max(p.x1, p.x2) <= 50 + 1e-6 || Math.min(p.x1, p.x2) >= 450 - 1e-6;

  it('西面の 1F の線は水平ではなく勾配なり（軒先へ向かって下がる）', () => {
    const ls = linesOf('west');
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) expect(Math.abs(l.y1 - l.y2)).toBeGreaterThan(1e-6);
  });

  it('西面の 1F の線は 2F の壁の外だけ（妻の内部を貫通しない）', () => {
    for (const l of linesOf('west')) expect(outside(l)).toBe(true);
  });

  it('東面の対応する線（壁の外の区間）と左右反転で一致する', () => {
    const norm = (ls: ReturnType<typeof linesOf>) => ls
      .filter(outside)
      .map((l) => {
        // 変軸の全幅は 0..500（局所）。左右反転して端点を昇順に正規化する。
        const a = [Math.round((500 - l.x1) * 1000) / 1000, Math.round(l.y1 * 1000) / 1000];
        const b = [Math.round((500 - l.x2) * 1000) / 1000, Math.round(l.y2 * 1000) / 1000];
        return JSON.stringify([a, b].sort());
      })
      .sort();
    const plain = (ls: ReturnType<typeof linesOf>) => ls
      .filter(outside)
      .map((l) => JSON.stringify([
        [Math.round(l.x1 * 1000) / 1000, Math.round(l.y1 * 1000) / 1000],
        [Math.round(l.x2 * 1000) / 1000, Math.round(l.y2 * 1000) / 1000],
      ].sort()))
      .sort();
    expect(norm(linesOf('west'))).toEqual(plain(linesOf('east')));
  });

  it('東面の 1F の屋根線は従来どおり（勾配なりのけらば・棟まで上がる）', () => {
    const ls = linesOf('east');
    const ys = ls.flatMap((l) => [l.y1, l.y2]);
    expect(Math.min(...ys)).toBe(-510);      // 棟 5100
    expect(Math.max(...ys)).toBe(-360);      // 軒先 3600
  });
});

describe('E-9-fix6: 2 棟物件でも「壁の外にはみ出す線」は東西で鏡像一致', () => {
  const facePrims = (f: 'east' | 'west') =>
    buildingAndRoofPrimitives(face(f, MARKERS), () => '#888');
  /** 2F の壁(局所 50..450)の**外側にはみ出した屋根の線**だけを、左右反転して正規化。
   *  壁の角の縦線は「どちらの棟が手前か」で変わるので鏡像の対象にしない。 */
  const outerNorm = (f: 'east' | 'west', mirror: boolean) => facePrims(f)
    .filter((p): p is Extract<typeof p, { kind: 'line' }> => p.kind === 'line'
      && p.meta?.kind === 'roof'
      && ((p.x1 + p.x2) / 2 < 50 - 1e-6 || (p.x1 + p.x2) / 2 > 450 + 1e-6))
    .map((l) => {
      const fx = (x: number) => Math.round((mirror ? 500 - x : x) * 1000) / 1000;
      return JSON.stringify([[fx(l.x1), l.y1], [fx(l.x2), l.y2]].sort());
    })
    .sort();

  it('東面と西面で、壁の外の線分が左右反転で一致する', () => {
    expect(outerNorm('west', true)).toEqual(outerNorm('east', false));
  });

  it('その線分は 2F と 1F の 2 本ずつ（両端に平行な斜線）', () => {
    const ls = facePrims('east').filter((p) => p.kind === 'line'
      && (Math.max(p.x1, p.x2) <= 50 + 1e-6 || Math.min(p.x1, p.x2) >= 450 - 1e-6)
      && p.meta?.kind === 'roof');
    expect(ls.filter((p) => p.meta?.buildingId === 'f1')).toHaveLength(2);
    expect(ls.filter((p) => p.meta?.buildingId === 'f2')).toHaveLength(2);
  });
});
