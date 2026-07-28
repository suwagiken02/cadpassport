import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point, Roof } from '@/types';
import { buildFaceElevation, type RoofBand } from '../elevationEngine';
import { faceElevationToPrimitives } from '../elevationToObjects';
import { liftLegacyRoofs } from '@/lib/konva/roofResolve';
import type { Face } from '../faceReconstruction';

// ============================================================
// R-1f-4: L 字の「大屋根 + 下屋」統合テスト。
//
// 建物(L字・グリッド):
//   (0,0)-(360,0)-(360,300)-(180,300)-(180,540)-(0,540)
//   辺: 0=北(y0) / 1=東(x360,y0-300) / 2=南(y300,x180-360) / 3=東(x180,y300-540)
//       4=南(y540,x0-180) / 5=西(x0)
//   大屋根 = 北の帯 y0-300（辺 0,1,2 と 西辺の上半分に乗る）
//   下屋   = 南西の翼 y300-540（辺 3,4 と 西辺の下半分に乗る）
// 高さマーカーは大屋根の壁に 5000、下屋の壁に 3000。
// ============================================================
const L_POINTS: Point[] = [
  { x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 300 },
  { x: 180, y: 300 }, { x: 180, y: 540 }, { x: 0, y: 540 },
];
const BLD: BuildingShape = {
  id: 'L', type: 'polygon', points: L_POINTS, fill: '#000', floor: 1,
  roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null },
};

const MAIN: Roof = {
  id: 'main', buildingId: 'L', roofShape: 'gable', uniformMm: 600,
  polygon: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 300 }, { x: 180, y: 300 }, { x: 0, y: 300 }],
};
const LOWER: Roof = {
  id: 'lower', buildingId: 'L', roofShape: 'shed', uniformMm: 600,
  polygon: [{ x: 0, y: 300 }, { x: 180, y: 300 }, { x: 180, y: 540 }, { x: 0, y: 540 }],
};

// 大屋根の壁(北・南面 x180-360)に 5000、下屋の壁(南面 x0-180)に 3000。
const MARKERS: HeightMarker[] = [
  { id: 'm1', buildingId: 'L', edgeIndex: 0, t: 0, heightMm: 5000 },
  { id: 'm2', buildingId: 'L', edgeIndex: 2, t: 0, heightMm: 5000 },
  { id: 'm3', buildingId: 'L', edgeIndex: 2, t: 1, heightMm: 5000 },
  { id: 'm4', buildingId: 'L', edgeIndex: 4, t: 0, heightMm: 3000 },
  { id: 'm5', buildingId: 'L', edgeIndex: 4, t: 1, heightMm: 3000 },
];

const FACES: Face[] = ['north', 'south', 'east', 'west'];
const feFor = (face: Face) =>
  buildFaceElevation([], [BLD], { markers: MARKERS, face, roofs: [MAIN, LOWER] });
const bandOf = (bands: RoofBand[], roofId: string) => bands.find((b) => b.roofId === roofId)!;
const profMax = (b: RoofBand) => Math.max(...b.profile.map((p) => p.mm));

describe('R-1f-4: L字 大屋根+下屋 — 各面のバンドが屋根ごとに 2 本', () => {
  it('4 面すべてで大屋根・下屋の 2 バンドが出る', () => {
    for (const face of FACES) {
      const bands = feFor(face).roofBands;
      expect(bands.length, face).toBe(2);
      expect(bands.map((b) => b.roofId).sort(), face).toEqual(['lower', 'main']);
    }
  });

  it('南面: 大屋根(奥)→下屋(手前)の順で、x 範囲も高さも屋根ごとに分かれる', () => {
    const bands = feFor('south').roofBands;
    expect(bands.map((b) => b.roofId)).toEqual(['main', 'lower']);

    // 大屋根: 南向きの壁は x180-360、出幅 600mm=60grid で [-60,420] まで張り出す。軒高 5000 で水平。
    const main = bandOf(bands, 'main');
    expect(main.xStart).toBe(-60);
    expect(main.xEnd).toBe(420);
    expect(main.profile.every((p) => p.mm === 5000)).toBe(true);
    expect(main.ridgeMm).toBe(5000);

    // 下屋: 南向きの壁は x0-180、張り出して [-60,240]。軒高 3000（大屋根の 5000 が漏れない）。
    const lower = bandOf(bands, 'lower');
    expect(lower.xStart).toBe(-60);
    expect(lower.xEnd).toBe(240);
    expect(lower.profile.every((p) => p.mm === 3000)).toBe(true);
    expect(lower.ridgeMm).toBe(3000);
  });

  it('北面: 下屋は北に壁を持たないので自分の軒高(3000)の水平バンドになる', () => {
    const bands = feFor('north').roofBands;
    // 北から見ると下屋が奥・大屋根が手前。
    expect(bands.map((b) => b.roofId)).toEqual(['lower', 'main']);
    const lower = bandOf(bands, 'lower');
    expect(lower.profile.every((p) => p.mm === 3000)).toBe(true);
    // E-5-fix: 北立面は左右反転。下屋 [-60,240] → [-240,60]、大屋根 [-60,420] → [-420,60]。
    expect([lower.xStart, lower.xEnd]).toEqual([-240, 60]);
    const main = bandOf(bands, 'main');
    expect([main.xStart, main.xEnd]).toEqual([-420, 60]);
    expect(main.profile.every((p) => p.mm === 5000)).toBe(true);
  });

  it('西面: 同じ壁面でも大屋根側が高く下屋側が低い（高さが屋根別）', () => {
    const bands = feFor('west').roofBands;
    const main = bandOf(bands, 'main');
    const lower = bandOf(bands, 'lower');
    // 西壁は 1 枚だが、大屋根が乗る北半分(y0-300)と下屋が乗る南半分(y300-540)で別バンドになる。
    expect(main.profile.some((p) => p.x === 0 && p.mm === 5000)).toBe(true);    // 大屋根の軒(北端)
    expect(lower.profile.some((p) => p.x === 540 && p.mm === 3000)).toBe(true); // 下屋の軒(南端)
    expect(profMax(main)).toBeGreaterThan(profMax(lower));
    expect(profMax(lower)).toBeLessThan(5000); // 下屋は大屋根の軒高に届かない
  });

  it('東面: 2 バンドの変軸範囲が別（大屋根=北側の壁・下屋=南側の壁）', () => {
    const bands = feFor('east').roofBands;
    const main = bandOf(bands, 'main');
    const lower = bandOf(bands, 'lower');
    expect([main.xStart, main.xEnd]).not.toEqual([lower.xStart, lower.xEnd]);
  });

  it('屋根を 1 枚だけ渡すと 1 バンドしか出ない（もう一方が勝手に混ざらない）', () => {
    const only = buildFaceElevation([], [BLD], { markers: MARKERS, face: 'south', roofs: [LOWER] });
    expect(only.roofBands.length).toBe(1);
    expect(only.roofBands[0].roofId).toBe('lower');
    expect(only.roofBands[0].profile.every((p) => p.mm === 3000)).toBe(true);
  });
});

describe('R-1f-4: 既存の単一屋根は不変（L字の回帰）', () => {
  const single: Roof = {
    id: 'roof-lift-L', buildingId: 'L', polygon: L_POINTS, roofShape: 'gable', uniformMm: 600,
  };
  const strip = (bands: RoofBand[]) => bands.map(({ roofId: _r, ...rest }) => rest);

  // R-1g: 旧 building.roof の直読みは撤去。互換は読み込み時の lift 一点なので、
  //   「旧 RoofConfig を lift した屋根」と「同形の屋根を直接渡した場合」の一致で担保する。
  it('旧 RoofConfig は lift すれば polygon=建物外周の 1 屋根と 4 面すべてで数値一致', () => {
    for (const face of FACES) {
      const lifted = buildFaceElevation([], [BLD], { markers: MARKERS, face, roofs: liftLegacyRoofs([BLD], []) });
      const explicit = buildFaceElevation([], [BLD], { markers: MARKERS, face, roofs: [single] });
      expect(lifted.roofBands.length, face).toBe(1);
      expect(strip(lifted.roofBands), face).toEqual(strip(explicit.roofBands));
      expect(lifted.ridgeMaxMm, face).toBe(explicit.ridgeMaxMm);
    }
  });

  it('建物シルエット・足場・嵩上げは屋根分割の影響を受けない', () => {
    const legacy = buildFaceElevation([], [BLD], { markers: MARKERS, face: 'south' });
    const split = feFor('south');
    expect(split.buildingOutlines).toEqual(legacy.buildingOutlines);
    expect(split.scaffolds).toEqual(legacy.scaffolds);
  });
});

describe('R-1f-4: キャンバス配置(プリミティブ)にも屋根ごとに出る', () => {
  it('南立面のプリミティブに 5000(大屋根) と 3000(下屋) の軒線が両方ある', () => {
    const prims = faceElevationToPrimitives(feFor('south'));
    // elevationToObjects: 垂直は mm/10 で上が負（GL=0）。軒線は輪郭色の線。
    const roofLineYs = prims
      .filter((p): p is Extract<typeof p, { kind: 'line' }> => p.kind === 'line' && p.stroke === '#8a8a86')
      .map((p) => p.y1);
    expect(roofLineYs).toContain(-500); // 5000mm = 大屋根の軒
    expect(roofLineYs).toContain(-300); // 3000mm = 下屋の軒
  });
});
