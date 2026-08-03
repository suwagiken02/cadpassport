// ============================================================
// E-8-v3a: 部材の位置を「スロット番号」から「自由座標(mm)」へ。
//
// v2 は postIndex / spanIndex から座標を引いていたので、決められた場所にしか置けなかった。
// v3 は x0Mm / x1Mm（面軸 mm）を一次データにして、どこにでも置ける。
// 接合（コマ・ジョイント）へは吸着で寄せる＝結果的にコマ位置の座標になるだけ（v3b）。
//
// ここで固定すること:
//   1. 自由座標があれば、スロット番号も geom も見ずにその位置に描かれる
//   2. 保存済みの旧データ（グリッド座標だけ / スロット番号だけ）も同じ絵になる
//   3. 変換(withFreeCoords)はべき等で、絵を変えない
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import {
  GRID_MM, faceElevationToParts, partRangeMm, partsToPrimitives, withFreeCoords,
  type ElevationPart,
} from '../elevationParts';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 540, y: 0 }, { x: 540, y: 360 }, { x: 0, y: 360 }];
const bld: BuildingShape = { id: 'B', type: 'polygon', points: RECT, fill: '#333', floor: 1 };
const col: FaceSpanColumn = {
  face: 'south', floor: 1, depthCoord: 450, xStart: 0, xEnd: 540,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};
const fe = buildFaceElevation([col], [bld], { defaultHeightMm: 6500, face: 'south' });
const bundle = faceElevationToParts(fe);
const geom = bundle.geom;
const sg = geom.scaffolds[0];

/** その部材だけを描いたときの、線の x 範囲（ローカル・グリッド）。 */
const drawnXs = (part: ElevationPart) => {
  const xs = partsToPrimitives({ geom, parts: [part] })
    .flatMap((p) => (p.kind === 'line' ? [p.x1, p.x2] : p.kind === 'circle' ? [p.x] : []));
  return { min: Math.min(...xs), max: Math.max(...xs) };
};

describe('自動生成部材は最初から自由座標を持つ', () => {
  it('すべての部材に x0Mm / x1Mm が入っている', () => {
    expect(bundle.parts.length).toBeGreaterThan(0);
    for (const p of bundle.parts) {
      expect(p.x0Mm, p.id).toBeTypeOf('number');
      expect(p.x1Mm, p.id).toBeTypeOf('number');
    }
  });

  it('支柱・ジャッキは 1 点（x0Mm === x1Mm）、手摺・踏板は両端', () => {
    for (const p of bundle.parts) {
      if (p.kind === 'post' || p.kind === 'jack' || p.kind === 'postExt') {
        expect(p.x0Mm, p.id).toBe(p.x1Mm);
      } else {
        expect(p.x1Mm! - p.x0Mm!, p.id).toBeGreaterThan(0);
      }
    }
  });

  it('面軸 mm はグリッド座標の 10 倍（1 グリッド = 10mm）', () => {
    expect(GRID_MM).toBe(10);
    const rail = bundle.parts.find((p) => p.kind === 'rail')!;
    expect(rail.x0Mm).toBe(rail.x0! * 10);
    // 支柱は postXs から復元された位置
    const post = bundle.parts.find((p) => p.kind === 'post' && p.postIndex === 2)!;
    expect(post.x0Mm).toBe(sg.postXs[2] * 10);
  });
});

describe('自由座標が一次: どこにでも置ける', () => {
  it('スロット番号に無い位置でも、その座標に描かれる', () => {
    // 支柱間の途中（支柱 0 と 1 の間の 1/3 の位置）＝スロットには存在しない場所
    const between = (sg.postXs[0] + (sg.postXs[1] - sg.postXs[0]) / 3) * GRID_MM;
    const free: ElevationPart = {
      id: 'free:post', kind: 'post', scaffoldIndex: 0, origin: 'manual',
      x0Mm: between, x1Mm: between, levelMm: 2000, komaCount: 4,
    };
    const drawn = drawnXs(free);
    expect(drawn.min).toBeLessThanOrEqual(between / GRID_MM);
    expect(drawn.max).toBeGreaterThanOrEqual(between / GRID_MM);
    // 支柱位置のどれとも一致しない＝スロット外に置けている
    for (const px of sg.postXs) expect(Math.abs(between / GRID_MM - px)).toBeGreaterThan(1);
  });

  it('自由座標があればスロット番号は位置に影響しない', () => {
    const base: ElevationPart = {
      id: 'free:rail', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 1000, x1Mm: 2800, levelMm: 2000,
    };
    // spanIndex を変えても、x0/x1(旧グリッド)を付けても、描かれる位置は同じ
    const a = drawnXs(base);
    const b = drawnXs({ ...base, spanIndex: 2 });
    const c = drawnXs({ ...base, x0: 999, x1: 999 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // 端はクサビの爪まで（爪はインセットぶん支柱側へ回り込むので部材の端に届く）
    expect(a.min).toBeCloseTo(1000 / GRID_MM);
    expect(a.max).toBeCloseTo(2800 / GRID_MM);
  });

  it('部材を動かすと、その部材だけがその量ぶん動く', () => {
    const p: ElevationPart = {
      id: 'free:rail', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      x0Mm: 1000, x1Mm: 2800, levelMm: 2000,
    };
    const before = drawnXs(p);
    const after = drawnXs({ ...p, x0Mm: 1000 + 333, x1Mm: 2800 + 333 });
    expect(after.min - before.min).toBeCloseTo(333 / GRID_MM);
    expect(after.max - before.max).toBeCloseTo(333 / GRID_MM);
  });
});

describe('保存済みデータの互換（変換バッチなしで読める）', () => {
  it('旧: グリッド座標だけの部材も同じ絵になる', () => {
    const modern = bundle.parts.find((p) => p.kind === 'rail')!;
    const legacy: ElevationPart = { ...modern, x0Mm: undefined, x1Mm: undefined };
    expect(drawnXs(legacy)).toEqual(drawnXs(modern));
    expect(partRangeMm(legacy, sg)).toEqual({ x0Mm: modern.x0Mm, x1Mm: modern.x1Mm });
  });

  it('旧: スロット番号だけの支柱も同じ絵になる', () => {
    const modern = bundle.parts.find((p) => p.kind === 'post' && p.postIndex === 1)!;
    const legacy: ElevationPart = {
      ...modern, x0Mm: undefined, x1Mm: undefined, x0: undefined, x1: undefined,
    };
    expect(drawnXs(legacy)).toEqual(drawnXs(modern));
  });

  it('withFreeCoords は旧データを自由座標に変換し、絵を変えない', () => {
    const legacy = bundle.parts.map((p) => ({
      ...p, x0Mm: undefined, x1Mm: undefined,
    })) as ElevationPart[];
    const migrated = withFreeCoords(legacy, geom);
    for (const p of migrated) {
      expect(p.x0Mm, p.id).toBeTypeOf('number');
      expect(p.x1Mm, p.id).toBeTypeOf('number');
    }
    expect(partsToPrimitives({ geom, parts: migrated }))
      .toEqual(partsToPrimitives({ geom, parts: legacy }));
  });

  it('withFreeCoords はべき等（2 回かけても変わらない・配列も作り直さない）', () => {
    const once = withFreeCoords(bundle.parts, geom);
    expect(once).toBe(bundle.parts);            // 既に自由座標なので同じ参照
    const twice = withFreeCoords(once, geom);
    expect(twice).toBe(once);
  });
});
