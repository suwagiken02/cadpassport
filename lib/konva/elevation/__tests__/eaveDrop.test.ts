import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, RidgeLine, Point } from '@/types';
import { buildFaceElevation, roofSlopePerMm } from '../elevationEngine';
import type { FaceSpanColumn, Face } from '../faceReconstruction';

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

// R-1c-fix2: コマ嵩上げの基準は「屋根の形」ではなく「壁の形」(鮎澤氏確定)。
//   R-1c/R-1c-fix で入れた「roofMaxOverSpan に RidgeLine 投影棟を算入」は設計誤りとして完全撤回した。
//   よって「②=RidgeLine の棟高で妻面嵩上げが発生する」系のテスト(R-1c 追加分)は削除。
//   嵩上げが要るのは壁が高く立ち上がる面(切妻の妻面・への字の三角壁)だけ、が正。
describe('R-1c-fix2: コマ嵩上げの基準は壁の形（棟は算入しない）', () => {
  const RECT_BLD: BuildingShape = { id: 'B', type: 'polygon', fill: '#000', floor: 1, points: RECT };
  // 寄棟の中央棟（RECT は縦長 h>w なので棟は x=180・y方向）。
  const hipRidge: RidgeLine = { id: 'r', buildingId: 'B', p1: { x: 180, y: 180 }, p2: { x: 180, y: 360 }, heightMm: 7000 };
  const cols: Record<Face, FaceSpanColumn> = {
    north: { face: 'north', floor: 1, depthCoord: 0, xStart: 0, xEnd: 360, rails: [1800, 1800], handrailIds: ['a', 'b'] },
    south: { face: 'south', floor: 1, depthCoord: 540, xStart: 0, xEnd: 360, rails: [1800, 1800], handrailIds: ['a', 'b'] },
    east: { face: 'east', floor: 1, depthCoord: 360, xStart: 0, xEnd: 540, rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'] },
    west: { face: 'west', floor: 1, depthCoord: 0, xStart: 0, xEnd: 540, rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'] },
  };
  const gableS: HeightMarker[] = [
    { id: 's0', buildingId: 'B', edgeIndex: 2, t: 0, heightMm: 5000 },
    { id: 'sm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 7000 },
    { id: 's1', buildingId: 'B', edgeIndex: 2, t: 1, heightMm: 5000 },
  ];

  it('寄棟（全周軒高一定＋RidgeLine）: 全4面で嵩上げなし ← 症状の回帰', () => {
    // 壁は全周 5000 で一定＝全面水下。棟(RidgeLine)は嵩上げに一切算入しない → どの面も spanRaises 空。
    // 以前は北/南面で点棟(x=180)を拾い中央スパンだけ嵩上げされていた（これが症状）。
    for (const face of ['north', 'south', 'east', 'west'] as Face[]) {
      const fe = buildFaceElevation([cols[face]], [RECT_BLD], { defaultHeightMm: 5000, ridgeLines: [hipRidge] });
      expect(fe.scaffolds[0].spanRaises).toEqual([]);
    }
  });

  it('切妻・妻面（中央マーカーの三角壁）: 壁が高いので階段状に嵩上げ', () => {
    // 南辺(edge2)中央マーカーで への字 → 壁 segments が棟高7000を含む＝壁の形で嵩上げ。
    const fe = buildFaceElevation([cols.south], [RECT_BLD], { markers: gableS });
    const raises = fe.scaffolds[0].spanRaises;
    expect(raises.length).toBeGreaterThan(0);
    expect(raises.every((r) => r.raisedFloorMm > 3200)).toBe(true); // 最上段床3200より上へ
  });

  it('切妻・樋面（フラット壁）: 嵩上げなし（維持）', () => {
    // 妻面(南)に棟マーカーがあっても、樋面(東)の壁は軒高一定＝水下 → 嵩上げ対象外。
    const fe = buildFaceElevation([cols.east], [RECT_BLD], { markers: gableS });
    expect(fe.scaffolds[0].spanRaises).toEqual([]);
  });
});
