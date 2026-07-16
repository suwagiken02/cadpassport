import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, RidgeLine, Point } from '@/types';
import { buildFaceElevation, roofSlopePerMm } from '../elevationEngine';
import type { FaceSpanColumn } from '../faceReconstruction';

// ============================================================
// R-1c: 軒先下がりの自動計算。①(軒高)と②(棟)から勾配を出し、樋面の軒先を軒高−勾配×出幅に下げる。
// 妻面嵩上げは壁 segments ではなく屋根包絡線(棟込み)を評価し、②が RidgeLine でも棟を取りこぼさない。
// ============================================================

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const roofBld = (id: string): BuildingShape => ({
  id, type: 'polygon', points: RECT, fill: '#000', floor: 1,
  roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null },
});

describe('roofSlopePerMm (R-1c pure)', () => {
  it('高さ差 ÷ run。軒5000・棟7000・run2700 → 0.7407', () => {
    expect(roofSlopePerMm(5000, 7000, 2700)).toBeCloseTo(2000 / 2700, 6);
  });
  it('②なし相当(棟≦軒) → 0(フラット)', () => {
    expect(roofSlopePerMm(5000, 5000, 2700)).toBe(0);
    expect(roofSlopePerMm(5000, 4000, 2700)).toBe(0);
  });
  it('run≦0 → 0(ゼロ割回避)', () => {
    expect(roofSlopePerMm(5000, 7000, 0)).toBe(0);
  });
});

describe('樋面の軒先下がり (R-1c)', () => {
  // 北=樋面。棟マーカー②を南辺中央(edge2 t0.5)に、軒①を北辺(edge0)に置く。
  const markers: HeightMarker[] = [
    { id: 'n0', buildingId: 'E', edgeIndex: 0, t: 0, heightMm: 5000 },
    { id: 'n1', buildingId: 'E', edgeIndex: 0, t: 1, heightMm: 5000 },
    { id: 'sm', buildingId: 'E', edgeIndex: 2, t: 0.5, heightMm: 7000 },
  ];

  it('軒高5000・棟7000・出幅600 → 軒先=4556(=5000−0.7407×600)。棟マーカー方式', () => {
    // run = 北壁(y=0) → 棟(bbox中央 y=270) = 2700mm。slope=2000/2700。drop=round(0.7407×600)=444。
    const fe = buildFaceElevation([], [roofBld('E')], { markers, face: 'north' });
    const band = fe.roofBands[0];
    expect(band.filledToRidge).toBe(true);
    expect(band.ridgeMm).toBe(7000); // 棟は不変
    // profile(=軒プロファイル)は全点 4556 に下がる(樋面は面内フラットなので一律下がり)。
    expect(band.profile.every((p) => p.mm === 4556)).toBe(true);
  });

  it('②(棟)が無ければ軒先は下がらない(従来=軒高のまま)', () => {
    // 軒マーカーのみ・棟なし → hasOverhang の線バンド、profile は 5000 のまま。
    const eaveOnly: HeightMarker[] = [
      { id: 'a', buildingId: 'F', edgeIndex: 0, t: 0, heightMm: 5000 },
      { id: 'b', buildingId: 'F', edgeIndex: 0, t: 1, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([], [roofBld('F')], { markers: eaveOnly, face: 'north' });
    const band = fe.roofBands[0];
    expect(band.filledToRidge).toBe(false);
    expect(band.profile.every((p) => p.mm === 5000)).toBe(true); // 下がりなし
  });
});

describe('妻面嵩上げが棟(RidgeLine)を取りこぼさない (R-1c・最大リスク対応)', () => {
  // 南面(妻面)の列。壁は軒高5000でフラット、棟は RidgeLine(x=180・面直交)で7000。
  const col: FaceSpanColumn = {
    face: 'south', floor: 1, depthCoord: 540, xStart: 0, xEnd: 360, rails: [1800, 1800], handrailIds: ['a', 'b'],
  };
  const building: BuildingShape = { id: 'B', type: 'polygon', fill: '#000', floor: 1, points: RECT };
  const ridge: RidgeLine = { id: 'r', buildingId: 'B', p1: { x: 180, y: 90 }, p2: { x: 180, y: 450 }, heightMm: 7000 };

  it('②=RidgeLine の棟高で嵩上げが発生する(壁segmentsだけなら取りこぼす)', () => {
    // 軒高5000 → 最上段作業床3200。棟7000 → gap=3800 > reach1900 で嵩上げ。
    const fe = buildFaceElevation([col], [building], { defaultHeightMm: 5000, ridgeLines: [ridge] });
    const sc = fe.scaffolds[0];
    expect(sc.spanRaises.length).toBeGreaterThan(0);
    // 嵩上げは棟(7000)基準。最終床は最上段床3200 + 追加コマ分だけ上がる。
    expect(sc.spanRaises.every((r) => r.raisedFloorMm > 3200)).toBe(true);
  });

  it('棟(②)が無ければ軒高5000のみで reach 内 → 嵩上げなし(対比)', () => {
    const fe = buildFaceElevation([col], [building], { defaultHeightMm: 5000 });
    expect(fe.scaffolds[0].spanRaises.length).toBe(0);
  });
});

describe('R-1c-fix: 樋面の嵩上げ判定から平行棟を除外', () => {
  const building: BuildingShape = { id: 'B', type: 'polygon', fill: '#000', floor: 1, points: RECT };
  const col: FaceSpanColumn = {
    face: 'south', floor: 1, depthCoord: 540, xStart: 0, xEnd: 360, rails: [1800, 1800], handrailIds: ['a', 'b'],
  };

  it('寄棟・樋面(面平行の棟): 棟を拾わず嵩上げなし(spanRaises 空) ← 症状の回帰', () => {
    // 南面(樋面)に平行な棟(x軸沿い y=270)。投影 a=90,b=270 の水平棟(a≠b)→ 嵩上げ評価から除外。
    // 壁は軒高5000のみ → 最上段3200 で gap1800 ≤ reach1900 → 嵩上げなし。
    const ridge: RidgeLine = { id: 'r', buildingId: 'B', p1: { x: 90, y: 270 }, p2: { x: 270, y: 270 }, heightMm: 7000 };
    const fe = buildFaceElevation([col], [building], { defaultHeightMm: 5000, ridgeLines: [ridge] });
    expect(fe.scaffolds[0].spanRaises).toEqual([]);
  });

  it('切妻・妻面(マーカー三角): 壁 segments 自体が高いので従来どおり嵩上げ', () => {
    // 南辺(edge2)中央に棟マーカー → への字。壁 segments が棟高7000を含むので棟ライン無関係に嵩上げ。
    const gable: HeightMarker[] = [
      { id: 's0', buildingId: 'B', edgeIndex: 2, t: 0, heightMm: 5000 },
      { id: 'sm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 7000 },
      { id: 's1', buildingId: 'B', edgeIndex: 2, t: 1, heightMm: 5000 },
    ];
    const fe = buildFaceElevation([col], [building], { markers: gable });
    expect(fe.scaffolds[0].spanRaises.length).toBeGreaterThan(0);
  });
});
