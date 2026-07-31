import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToPrimitives } from '../elevationToObjects';
import { faceElevationToParts, isPartPrimitive, partsToPrimitives } from '../elevationParts';

// ============================================================
// E-8-v2a: 部材ブロック（意味データ）一次化。
// 最重要: 「部材から起こした絵」が現行の自動生成と完全一致すること。
// これが移行の安全網（部材化しても立面図の見た目が 1px も変わらない）。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 });
const northCol: FaceSpanColumn = {
  face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};

const fe = buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 });

describe('faceElevationToParts / partsToPrimitives: 現行の絵と一致', () => {
  it('部材プリミティブが完全一致する（座標・色・順序・meta まで）', () => {
    const expected = faceElevationToPrimitives(fe).filter(isPartPrimitive);
    const actual = partsToPrimitives(faceElevationToParts(fe));
    expect(actual).toEqual(expected);
  });

  it('嵩上げのある妻面でも一致する', () => {
    const markers: HeightMarker[] = [
      { id: 's0', buildingId: 'G', edgeIndex: 2, t: 0, heightMm: 5000 },
      { id: 'sm', buildingId: 'G', edgeIndex: 2, t: 0.5, heightMm: 9000 },
      { id: 's1', buildingId: 'G', edgeIndex: 2, t: 1, heightMm: 5000 },
    ];
    const southCol: FaceSpanColumn = {
      face: 'south', floor: 1, depthCoord: 540, xStart: 0, xEnd: 360,
      rails: [1800, 1800], handrailIds: ['a', 'b'],
    };
    const feG = buildFaceElevation([southCol], [bld('G')], { markers });
    const expected = faceElevationToPrimitives(feG).filter(isPartPrimitive);
    const actual = partsToPrimitives(faceElevationToParts(feG));
    expect(actual).toEqual(expected);
    // 嵩上げ部材が実際に含まれていること（テストが空振りでないことの確認）
    expect(actual.some((p) => p.meta?.kind === 'raise')).toBe(true);
  });

  it('入隅で切断された列（L字・2列）でも一致する', () => {
    const L: Point[] = [
      { x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 180 },
      { x: 180, y: 180 }, { x: 180, y: 360 }, { x: 0, y: 360 },
    ];
    const lbld: BuildingShape = { id: 'L', type: 'polygon', points: L, fill: '#3d3d3a', floor: 2 };
    const inner: FaceSpanColumn = { face: 'south', floor: 2, depthCoord: 270, xStart: 90, xEnd: 450, rails: [1800, 1800], handrailIds: ['a', 'b'] };
    const outer: FaceSpanColumn = { face: 'south', floor: 2, depthCoord: 450, xStart: -90, xEnd: 270, rails: [1800, 1800], handrailIds: ['c', 'd'] };
    const feL = buildFaceElevation([inner, outer], [lbld], { defaultHeightMm: 5000 });
    const expected = faceElevationToPrimitives(feL).filter(isPartPrimitive);
    const actual = partsToPrimitives(faceElevationToParts(feL));
    expect(actual).toEqual(expected);
    // 切断された手摺（同じ高さで複数本）が部材としても分かれていること
    const rails = faceElevationToParts(feL).parts.filter((p) => p.kind === 'rail');
    expect(rails.length).toBeGreaterThan(feL.scaffolds[0].levels.komaGridMm.length);
  });
});

describe('部材の意味データ', () => {
  const bundle = faceElevationToParts(fe);

  it('支柱は支柱番号、踏板・手摺はスパン番号と高さを持つ', () => {
    // E-8-v2j: 支柱は規格部材の積み重ね（H=6500 は 14 コマ → 下から [6,8] の 2 部材）。
    const posts = bundle.parts.filter((p) => p.kind === 'post');
    expect(posts.map((p) => p.postIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(posts.map((p) => p.segmentIndex)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    // E-8-v2l: 踏板・手摺は「1 スパン 1 部材」。3 段 × 3 スパン = 9 枚。
    const boards = bundle.parts.filter((p) => p.kind === 'board');
    expect(boards.length).toBe(9);
    expect(Array.from(new Set(boards.map((p) => p.levelMm)))).toEqual([1100, 2900, 4700]);
    for (const lv of [1100, 2900, 4700]) {
      expect(boards.filter((p) => p.levelMm === lv).map((p) => p.spanIndex).sort())
        .toEqual([0, 1, 2]);   // 各段にスパン 0..2 が 1 枚ずつ
    }
  });

  it('自動生成分は origin=auto', () => {
    expect(bundle.parts.every((p) => p.origin === 'auto')).toBe(true);
  });

  it('geom に支柱位置と段構成が入る（再描画の素）', () => {
    expect(bundle.geom.scaffolds).toHaveLength(1);
    expect(bundle.geom.scaffolds[0].postXs).toEqual([-450, -270, -90, 90]); // 北面は左右反転
    expect(bundle.geom.scaffolds[0].levelsMm).toEqual([1100, 2900, 4700]);
    expect(bundle.geom.scaffolds[0].topRailMm).toBe(6500);
    expect(bundle.geom.minXg).toBe(-450);
  });

  it('id は現行プリミティブの安定 id と同じ（再マッチ資産を引き継ぐ）', () => {
    const ids = new Set(faceElevationToPrimitives(fe).filter(isPartPrimitive).map((p) => p.meta!.id));
    for (const p of bundle.parts) expect(ids.has(p.id), p.id).toBe(true);
  });

  it('高さ情報が無ければ部材も空', () => {
    const empty = buildFaceElevation([], [bld('B')], { face: 'north' });
    const b = faceElevationToParts(empty);
    expect(b.parts).toEqual([]);
    expect(partsToPrimitives(b)).toEqual([]);
  });
});

describe('手動追加部材（レンジ未指定はスパン幅で決まる）', () => {
  it('spanIndex だけ与えれば支柱間いっぱいに描かれる', () => {
    const bundle = faceElevationToParts(fe);
    const manual = {
      id: 'manual:board:1', kind: 'board' as const, scaffoldIndex: 0, origin: 'manual' as const,
      spanIndex: 1, levelMm: 2900,
    };
    const prims = partsToPrimitives({ geom: bundle.geom, parts: [manual] });
    // E-8-v2f: 踏板は「濃い縁＋本体色」の 2 枚重ねで帯に見せる（部材感を出す）。
    expect(prims).toHaveLength(2);
    // postXs[1]=-270, postXs[2]=-90 → ローカルは minXg=-450 を引いて 180..360。
    // E-8-v2h: 1 枚ずつ切れて見えるよう端を boardInsetGrid(2.5) だけ内側に寄せる。
    for (const p of prims) {
      expect(p.kind === 'line' && [p.x1, p.x2]).toEqual([182.5, 357.5]);
      expect(p.meta?.kind).toBe('board');
    }
  });

  it('筋交は手動追加専用（自動生成には出ない）', () => {
    const bundle = faceElevationToParts(fe);
    expect(bundle.parts.some((p) => p.kind === 'brace')).toBe(false);
    const brace = {
      id: 'manual:brace:1', kind: 'brace' as const, scaffoldIndex: 0, origin: 'manual' as const,
      spanIndex: 0, levelMm: 2900,
    };
    const prims = partsToPrimitives({ geom: bundle.geom, parts: [brace] });
    // E-8-v2f: 太い斜線＋両端の丸ハンドル。
    expect(prims.map((p) => p.kind)).toEqual(['line', 'circle', 'circle']);
  });
});
