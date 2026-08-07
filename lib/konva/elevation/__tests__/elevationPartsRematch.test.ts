// ============================================================
// E-8-v2e: 作り直したときに手当てが引き継がれるか。
//
// E-8-v3f で引き継ぎの判定を 2 段構えにした:
//   ・番号（spanIndex/postIndex＋levelMm）で見つかれば、その場所へ（旧世代）
//   ・見つからなくても、新しい足場の範囲に掛かっていれば座標そのままで残す
// 孤立に回すのは「その面の足場ごと消えた」「完全に範囲外へ出た」ときだけ
// （鮎澤氏の判断＝「残す」。場所が不自然でも見えていれば手で直せる）。
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

  // E-8-v3f: 以前は「番号の置き場所が消えた＝孤立」だった。今は範囲に掛かっていれば残す。
  it('スパンが減っても、範囲に掛かっている手動部材は残る（勝手に別の場所へ移さない）', () => {
    const manual: ElevationPart = {
      id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 2, levelMm: 900, x0: 360, x1: 540,
    };
    const r = rematchElevationParts([...bundle(3).parts, manual], bundle(2));
    const kept = r.parts.find((p) => p.id === 'manual:rail:1');
    expect(kept).toBeTruthy();
    expect(r.orphans).toEqual([]);
    // 座標は動かさない（隣のスパンへ勝手に付け替えない）
    expect([kept!.x0, kept!.x1]).toEqual([360, 540]);
    expect(kept!.levelMm).toBe(900);
  });

  // E-8-v4a: 足場ゼロの面も「部材を置いてよい面」になったので、
  // 足場が消えただけでは孤立にしない（座標を持っていれば残す）。
  it('足場が 1 連も無くなっても、座標を持つ部材は残る', () => {
    const manual: ElevationPart = {
      id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 2, levelMm: 900, x0: 360, x1: 540,
    };
    const gone: ElevationPartsBundle = { parts: [], geom: { minXg: 0, scaffolds: [] } };
    const r = rematchElevationParts([manual], gone);
    expect(r.orphans).toEqual([]);
    expect(r.parts.map((p) => p.id)).toEqual(['manual:rail:1']);
  });

  it('座標を引けない部材は孤立に回す（描きようが無い）', () => {
    // 番号しか持たない旧データ＋足場ゼロ＝位置が決まらない
    const noCoords: ElevationPart = {
      id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
      spanIndex: 2, levelMm: 900,
    };
    const gone: ElevationPartsBundle = { parts: [], geom: { minXg: 0, scaffolds: [] } };
    const r = rematchElevationParts([noCoords], gone);
    expect(r.parts).toHaveLength(0);
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

  // E-8-v3f: 墓標も「範囲に掛かっていれば残す」に揃えた。建物が伸び縮みしても
  // 「消した」という意思が生き続ける（描画はされないので邪魔にならない）。
  it('スパンが減っても墓標は残る（描かれない）', () => {
    const prev = bundle(3).parts.map((p) => (
      p.spanIndex === 2 && p.levelMm === 0
        ? { ...p, origin: 'manual' as const, removed: true }
        : p));
    const r = rematchElevationParts(prev, bundle(2));
    expect(r.orphans).toEqual([]);
    const tomb = r.parts.find((p) => p.removed);
    expect(tomb).toBeTruthy();
    expect(partsToPrimitives({ parts: [tomb!], geom: geom(2) })).toEqual([]);
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
    // E-8-v3f: スパン 2 連（支柱 0..2）でも、仮想グリッドの範囲内なので残す
    const shrunk = rematchElevationParts([manual], bundle(2));
    expect(shrunk.parts.some((p) => p.id === 'manual:post:1')).toBe(true);
    expect(shrunk.orphans).toEqual([]);
  });

  it('別の足場連の同じ番号は別の場所として扱う', () => {
    const a = partSlotKey({ kind: 'board', scaffoldIndex: 0, spanIndex: 1, levelMm: 0 });
    const b = partSlotKey({ kind: 'board', scaffoldIndex: 1, spanIndex: 1, levelMm: 0 });
    expect(a).not.toBe(b);
  });

  it('別の足場連が消えたら、その連の部材は孤立に回る', () => {
    const onSecond: ElevationPart = {
      id: 'manual:rail:2', kind: 'rail', scaffoldIndex: 1, origin: 'manual',
      spanIndex: 0, levelMm: 900, x0: 0, x1: 180,
    };
    const r = rematchElevationParts([onSecond], bundle(3));   // 足場は 1 連しかない
    expect(r.orphans.map((p) => p.id)).toEqual(['manual:rail:2']);
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
