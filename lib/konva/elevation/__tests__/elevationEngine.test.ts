import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point, RoofOverhang, RidgeLine } from '@/types';
import { heightToFloors } from '../../calculator';
import type { FaceSpanColumn } from '../faceReconstruction';
import {
  buildElevationLevels,
  buildElevationColumns,
  buildBuildingOutline,
  buildFaceElevation,
  DEFAULT_JACK_MM,
  KOMA_PITCH_MM,
  LAYER_HEIGHT_MM,
} from '../elevationEngine';

// 座標: 水平=グリッド(1grid=10mm)、高さ=mm(GL基準)。1800mm=180grid。
function bld(id: string, points: Point[], floor?: number): BuildingShape {
  return { id, type: 'polygon', points, fill: '#eee', floor };
}
// 矩形建物 (0,0)-(360,0)-(360,540)-(0,540)（北辺=edge0, y=0, x[0,360]）
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];

function scol(over: Partial<FaceSpanColumn>): FaceSpanColumn {
  return {
    face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
    rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
    ...over,
  };
}

describe('buildElevationLevels: 電卓 heightToFloors との整合', () => {
  it('H=5000 → スタート1400・2段・1800下がり・levels=[1400,3200]・天端5000', () => {
    const lv = buildElevationLevels(5000);
    expect(lv.startMm).toBe(1400);
    expect(lv.floors).toBe(2);
    expect(lv.sagariMm).toBe(1800);
    expect(lv.levels).toEqual([1400, 3200]);
    expect(lv.topRailMm).toBe(5000);
    // 電卓と厳密一致
    const ht = heightToFloors(5000);
    expect(lv.startMm).toBe(ht.startMm);
    expect(lv.floors).toBe(ht.floors);
  });

  it('H=6500 → スタート1100・3段・levels=[1100,2900,4700]・天端6500', () => {
    const lv = buildElevationLevels(6500);
    expect(lv.startMm).toBe(1100);
    expect(lv.floors).toBe(3);
    expect(lv.levels).toEqual([1100, 2900, 4700]);
    expect(lv.topRailMm).toBe(6500);
    expect(lv.sagariMm).toBe(1800);
  });

  it('H<1800（1000）→ 0段・levels空・下がり0', () => {
    const lv = buildElevationLevels(1000);
    expect(lv.floors).toBe(0);
    expect(lv.levels).toEqual([]);
    expect(lv.sagariMm).toBe(0);
    expect(lv.komaGridMm).toEqual([]);
  });

  it('pillarType 透過: H=3800 は既定(通常330)で {2000,1}・根がらみ140 で {200,2}', () => {
    const normal = buildElevationLevels(3800);
    expect(normal.startMm).toBe(2000);
    expect(normal.floors).toBe(1);
    const negarami = buildElevationLevels(3800, { pillarType: 'negarami' });
    expect(negarami.startMm).toBe(200);
    expect(negarami.floors).toBe(2);
  });

  it('コマ格子: ジャッキ上端(150)起点・450刻み・天端以下', () => {
    const lv = buildElevationLevels(5000);
    expect(lv.jackTopMm).toBe(DEFAULT_JACK_MM);
    expect(lv.komaGridMm[0]).toBe(150);
    for (let i = 1; i < lv.komaGridMm.length; i++) {
      expect(lv.komaGridMm[i] - lv.komaGridMm[i - 1]).toBe(KOMA_PITCH_MM);
    }
    expect(lv.komaGridMm[lv.komaGridMm.length - 1]).toBeLessThanOrEqual(lv.topRailMm);
  });

  it('opts で層/ジャッキ上書き可', () => {
    const lv = buildElevationLevels(3600, { jackMm: 300 });
    expect(lv.jackTopMm).toBe(300);
    expect(lv.komaGridMm[0]).toBe(300);
    expect(LAYER_HEIGHT_MM).toBe(1800);
  });
});

describe('buildElevationColumns: 支柱x = rails 累積', () => {
  it('北面 rails[1800×3] xStart=-90 → postXs=[-90,90,270,450]', () => {
    const { postXs, spans } = buildElevationColumns(scol({}));
    expect(postXs).toEqual([-90, 90, 270, 450]);
    expect(spans.map(s => s.lenMm)).toEqual([1800, 1800, 1800]);
    expect(spans[0]).toEqual({ x0: -90, x1: 90, lenMm: 1800 });
    expect(spans[2].x1).toBe(450); // = xEnd
  });

  it('混在長 [1800,600] も累積が正しい', () => {
    const { postXs } = buildElevationColumns(scol({ rails: [1800, 600], xEnd: 150 }));
    expect(postXs).toEqual([-90, 90, 150]); // -90 +180 +60
  });
});

describe('buildBuildingOutline: 高さマーカーあり/なしフォールバック', () => {
  const building = bld('B1', RECT, 1);

  it('マーカー1個 → 全周一定値で北面セグメントが出る', () => {
    const markers: HeightMarker[] = [
      { id: 'm1', buildingId: 'B1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
    ];
    const o = buildBuildingOutline(building, 'north', markers);
    expect(o.segments.length).toBe(1);
    expect(o.segments[0]).toEqual({ xStart: 0, xEnd: 360, heightStartMm: 5000, heightEndMm: 5000 });
    expect(o.floor).toBe(1);
  });

  it('マーカー無し + defaultHeightMm → 既定高さで出る', () => {
    const o = buildBuildingOutline(building, 'north', [], { defaultHeightMm: 3000 });
    expect(o.segments.length).toBe(1);
    expect(o.segments[0].heightStartMm).toBe(3000);
  });

  it('マーカー無し + 既定無し → 高さ不明でセグメント空', () => {
    const o = buildBuildingOutline(building, 'north', []);
    expect(o.segments).toEqual([]);
  });
});

describe('buildBuildingOutline: 辺内部マーカーで妻(折れ線)化', () => {
  const building = bld('G1', RECT, 1); // 北辺=edge0, x[0,360]

  it('中央 t=0.5 高マーカー＋両端低 → サブセグメント2本(三角の妻)', () => {
    const markers: HeightMarker[] = [
      { id: 'g0', buildingId: 'G1', edgeIndex: 0, t: 0, heightMm: 3000 },
      { id: 'gm', buildingId: 'G1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
      { id: 'g1', buildingId: 'G1', edgeIndex: 0, t: 1, heightMm: 3000 },
    ];
    const o = buildBuildingOutline(building, 'north', markers);
    expect(o.segments.length).toBe(2);
    // 左: x[0,180] 3000→5000、右: x[180,360] 5000→3000（頂点は中央 x=180・5000）
    expect(o.segments[0]).toEqual({ xStart: 0, xEnd: 180, heightStartMm: 3000, heightEndMm: 5000 });
    expect(o.segments[1]).toEqual({ xStart: 180, xEnd: 360, heightStartMm: 5000, heightEndMm: 3000 });
  });

  it('マーカー1個(全周一定) → 従来どおり1辺1セグメント不変', () => {
    const markers: HeightMarker[] = [
      { id: 'm1', buildingId: 'G1', edgeIndex: 0, t: 0.5, heightMm: 4000 },
    ];
    const o = buildBuildingOutline(building, 'north', markers);
    expect(o.segments.length).toBe(1);
    expect(o.segments[0]).toEqual({ xStart: 0, xEnd: 360, heightStartMm: 4000, heightEndMm: 4000 });
  });
});

describe('E-3.5-2b: 段数・天端は水下(樋面)基準', () => {
  const building = bld('W1', RECT, 1); // 北辺=edge0, x[0,360]
  const northCol = scol({}); // 北面 x[-90,450], rails[1800×3]

  it('妻(両端軒5000・棟7000) → 基準は水下5000（棟7000ではない）', () => {
    const markers: HeightMarker[] = [
      { id: 'w0', buildingId: 'W1', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'wm', buildingId: 'W1', edgeIndex: 0, t: 0.5, heightMm: 7000 },
      { id: 'w1', buildingId: 'W1', edgeIndex: 0, t: 1, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([northCol], [building], { markers });
    // 段数・天端は水下5000基準（heightToFloors(5000)）
    expect(fe.scaffolds[0].levels.topRailMm).toBe(5000);
    expect(fe.scaffolds[0].levels.levels).toEqual([1400, 3200]);
    // 建物外形は棟7000を保持（天端5000より上に突き出る）
    const apex = Math.max(...fe.buildingOutlines[0].segments.flatMap(s => [s.heightStartMm, s.heightEndMm]));
    expect(apex).toBe(7000);
  });

  it('フラット面(一定5000)は従来どおり', () => {
    const markers: HeightMarker[] = [
      { id: 'f1', buildingId: 'W1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([northCol], [building], { markers });
    expect(fe.scaffolds[0].levels.topRailMm).toBe(5000);
    expect(fe.scaffolds[0].levels.levels).toEqual([1400, 3200]);
  });
});

describe('E-3.5-2c: 妻面のコマ嵩上げ(段違い作業床)', () => {
  const building = bld('W1', RECT, 1); // 北辺=edge0, x[0,360]
  const northCol = scol({}); // 北面 x[-90,450], postXs=[-90,90,270,450]

  // 屋根の線形補間から roofMax を再計算（テスト内検証用）。
  const roofMaxOverSpan = (fe: ReturnType<typeof buildFaceElevation>, x0: number, x1: number): number => {
    const segs = fe.buildingOutlines[0].segments;
    let mx = -Infinity;
    for (const s of segs) {
      const lo = Math.max(x0, s.xStart), hi = Math.min(x1, s.xEnd);
      if (hi < lo) continue;
      const at = (x: number) => s.heightStartMm + ((x - s.xStart) / (s.xEnd - s.xStart)) * (s.heightEndMm - s.heightStartMm);
      mx = Math.max(mx, at(lo), at(hi));
    }
    return mx;
  };

  it('妻(両端軒5000・棟7000): 棟に近いスパンほど addKoma が増える階段状', () => {
    const markers: HeightMarker[] = [
      { id: 'w0', buildingId: 'W1', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'wm', buildingId: 'W1', edgeIndex: 0, t: 0.5, heightMm: 7000 },
      { id: 'w1', buildingId: 'W1', edgeIndex: 0, t: 1, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([northCol], [building], { markers });
    const sr = fe.scaffolds[0].spanRaises;
    // 水下5000基準 → 最上段床3200。各スパンの屋根最高点まで届かない分だけコマ追加。
    expect(sr.map(r => r.spanIndex)).toEqual([0, 1, 2]);
    expect(sr.map(r => r.addKoma)).toEqual([2, 5, 2]);      // 中央(棟)スパンが最大
    expect(sr.map(r => r.raisedFloorMm)).toEqual([4100, 5450, 4100]);

    // 必要最小の検証: raisedFloor+1900 ≥ roofMax かつ (raisedFloor−450)+1900 < roofMax
    for (const r of sr) {
      const roofMax = roofMaxOverSpan(fe, r.x0, r.x1);
      expect(r.raisedFloorMm + 1900).toBeGreaterThanOrEqual(roofMax);
      expect(r.raisedFloorMm - 450 + 1900).toBeLessThan(roofMax);
    }
  });

  it('gap≤1900 のスパンは嵩上げなし（フラット面 → spanRaises 空）', () => {
    const markers: HeightMarker[] = [
      { id: 'f1', buildingId: 'W1', edgeIndex: 0, t: 0.5, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([northCol], [building], { markers });
    expect(fe.scaffolds[0].spanRaises).toEqual([]);
  });

  it('マーカー無し(既定高さ)でも spanRaises は空', () => {
    const fe = buildFaceElevation([northCol], [building], { defaultHeightMm: 6500 });
    expect(fe.scaffolds[0].spanRaises).toEqual([]);
  });
});

describe('E-3.6-1: 嵩上げコマの 4+1 分解', () => {
  const building = bld('K1', RECT, 1);
  const northCol = scol({}); // 水下5000基準 → 最上段床 topFloor=3200
  const gable = (ridge: number): HeightMarker[] => [
    { id: 'e0', buildingId: 'K1', edgeIndex: 0, t: 0, heightMm: 5000 },
    { id: 'em', buildingId: 'K1', edgeIndex: 0, t: 0.5, heightMm: ridge },
    { id: 'e1', buildingId: 'K1', edgeIndex: 0, t: 1, heightMm: 5000 },
  ];

  it('addKoma=5 → fullLayers=1・remKoma=1・中間床[5000]・最終床5450', () => {
    const fe = buildFaceElevation([northCol], [building], { markers: gable(7000) });
    const mid = fe.scaffolds[0].spanRaises.find(r => r.spanIndex === 1)!;
    expect(mid.addKoma).toBe(5);
    expect(mid.fullLayers).toBe(1);
    expect(mid.remKoma).toBe(1);
    expect(mid.intermediateFloorsMm).toEqual([5000]); // topFloor3200 + 1800
    expect(mid.raisedFloorMm).toBe(5450);
  });

  it('addKoma=2 → fullLayers=0・中間床なし(従来どおり)', () => {
    const fe = buildFaceElevation([northCol], [building], { markers: gable(7000) });
    const edge = fe.scaffolds[0].spanRaises.find(r => r.spanIndex === 0)!;
    expect(edge.addKoma).toBe(2);
    expect(edge.fullLayers).toBe(0);
    expect(edge.remKoma).toBe(2);
    expect(edge.intermediateFloorsMm).toEqual([]);
    expect(edge.raisedFloorMm).toBe(4100);
  });

  it('addKoma=4 → fullLayers=1・remKoma=0・中間床なし・最終床=最上フル段', () => {
    const fe = buildFaceElevation([northCol], [building], { markers: gable(6800) });
    const mid = fe.scaffolds[0].spanRaises.find(r => r.spanIndex === 1)!;
    expect(mid.addKoma).toBe(4);
    expect(mid.fullLayers).toBe(1);
    expect(mid.remKoma).toBe(0);
    expect(mid.intermediateFloorsMm).toEqual([]);
    expect(mid.raisedFloorMm).toBe(5000); // topFloor3200 + 1800
  });
});

describe('E-3.6-2: 足場なしでも建物のみ表示', () => {
  const building = bld('N1', RECT, 1);
  it('列0でも buildingOutlines は生成され scaffolds は空・face は opts.face', () => {
    const fe = buildFaceElevation([], [building], { defaultHeightMm: 5000, face: 'north' });
    expect(fe.scaffolds).toEqual([]);
    expect(fe.buildingOutlines.length).toBe(1);
    expect(fe.face).toBe('north');
  });
});

describe('E-3.6-3: 棟(建物最高点)破線 ridgeMaxMm', () => {
  const building = bld('R1', RECT, 1);
  // 北辺=edge0(軒5000)、南辺=edge2 の中央に棟7000。
  const markers: HeightMarker[] = [
    { id: 'n0', buildingId: 'R1', edgeIndex: 0, t: 0, heightMm: 5000 },
    { id: 'n1', buildingId: 'R1', edgeIndex: 0, t: 1, heightMm: 5000 },
    { id: 'sm', buildingId: 'R1', edgeIndex: 2, t: 0.5, heightMm: 7000 },
  ];

  it('外形が棟に達しない面(北・軒5000) → ridgeMaxMm=7000', () => {
    const fe = buildFaceElevation([], [building], { markers, face: 'north' });
    expect(fe.ridgeMaxMm).toBe(7000);
  });

  it('妻面(南・外形が棟7000に達する) → ridgeMaxMm=null', () => {
    const fe = buildFaceElevation([], [building], { markers, face: 'south' });
    expect(fe.ridgeMaxMm).toBeNull();
  });

  it('マーカー無しは ridgeMaxMm=null', () => {
    const fe = buildFaceElevation([], [building], { defaultHeightMm: 5000, face: 'north' });
    expect(fe.ridgeMaxMm).toBeNull();
  });
});

describe('E-3.7: 屋根投影バンド roofBands', () => {
  const building = bld('R1', RECT, 1);
  // 北辺=edge0(軒5000)、南辺=edge2 の中央に棟7000。
  const markers: HeightMarker[] = [
    { id: 'n0', buildingId: 'R1', edgeIndex: 0, t: 0, heightMm: 5000 },
    { id: 'n1', buildingId: 'R1', edgeIndex: 0, t: 1, heightMm: 5000 },
    { id: 'sm', buildingId: 'R1', edgeIndex: 2, t: 0.5, heightMm: 7000 },
  ];

  it('軒面(北): roofBands 1件・x は外形範囲[0,360]・ridge=7000', () => {
    const fe = buildFaceElevation([], [building], { markers, face: 'north' });
    expect(fe.roofBands.length).toBe(1);
    expect(fe.roofBands[0].buildingId).toBe('R1');
    expect(fe.roofBands[0].ridgeMm).toBe(7000);
    expect(fe.roofBands[0].xStart).toBe(0);
    expect(fe.roofBands[0].xEnd).toBe(360);
    expect(fe.ridgeMaxMm).toBe(7000);
  });

  it('妻面(南・外形が棟7000に達する): roofBands 空', () => {
    const fe = buildFaceElevation([], [building], { markers, face: 'south' });
    expect(fe.roofBands).toEqual([]);
    expect(fe.ridgeMaxMm).toBeNull();
  });

  it('マーカー無し: roofBands 空', () => {
    const fe = buildFaceElevation([], [building], { defaultHeightMm: 5000, face: 'north' });
    expect(fe.roofBands).toEqual([]);
  });
});

describe('E-3.9: 軒の出を屋根バンドに反映', () => {
  const markers = (bid: string): HeightMarker[] => [
    { id: 'n0', buildingId: bid, edgeIndex: 0, t: 0, heightMm: 5000 },
    { id: 'n1', buildingId: bid, edgeIndex: 0, t: 1, heightMm: 5000 },
    { id: 'sm', buildingId: bid, edgeIndex: 2, t: 0.5, heightMm: 7000 },
  ];

  it('出幅あり(RoofConfig 600mm): 壁シルエットは壁位置[0,360]・roofBands は壁±出幅[-60,420]', () => {
    const roofBuilding: BuildingShape = {
      ...bld('RF1', RECT, 1),
      roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null },
    };
    const fe = buildFaceElevation([], [roofBuilding], { markers: markers('RF1'), face: 'north' });
    const segs = fe.buildingOutlines[0].segments;
    expect(segs[0].xStart).toBe(0);              // 壁シルエットは壁位置
    expect(segs[segs.length - 1].xEnd).toBe(360);
    expect(fe.roofBands.length).toBe(1);
    expect(fe.roofBands[0].xStart).toBe(-60);    // 出幅600mm=60grid 左右へ拡張
    expect(fe.roofBands[0].xEnd).toBe(420);
    expect(fe.roofBands[0].ridgeMm).toBe(7000);
  });

  it('出幅なし: 壁と roofBands の x 範囲が一致', () => {
    const fe = buildFaceElevation([], [bld('R1', RECT, 1)], { markers: markers('R1'), face: 'north' });
    const segs = fe.buildingOutlines[0].segments;
    expect(fe.roofBands[0].xStart).toBe(segs[0].xStart);
    expect(fe.roofBands[0].xEnd).toBe(segs[segs.length - 1].xEnd);
  });

  it('旧式 roofOverhangs[](RoofConfig なし建物)でも反映', () => {
    const legacy: RoofOverhang[] = [
      { id: 'ro1', buildingId: 'L1', faceIndex: 1, overhangMm: 600 }, // east(edge1)
      { id: 'ro3', buildingId: 'L1', faceIndex: 3, overhangMm: 600 }, // west(edge3)
    ];
    const fe = buildFaceElevation([], [bld('L1', RECT, 1)], { markers: markers('L1'), face: 'north', roofOverhangs: legacy });
    expect(fe.roofBands[0].xStart).toBe(-60);
    expect(fe.roofBands[0].xEnd).toBe(420);
  });

  // 実機不具合: 棟マーカー無し(建物高さ1点)＋出幅ありで軒バンドが出ず張り出さなかった問題の回帰固定。
  it('棟マーカー無し(建物高さ1点)でも軒の出は壁より張り出す(フラット軒バンド)', () => {
    const roofBuilding: BuildingShape = {
      ...bld('SF1', RECT, 1),
      roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null },
    };
    const markers: HeightMarker[] = [
      { id: 'h1', buildingId: 'SF1', edgeIndex: 0, t: 0.5, heightMm: 6000 }, // 単一=建物高さ(軒)のみ
    ];
    const fe = buildFaceElevation([], [roofBuilding], { markers, face: 'north' });
    expect(fe.roofBands.length).toBe(1);
    expect(fe.roofBands[0].xStart).toBe(-60);      // 壁[0,360] より左右へ張り出す
    expect(fe.roofBands[0].xEnd).toBe(420);
    expect(fe.roofBands[0].ridgeMm).toBe(6000);    // 軒高でフラット
    expect(fe.buildingOutlines[0].segments[0].xStart).toBe(0); // 壁シルエットは壁位置
  });

  it('出幅なし・棟マーカー無しなら軒バンドは出ない', () => {
    const fe = buildFaceElevation([], [bld('NF1', RECT, 1)], { defaultHeightMm: 5000, face: 'north' });
    expect(fe.roofBands).toEqual([]);
  });
});

describe('buildFaceElevation: 矩形2階 × H=6500', () => {
  const building = bld('B1', RECT, 1);
  const northCol = scol({}); // 北面 floor1, rails[1800×3], x[-90,450]
  const fe = buildFaceElevation([northCol], [building], { defaultHeightMm: 6500 });

  it('段構成が電卓と整合・支柱x累積', () => {
    expect(fe.scaffolds.length).toBe(1);
    const sc = fe.scaffolds[0];
    expect(sc.levels.levels).toEqual([1100, 2900, 4700]);
    expect(sc.levels.topRailMm).toBe(6500);
    expect(sc.postXs).toEqual([-90, 90, 270, 450]);
  });

  it('踏板帯=段数・横線=コマ格子数', () => {
    const sc = fe.scaffolds[0];
    expect(sc.boards.length).toBe(sc.levels.floors); // 3
    expect(sc.boards.map(b => b.levelMm)).toEqual([1100, 2900, 4700]);
    expect(sc.rails.length).toBe(sc.levels.komaGridMm.length);
    expect(sc.boards[0].x0).toBe(-90);
    expect(sc.boards[0].x1).toBe(450);
  });

  it('建物輪郭が北面に出る（高さ6500）', () => {
    expect(fe.buildingOutlines.length).toBe(1);
    expect(fe.buildingOutlines[0].segments[0].heightStartMm).toBe(6500);
  });
});

describe('buildFaceElevation: L字上階の2列が別 scaffold', () => {
  // L 字南面の内側(depth270, x[90,450]) と 外側(depth450, x[-90,270]) の2列。
  const inner = scol({ face: 'south', floor: 2, depthCoord: 270, xStart: 90, xEnd: 450, rails: [1800, 1800] });
  const outer = scol({ face: 'south', floor: 2, depthCoord: 450, xStart: -90, xEnd: 270, rails: [1800, 1800] });
  const building = bld('L2', RECT, 2);
  const fe = buildFaceElevation([inner, outer], [building], { defaultHeightMm: 5000 });

  it('2列がそれぞれ別 scaffold で保持され、奥行き順が保たれる', () => {
    expect(fe.scaffolds.length).toBe(2);
    expect(fe.scaffolds.map(s => s.column.depthCoord)).toEqual([270, 450]);
  });

  it('各列の支柱x・段構成が独立に出る', () => {
    expect(fe.scaffolds[0].postXs).toEqual([90, 270, 450]);
    expect(fe.scaffolds[1].postXs).toEqual([-90, 90, 270]);
    expect(fe.scaffolds[0].levels.levels).toEqual([1400, 3200]); // H=5000
  });
});

describe('E-3.11: 妻面のけらば張り出し(傾き保存延長)', () => {
  const gableMarkers = (bid: string, eave: number, ridge: number): HeightMarker[] => [
    { id: 'c0', buildingId: bid, edgeIndex: 0, t: 0, heightMm: eave },
    { id: 'cm', buildingId: bid, edgeIndex: 0, t: 0.5, heightMm: ridge },
    { id: 'c1', buildingId: bid, edgeIndex: 0, t: 1, heightMm: eave },
  ];
  const roofBld = (id: string): BuildingShape => ({
    ...bld(id, RECT, 1),
    roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null },
  });

  it('妻面・出幅600: x=壁±出幅・けらば軒先=軒高−勾配×出幅・棟まで塗らない', () => {
    const fe = buildFaceElevation([], [roofBld('G')], { markers: gableMarkers('G', 5000, 7000), face: 'north' });
    expect(fe.roofBands.length).toBe(1);
    const band = fe.roofBands[0];
    expect(band.filledToRidge).toBe(false);
    expect(band.xStart).toBe(-60);
    expect(band.xEnd).toBe(420);
    // 傾き=(7000-5000)/180 mm/grid、出幅60grid → けらば軒先 = 5000 − 2000/180×60 = 4333
    expect(band.profile[0]).toEqual({ x: -60, mm: 4333 });
    expect(band.profile[band.profile.length - 1]).toEqual({ x: 420, mm: 4333 });
    // 中央の壁プロファイル(棟)を保持
    expect(band.profile.some((p) => p.x === 180 && p.mm === 7000)).toBe(true);
  });

  it('けらば軒先の高さは GL(0) 下限', () => {
    const fe = buildFaceElevation([], [roofBld('G2')], { markers: gableMarkers('G2', 400, 7000), face: 'north' });
    const band = fe.roofBands[0];
    // 傾き=(7000-400)/180≈36.7、60grid で 400−2200<0 → 0
    expect(band.profile[0].mm).toBe(0);
    expect(band.profile[band.profile.length - 1].mm).toBe(0);
  });

  it('妻面・出幅なし: バンドなし(従来どおり)', () => {
    const fe = buildFaceElevation([], [bld('GN', RECT, 1)], { markers: gableMarkers('GN', 5000, 7000), face: 'north' });
    expect(fe.roofBands).toEqual([]);
  });

  it('樋面(棟マーカー付き)は従来どおり棟まで塗る台形(filledToRidge=true)', () => {
    // 北=軒(角5000)・南=棟7000 → 北面は樋面の切妻投影。
    const markers: HeightMarker[] = [
      { id: 'n0', buildingId: 'E', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'n1', buildingId: 'E', edgeIndex: 0, t: 1, heightMm: 5000 },
      { id: 'sm', buildingId: 'E', edgeIndex: 2, t: 0.5, heightMm: 7000 },
    ];
    const fe = buildFaceElevation([], [roofBld('E')], { markers, face: 'north' });
    expect(fe.roofBands[0].filledToRidge).toBe(true);
    expect(fe.roofBands[0].ridgeMm).toBe(7000);
    expect(fe.roofBands[0].xStart).toBe(-60);
    expect(fe.roofBands[0].xEnd).toBe(420);
    expect(fe.roofBands[0].baseMm).toBeUndefined(); // マーカー方式
  });
});

describe('E-3.8b: 棟ライン投影で屋根バンド上端を上側包絡線に一般化', () => {
  const roofBld = (id: string): BuildingShape => ({
    ...bld(id, RECT, 1),
    roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null },
  });
  // 単一の軒マーカー(建物高さ=軒5000・外形フラット)。棟は棟ラインで与える。
  const eaveMarker = (bid: string): HeightMarker[] => [{ id: 'e', buildingId: bid, edgeIndex: 0, t: 0.5, heightMm: 5000 }];
  const rline = (id: string, bid: string, p1: Point, p2: Point, h: number): RidgeLine =>
    ({ id, buildingId: bid, p1, p2, heightMm: h });

  it('寄棟(面平行の棟ライン・出幅600): 台形の上側包絡線', () => {
    const ridge = rline('r', 'W', { x: 90, y: 270 }, { x: 270, y: 270 }, 7000); // 北面(x軸)に平行
    const fe = buildFaceElevation([], [roofBld('W')], { markers: eaveMarker('W'), face: 'north', ridgeLines: [ridge] });
    expect(fe.roofBands.length).toBe(1);
    const band = fe.roofBands[0];
    expect(band.filledToRidge).toBe(true);
    expect(band.baseMm).toBe(5000);
    expect(band.ridgeMm).toBe(7000);
    expect(band.xStart).toBe(-60);
    expect(band.xEnd).toBe(420);
    expect(band.profile).toEqual([
      { x: -60, mm: 5000 }, { x: 0, mm: 5800 }, { x: 90, mm: 7000 },
      { x: 270, mm: 7000 }, { x: 360, mm: 5800 }, { x: 420, mm: 5000 },
    ]);
  });

  it('妻側(面直交の棟ライン): 三角の包絡線(棟が1点に潰れる)', () => {
    const ridge = rline('r', 'G', { x: 180, y: 90 }, { x: 180, y: 450 }, 7000); // 北面(x軸)に直交
    const fe = buildFaceElevation([], [roofBld('G')], { markers: eaveMarker('G'), face: 'north', ridgeLines: [ridge] });
    const band = fe.roofBands[0];
    expect(band.filledToRidge).toBe(true);
    expect(band.profile).toEqual([
      { x: -60, mm: 5000 }, { x: 0, mm: 5500 }, { x: 180, mm: 7000 },
      { x: 360, mm: 5500 }, { x: 420, mm: 5000 },
    ]);
  });

  it('出幅なし+棟ライン: 拡張なしで包絡線(x=壁範囲)', () => {
    const ridge = rline('r', 'N', { x: 90, y: 270 }, { x: 270, y: 270 }, 7000);
    const fe = buildFaceElevation([], [bld('N', RECT, 1)], { markers: eaveMarker('N'), face: 'north', ridgeLines: [ridge] });
    const band = fe.roofBands[0];
    expect(band.xStart).toBe(0);
    expect(band.xEnd).toBe(360);
    expect(band.profile).toEqual([
      { x: 0, mm: 5000 }, { x: 90, mm: 7000 }, { x: 270, mm: 7000 }, { x: 360, mm: 5000 },
    ]);
  });

  it('複数棟ライン: 全ラインの max で合成(間の谷も交点で標本化)', () => {
    const r1 = rline('r1', 'M', { x: 60, y: 270 }, { x: 120, y: 270 }, 7000);
    const r2 = rline('r2', 'M', { x: 240, y: 270 }, { x: 300, y: 270 }, 7000);
    const fe = buildFaceElevation([], [bld('M', RECT, 1)], { markers: eaveMarker('M'), face: 'north', ridgeLines: [r1, r2] });
    const band = fe.roofBands[0];
    expect(band.profile).toEqual([
      { x: 0, mm: 5000 }, { x: 60, mm: 7000 }, { x: 120, mm: 7000 },
      { x: 180, mm: 6500 }, // 2 棟の谷
      { x: 240, mm: 7000 }, { x: 300, mm: 7000 }, { x: 360, mm: 5000 },
    ]);
  });

  it('棟ラインなし建物は従来挙動(マーカー方式・baseMm undefined)', () => {
    // 棟マーカー付き(南7000)＋棟ラインなし → 従来の台形。
    const markers: HeightMarker[] = [
      { id: 'n0', buildingId: 'K', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'n1', buildingId: 'K', edgeIndex: 0, t: 1, heightMm: 5000 },
      { id: 'sm', buildingId: 'K', edgeIndex: 2, t: 0.5, heightMm: 7000 },
    ];
    const fe = buildFaceElevation([], [bld('K', RECT, 1)], { markers, face: 'north' });
    expect(fe.roofBands[0].filledToRidge).toBe(true);
    expect(fe.roofBands[0].baseMm).toBeUndefined();
    expect(fe.roofBands[0].ridgeMm).toBe(7000);
  });
});
