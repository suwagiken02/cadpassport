import { describe, it, expect } from 'vitest';
import { resolveScaffoldStartOnNormalized, relabelByFace2F } from '../labelUtils';
import { getBuildingEdgesClockwise } from '../autoLayoutUtils';
import type { BuildingShape, Point } from '@/types';

// ============================================================
// H-3d-7 ゴールデンテスト: bothmode ⭐(足場開始)起点解決の単一規約
//
// 仕様:
//   scaffoldStart.startVertexIndex は getBuildingEdgesClockwise(building) の
//   辺順(edge.p1 列)の index として保存されている(types/index.ts:298)。
//   normalize(splitBuilding2FAt1FVertices)で頂点が増減・winding が変わっても、
//   ⭐ の絶対座標を基準に「正規化後ポリゴンの CW 辺順で p1 が ⭐ に一致する index」
//   を一意に解決できなければならない。
//
// 既知バグ:
//   旧 normalizedScaffoldStart(AutoLayoutModal.tsx:299-303)は building.points[idx]
//   と生 points 配列を CW 辺 index で引いており、CCW 格納のポリゴンで別頂点を指す。
//   → 凸型 bothmode で ⭐ が左上にズレる。
// ============================================================

const coordEq = (a: Point, b: Point, eps = 0.001): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

const mk = (points: Point[]): BuildingShape => ({
  id: 't', type: 'polygon', points, fill: '#000',
});

// 2F 矩形を CCW 格納する(getBuildingEdgesClockwise が reverse する winding)。
// NW→SW→SE→NE は画面座標(y下向き)で反時計回り。
const NW: Point = { x: 20, y: 20 };
const NE: Point = { x: 80, y: 20 };
const SE: Point = { x: 80, y: 60 };
const SW: Point = { x: 20, y: 60 };
const rect2F = mk([NW, SW, SE, NE]);

// 4 隅。rawStartVertexIndex は CW 辺順から導出(規約に忠実、winding 規約に非依存)。
const cornerIdxCW = (b: BuildingShape, corner: Point): number =>
  getBuildingEdgesClockwise(b).findIndex(e => coordEq(e.p1, corner));

const CORNERS: { name: string; star: Point }[] = [
  { name: 'NW', star: NW },
  { name: 'NE', star: NE },
  { name: 'SE', star: SE },
  { name: 'SW', star: SW },
];

// 1F 形状の違い = 正規化後 2F に挿入される中間頂点の違い、として表現する。
// (splitBuilding2FAt1FVertices は 2F の winding を保ったまま辺上に頂点を挿入する)
// いずれも隅(NW/NE/SE/SW)頂点は保持されるため、⭐解決の期待値は隅座標そのもの。
const VARIANTS: { name: string; points: Point[] }[] = [
  { name: '矩形(挿入なし)', points: [NW, SW, SE, NE] },
  // 凸型(北張り出し): 北辺 NE→NW(y=20) に中間頂点
  { name: '凸型(北辺挿入)', points: [NW, SW, SE, NE, { x: 60, y: 20 }, { x: 40, y: 20 }] },
  // 凹型(南側): 南辺 SW→SE(y=60) に中間頂点
  { name: '凹型(南辺挿入)', points: [NW, SW, { x: 40, y: 60 }, { x: 60, y: 60 }, SE, NE] },
  // L字: 東辺 SE→NE(x=80) と 北辺 NE→NW(y=20) に中間頂点
  { name: 'L字(東辺+北辺挿入)', points: [NW, SW, SE, { x: 80, y: 40 }, NE, { x: 50, y: 20 }] },
];

describe('resolveScaffoldStartOnNormalized — ⭐起点解決の単一規約 (H-3d-7)', () => {
  for (const v of VARIANTS) {
    for (const c of CORNERS) {
      it(`${v.name} × ⭐${c.name}: ⭐座標に一致し、起点辺が A 始まり`, () => {
        const norm = mk(v.points);
        const rawIdx = cornerIdxCW(rect2F, c.star);
        expect(rawIdx).toBeGreaterThanOrEqual(0); // 前提: 隅が CW 辺の p1 に存在

        const res = resolveScaffoldStartOnNormalized(rect2F, norm, rawIdx);

        // 1) 解決した ⭐ 座標がユーザーの選んだ隅と一致
        expect(coordEq(res.point, c.star)).toBe(true);

        // 2) vertexIndex は正規化後 CW 辺順の index。その辺の p1 が ⭐
        const normEdges = getBuildingEdgesClockwise(norm);
        expect(coordEq(normEdges[res.vertexIndex].p1, c.star)).toBe(true);

        // 3) relabelByFace2F の起点(ラベル A*)が ⭐ 起点辺になる
        const relabeled = relabelByFace2F(normEdges, res.vertexIndex);
        expect(relabeled[res.vertexIndex].label).toMatch(/^A/);
      });
    }
  }
});

describe('H-3d-7 バグ再現: 旧ロジック相当は CCW 格納で ⭐ を誤る', () => {
  // 凸型(北辺挿入) × ⭐SW で、旧 normalizedScaffoldStart(:299-303)相当が
  // ⭐ を SW ではない頂点に解決してしまうことを示す(= バグがテストで捕まる)。
  const norm = mk([NW, SW, SE, NE, { x: 60, y: 20 }, { x: 40, y: 20 }]);
  const rawIdx = cornerIdxCW(rect2F, SW); // CW 辺順での SW 起点 index

  it('旧: building.points[idx] 方式は ⭐ 座標を取り違える', () => {
    // 旧 line 299 相当: 生 points 配列を CW 辺 index で引く
    const oldStar = rect2F.points[rawIdx];
    // rect2F は CCW 格納のため points[rawIdx] は SW にならない(= 誤り)
    expect(coordEq(oldStar, SW)).toBe(false);
  });

  it('旧: 取り違えた座標で再マップした index は ⭐ 辺を指さない', () => {
    const oldStar = rect2F.points[rawIdx];
    // 旧 line 301 相当: 正規化生 points での findIndex
    const oldNewIdx = norm.points.findIndex(p => coordEq(p, oldStar));
    const normEdges = getBuildingEdgesClockwise(norm);
    const len = normEdges.length;
    const oldEdge = normEdges[((oldNewIdx % len) + len) % len];
    // 旧 index を CW 辺配列に食わせると ⭐(SW)から外れる
    expect(coordEq(oldEdge.p1, SW)).toBe(false);
  });

  it('新: resolveScaffoldStartOnNormalized は ⭐(SW)を正しく解決', () => {
    const res = resolveScaffoldStartOnNormalized(rect2F, norm, rawIdx);
    expect(coordEq(res.point, SW)).toBe(true);
    const normEdges = getBuildingEdgesClockwise(norm);
    expect(coordEq(normEdges[res.vertexIndex].p1, SW)).toBe(true);
  });
});
