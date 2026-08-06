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
  applyOcclusionCut, buildFaceElevation, type BuildingOutline, type RoofBand,
} from '../elevationEngine';
import { applyBuildingOcclusion, type Occluder } from '../occlusion';

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
    // E-9-fix4: 右端は遮蔽で切れた境目＝縦の輪郭線を描かない印が付く。
    expect(segs).toEqual([{
      xStart: 0, xEnd: 100, heightStartMm: 3000, heightEndMm: 3000, clippedEnd: true,
    }]);
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

// ============================================================
// E-9c: 足場部材への遮蔽拡張（E-5 の切断機構に建物遮蔽を追加）。
//
// 奥の棟に付く足場も、手前の棟に隠れる部分は描かない。列どうしの遮蔽（E-5）と
// 同じ穴の仕組みに、高さごとの「建物の穴」を足すだけ（x 区間 × 高さしきい値）。
// ============================================================
describe('E-9c: 奥の建物に付く足場が手前の建物に隠れる', () => {
  /** 最小の足場列（rails/boards だけ本物）。 */
  const sc = (depthCoord: number, rails: { heightMm: number }[], boards: { levelMm: number }[]) => ({
    column: { depthCoord, xStart: 0, xEnd: 300, rails: [], handrailIds: [] },
    postXs: [0, 300],
    levels: {} as never,
    rails: rails.map((r) => ({ ...r, x0: 0, x1: 300 })),
    boards: boards.map((b) => ({ ...b, x0: 0, x1: 300 })),
    spanRaises: [],
  }) as unknown as Parameters<typeof applyOcclusionCut>[0][number];

  /** 手前の建物: x 0..200 で高さ 6000（東面）。 */
  const occ: Occluder[] = [{
    frontness: 400,
    spans: [{ x0: 0, x1: 200, mm0: 6000, mm1: 6000 }],
  }];

  it('手前の建物より低い横線は、その x 区間で切れる', () => {
    const [cut] = applyOcclusionCut(
      [sc(100, [{ heightMm: 3000 }], [{ levelMm: 3000 }])], 'east', 0, occ);
    expect(cut.rails.map((r) => [r.x0, r.x1])).toEqual([[200, 300]]);
    expect(cut.boards.map((b) => [b.x0, b.x1])).toEqual([[200, 300]]);
  });

  it('手前の建物より高い横線は切れない（上に出ているので見える）', () => {
    const [cut] = applyOcclusionCut(
      [sc(100, [{ heightMm: 9000 }], [])], 'east', 0, occ);
    expect(cut.rails.map((r) => [r.x0, r.x1])).toEqual([[0, 300]]);
  });

  it('高さごとに穴が変わる（低い段だけ消えて高い段は残る）', () => {
    const [cut] = applyOcclusionCut(
      [sc(100, [{ heightMm: 3000 }, { heightMm: 9000 }], [])], 'east', 0, occ);
    expect(cut.rails.map((r) => [r.heightMm, r.x0, r.x1]))
      .toEqual([[3000, 200, 300], [9000, 0, 300]]);
  });

  it('その建物より手前に立つ足場（自分の建物の外側の列）は切られない', () => {
    const [cut] = applyOcclusionCut(
      [sc(500, [{ heightMm: 3000 }], [])], 'east', 0, occ);   // frontness 500 > 400
    expect(cut.rails.map((r) => [r.x0, r.x1])).toEqual([[0, 300]]);
  });

  it('建物の遮蔽が無ければ従来どおり（E-5 の列どうしだけ）', () => {
    const [cut] = applyOcclusionCut([sc(100, [{ heightMm: 3000 }], [])], 'east', 0);
    expect(cut.rails.map((r) => [r.x0, r.x1])).toEqual([[0, 300]]);
  });
});

describe('E-9c: 前後の判定は「壁 1 枚・屋根 1 枚ごと」', () => {
  /** L 字の 1 棟: 手前の翼(depth 360)と奥の翼(depth 180)。 */
  const lShape = bld('L', [
    { x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 180 },
    { x: 180, y: 180 }, { x: 180, y: 360 }, { x: 0, y: 360 },
  ]);
  /** 別棟（L 字の 2 つの翼の**間**の深さ・depth 280）。手前の翼より奥、奥の翼より手前。 */
  const mid = bld('mid', rect(0, 250, 360, 280));

  it('同じ建物どうしは遮蔽しない（大屋根/下屋の重ね順は R-1f の描画順が担当）', () => {
    const outlines = [{
      buildingId: 'L', floor: 1, face: 'south' as const,
      segments: [
        { xStart: 0, xEnd: 180, heightStartMm: 4800, heightEndMm: 4800, depthCoord: 360 },
        { xStart: 0, xEnd: 360, heightStartMm: 3000, heightEndMm: 3000, depthCoord: 180 },
      ],
    }];
    const r = applyBuildingOcclusion(outlines, [], [lShape], 'south');
    expect(r.buildingOutlines).toEqual(outlines);
  });

  it('別棟に対しては「手前の翼」だけが遮る（奥の翼は遮らない）', () => {
    const outlines = [
      {
        buildingId: 'L', floor: 1, face: 'south' as const,
        segments: [
          { xStart: 0, xEnd: 180, heightStartMm: 4800, heightEndMm: 4800, depthCoord: 360 },
          { xStart: 180, xEnd: 360, heightStartMm: 4800, heightEndMm: 4800, depthCoord: 180 },
        ],
      },
      {
        buildingId: 'mid', floor: 1, face: 'south' as const,
        segments: [{ xStart: 0, xEnd: 360, heightStartMm: 3000, heightEndMm: 3000, depthCoord: 280 }],
      },
    ];
    const r = applyBuildingOcclusion(outlines, [], [lShape, mid], 'south');
    const midSegs = r.buildingOutlines.find((o) => o.buildingId === 'mid')!.segments;
    // 手前の翼(x 0..180) の裏だけが消え、奥の翼の裏(x 180..360)は残る
    expect(midSegs.map((s) => [s.xStart, s.xEnd])).toEqual([[180, 360]]);
  });
});

// ============================================================
// E-9-fix2: 平面で接している壁は、立面でも接して描かれること。
//
// 実機症状（鮎澤氏・平面確認済み）: 1F 棟の右辺と 2F 棟の左壁がぴったり接している
// 物件で、北立面では 2 棟の壁の間に明確な隙間が空いた。
//
// 根因: 手前の棟の**屋根バンドの x 範囲は軒の出(出幅)ぶん壁より外へ広がる**。それを
// 壁と同じ「GL から立つ塊」として遮蔽に使っていたため、隣の建物の壁が軒の出ぶん
// 消えていた（隙間の実寸＝出幅そのもの）。軒の下は透けて見えるのが正しい。
// ============================================================
describe('E-9-fix2: 接している 2 棟の壁は立面でも接する', () => {
  const roofOf = (id: string, bid: string, poly: Point[], uniformMm: number) =>
    ({ id, buildingId: bid, polygon: poly, roofShape: 'gable', uniformMm } as unknown as
      NonNullable<Parameters<typeof buildFaceElevation>[2]>['roofs'] extends (infer R)[] ? R : never);

  // 平面: 1F 棟(左・x 0..300 / y 0..300)の右辺 x=300 に 2F 棟(右・x 300..600 / y -100..300)が接する。
  //   2F の北壁(y=-100)は 1F の北壁(y=0)より手前（北面は y が小さいほど手前）。
  const left = bld('left', rect(0, 0, 300, 300));
  const right = bld('right', rect(300, -100, 600, 300));
  const markers = [...marks(left, 3000), ...marks(right, 6000)];
  const roofs = [
    roofOf('rl', 'left', rect(0, 0, 300, 300), 500),
    roofOf('rr', 'right', rect(300, -100, 600, 300), 500),   // 出幅 500mm
  ];

  const northOf = (withRoofs: boolean) => buildFaceElevation([], [left, right], {
    face: 'north', floor: 1, markers, roofs: withRoofs ? roofs : [],
  });
  /** その建物の壁の x 範囲（面軸・mirror 後）。 */
  const range = (f: ReturnType<typeof buildFaceElevation>, id: string) => {
    const segs = f.buildingOutlines.find((o) => o.buildingId === id)!.segments;
    return [Math.min(...segs.map((s) => s.xStart)), Math.max(...segs.map((s) => s.xEnd))];
  };

  it('屋根なし: 2 棟の壁の端が一致する（基準）', () => {
    const f = northOf(false);
    expect(range(f, 'right')[1]).toBe(range(f, 'left')[0]);
  });

  it('屋根あり（軒の出 500mm）でも壁の端は一致する＝隙間が空かない', () => {
    const f = northOf(true);
    const l = range(f, 'left'), r = range(f, 'right');
    expect(r[1]).toBe(l[0]);
    // 出幅ぶん(50 グリッド=500mm)削られていないこと（症状の再発防止）
    expect(l[1] - l[0]).toBe(300);
  });

  it('軒の下は透ける: 軒の出の範囲は遮蔽に使わない', () => {
    const f = northOf(true);
    // 手前(右)の屋根バンドは壁より外(左)へ張り出しているが、
    const band = f.roofBands.find((b) => b.buildingId === 'right')!;
    expect(Math.max(band.xStart, band.xEnd)).toBeGreaterThan(range(f, 'right')[1]);
    // 奥(左)の壁はその範囲でも消えていない
    expect(range(f, 'left')[0]).toBe(range(f, 'right')[1]);
  });

  it('壁が重なる範囲では従来どおり遮蔽される（この修正で遮蔽が死んでいない）', () => {
    // 右棟を左棟に完全に重ねると、手前の右棟が奥の左棟を隠す
    const over = bld('right', rect(0, -100, 300, 300));
    const f = buildFaceElevation([], [left, over], {
      face: 'north', floor: 1, markers: [...marks(left, 3000), ...marks(over, 6000)],
    });
    expect(f.buildingOutlines.find((o) => o.buildingId === 'left')!.segments).toEqual([]);
  });
});

// ============================================================
// E-9-fix: 遮蔽で見える範囲は「連続した 1 枚」で描く（縦線シマシマの解消）。
//
// 実機症状（鮎澤氏）: 西面（1F が手前・2F が奥で高い）で、2F の見える部分が面として
// 描かれず細い縦線が多数並ぶシマシマ状になった。遮蔽の判定は細かい x 区間で行うため、
// そのまま短冊として描くと短冊の左右の縦辺が全部線になる。
// ============================================================
describe('E-9-fix: 可視領域は連続ポリゴン（内部に縦線を作らない）', () => {
  /** 手前の低い棟（西向きの妻＝上端が斜め）と、奥の高い棟。 */
  const low = bld('low', rect(0, 0, 200, 300));
  const high = bld('high', rect(200, 0, 500, 300));
  /** 手前の西壁だけ妻（両端 3000・中央 5000）。奥は 9000 の陸屋根。 */
  const markers: HeightMarker[] = [
    { id: 'p', buildingId: 'low', edgeIndex: 3, t: 0, heightMm: 3000 },
    { id: 'q', buildingId: 'low', edgeIndex: 3, t: 0.5, heightMm: 5000 },
    { id: 'r', buildingId: 'low', edgeIndex: 3, t: 1, heightMm: 3000 },
    { id: 's', buildingId: 'high', edgeIndex: 3, t: 0.5, heightMm: 9000 },
  ];
  const west = () => buildFaceElevation([], [low, high], { face: 'west', floor: 1, markers });

  it('斜めの手前に隠れても、奥の可視部分は短冊に割れない', () => {
    const segs = west().buildingOutlines.find((o) => o.buildingId === 'high')!.segments;
    // 300mm 刻みの判定で 10 枚に割れていた（実機のシマシマ）。1 枚に統合される。
    expect(segs).toHaveLength(1);
    expect(segs[0].xStart).toBe(0);
    expect(segs[0].xEnd).toBe(300);
  });

  it('下端は階段ではなく手前の輪郭（勾配）なりに引かれる', () => {
    const seg = west().buildingOutlines.find((o) => o.buildingId === 'high')!.segments[0];
    // 手前の妻は 3000 →(中央)5000→ 3000。下端の折れ線がその形をなぞる。
    expect(seg.baseStartMm).toBe(3000);
    expect(seg.baseEndMm).toBe(3000);
    const path = seg.basePath!;
    expect(path[0]).toEqual({ x: 0, mm: 3000 });
    expect(path[path.length - 1]).toEqual({ x: 300, mm: 3000 });
    expect(Math.max(...path.map((p) => p.mm))).toBe(5000);       // 頂点は手前の棟の頂点
    // 階段の段（同じ高さの点が続く）になっていない＝すべて勾配上の点
    expect(path.every((p) => Math.abs(p.mm - (p.x <= 150 ? 3000 + (p.x / 150) * 2000
      : 5000 - ((p.x - 150) / 150) * 2000)) < 1e-6)).toBe(true);
  });

  it('下端が一直線なら折れ線は付けない（従来どおりの台形）', () => {
    const flat = bld('flat', rect(0, 0, 200, 300));
    const back = bld('back2', rect(200, 0, 500, 300));
    const f = buildFaceElevation([], [flat, back], {
      face: 'west', floor: 1, markers: [...marks(flat, 3000), ...marks(back, 9000)],
    });
    const seg = f.buildingOutlines.find((o) => o.buildingId === 'back2')!.segments[0];
    expect(seg.basePath).toBeUndefined();
    expect(seg.baseStartMm).toBe(3000);
  });
});

// ============================================================
// E-9-fix3: 東面で 1F の軒の出（はみ出し分）は残る。
//
// 1F 本体が 2F に隠れるのは正しいが、1F の屋根は 2F の壁より外へ張り出しており、
// そのはみ出し分は 2F の脇に見えるはず。屋根バンドは建物単位でまとめて落とさず、
// バンドごとに独立してクリップする。
// ============================================================
describe('E-9-fix3: 隠れた建物でも屋根のはみ出し分は描く', () => {
  const backB = bld('back', rect(0, 0, 300, 300));       // 奥・低い（2F と同じ y 範囲）
  const frontB2 = bld('front', rect(300, 0, 600, 300));  // 手前・高い
  const markers = [...marks(backB, 3000), ...marks(frontB2, 6000)];
  const roofOf = (id: string, bid: string, poly: Point[], uniformMm: number) =>
    ({ id, buildingId: bid, polygon: poly, roofShape: 'gable', uniformMm } as unknown as
      NonNullable<Parameters<typeof buildFaceElevation>[2]>['roofs'] extends (infer R)[] ? R : never);
  const east = () => buildFaceElevation([], [backB, frontB2], {
    face: 'east', floor: 1, markers,
    roofs: [
      roofOf('rb', 'back', rect(0, 0, 300, 300), 500),     // 出幅 500mm
      roofOf('rf', 'front', rect(300, 0, 600, 300), 500),
    ],
  });

  it('1F 本体（壁）は完全に隠れる', () => {
    expect(east().buildingOutlines.find((o) => o.buildingId === 'back')!.segments).toEqual([]);
  });

  it('1F の軒の出は 2F の両脇に残る（座標固定）', () => {
    const bands = east().roofBands.filter((b) => b.buildingId === 'back')
      .map((b) => [Math.min(b.xStart, b.xEnd), Math.max(b.xStart, b.xEnd)])
      .sort((a, b) => a[0] - b[0]);
    // 2F の壁は [-300, 0]。1F のバンドは壁 ±出幅(50 グリッド=500mm) なので
    // その外側 [-350,-300] と [0,50] が「2F の脇に覗くけらば端」として残る。
    expect(bands).toEqual([[-350, -300], [0, 50]]);
  });

  it('2F に重なる範囲のバンドは消える（隠れるものは隠れる）', () => {
    const bands = east().roofBands.filter((b) => b.buildingId === 'back');
    expect(bands.every((b) => Math.min(b.xStart, b.xEnd) >= 0 || Math.max(b.xStart, b.xEnd) <= -300))
      .toBe(true);
  });
});
