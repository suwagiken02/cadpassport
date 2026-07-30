import { describe, it, expect } from 'vitest';
import type { BuildingShape, ElevationView, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToPrimitives } from '../elevationToObjects';
import { faceElevationToParts, isPartPrimitive } from '../elevationParts';
import { composeViewPrimitives, hasParts } from '../elevationViewCompose';

// ============================================================
// E-8-v2b: 部材ブロック一次化の互換。
// 「parts を持つビューを描いた結果」＝「従来の primitives」でなければならない（重なり順まで）。
// 旧ビュー(parts 無し)は従来経路のまま。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 });
const northCol: FaceSpanColumn = {
  face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};
const fe = buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 });
const prims = faceElevationToPrimitives(fe);
const bundle = faceElevationToParts(fe);

const view = (over?: Partial<ElevationView>): ElevationView => ({
  id: 'v1', face: 'north', originGrid: { x: 0, y: 0 }, scale: 1, primitives: prims, ...over,
});

describe('composeViewPrimitives', () => {
  it('parts 一次のビューは従来と完全一致（順序・座標・meta まで）', () => {
    const v = view({ parts: bundle.parts, geom: bundle.geom });
    expect(hasParts(v)).toBe(true);
    expect(composeViewPrimitives(v)).toEqual(prims);
  });

  it('旧ビュー(parts 無し)は従来どおり primitives をそのまま描く', () => {
    const v = view();
    expect(hasParts(v)).toBe(false);
    expect(composeViewPrimitives(v)).toEqual(prims);
  });

  it('部材を1つ消すと、その部材だけが描かれなくなる（背景は不変）', () => {
    const target = bundle.parts.find((p) => p.kind === 'post')!;
    const v = view({ parts: bundle.parts.filter((p) => p.id !== target.id), geom: bundle.geom });
    const out = composeViewPrimitives(v);
    expect(out.some((p) => p.meta?.id === target.id)).toBe(false);
    expect(out).toHaveLength(prims.length - 1);
    // 背景（非部材）は 1 つも欠けない
    const bg = (xs: typeof prims) => xs.filter((p) => !isPartPrimitive(p));
    expect(bg(out)).toEqual(bg(prims));
  });

  it('部材を足すと末尾ではなく部材群の位置に入る（背景の重なり順を壊さない）', () => {
    const added = {
      id: 'manual:board:1', kind: 'board' as const, scaffoldIndex: 0, origin: 'manual' as const,
      spanIndex: 0, levelMm: 2900,
    };
    const v = view({ parts: [...bundle.parts, added], geom: bundle.geom });
    const out = composeViewPrimitives(v);
    const idx = out.findIndex((p) => p.meta?.id === 'manual:board:1');
    const lastBgBefore = out.findIndex((p) => p.meta?.kind === 'gl');
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(lastBgBefore); // GL より前＝足場グループの中に入っている
  });

  it('文字上書き(E-8c)は parts 一次でも効く', () => {
    const v = view({
      parts: bundle.parts, geom: bundle.geom,
      edits: [{ op: 'text', targetId: 'dimText:top', text: '天端 6600' }],
    });
    const out = composeViewPrimitives(v);
    const t = out.find((p) => p.meta?.id === 'dimText:top');
    expect(t && t.kind === 'text' && t.text).toBe('天端 6600');
  });

  it('部材が空でも背景は描かれる', () => {
    const v = view({ parts: [], geom: bundle.geom });
    const out = composeViewPrimitives(v);
    expect(out.every((p) => !isPartPrimitive(p))).toBe(true);
    expect(out.length).toBe(prims.filter((p) => !isPartPrimitive(p)).length);
  });
});
