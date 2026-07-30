// ============================================================
// E-8-v2e: 作り直したときに手当てが引き継がれるか。
// 「はまる場所にしかはまらない」ので、引き継ぎも位置ではなく意味（種類＋番号＋高さ）で行う。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry, ElevationPartsBundle } from '../elevationParts';
import { partsToPrimitives } from '../elevationParts';
import { rematchElevationParts, partSlotKey, describePart } from '../elevationPartsRematch';

/** スパン数 n の足場 1 連（レベルは 0/1700、コマは 450 刻み）。 */
const geom = (spans: number): ElevationPartGeometry => ({
  minXg: 0,
  scaffolds: [{
    postXs: Array.from({ length: spans + 1 }, (_, i) => i * 180),
    jackTopMm: 150,
    topRailMm: 2600,
    levelsMm: [0, 1700],
    komaGridMm: [450, 900, 1350, 2150, 2600],
  }],
});

const auto = (kind: ElevationPart['kind'], over: Partial<ElevationPart>): ElevationPart => ({
  id: `auto:${kind}:${over.spanIndex ?? over.postIndex}:${over.levelMm ?? '-'}`,
  kind, scaffoldIndex: 0, origin: 'auto', ...over,
});

/** スパン数 n の自動束（board を全スパン×全レベルに敷いただけの最小構成）。 */
const bundle = (spans: number): ElevationPartsBundle => {
  const g = geom(spans);
  const parts: ElevationPart[] = [];
  for (let s = 0; s < spans; s++) {
    for (const lv of [0, 1700]) {
      parts.push(auto('board', {
        spanIndex: s, levelMm: lv, x0: s * 180, x1: (s + 1) * 180,
      }));
    }
  }
  return { parts, geom: g };
};

describe('rematchElevationParts', () => {
  it('手当てが無ければ新しい自動部材をそのまま使う', () => {
    const next = bundle(3);
    const r = rematchElevationParts([], next);
    expect(r.parts).toEqual(next.parts);
    expect(r.orphans).toEqual([]);
  });

  it('手動で足した部材は同じ意味の場所に残る', () => {
    const manual: ElevationPart = {
      id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 1, levelMm: 900, x0: 180, x1: 360,
    };
    const r = rematchElevationParts([...bundle(3).parts, manual], bundle(3));
    const kept = r.parts.find((p) => p.id === 'manual:rail:1');
    expect(kept).toBeTruthy();
    expect([kept!.spanIndex, kept!.levelMm]).toEqual([1, 900]);
    expect(r.orphans).toEqual([]);
  });

  it('スパンが減って置き場所が消えた手動部材は孤立に回す（勝手に別の場所へ移さない）', () => {
    const manual: ElevationPart = {
      id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 2, levelMm: 900, x0: 360, x1: 540,
    };
    const r = rematchElevationParts([...bundle(3).parts, manual], bundle(2));
    expect(r.parts.some((p) => p.id === 'manual:rail:1')).toBe(false);
    expect(r.orphans.map((p) => p.id)).toEqual(['manual:rail:1']);
  });

  it('削除した自動部材（墓標）は作り直してもぶり返さない', () => {
    const prev = bundle(3).parts.map((p) => (
      p.spanIndex === 1 && p.levelMm === 0
        ? { ...p, origin: 'manual' as const, removed: true }
        : p));
    const r = rematchElevationParts(prev, bundle(3));
    const alive = r.parts.filter((p) => !p.removed);
    expect(alive.some((p) => p.kind === 'board' && p.spanIndex === 1 && p.levelMm === 0)).toBe(false);
    // 墓標そのものは意味データとして残る（描画はされない）
    expect(r.parts.some((p) => p.removed)).toBe(true);
    expect(partsToPrimitives({ parts: r.parts, geom: geom(3) })
      .some((p) => p.kind === 'line' && p.x1 === 180 && p.y1 === 0)).toBe(false);
  });

  it('墓標の置き場所ごと消えたら孤立に回る（同じ場所の自動部材は復活する）', () => {
    const prev = bundle(3).parts.map((p) => (
      p.spanIndex === 2 && p.levelMm === 0
        ? { ...p, origin: 'manual' as const, removed: true }
        : p));
    const r = rematchElevationParts(prev, bundle(2));
    expect(r.parts.some((p) => p.removed)).toBe(false);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].removed).toBe(true);
  });

  it('引き継いだ部材の描画レンジは新しい幾何から引き直す', () => {
    const manual: ElevationPart = {
      id: 'manual:board:1', kind: 'board', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 0, levelMm: 0, x0: 0, x1: 180,
    };
    const wide: ElevationPartsBundle = {
      parts: [], geom: { minXg: 0, scaffolds: [{ ...geom(1).scaffolds[0], postXs: [0, 300] }] },
    };
    const r = rematchElevationParts([manual], wide);
    const kept = r.parts.find((p) => p.id === 'manual:board:1');
    expect([kept!.x0, kept!.x1]).toEqual([0, 300]);
  });

  it('手動部材と同じ場所の自動部材は二重に置かない', () => {
    const manual: ElevationPart = {
      id: 'manual:board:1', kind: 'board', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 0, levelMm: 0, x0: 0, x1: 180,
    };
    const r = rematchElevationParts([manual], bundle(3));
    const here = r.parts.filter((p) => p.kind === 'board' && p.spanIndex === 0 && p.levelMm === 0);
    expect(here).toHaveLength(1);
    expect(here[0].id).toBe('manual:board:1');
  });

  it('支柱は支柱番号で照合する（スパン番号ではない）', () => {
    const manual: ElevationPart = {
      id: 'manual:post:1', kind: 'post', scaffoldIndex: 0, origin: 'manual', postIndex: 3,
    };
    expect(rematchElevationParts([manual], bundle(3)).parts.some((p) => p.id === 'manual:post:1')).toBe(true);
    // スパン 2 連 → 支柱は 0..2 しかないので置き場所が無い
    expect(rematchElevationParts([manual], bundle(2)).orphans.map((p) => p.id)).toEqual(['manual:post:1']);
  });

  it('別の足場連の同じ番号は別の場所として扱う', () => {
    const a = partSlotKey({ kind: 'board', scaffoldIndex: 0, spanIndex: 1, levelMm: 0 });
    const b = partSlotKey({ kind: 'board', scaffoldIndex: 1, spanIndex: 1, levelMm: 0 });
    expect(a).not.toBe(b);
  });

  it('孤立部材は人が読める説明になる', () => {
    expect(describePart({
      id: 'x', kind: 'rail', scaffoldIndex: 0, origin: 'manual', spanIndex: 1, levelMm: 900,
    })).toContain('スパン2');
    expect(describePart({
      id: 'y', kind: 'board', scaffoldIndex: 0, origin: 'manual', spanIndex: 0, levelMm: 0, removed: true,
    })).toContain('削除');
  });
});
