// ============================================================
// E-9b: 建物同士の遮蔽（建物外形・屋根バンド）。
//
// 実機症状（鮎澤氏・スクショ確定）: 2 棟（手前=高い 2F 棟 / 奥=低い 1F 下屋棟）の
// 東立面で、奥の 1F が壁も屋根バンドも透けて全部描かれていた。東から見れば 1F は
// 2F の完全に後ろかつ低いので、一切見えないのが正しい。
//
// 方式は「x 区間 × 高さしきい値」:
//   ある高さ h の要素は、手前の上端が h 以上の x 区間では隠れる。
//   完全に隠れる → 描かない / 部分的 → はみ出した部分だけ（下端を手前の上端まで上げる）。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point } from '@/types';
import {
  buildFaceElevation, type BuildingOutline, type RoofBand,
} from '../elevationEngine';
import { applyBuildingOcclusion } from '../occlusion';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const bld = (id: string, pts: Point[]): BuildingShape => ({ id, points: pts } as BuildingShape);
/** 建物の全周に同じ高さのマーカーを 2 個置く（高さが決まればよい）。 */
const marks = (b: BuildingShape, mm: number): HeightMarker[] => [
  { id: `${b.id}-m0`, buildingId: b.id, edgeIndex: 0, t: 0.5, heightMm: mm },
  { id: `${b.id}-m2`, buildingId: b.id, edgeIndex: 2, t: 0.5, heightMm: mm },
];
const outline = (id: string, segs: BuildingOutline['segments']): BuildingOutline =>
  ({ buildingId: id, floor: 1, face: 'east', segments: segs } as BuildingOutline);

// ────────────────────────────────────────────────
// 実機の実例: 東面・手前(東側)に高い 2F 棟、奥(西側)に低い 1F 下屋棟。
//   東西の並び: 奥 x 0..200 / 手前 x 200..400。y は同じ範囲＝東面では完全に重なる。
// ────────────────────────────────────────────────
const back = bld('back', rect(0, 0, 200, 300));      // 奥（西側）・低い
const frontB = bld('front', rect(200, 0, 400, 300)); // 手前（東側）・高い

describe('東面: 手前の高い棟が奥の低い棟を完全に隠す', () => {
  const outlines = [
    outline('back', [{ xStart: 0, xEnd: 300, heightStartMm: 3000, heightEndMm: 3000 }]),
    outline('front', [{ xStart: 0, xEnd: 300, heightStartMm: 6000, heightEndMm: 6000 }]),
  ];

  it('奥の建物のシルエットが消える', () => {
    const r = applyBuildingOcclusion(outlines, [], [back, frontB], 'east');
    const backOut = r.buildingOutlines.find((o) => o.buildingId === 'back')!;
    expect(backOut.segments).toEqual([]);
  });

  it('手前の建物はそのまま（下端も GL のまま）', () => {
    const r = applyBuildingOcclusion(outlines, [], [back, frontB], 'east');
    const f = r.buildingOutlines.find((o) => o.buildingId === 'front')!;
    expect(f.segments).toHaveLength(1);
    expect(f.segments[0].baseStartMm).toBeUndefined();
    expect(f.segments[0].heightStartMm).toBe(6000);
  });

  it('奥の屋根バンドも消える', () => {
    const band: RoofBand = {
      buildingId: 'back', xStart: 0, xEnd: 300, ridgeMm: 4500,
      profile: [{ x: 0, mm: 3000 }, { x: 300, mm: 3000 }], filledToRidge: true,
    };
    const r = applyBuildingOcclusion(outlines, [band], [back, frontB], 'east');
    expect(r.roofBands.filter((b) => b.buildingId === 'back')).toEqual([]);
  });

  it('西から見れば前後が入れ替わる（低い西棟が手前・高い東棟は上だけ見える）', () => {
    const r = applyBuildingOcclusion(outlines, [], [back, frontB], 'west');
    // 西側(3000)が手前でフルに見える
    expect(r.buildingOutlines.find((o) => o.buildingId === 'back')!.segments).toHaveLength(1);
    // 東側(6000)は 3000 より上だけが見える
    const f = r.buildingOutlines.find((o) => o.buildingId === 'front')!.segments;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ heightStartMm: 6000, baseStartMm: 3000, baseEndMm: 3000 });
  });
});

describe('奥が高い場合は「上だけ」見える', () => {
  const outlines = [
    outline('back', [{ xStart: 0, xEnd: 300, heightStartMm: 9000, heightEndMm: 9000 }]),
    outline('front', [{ xStart: 0, xEnd: 300, heightStartMm: 6000, heightEndMm: 6000 }]),
  ];

  it('下端が手前の上端まで持ち上がる（はみ出しだけ描く）', () => {
    const r = applyBuildingOcclusion(outlines, [], [back, frontB], 'east');
    const b = r.buildingOutlines.find((o) => o.buildingId === 'back')!;
    expect(b.segments).toHaveLength(1);
    expect(b.segments[0]).toMatchObject({
      xStart: 0, xEnd: 300,
      heightStartMm: 9000, heightEndMm: 9000,
      baseStartMm: 6000, baseEndMm: 6000,
    });
  });

  it('屋根バンドは棟まで隠れなければ残り、下から削られる', () => {
    const band: RoofBand = {
      buildingId: 'back', xStart: 0, xEnd: 300, ridgeMm: 11000,
      profile: [{ x: 0, mm: 9000 }, { x: 300, mm: 9000 }], filledToRidge: true,
    };
    const r = applyBuildingOcclusion(outlines, [band], [back, frontB], 'east');
    const kept = r.roofBands.filter((b) => b.buildingId === 'back');
    expect(kept).toHaveLength(1);
    expect(kept[0].ridgeMm).toBe(11000);
    expect(Math.min(...kept[0].profile.map((p) => p.mm))).toBe(9000);  // 軒(9000) > 手前(6000)
  });
});

describe('重ならない 2 棟は両方そのまま見える', () => {
  it('x 範囲が離れていれば削られない', () => {
    const outlines = [
      outline('back', [{ xStart: 0, xEnd: 100, heightStartMm: 3000, heightEndMm: 3000 }]),
      outline('front', [{ xStart: 400, xEnd: 500, heightStartMm: 6000, heightEndMm: 6000 }]),
    ];
    const r = applyBuildingOcclusion(outlines, [], [back, frontB], 'east');
    expect(r.buildingOutlines.find((o) => o.buildingId === 'back')!.segments).toEqual([
      { xStart: 0, xEnd: 100, heightStartMm: 3000, heightEndMm: 3000 },
    ]);
  });

  it('一部だけ重なるなら、はみ出した側だけが残る', () => {
    const outlines = [
      outline('back', [{ xStart: 0, xEnd: 300, heightStartMm: 3000, heightEndMm: 3000 }]),
      outline('front', [{ xStart: 100, xEnd: 300, heightStartMm: 6000, heightEndMm: 6000 }]),
    ];
    const r = applyBuildingOcclusion(outlines, [], [back, frontB], 'east');
    const segs = r.buildingOutlines.find((o) => o.buildingId === 'back')!.segments;
    expect(segs).toEqual([{ xStart: 0, xEnd: 100, heightStartMm: 3000, heightEndMm: 3000 }]);
  });
});

describe('単棟・同深度は不変', () => {
  it('建物が 1 棟なら何も変わらない', () => {
    const outlines = [outline('only', [{ xStart: 0, xEnd: 300, heightStartMm: 3000, heightEndMm: 3000 }])];
    const r = applyBuildingOcclusion(outlines, [], [bld('only', rect(0, 0, 200, 300))], 'east');
    expect(r.buildingOutlines).toEqual(outlines);
  });

  it('壁面が揃う 2 棟（総二階の 1F/2F）は前後を作らない＝両方そのまま', () => {
    const same1 = bld('f1', rect(0, 0, 200, 300));
    const same2 = bld('f2', rect(0, 0, 200, 300));
    const outlines = [
      outline('f1', [{ xStart: 0, xEnd: 300, heightStartMm: 3000, heightEndMm: 3000 }]),
      outline('f2', [{ xStart: 0, xEnd: 300, heightStartMm: 6000, heightEndMm: 6000 }]),
    ];
    const r = applyBuildingOcclusion(outlines, [], [same1, same2], 'east');
    expect(r.buildingOutlines).toEqual(outlines);
  });
});

describe('end-to-end: buildFaceElevation（実機と同じ経路）', () => {
  /** 足場は無し（建物だけ）。face だけ指定して立面を作る。 */
  const fe = (face: 'east' | 'west') => buildFaceElevation([], [back, frontB], {
    face, floor: 1,
    markers: [...marks(back, 3000), ...marks(frontB, 6000)],
  });

  it('東面: 奥(西側)の低い棟は 1 本も描かれない', () => {
    const f = fe('east');
    const backOut = f.buildingOutlines.find((o) => o.buildingId === 'back');
    expect(backOut?.segments ?? []).toEqual([]);
    const frontOut = f.buildingOutlines.find((o) => o.buildingId === 'front')!;
    expect(frontOut.segments.length).toBeGreaterThan(0);
  });

  it('西面: 前後が逆になり、東側の高い棟は上だけになる', () => {
    const f = fe('west');
    const east = f.buildingOutlines.find((o) => o.buildingId === 'front')!.segments;
    expect(east).toHaveLength(1);
    expect(east[0].baseStartMm).toBe(3000);   // 手前(西・3000) より上だけ
    expect(east[0].heightStartMm).toBe(6000);
    expect(f.buildingOutlines.find((o) => o.buildingId === 'back')!.segments.length)
      .toBeGreaterThan(0);
  });

  it('南面（横に並ぶ＝重ならない）では両方描かれる', () => {
    const f = buildFaceElevation([], [back, frontB], {
      face: 'south', floor: 1,
      markers: [...marks(back, 3000), ...marks(frontB, 6000)],
    });
    expect(f.buildingOutlines.find((o) => o.buildingId === 'back')!.segments.length)
      .toBeGreaterThan(0);
    expect(f.buildingOutlines.find((o) => o.buildingId === 'front')!.segments.length)
      .toBeGreaterThan(0);
  });
});
