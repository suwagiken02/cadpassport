import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import {
  PALETTE_KINDS, buildElevationSlots, neighborSlot, nextPartId, slotAnchor, slotKey,
  slotOccupied, slotToPart, snapToSlot,
} from '../elevationSlots';

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
      const posts = buildElevationSlots(geom, 'post', ext);
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
      expect(levels).toContain(topKoma + 450 * 3);
      expect(levels).not.toContain(topKoma + 450 * 4);   // 実用範囲で止める
    });

    it('下方向は GL より下へは出さない', () => {
      const levels = buildElevationSlots(geom, 'rail', ext).map((s) => s.levelMm!);
      expect(Math.min(...levels)).toBeGreaterThan(0);
    });

    it('既定（extend なし）は実在のスロットだけ＝再マッチの孤立判定は変わらない', () => {
      expect(buildElevationSlots(geom, 'rail')).toHaveLength(3 * 7);
      expect(buildElevationSlots(geom, 'rail').every((s) => !s.virtual)).toBe(true);
    });

    it('外側へドラッグすると仮想スパンへ吸着する', () => {
      // 右端(540)の外 700 付近・コマ 1500 のあたりへ落とす
      const snapped = snapToSlot({ x: 700, yMm: 1500 }, geom, 'rail', ext)!;
      expect(snapped.spanIndex).toBe(lastPost);
      expect(snapped.levelMm).toBe(1500);
      expect(snapped.virtual).toBe(true);
      // 拡張しなければ既存の端スパンに留まる（従来の挙動）
      expect(snapToSlot({ x: 700, yMm: 1500 }, geom, 'rail')!.spanIndex).toBe(2);
    });

    it('仮想位置へ置いた部材は通常の ElevationPart として保存できる', () => {
      const slot = buildElevationSlots(geom, 'rail', ext)
        .find((s) => s.spanIndex === lastPost && s.levelMm === 1500)!;
      const part = slotToPart(slot, 'manual:rail:1');
      expect(part).toMatchObject({
        id: 'manual:rail:1', kind: 'rail', scaffoldIndex: 0, origin: 'manual',
        spanIndex: lastPost, levelMm: 1500, x0: 540, x1: 720,
      });
      // 二重置きの判定も仮想位置で効く
      expect(slotOccupied([part], slot)).toBe(true);
      expect(slotOccupied([part], { ...slot, spanIndex: lastPost + 1 })).toBe(false);
    });
  });

  it('幅はスパン幅から自動（部材側で長さを指定しない）', () => {
    const boards = buildElevationSlots(geom, 'board');
    for (const s of boards) expect(s.x1 - s.x0).toBe(180);
  });
});

describe('snapToSlot', () => {
  it('最寄りの有効位置に吸着する（中途半端な位置でも必ずどこかにはまる）', () => {
    // スパン1(180..360)の中央あたり・高さ 2800mm → 最寄りはコマ 2850
    const s = snapToSlot({ x: 270, yMm: 2800 }, geom, 'board')!;
    expect(s.spanIndex).toBe(1);
    expect(s.levelMm).toBe(2850);
  });

  it('手摺はコマ列にだけ吸着する（450 刻み以外へは行かない）', () => {
    const koma = geom.scaffolds[0].komaGridMm;
    for (const yMm of [140, 700, 1900, 2600, 9999]) {
      const s = snapToSlot({ x: 270, yMm }, geom, 'rail')!;
      expect(koma).toContain(s.levelMm);
    }
    expect(snapToSlot({ x: 270, yMm: 1900 }, geom, 'rail')!.levelMm).toBe(1950);
    expect(snapToSlot({ x: 270, yMm: 700 }, geom, 'rail')!.levelMm).toBe(600);
  });

  it('踏板もコマ列へ吸着できる（作業床の高さだけに縛られない）', () => {
    // 1900mm は作業床(1100/2900)より コマ 1950 の方が近い
    expect(snapToSlot({ x: 90, yMm: 1900 }, geom, 'board')!.levelMm).toBe(1950);
    // 作業床ちょうどならその高さのまま
    expect(snapToSlot({ x: 90, yMm: 1100 }, geom, 'board')!.levelMm).toBe(1100);
  });

  it('支柱は横位置だけで決まる', () => {
    const s = snapToSlot({ x: 350, yMm: 3000 }, geom, 'post')!;
    expect(s.postIndex).toBe(2); // x=360 が最寄り
  });

  it('スロットが無い幾何では null', () => {
    expect(snapToSlot({ x: 0, yMm: 0 }, { minXg: 0, scaffolds: [] }, 'board')).toBeNull();
  });

  it('slotAnchor はスパン中央と高さ', () => {
    expect(slotAnchor(boardSlot(0, 1100), geom)).toEqual({ x: 90, y: 1100 });
  });

  it('slotKey は場所が同じなら同じ・違えば違う', () => {
    expect(slotKey(boardSlot(0, 1100))).toBe(slotKey(boardSlot(0, 1100)));
    expect(slotKey(boardSlot(0, 1100))).not.toBe(slotKey(boardSlot(1, 1100)));
    expect(slotKey(boardSlot(0, 1100))).not.toBe(slotKey(boardSlot(0, 1500)));
  });
});

describe('slotToPart / 二重置き防止 / id 採番', () => {
  it('スロットから手動部材を作る（支柱系はレンジを持たない）', () => {
    const board = slotToPart(boardSlot(0, 1100), 'manual:board:1');
    expect(board).toMatchObject({ kind: 'board', origin: 'manual', spanIndex: 0, levelMm: 1100, x0: 0, x1: 180 });
    const post = slotToPart(buildElevationSlots(geom, 'post')[1], 'manual:post:1');
    expect(post).toMatchObject({ kind: 'post', origin: 'manual', postIndex: 1 });
    expect(post.x0).toBeUndefined();
  });

  it('同じ位置に同種があれば occupied', () => {
    const slot = boardSlot(0, 1100);
    const parts: ElevationPart[] = [slotToPart(slot, 'a')];
    expect(slotOccupied(parts, slot)).toBe(true);
    expect(slotOccupied(parts, boardSlot(1, 1100))).toBe(false);
    // 種類が違えば別枠
    expect(slotOccupied(parts, buildElevationSlots(geom, 'rail')[0])).toBe(false);
  });

  it('id は種類ごとの連番で衝突しない', () => {
    const parts: ElevationPart[] = [{ id: 'manual:board:1', kind: 'board', scaffoldIndex: 0, origin: 'manual' }];
    expect(nextPartId(parts, 'board')).toBe('manual:board:2');
    expect(nextPartId(parts, 'post')).toBe('manual:post:1');
  });
});

describe('neighborSlot（隣の有効位置・v2d の移動用）', () => {
  const board = slotToPart(boardSlot(1, 2900), 'b');
  it('左右はスパン番号を 1 つずらす', () => {
    expect(neighborSlot(board, geom, 'right')).toMatchObject({ spanIndex: 2, levelMm: 2900 });
    expect(neighborSlot(board, geom, 'left')).toMatchObject({ spanIndex: 0, levelMm: 2900 });
  });
  it('上下は縦位置を 1 つずらす（コマ列を含む）', () => {
    expect(neighborSlot(board, geom, 'up')).toMatchObject({ spanIndex: 1, levelMm: 4700 });
    expect(neighborSlot(board, geom, 'down')).toMatchObject({ spanIndex: 1, levelMm: 2850 });
  });
  it('端では null（はまらない場所へは動かない）', () => {
    const left = slotToPart(boardSlot(0, 150), 'x'); // 最左・最下
    expect(neighborSlot(left, geom, 'left')).toBeNull();
    expect(neighborSlot(left, geom, 'down')).toBeNull();
  });
  it('支柱は左右のみ（縦位置を持たない）', () => {
    const post = slotToPart(buildElevationSlots(geom, 'post')[1], 'p');
    expect(neighborSlot(post, geom, 'right')).toMatchObject({ postIndex: 2 });
    expect(neighborSlot(post, geom, 'up')).toBeNull();
  });
});
