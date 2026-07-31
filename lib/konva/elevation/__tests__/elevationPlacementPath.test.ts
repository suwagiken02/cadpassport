// ============================================================
// E-8-v2l: 「配置 → 画面」の実経路を固定する (= 実機とテストの食い違い防止)
//
// 経緯: 生成時だけを見るテストが緑でも、実機では手摺が列全幅 1 本（10800mm）のままで、
//   「テスト緑・実機NG」が続いた。原因は、テストが実際の配置フローと同じ入力・同じ
//   関数列を通っていなかったこと。ここでは配置フロー(ElevationPlaceDialog)と同じ手順で
//   ElevationView を組み立て、描画経路(composeViewPrimitives)まで通して固定する。
//
// 固定する事実:
//   1. 手摺・踏板は「レベル × スパン」で 1 本ずつ（6 スパンならレベルごとに 6 件・各 1800mm）
//   2. 画面に出る部材は必ず parts 由来（保存済み primitives の絵は使われない）
//   3. モーダルのプレビューも同じ emitter を使う（部材の二重実装を作らない）
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { BuildingShape, ElevationView, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToPrimitives } from '../elevationToObjects';
import {
  faceElevationToParts, hasLegacyFullWidthParts, isPartPrimitive, partsToPrimitives,
} from '../elevationParts';
import { composeViewPrimitives } from '../elevationViewCompose';

/** 6 スパン(10800mm)の面。実機で「1 本で動く」と報告された規模。 */
const SPANS = 6;
const SPAN_GRID = 180;                 // 1800mm = 180 グリッド
const RECT: Point[] = [
  { x: 0, y: 0 }, { x: 1080, y: 0 }, { x: 1080, y: 720 }, { x: 0, y: 720 },
];
const bld: BuildingShape = { id: 'B', type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 };
const col6: FaceSpanColumn = {
  face: 'south', floor: 1, depthCoord: 810, xStart: -90, xEnd: -90 + SPANS * SPAN_GRID,
  rails: Array.from({ length: SPANS }, () => 1800),
  handrailIds: Array.from({ length: SPANS }, (_, i) => `h${i}`),
};

const fe = buildFaceElevation([col6], [bld], { defaultHeightMm: 7000, face: 'south' });
const bundle = faceElevationToParts(fe);

/** 配置フロー(ElevationPlaceDialog.buildViews)と同じ組み立て。 */
const placedView: ElevationView = {
  id: 'v1', face: 'south', originGrid: { x: 0, y: 0 }, scale: 1,
  primitives: faceElevationToPrimitives(fe),
  parts: bundle.parts, geom: bundle.geom,
};

describe('配置フローが作る部材: レベル × スパンで 1 本ずつ', () => {
  const rails = bundle.parts.filter((p) => p.kind === 'rail');
  const levels = Array.from(new Set(rails.map((p) => p.levelMm)));

  it('手摺はレベルごとに 6 件（スパン番号 0..5 が 1 つずつ）', () => {
    expect(levels.length).toBeGreaterThan(0);
    for (const lv of levels) {
      const atLevel = rails.filter((p) => p.levelMm === lv);
      expect(atLevel.length).toBe(SPANS);
      expect(atLevel.map((p) => p.spanIndex).sort((a, b) => (a ?? 0) - (b ?? 0)))
        .toEqual([0, 1, 2, 3, 4, 5]);
    }
    expect(rails.length).toBe(levels.length * SPANS);
  });

  it('手摺 1 本の幅はスパン幅 1800mm（列全幅 10800mm の 1 本は出ない）', () => {
    for (const r of rails) {
      expect(Math.round(Math.abs((r.x1 ?? 0) - (r.x0 ?? 0)))).toBe(SPAN_GRID);
    }
    const full = SPANS * SPAN_GRID;
    expect(rails.some((r) => Math.round(Math.abs((r.x1 ?? 0) - (r.x0 ?? 0))) === full)).toBe(false);
  });

  it('踏板も 1 スパン 1 枚', () => {
    const boards = bundle.parts.filter((p) => p.kind === 'board');
    const lv = Array.from(new Set(boards.map((p) => p.levelMm)));
    expect(boards.length).toBe(lv.length * SPANS);
    for (const b of boards) {
      expect(Math.round(Math.abs((b.x1 ?? 0) - (b.x0 ?? 0)))).toBe(SPAN_GRID);
    }
  });

  it('1 本だけ動かせる: 1 部材を動かしても他の部材の絵は変わらない', () => {
    const target = bundle.parts.find((p) => p.kind === 'rail')!;
    const moved = bundle.parts.map((p) => (
      p.id === target.id
        ? { ...p, origin: 'manual' as const, x0: (p.x0 ?? 0) + SPAN_GRID, x1: (p.x1 ?? 0) + SPAN_GRID }
        : p));
    const before = partsToPrimitives(bundle);
    const after = partsToPrimitives({ parts: moved, geom: bundle.geom });
    const diff = after.filter((p, i) => JSON.stringify(p) !== JSON.stringify(before[i]));
    // 動いたのは対象の手摺 1 本ぶんのプリミティブ（本体＋フック）だけ
    expect(diff.length).toBeGreaterThan(0);
    expect(Array.from(new Set(diff.map((p) => p.meta?.id)))).toEqual([target.id]);
  });
});

describe('描画経路: 画面に出る部材は必ず parts 由来', () => {
  it('composeViewPrimitives の部材は partsToPrimitives と一致する', () => {
    const drawn = composeViewPrimitives(placedView);
    expect(drawn.filter(isPartPrimitive)).toEqual(partsToPrimitives(bundle));
  });

  it('保存済み primitives の部材が古くても、画面は parts に従う（旧経路の復活検出）', () => {
    // 保存された「絵」だけを列全幅 1 本に戻した ElevationView（= v2l 以前の姿）。
    const stale: ElevationView = {
      ...placedView,
      primitives: placedView.primitives.map((p) => (
        p.meta?.kind === 'rail' && p.kind === 'line'
          ? { ...p, x2: p.x1 + SPANS * SPAN_GRID }
          : p)),
    };
    expect(composeViewPrimitives(stale).filter(isPartPrimitive)).toEqual(partsToPrimitives(bundle));
  });

  it('背景（建物・GL・寸法）は保存済み primitives のまま残る', () => {
    const drawn = composeViewPrimitives(placedView);
    const kinds = new Set(drawn.map((p) => p.meta?.kind));
    expect(kinds.has('building')).toBe(true);
    expect(kinds.has('gl')).toBe(true);
    expect(kinds.has('dim')).toBe(true);
  });
});

// ============================================================
// 配置済み（保存済み）の立面を最新形へ作り直す判定 (= E-8-v2l)。
// 暗黙移行が暴走しないよう、「1 回で収束し、再入しない」ことをここで固定する。
// ============================================================
describe('旧世代(列全幅)parts の検出と再入禁止', () => {
  const sg = bundle.geom.scaffolds[0];
  const railLevels = Array.from(new Set(
    bundle.parts.filter((p) => p.kind === 'rail').map((p) => p.levelMm)));
  /** v2l 以前の姿: 手摺・踏板が列の全幅 1 本。 */
  const legacyParts = [
    ...bundle.parts.filter((p) => p.kind !== 'rail' && p.kind !== 'board'),
    ...railLevels.map((lv) => ({
      id: `rail:0:${lv}:0`, kind: 'rail' as const, scaffoldIndex: 0, origin: 'auto' as const,
      levelMm: lv, spanIndex: 0, x0: sg.postXs[0], x1: sg.postXs[sg.postXs.length - 1],
    })),
  ];

  it('列全幅の自動部材を持つビューは作り直し対象', () => {
    expect(hasLegacyFullWidthParts(legacyParts, bundle.geom)).toBe(true);
  });

  it('作り直した後は対象外＝再入しない（1 回で収束する）', () => {
    expect(hasLegacyFullWidthParts(bundle.parts, bundle.geom)).toBe(false);
    // 「検出 → 作り直し → 再判定」を繰り返しても 2 回目以降は走らない
    let parts = legacyParts as typeof bundle.parts;
    let runs = 0;
    for (let i = 0; i < 5; i++) {
      if (!hasLegacyFullWidthParts(parts, bundle.geom)) break;
      parts = bundle.parts;   // 作り直し（現在の平面から再生成した結果に相当）
      runs++;
    }
    expect(runs).toBe(1);
  });

  it('手で動かした部材・編集差分があるビューは触らない（勝手に失わない）', () => {
    const withManual = legacyParts.map((p, i) => (i === 0 ? { ...p, origin: 'manual' as const } : p));
    expect(hasLegacyFullWidthParts(withManual, bundle.geom)).toBe(false);
    expect(hasLegacyFullWidthParts(legacyParts, bundle.geom, true)).toBe(false);
  });

  it('parts / geom が無いビューでは判定しない（従来どおり parts 生成に任せる）', () => {
    expect(hasLegacyFullWidthParts(undefined, bundle.geom)).toBe(false);
    expect(hasLegacyFullWidthParts(bundle.parts, undefined)).toBe(false);
    expect(hasLegacyFullWidthParts([], bundle.geom)).toBe(false);
  });
});

describe('プレビューと配置は同じ部材 emitter を使う', () => {
  const modal = fs.readFileSync(
    path.resolve(__dirname, '../../../../components/elevation/ElevationModal.tsx'), 'utf8');

  it('ElevationModal は partsToPrimitives 経由で部材を描く', () => {
    expect(modal).toContain('partsToPrimitives');
    expect(modal).toContain('faceElevationToParts');
  });

  it('ElevationModal に部材の独自描画が復活していない', () => {
    // 二重実装に戻ると、プレビューにだけ古い姿（丸ハンドル・全幅手摺）が残る。
    for (const forbidden of ['const railLine', 'const boardLine', 'const postLine', 'insetRange(']) {
      expect(modal.includes(forbidden), `ElevationModal に ${forbidden} が復活している`).toBe(false);
    }
  });
});
