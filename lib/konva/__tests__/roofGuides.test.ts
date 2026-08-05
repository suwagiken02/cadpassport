// ============================================================
// R-1n: 高さ・棟のガイドは「建物の壁」ではなく「ユーザーが作った屋根領域」基準。
//
// 原則（鮎澤氏）: 「壁＝屋根ではない」。高さマーカー・妻 TOP の入力対象は屋根。
//   ・建物全面に屋根を作った → ガイドは全周（従来と同じ位置＝互換）
//   ・一部にだけ屋根を作った → その領域の四隅・辺中央だけ
//   ・屋根が無い建物         → ガイドを出さない（先に屋根を作るのが正しい順序）
//
// 実機（スクショ確定）: 1F の上の左半分に 2F が乗る下屋構成。1F の屋根は右半分だけが正しい。
//   従来は 1F 建物の全周にガイドが出ており（誤り）、本当に必要な
//   「屋根の左辺（2F との境界）の中央」＝妻の TOP に置けなかった。
//
// 保存形式: 屋根のガイド点が**壁の上**なら従来どおり壁基準（buildingedgeIndex/t）で保存する
//   ＝立面の高さプロファイルにそのまま効く。壁を持たない辺（2F との境界）だけ roofId 付き。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, HeightMarker, Point, Roof } from '@/types';
import {
  guidesForBuildings, hasRoofFor, markerPolygon, nearestOutlineGuide, roofOutlineGuides,
} from '../heightMarkerUtils';
import { getHeightAtPosition } from '../heightInterpolation';
import { roofMarkerMaxMm, roofWallCoverages } from '../elevation/roofBandSource';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const roof = (id: string, buildingId: string, polygon: Point[]): Roof =>
  ({ id, buildingId, polygon, roofShape: 'gable', uniformMm: 0 } as Roof);

/** 1F 建物: x 0..200 / y 0..100（左半分の上に 2F が乗る）。 */
const b1 = { id: 'b1', points: rect(0, 0, 200, 100), floor: 1 } as BuildingShape;
/** 1F の屋根: 右半分だけ（x 100..200）。左辺 x=100 は 2F との境界＝壁が無い。 */
const r1 = roof('r1', 'b1', rect(100, 0, 200, 100));
/** 屋根の左辺の中央＝妻の TOP を置きたい点。 */
const gableTop: Point = { x: 100, y: 50 };

describe('屋根領域基準のガイド（実機の実例: 1F 屋根は右半分）', () => {
  const gs = roofOutlineGuides(b1, [r1]);

  it('屋根の四隅と各辺の中央が出る（4 隅 + 4 中央）', () => {
    expect(gs.filter((g) => g.kind === 'corner')).toHaveLength(4);
    expect(gs.filter((g) => g.kind === 'mid')).toHaveLength(4);
  });

  it('屋根の左辺（2F との境界）の中央に ◆ が出る＝妻の TOP を置ける', () => {
    const g = gs.find((x) => x.kind === 'mid' && x.point.x === 100 && x.point.y === 50);
    expect(g).toBeDefined();
    expect(g!.roofId).toBe('r1');            // 壁が無いので屋根基準で保存する
    expect(g!.t).toBe(0.5);
  });

  it('屋根が無い範囲（建物の左半分）にはガイドが出ない', () => {
    // 建物の左辺 x=0 の中央（従来はここにも ◆ が出ていた）
    expect(gs.some((g) => g.point.x === 0 && g.point.y === 50)).toBe(false);
  });

  it('壁の上にある屋根の辺は**壁基準**で返る（従来の保存形式＝立面にそのまま効く）', () => {
    // 屋根の右辺 x=200 は建物の東壁の上
    const right = gs.find((g) => g.kind === 'mid' && g.point.x === 200 && g.point.y === 50)!;
    expect(right.roofId).toBeUndefined();
    expect(right.edgeIndex).toBe(1);          // 建物の東辺
    expect(right.t).toBeCloseTo(0.5, 6);
    // 屋根の上辺 x 100..200 は建物の北辺の上（t は建物の辺での位置）
    const top = gs.find((g) => g.kind === 'mid' && g.point.y === 0)!;
    expect(top.roofId).toBeUndefined();
    expect(top.edgeIndex).toBe(0);
    expect(top.t).toBeCloseTo(0.75, 6);       // x=150 は建物北辺(0→200)の 0.75
  });

  it('見えているガイドに吸着できる（妻 TOP の点）', () => {
    const g = nearestOutlineGuide({ x: 101, y: 52 }, gs, 5)!;
    expect(g.kind).toBe('mid');
    expect(g.point).toEqual(gableTop);
    expect(g.roofId).toBe('r1');
  });
});

describe('全周屋根は従来と同じ位置に出る（互換）', () => {
  const full = roof('rf', 'b1', rect(0, 0, 200, 100));
  const gs = roofOutlineGuides(b1, [full]);

  it('4 隅 + 4 辺中央が、すべて壁基準で返る', () => {
    expect(gs).toHaveLength(8);
    expect(gs.every((g) => g.roofId === undefined)).toBe(true);
    const mids = gs.filter((g) => g.kind === 'mid').map((g) => g.point);
    expect(mids).toEqual([
      { x: 100, y: 0 }, { x: 200, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 50 },
    ]);
  });

  it('polygon 未設定の屋根（旧データ）も建物外周として同じ結果', () => {
    const legacy = { id: 'rl', buildingId: 'b1', roofShape: 'gable', uniformMm: 0 } as Roof;
    expect(roofOutlineGuides(b1, [legacy]).map((g) => g.point))
      .toEqual(gs.map((g) => g.point));
  });
});

describe('屋根が無い建物はガイドを出さない（先に屋根を作る）', () => {
  it('ガイド 0 件・案内の判定も false', () => {
    expect(guidesForBuildings([b1], [])).toEqual([]);
    expect(hasRoofFor(b1, [])).toBe(false);
    expect(hasRoofFor(b1, [r1])).toBe(true);
  });
});

describe('複数の屋根（大屋根＋下屋）はそれぞれの polygon ごとに出る', () => {
  const big = roof('big', 'b1', rect(0, 0, 120, 100));
  const small = roof('small', 'b1', rect(120, 20, 200, 80));

  it('両方の屋根の四隅・辺中央が出る', () => {
    const gs = guidesForBuildings([b1], [big, small]);
    expect(gs.filter((g) => g.kind === 'mid')).toHaveLength(8);
    // 大屋根と下屋の境界（x=120・壁が無い）はそれぞれの屋根基準で出る
    const boundary = gs.filter((g) => g.kind === 'mid' && g.point.x === 120);
    expect(boundary.map((g) => g.roofId).sort()).toEqual(['big', 'small']);
  });

  it('他の建物の屋根は混ざらない', () => {
    const other = { id: 'b2', points: rect(300, 0, 400, 100), floor: 1 } as BuildingShape;
    expect(roofOutlineGuides(other, [big, small])).toEqual([]);
  });
});

describe('保存形式との整合（立面エンジンの消費）', () => {
  /** 妻の TOP: 屋根の左辺の中央に置いたマーカー（壁が無いので屋根基準）。 */
  const top: HeightMarker = {
    id: 'top', buildingId: 'b1', edgeIndex: 3, t: 0.5, heightMm: 6000, roofId: 'r1',
  };
  /** 軒: 屋根の右辺（＝建物の東壁）に置いたマーカー（壁基準）。 */
  const eaveN: HeightMarker = { id: 'e1', buildingId: 'b1', edgeIndex: 0, t: 0.75, heightMm: 3000 };
  const eaveE: HeightMarker = { id: 'e2', buildingId: 'b1', edgeIndex: 1, t: 0.5, heightMm: 3000 };

  it('屋根基準のマーカーは壁の高さプロファイルに参加しない（壁の上に無いので当然）', () => {
    // 壁基準の 2 個だけで補間される＝屋根基準の 6000 が壁の高さを持ち上げない
    const h = getHeightAtPosition(b1, [eaveN, eaveE, top], 1, 0.5);
    expect(h).toBe(3000);
  });

  it('その屋根の棟マーカーとしては必ず効く（妻 TOP が立面に届く）', () => {
    const cov = roofWallCoverages(b1, r1);
    expect(roofMarkerMaxMm(b1, cov, [eaveN, eaveE, top], 'r1')).toBe(6000);
  });

  it('別の屋根の棟マーカーにはならない（下屋が大屋根の棟で持ち上がらない）', () => {
    const other = roof('r2', 'b1', rect(0, 0, 100, 100));
    const cov = roofWallCoverages(b1, other);
    expect(roofMarkerMaxMm(b1, cov, [top], 'r2')).toBeNull();
  });

  it('マーカーの位置の基準ポリゴンは roofId で決まる', () => {
    expect(markerPolygon(b1, [r1], top)).toEqual(r1.polygon);
    expect(markerPolygon(b1, [r1], eaveE)).toEqual(b1.points);
    // 屋根が消えた孤児マーカーは壁外周へフォールバック（描画が消えない）
    expect(markerPolygon(b1, [], top)).toEqual(b1.points);
  });
});
