// ============================================================
// E-8-v4a(レベル1): 自動生成の足場が無い面でも部材を置ける・見える・残る。
//
// v3 の思想は「自由＋接合吸着」なのに、実際は足場のある面でしか部材を置けなかった。
// 調べると、置く・吸着する・保存するところは足場ゼロでも動いていて、
// partsToPrimitives が `if (!sg) continue` で落としていた＝**見えないだけ**だった。
//
// ここで固定するのは 3 つ:
//   1. 足場があるときの出力が 1 ミリも変わらないこと（回帰防止の本丸）
//   2. 足場が無くても、部材が自分の座標で描かれること
//   3. 足場が無い面でも、作り直しで部材が消えないこと
//      （これを外すと「置けるが再生成で消える」＝ E-8-v3d-check の再来）
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { newElevationPart, partsToPrimitives } from '../elevationParts';
import { rematchElevationParts } from '../elevationPartsRematch';

/** 足場のある面（支柱 4 本＝スパン 3 つ）。 */
const withScaffold: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360, 540],
    jackTopMm: 150,
    topRailMm: 6500,
    levelsMm: [1100, 2900, 4700],
    komaGridMm: [150, 600, 1050, 1500, 1950, 2400, 2850],
  }],
};

/** 足場のない面（建物だけ描いて足場を置いていない面）。 */
const noScaffold: ElevationPartGeometry = { minXg: 0, scaffolds: [] };

/** パレットから置いた部材（自由座標を持つ）。 */
const palette = (kind: ElevationPart['kind'], opts?: { komaCount?: number; sizeMm?: number }) =>
  newElevationPart(kind, `manual:${kind}:1`, 0, { xMm: 900, yMm: 1500 }, opts);

// ------------------------------------------------------------
// 1. 足場があるときの出力は変えない。
//    自動生成部材（座標も高さも足場から引く）が、この変更の影響を受けないこと。
// ------------------------------------------------------------
describe('足場があるときの描画は一切変わらない', () => {
  /** 自動生成に出てくる形をひととおり（支柱は段・継ぎ足し、踏板・手摺・ジャッキ・嵩上げ）。 */
  const autoParts: ElevationPart[] = [
    { id: 'board:0:1100:0', kind: 'board', scaffoldIndex: 0, origin: 'auto', spanIndex: 0, levelMm: 1100, x0: 0, x1: 180 },
    { id: 'rail:0:1500:180', kind: 'rail', scaffoldIndex: 0, origin: 'auto', spanIndex: 1, levelMm: 1500, x0: 180, x1: 360 },
    { id: 'post:0:1:0', kind: 'post', scaffoldIndex: 0, origin: 'auto', postIndex: 1, segmentIndex: 0 },
    { id: 'post:0:1:1', kind: 'post', scaffoldIndex: 0, origin: 'auto', postIndex: 1, segmentIndex: 1 },
    { id: 'post:0:2', kind: 'post', scaffoldIndex: 0, origin: 'auto', postIndex: 2 },
    { id: 'jack:0:1', kind: 'jack', scaffoldIndex: 0, origin: 'auto', postIndex: 1 },
    { id: 'postExt:0:180', kind: 'postExt', scaffoldIndex: 0, origin: 'auto', levelMm: 7400, x0: 180, x1: 180 },
    { id: 'raise:0:1:mid0:board', kind: 'raiseBoard', scaffoldIndex: 0, origin: 'auto', spanIndex: 1, levelMm: 3200, x0: 180, x1: 360 },
    { id: 'raise:0:1:mid0:rail', kind: 'raiseRail', scaffoldIndex: 0, origin: 'auto', spanIndex: 1, levelMm: 3200, railOffsetMm: 900, x0: 180, x1: 360 },
  ];

  it('自動生成部材の出力（スナップショット）', () => {
    expect(partsToPrimitives({ geom: withScaffold, parts: autoParts })).toMatchSnapshot();
  });

  it('手動部材（足場あり）の出力（スナップショット）', () => {
    const manual: ElevationPart[] = [
      palette('rail'), palette('board'), palette('brace'),
      palette('post', { komaCount: 4 }), palette('jack'),
    ];
    expect(partsToPrimitives({ geom: withScaffold, parts: manual })).toMatchSnapshot();
  });

  it('墓標は描かない（従来どおり）', () => {
    const tomb: ElevationPart = { ...autoParts[0], origin: 'manual', removed: true };
    expect(partsToPrimitives({ geom: withScaffold, parts: [tomb] })).toEqual([]);
  });

  it('座標も足場も無い部材は描かない（従来どおり落とす）', () => {
    // spanIndex しか持たない旧データで、足場が消えた面 → レンジを引けない
    const stale: ElevationPart = {
      id: 'x', kind: 'rail', scaffoldIndex: 0, origin: 'manual', spanIndex: 1, levelMm: 1500,
    };
    expect(partsToPrimitives({ geom: noScaffold, parts: [stale] })).toEqual([]);
  });
});

// ------------------------------------------------------------
// 2. 足場が無くても、部材は自分の座標で描かれる。
// ------------------------------------------------------------
describe('足場が無くても部材が描かれる', () => {
  it('パレットの 5 種すべてがプリミティブを出す', () => {
    for (const kind of ['rail', 'board', 'brace', 'post', 'jack'] as const) {
      const p = kind === 'post' ? palette('post', { komaCount: 4 }) : palette(kind);
      const prims = partsToPrimitives({ geom: noScaffold, parts: [p] });
      expect(prims.length, kind).toBeGreaterThan(0);
    }
  });

  it('手摺は足場ありと同じ位置・同じ形で描かれる（足場に依存しない部材）', () => {
    const p = palette('rail');
    expect(partsToPrimitives({ geom: noScaffold, parts: [p] }))
      .toEqual(partsToPrimitives({ geom: withScaffold, parts: [p] }));
  });

  it('踏板・筋交も足場ありと同じ', () => {
    for (const kind of ['board', 'brace'] as const) {
      const p = palette(kind);
      expect(partsToPrimitives({ geom: noScaffold, parts: [p] }), kind)
        .toEqual(partsToPrimitives({ geom: withScaffold, parts: [p] }));
    }
  });

  it('支柱は下端＝levelMm・長さ＝komaCount で描かれる', () => {
    const p = palette('post', { komaCount: 4 });
    const bar = partsToPrimitives({ geom: noScaffold, parts: [p] })
      .find((q) => q.kind === 'line' && q.x1 === q.x2);
    if (!bar || bar.kind !== 'line') throw new Error('支柱の棒が無い');
    expect(bar.y1).toBeCloseTo(-1500 / 10);                 // 下端＝置いた高さ
    expect(bar.y2).toBeCloseTo(-(1500 + 450 * 4) / 10);     // 上端＝4 コマぶん上
  });

  it('支柱のコマ（連鎖の目印）が描かれる', () => {
    const p = palette('post', { komaCount: 4 });
    const noSg = partsToPrimitives({ geom: noScaffold, parts: [p] });
    const withSg = partsToPrimitives({ geom: withScaffold, parts: [p] });
    // コマは短い横線。足場の有無で本数が変わらない＝連鎖の目印が消えない
    const komaCount = (prims: typeof noSg) =>
      prims.filter((q) => q.kind === 'line' && q.y1 === q.y2).length;
    expect(komaCount(noSg)).toBeGreaterThan(0);
    expect(komaCount(noSg)).toBe(komaCount(withSg));
  });

  it('ジャッキは levelMm(上端) から地面まで描かれる', () => {
    const prims = partsToPrimitives({ geom: noScaffold, parts: [palette('jack')] });
    expect(prims.length).toBeGreaterThan(0);
  });

  it('自動生成専用の postExt は足場が無ければ描かない（従来どおり）', () => {
    const ext: ElevationPart = {
      id: 'postExt:0:180', kind: 'postExt', scaffoldIndex: 0, origin: 'auto',
      levelMm: 7400, x0: 180, x1: 180,
    };
    expect(partsToPrimitives({ geom: noScaffold, parts: [ext] })).toEqual([]);
  });
});

// ------------------------------------------------------------
// 3. 足場が無い面でも、作り直しで消えない。
//    （E-8-v3f の withinScaffold は「足場が無ければ孤立」だったので追随が要る）
// ------------------------------------------------------------
describe('足場が無い面でも作り直しで消えない', () => {
  const emptyBundle = { parts: [] as ElevationPart[], geom: noScaffold };

  it('足場ゼロの面に置いた部材は引き継がれる', () => {
    const r = rematchElevationParts([palette('rail')], emptyBundle);
    expect(r.orphans).toHaveLength(0);
    expect(r.parts.map((p) => p.id)).toContain('manual:rail:1');
  });

  it('座標はそのまま（勝手に動かさない）', () => {
    const kept = rematchElevationParts([palette('rail')], emptyBundle).parts[0];
    expect(kept).toMatchObject({ x0Mm: 0, x1Mm: 1800, levelMm: 1500 });
  });

  it('足場を組んだ後に作り直しても消えない（足場ゼロ → あり）', () => {
    const r = rematchElevationParts([palette('rail')], { parts: [], geom: withScaffold });
    expect(r.orphans).toHaveLength(0);
  });

  it('足場を消した後に作り直しても消えない（足場あり → ゼロ）', () => {
    const onScaffold = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 2700, yMm: 1500 });
    const r = rematchElevationParts([onScaffold], emptyBundle);
    expect(r.orphans).toHaveLength(0);
    expect(r.parts.map((p) => p.id)).toContain('manual:rail:1');
  });

  it('連鎖して置いた 5 本がまとめて残る', () => {
    const chain = Array.from({ length: 5 }, (_, i) =>
      newElevationPart('rail', `manual:rail:${i + 1}`, 0, { xMm: 900 + i * 1800, yMm: 1500 }));
    const r = rematchElevationParts(chain, emptyBundle);
    expect(r.orphans).toEqual([]);
    expect(r.parts).toHaveLength(5);
  });
});
