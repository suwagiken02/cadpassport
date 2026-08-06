import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { partsToPrimitives } from '../elevationParts';
import { ELEV_PART_COLORS, ELEV_PART_STYLE } from '../elevationPartStyle';
import {
  PALETTE_KINDS, buildElevationSlots, nextPartId,
} from '../elevationSlots';
import { postStackTopMm } from '../elevationParts';

// ============================================================
// E-8-v2c: 吸着スロット。「はまる場所にしかはまらない」を担保する有効位置。
//   支柱 4 本 = スパン 3 つ。作業床 1100/2900/4700、コマ 150/600/…（450 刻み）。
// E-8-v2g: 縦位置はコマ列が基準。踏板・筋交は「作業床の高さ ∪ コマ列」で、
//   自動生成の床（1800 ピッチでコマ列に乗らない）を保ったままコマ全段へ置ける。
// ============================================================
const geom: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360, 540],
    jackTopMm: 150,
    topRailMm: 6500,
    levelsMm: [1100, 2900, 4700],
    komaGridMm: [150, 600, 1050, 1500, 1950, 2400, 2850],
  }],
};
/** 踏板が使う縦位置（作業床 ∪ コマ）の本数。 */
const BOARD_LEVELS = 10; // 150,600,1050,1100,1500,1950,2400,2850,2900,4700
const boardSlot = (spanIndex: number, levelMm: number) =>
  buildElevationSlots(geom, 'board').find((s) => s.spanIndex === spanIndex && s.levelMm === levelMm)!;

describe('buildElevationSlots', () => {
  it('支柱・ジャッキは支柱位置ごと（縦位置は持たない）', () => {
    const posts = buildElevationSlots(geom, 'post');
    expect(posts).toHaveLength(4);
    expect(posts.map((s) => s.postIndex)).toEqual([0, 1, 2, 3]);
    expect(posts.every((s) => s.levelMm === undefined && s.x0 === s.x1)).toBe(true);
    expect(buildElevationSlots(geom, 'jack')).toHaveLength(4);
  });

  it('踏板はスパン × (作業床の高さ ∪ コマ列)', () => {
    const boards = buildElevationSlots(geom, 'board');
    expect(boards).toHaveLength(3 * BOARD_LEVELS);
    // 自動生成の作業床（コマ列に乗らない 1100）も、コマ（150 など）もどちらも置ける
    expect(boardSlot(0, 1100)).toMatchObject({ x0: 0, x1: 180 });
    expect(boardSlot(0, 150)).toBeDefined();
    const levels = Array.from(new Set(boards.map((s) => s.levelMm)));
    expect(levels).toEqual([...levels].sort((a, b) => a! - b!)); // 昇順
  });

  it('手摺はスパン × 450 刻みのコマ位置', () => {
    const rails = buildElevationSlots(geom, 'rail');
    expect(rails).toHaveLength(3 * 7);
    expect(new Set(rails.map((s) => s.levelMm))).toEqual(new Set(geom.scaffolds[0].komaGridMm));
  });

  it('筋交も踏板と同じ縦位置', () => {
    expect(buildElevationSlots(geom, 'brace')).toHaveLength(3 * BOARD_LEVELS);
  });

  it('パレットは 支柱/手摺/踏板/ジャッキ/筋交 の 5 種', () => {
    expect(PALETTE_KINDS).toEqual(['post', 'rail', 'board', 'jack', 'brace']);
  });

  // ============================================================
  // E-8-v2n: 既存足場の外側へ、足場の文法（スパン 1800 ピッチ・コマ 450 刻み）を延長する。
  // 実機: 既存足場の右外へ手摺を持って行っても吸着せず置けなかった＝平面のような自由さが無い。
  // ============================================================
  describe('extend: 既存足場の外側へ延長した仮想グリッド', () => {
    const sg = geom.scaffolds[0];
    const lastPost = sg.postXs.length - 1;              // 3（x=540）
    const ext = { extend: true } as const;

    it('右外 1 スパン目は端の支柱から標準スパン 1800mm(=180グリッド) 先', () => {
      const rails = buildElevationSlots(geom, 'rail', ext);
      const outer = rails.find((s) => s.spanIndex === lastPost);   // 支柱3→仮想支柱4
      expect(outer).toBeDefined();
      expect([outer!.x0, outer!.x1]).toEqual([540, 720]);
      expect(outer!.virtual).toBe(true);
    });

    it('左外 1 スパン目は端の支柱から 180 手前', () => {
      const outer = buildElevationSlots(geom, 'rail', ext).find((s) => s.spanIndex === -1);
      expect([outer!.x0, outer!.x1]).toEqual([-180, 0]);
      expect(outer!.virtual).toBe(true);
    });

    it('支柱・ジャッキも仮想位置に置ける（両外側へ 3 本ずつ）', () => {
      // E-8-v2r: 支柱には継ぎ足し先（levelMm つき）も出るので、足元〜天端の 1 本ぶんで見る
      const posts = buildElevationSlots(geom, 'post', ext).filter((s) => s.levelMm == null);
      expect(posts.map((s) => s.postIndex)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
      expect(posts.find((s) => s.postIndex === 6)!.x0).toBe(540 + 180 * 3);
      expect(posts.find((s) => s.postIndex === -3)!.x0).toBe(0 - 180 * 3);
      // 実在の支柱は仮想ではない
      expect(posts.filter((s) => !s.virtual).map((s) => s.postIndex)).toEqual([0, 1, 2, 3]);
    });

    it('上方向はコマ列を 450 刻みで延長する（天端の上にも掛けられる）', () => {
      const levels = Array.from(new Set(
        buildElevationSlots(geom, 'rail', ext).map((s) => s.levelMm))).sort((a, b) => a! - b!);
      const topKoma = Math.max(...sg.komaGridMm);        // 2850
      expect(levels).toContain(topKoma + 450);
      // E-8-v2t: まず支柱の実際の頭まで伸び、そこから仮想延長 3 コマ
      const ceiling = postStackTopMm(sg);
      expect(levels).toContain(ceiling + 450 * 3);
      expect(levels).not.toContain(ceiling + 450 * 4); // 実用範囲で止める
    });

    it('下方向は GL より下へは出さない', () => {
      const levels = buildElevationSlots(geom, 'rail', ext).map((s) => s.levelMm!);
      expect(Math.min(...levels)).toBeGreaterThan(0);
    });

    it('既定（extend なし）は実在のスロットだけ＝再マッチの孤立判定は変わらない', () => {
      expect(buildElevationSlots(geom, 'rail')).toHaveLength(3 * 7);
      expect(buildElevationSlots(geom, 'rail').every((s) => !s.virtual)).toBe(true);
    });
  });

  it('幅はスパン幅から自動（部材側で長さを指定しない）', () => {
    const boards = buildElevationSlots(geom, 'board');
    for (const s of boards) expect(s.x1 - s.x0).toBe(180);
  });
});

describe('継ぎ足しの候補 / id 採番', () => {

  // ============================================================
  // E-8-v2r: 支柱を既存支柱の天端に継ぎ足す（ジョイント継ぎ）。
  // 支柱は縦位置を持たない設計だったため、上へ積む先が吸着候補に無かった。
  // ============================================================
  describe('支柱の継ぎ足し（天端の上へ積む）', () => {
    const ext = { extend: true } as const;
    const sg = geom.scaffolds[0];
    const stackSlots = buildElevationSlots(geom, 'post', ext)
      .filter((s) => s.postIndex === 1 && s.levelMm != null);
    /** 規格部材を積み上げた実際の頭。天端(topRailMm)ではない (= E-8-v2s)。 */
    const head = postStackTopMm(sg);

    it('候補の基準は「実際の頭」で、そこから 450 刻み（levelMm ＝ 部材の下端）', () => {
      expect(stackSlots[0].levelMm).toBe(head);
      expect(stackSlots.map((s) => s.levelMm))
        .toEqual(Array.from({ length: 9 }, (_, k) => head + 450 * k));
      expect(stackSlots.every((s) => s.virtual)).toBe(true);
      expect(stackSlots.every((s) => s.x0 === s.x1 && s.x0 === sg.postXs[1])).toBe(true);
    });

    it('ジャッキは足元の部材なので継ぎ足し先を持たない', () => {
      expect(buildElevationSlots(geom, 'jack', ext).every((s) => s.levelMm == null)).toBe(true);
    });

    it('拡張なしでは従来どおり候補に出ない（再マッチの判定は変えない）', () => {
      expect(buildElevationSlots(geom, 'post').every((s) => s.levelMm == null)).toBe(true);
    });

    it('継ぎ足した部材の天も候補なので、その上へさらに継げる', () => {
      const levels = stackSlots.map((s) => s.levelMm);
      expect(levels).toContain(head + 450 * 4);   // 4 コマ品を載せた天
      expect(levels).toContain(head + 450 * 8);   // 8 コマ品を載せた天
    });

    it('置いた部材は「下端＝頭」で描かれ、接合点に継ぎ目が出る', () => {
      // 頭がちょうど 5000 になる足場（皿 50＋450×11＝5000）で座標を固定する
      const g5000: ElevationPartGeometry = {
        minXg: 0,
        scaffolds: [{
          postXs: [0, 180], jackTopMm: 50, topRailMm: 5000,
          levelsMm: [1400, 3200, 5000],
          komaGridMm: Array.from({ length: 11 }, (_, k) => 300 + 450 * k),
        }],
      };
      expect(postStackTopMm(g5000.scaffolds[0])).toBe(5000);
      const slot = buildElevationSlots(g5000, 'post', ext)
        .find((s) => s.postIndex === 1 && s.levelMm === 5000)!;
      const moved: ElevationPart = {
        id: 'post:0:1:1', kind: 'post', scaffoldIndex: 0, origin: 'manual',
        postIndex: slot.postIndex, levelMm: slot.levelMm, komaCount: 6,
      };
      expect(moved).toMatchObject({ kind: 'post', postIndex: 1, levelMm: 5000, komaCount: 6 });

      const prims = partsToPrimitives({ geom: g5000, parts: [moved] });
      const bar = prims.find((p) => p.kind === 'line' && p.x1 === p.x2 && p.stroke === ELEV_PART_COLORS.post);
      if (!bar || bar.kind !== 'line') throw new Error('支柱の棒が無い');
      // 下端＝5000（＝既存の頭）、上端＝5000＋450×6（ローカル y は -mm/10）
      expect(bar.y1).toBe(-500);
      expect(bar.y2).toBe(-(5000 + 450 * 6) / 10);
      // E-8-v2u: 下端はホゾ（オス・細い）＝下の支柱の受けへ差し込む形で出る
      const spigot = prims.find((p) => p.kind === 'line' && p.x1 === p.x2
        && p.stroke === ELEV_PART_COLORS.joint
        && p.widthGrid === ELEV_PART_STYLE.jointSpigotGrid);
      if (!spigot || spigot.kind !== 'line') throw new Error('ホゾが無い');
      expect(spigot.y1).toBe(-500);                                    // 接合点＝既存の頭
      expect(spigot.y2).toBe(-500 + ELEV_PART_STYLE.jointSpigotLenGrid);
      // 上端は受け（メス）。さらに上へ継げることが見える
      const cup = prims.find((p) => p.kind === 'line' && p.x1 === p.x2
        && p.stroke === ELEV_PART_COLORS.joint
        && p.widthGrid === ELEV_PART_STYLE.jointCupGrid);
      expect(cup && cup.kind === 'line' && cup.y1).toBeCloseTo(-(5000 + 450 * 6) / 10);
      // 丸（座）は足元だけなので、継ぎ足した部材には出ない
      expect(prims.filter((p) => p.kind === 'circle')).toHaveLength(0);
    });
  });

  // ============================================================
  // E-8-v2t: 手摺・踏板のコマ候補は「そのスパンの支柱が実際どこまで伸びているか」に追従する。
  // 支柱を継ぎ足したのに手摺が元の天端+3 コマで頭打ちだった（鮎澤氏）。
  // ============================================================
  describe('手摺のコマ候補が継ぎ足した支柱に追従する', () => {
    const ext = { extend: true } as const;
    const sg = geom.scaffolds[0];
    const head = postStackTopMm(sg);
    /** 支柱位置 1 に 6 コマ品(2700mm)を継ぎ足した状態。 */
    const stacked: ElevationPart = {
      id: 'manual:post:1', kind: 'post', scaffoldIndex: 0, origin: 'manual',
      postIndex: 1, levelMm: head, komaCount: 6,
    };
    const railTop = (parts?: ElevationPart[], spanIndex = 0) => Math.max(
      ...buildElevationSlots(geom, 'rail', { ...ext, parts })
        .filter((s) => s.spanIndex === spanIndex)
        .map((s) => s.levelMm!));

    it('継ぎ足す前は「支柱の頭＋仮想 3 コマ」で頭打ち', () => {
      expect(railTop()).toBe(head + 450 * 3);
    });

    it('継ぎ足すと、その部材の天まで候補が伸びる（＋仮想 3 コマ）', () => {
      const top = railTop([stacked]);
      expect(top).toBe(head + 450 * 6 + 450 * 3);
      // 継ぎ足した部材のコマ（下端から 250/450 刻み）と同じ 450 格子に乗る
      const levels = buildElevationSlots(geom, 'rail', { ...ext, parts: [stacked] })
        .filter((s) => s.spanIndex === 0).map((s) => s.levelMm!);
      expect(levels).toContain(head + 450);
      expect(levels).toContain(head + 450 * 6);
    });

    it('隣のスパンにも効く（支柱 1 は spanIndex 0 と 1 の共有支柱）', () => {
      expect(railTop([stacked], 1)).toBe(head + 450 * 6 + 450 * 3);
      // 支柱 1 に接していないスパンは伸びない
      expect(railTop([stacked], 2)).toBe(head + 450 * 3);
    });

    it('支柱を削除したら候補も縮む', () => {
      // 墓標（removed）は立っていない扱い
      expect(railTop([{ ...stacked, removed: true }])).toBe(head + 450 * 3);
      // 部材ごと取り除いても同じ
      expect(railTop([])).toBe(head + 450 * 3);
    });

    it('parts を渡さない経路（再マッチ等）は従来どおり', () => {
      expect(buildElevationSlots(geom, 'rail').every((s) => s.levelMm! <= head)).toBe(true);
    });

    it('踏板も同じ上限に追従する', () => {
      const boardTop = (parts?: ElevationPart[]) => Math.max(
        ...buildElevationSlots(geom, 'board', { ...ext, parts })
          .filter((s) => s.spanIndex === 0).map((s) => s.levelMm!));
      expect(boardTop([stacked])).toBe(head + 450 * 6 + 450 * 3);
      expect(boardTop([stacked])).toBeGreaterThan(boardTop());
    });
  });

  it('id は種類ごとの連番で衝突しない', () => {
    const parts: ElevationPart[] = [{ id: 'manual:board:1', kind: 'board', scaffoldIndex: 0, origin: 'manual' }];
    expect(nextPartId(parts, 'board')).toBe('manual:board:2');
    expect(nextPartId(parts, 'post')).toBe('manual:post:1');
  });
});
