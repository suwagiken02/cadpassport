import { describe, it, expect } from 'vitest';
import type { BuildingShape, HandrailLengthMm, HeightMarker, Point } from '@/types';
import { applyTsumawariToRails, railsForFace } from '../gableApply';
import { detectGableFaces } from '@/lib/konva/gableFaces';
import { getBuildingEdgesClockwise, placeHandrailsForEdge } from '@/lib/konva/autoLayoutUtils';
import { mmToGrid } from '@/lib/konva/gridUtils';

// ============================================================
// M-1c: 妻割の自動割付への適用。
// 合計を変えずに並び（と同じ合計の多重集合）だけ差し替えるので、
// 両端の離れ・隣接面の端点接続という絶対制約は保たれる。
// ============================================================
const METRIC: HandrailLengthMm[] = [1800, 1200, 900, 600, 400, 300, 200];
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const BLD: BuildingShape = { id: 'B', type: 'polygon', points: RECT, fill: '#000' };
/** 南辺の中央が高い＝南が妻面。 */
const GABLE_S: HeightMarker[] = [
  { id: 's0', buildingId: 'B', edgeIndex: 2, t: 0, heightMm: 5000 },
  { id: 'sm', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 7000 },
  { id: 's1', buildingId: 'B', edgeIndex: 2, t: 1, heightMm: 5000 },
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('applyTsumawariToRails', () => {
  it('合計 8500 の通常割りを妻割の 1 位へ差し替える（合計は不変）', () => {
    const normal: HandrailLengthMm[] = [1800, 1800, 1800, 1800, 1200, 100 as HandrailLengthMm];
    // 端から詰めた並び（合計 8500）を渡すと、確定の妻割並びになる。
    const out = applyTsumawariToRails([1800, 1800, 1800, 1800, 900, 400], METRIC);
    expect(out).toEqual([1800, 1800, 400, 900, 1800, 1800]);
    expect(sum(out)).toBe(8500);
    expect(sum(normal)).toBe(8500); // 参考: 元の合計と一致
  });

  it('同じ合計なら多重集合が違っても妻割の 1 位に揃う', () => {
    const a = applyTsumawariToRails([1800, 1800, 1800, 1800, 900, 200, 200], METRIC);
    const b = applyTsumawariToRails([1800, 1800, 1800, 1800, 900, 400], METRIC);
    expect(a).toEqual(b);
    expect(sum(a)).toBe(8500);
  });

  it('合計は必ず保存される（離れ・端点接続の絶対制約を壊さない）', () => {
    for (const rails of [
      [1800, 1800, 900],
      [1800, 1800, 1800, 1800, 1800, 1500, 1500],
      [1200, 600, 400],
      [1800],
    ] as HandrailLengthMm[][]) {
      expect(sum(applyTsumawariToRails(rails, METRIC))).toBe(sum(rails));
    }
  });

  it('列挙できない合計は元の多重集合の並べ替えにフォールバック', () => {
    const odd: HandrailLengthMm[] = [1800, 1800, 137 as HandrailLengthMm]; // 137 は規格外＝候補列挙が空
    const out = applyTsumawariToRails(odd, METRIC);
    expect(sum(out)).toBe(sum(odd));
    expect([...out].sort()).toEqual([...odd].sort()); // 多重集合は不変
  });

  it('空 rails はそのまま', () => {
    expect(applyTsumawariToRails([], METRIC)).toEqual([]);
  });
});

describe('railsForFace（面ごとの適用）', () => {
  const rails: HandrailLengthMm[] = [1800, 1800, 1800, 1800, 900, 400];

  it('妻面だけ妻割になり、他の面は元のまま', () => {
    const gable = new Set<'north' | 'south' | 'east' | 'west'>(['south']);
    expect(railsForFace(rails, 'south', gable, METRIC)).toEqual([1800, 1800, 400, 900, 1800, 1800]);
    expect(railsForFace(rails, 'north', gable, METRIC)).toBe(rails);
    expect(railsForFace(rails, 'east', gable, METRIC)).toBe(rails);
  });

  it('妻面なし（null/空集合）は全面通常割り＝挙動不変', () => {
    expect(railsForFace(rails, 'south', null, METRIC)).toBe(rails);
    expect(railsForFace(rails, 'south', new Set(), METRIC)).toBe(rails);
  });
});

describe('統合: 妻面判定 → 妻割 → 実配置', () => {
  it('矩形の妻面(南)は中央対称に並び、面の長さは変わらない', () => {
    const faces = detectGableFaces(BLD, GABLE_S).faces;
    expect(Array.from(faces)).toEqual(['south']);

    const edges = getBuildingEdgesClockwise(BLD);
    const south = edges.find((e) => e.face === 'south')!;
    const rails: HandrailLengthMm[] = [1800, 1800, 1800, 1800, 900, 400]; // 合計 8500
    const applied = railsForFace(rails, south.face, faces, METRIC);
    expect(applied).toEqual([1800, 1800, 400, 900, 1800, 1800]);

    // 実配置（南辺は右→左に進むので cursorStart から負方向）
    const layout = {
      edge: south, scaffoldCoord: 0, cursorStart: 0, cursorEnd: mmToGrid(8500),
      candidates: [], selectedIndex: 0,
    } as unknown as Parameters<typeof placeHandrailsForEdge>[0];
    const placed = placeHandrailsForEdge(layout, applied);
    expect(placed).toHaveLength(6);
    // 占有長さの合計は妻割の前後で不変
    expect(sum(placed.map((p) => p.lengthMm))).toBe(8500);
    // 端から数えたスパン境界が中央対称（1800,1800 | 400,900 | 1800,1800）
    const lens = placed.map((p) => p.lengthMm);
    expect(lens.slice(0, 2)).toEqual(lens.slice(4).reverse());
  });

  it('L字（入隅あり）は妻面判定の対象外＝通常割りのまま', () => {
    const L: Point[] = [
      { x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 300 },
      { x: 180, y: 300 }, { x: 180, y: 540 }, { x: 0, y: 540 },
    ];
    const lBld: BuildingShape = { ...BLD, points: L };
    const lMarkers: HeightMarker[] = [
      { id: 'l0', buildingId: 'B', edgeIndex: 4, t: 0, heightMm: 5000 },
      { id: 'lm', buildingId: 'B', edgeIndex: 4, t: 0.5, heightMm: 7000 },
      { id: 'l1', buildingId: 'B', edgeIndex: 4, t: 1, heightMm: 5000 },
    ];
    const faces = detectGableFaces(lBld, lMarkers).faces;
    expect(faces.size).toBe(0);
    const rails: HandrailLengthMm[] = [1800, 1800, 1800, 1800, 900, 400];
    expect(railsForFace(rails, 'south', faces, METRIC)).toBe(rails);
  });

  it('フラットな矩形（切妻でない）は全面通常割り', () => {
    const flat: HeightMarker[] = [
      { id: 'a', buildingId: 'B', edgeIndex: 0, t: 0.5, heightMm: 5000 },
      { id: 'b', buildingId: 'B', edgeIndex: 2, t: 0.5, heightMm: 5000 },
    ];
    const faces = detectGableFaces(BLD, flat).faces;
    expect(faces.size).toBe(0);
  });
});
