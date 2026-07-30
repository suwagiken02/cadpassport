import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import {
  PALETTE_KINDS, buildElevationSlots, neighborSlot, nextPartId, slotAnchor,
  slotOccupied, slotToPart, snapToSlot,
} from '../elevationSlots';

// ============================================================
// E-8-v2c: 吸着スロット。「はまる場所にしかはまらない」を担保する有効位置。
//   支柱 4 本 = スパン 3 つ。作業床 1100/2900/4700、コマ 150/600/…（450 刻み）。
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

describe('buildElevationSlots', () => {
  it('支柱・ジャッキは支柱位置ごと（縦位置は持たない）', () => {
    const posts = buildElevationSlots(geom, 'post');
    expect(posts).toHaveLength(4);
    expect(posts.map((s) => s.postIndex)).toEqual([0, 1, 2, 3]);
    expect(posts.every((s) => s.levelMm === undefined && s.x0 === s.x1)).toBe(true);
    expect(buildElevationSlots(geom, 'jack')).toHaveLength(4);
  });

  it('踏板はスパン × 作業床の高さ', () => {
    const boards = buildElevationSlots(geom, 'board');
    expect(boards).toHaveLength(3 * 3); // スパン3 × 床3
    expect(boards[0]).toMatchObject({ spanIndex: 0, levelMm: 1100, x0: 0, x1: 180 });
  });

  it('手摺はスパン × 450 刻みのコマ位置', () => {
    const rails = buildElevationSlots(geom, 'rail');
    expect(rails).toHaveLength(3 * 7);
    expect(new Set(rails.map((s) => s.levelMm))).toEqual(new Set(geom.scaffolds[0].komaGridMm));
  });

  it('筋交はスパン × 作業床の高さ', () => {
    expect(buildElevationSlots(geom, 'brace')).toHaveLength(9);
  });

  it('パレットは 支柱/手摺/踏板/ジャッキ/筋交 の 5 種', () => {
    expect(PALETTE_KINDS).toEqual(['post', 'rail', 'board', 'jack', 'brace']);
  });

  it('幅はスパン幅から自動（部材側で長さを指定しない）', () => {
    const boards = buildElevationSlots(geom, 'board');
    for (const s of boards) expect(s.x1 - s.x0).toBe(180);
  });
});

describe('snapToSlot', () => {
  it('最寄りの有効位置に吸着する（中途半端な位置でも必ずどこかにはまる）', () => {
    // スパン1(180..360)の中央あたり・高さ 2800mm → 床 2900 のスロット
    const s = snapToSlot({ x: 270, yMm: 2800 }, geom, 'board')!;
    expect(s.spanIndex).toBe(1);
    expect(s.levelMm).toBe(2900);
  });

  it('支柱は横位置だけで決まる', () => {
    const s = snapToSlot({ x: 350, yMm: 3000 }, geom, 'post')!;
    expect(s.postIndex).toBe(2); // x=360 が最寄り
  });

  it('縦は mm→グリッド換算で比較する（縦横のスケール差を吸収）', () => {
    // x はスパン0の中央(90)、高さは 1100 と 2900 の中間より少し下 → 1100 側
    const s = snapToSlot({ x: 90, yMm: 1900 }, geom, 'board')!;
    expect(s.levelMm).toBe(1100);
  });

  it('スロットが無い幾何では null', () => {
    expect(snapToSlot({ x: 0, yMm: 0 }, { minXg: 0, scaffolds: [] }, 'board')).toBeNull();
  });

  it('slotAnchor はスパン中央と高さ', () => {
    const s = buildElevationSlots(geom, 'board')[0];
    expect(slotAnchor(s, geom)).toEqual({ x: 90, y: 1100 });
  });
});

describe('slotToPart / 二重置き防止 / id 採番', () => {
  it('スロットから手動部材を作る（支柱系はレンジを持たない）', () => {
    const board = slotToPart(buildElevationSlots(geom, 'board')[0], 'manual:board:1');
    expect(board).toMatchObject({ kind: 'board', origin: 'manual', spanIndex: 0, levelMm: 1100, x0: 0, x1: 180 });
    const post = slotToPart(buildElevationSlots(geom, 'post')[1], 'manual:post:1');
    expect(post).toMatchObject({ kind: 'post', origin: 'manual', postIndex: 1 });
    expect(post.x0).toBeUndefined();
  });

  it('同じ位置に同種があれば occupied', () => {
    const slot = buildElevationSlots(geom, 'board')[0];
    const parts: ElevationPart[] = [slotToPart(slot, 'a')];
    expect(slotOccupied(parts, slot)).toBe(true);
    expect(slotOccupied(parts, buildElevationSlots(geom, 'board')[1])).toBe(false);
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
  const board = slotToPart(buildElevationSlots(geom, 'board')[4], 'b'); // spanIndex1・2900
  it('左右はスパン番号を 1 つずらす', () => {
    expect(neighborSlot(board, geom, 'right')).toMatchObject({ spanIndex: 2, levelMm: 2900 });
    expect(neighborSlot(board, geom, 'left')).toMatchObject({ spanIndex: 0, levelMm: 2900 });
  });
  it('上下は段を 1 つずらす', () => {
    expect(neighborSlot(board, geom, 'up')).toMatchObject({ spanIndex: 1, levelMm: 4700 });
    expect(neighborSlot(board, geom, 'down')).toMatchObject({ spanIndex: 1, levelMm: 1100 });
  });
  it('端では null（はまらない場所へは動かない）', () => {
    const left = slotToPart(buildElevationSlots(geom, 'board')[0], 'x'); // span0・1100
    expect(neighborSlot(left, geom, 'left')).toBeNull();
    expect(neighborSlot(left, geom, 'down')).toBeNull();
  });
  it('支柱は左右のみ（縦位置を持たない）', () => {
    const post = slotToPart(buildElevationSlots(geom, 'post')[1], 'p');
    expect(neighborSlot(post, geom, 'right')).toMatchObject({ postIndex: 2 });
    expect(neighborSlot(post, geom, 'up')).toBeNull();
  });
});
