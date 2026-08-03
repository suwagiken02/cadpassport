import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { partsToPrimitives } from '../elevationParts';
import { ELEV_PART_COLORS } from '../elevationPartStyle';
import {
  PALETTE_KINDS, buildElevationSlots, neighborSlot, nextPartId, slotAnchor, slotKey,
  slotOccupied, slotToPart, snapPostSlot, snapToSlot,
} from '../elevationSlots';
import { postMemberBottomMm, postStackTopMm } from '../elevationParts';

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

  // ============================================================
  // E-8-v2q: 支柱は規格部材（8/6/4/2/1 コマ品）の積み重ねで、1 本の支柱位置に
  // segmentIndex 違いの部材が複数ある。段を掴んで隣の支柱位置へ動かせること。
  // ============================================================
  describe('支柱の段（segmentIndex）を掴んだときの埋まり判定', () => {
    /** 支柱位置 2 に 2 段（0,1）が積まれている状態。 */
    const postAt = (postIndex: number, segmentIndex: number): ElevationPart => ({
      id: `post:0:${postIndex}:${segmentIndex}`, kind: 'post', scaffoldIndex: 0,
      origin: 'auto', postIndex, segmentIndex,
    });
    const stacked = [postAt(2, 0), postAt(2, 1)];
    const slotAt = (postIndex: number) =>
      buildElevationSlots(geom, 'post', { extend: true }).find((s) => s.postIndex === postIndex)!;

    it('同じ段が埋まっていれば occupied', () => {
      expect(slotOccupied(stacked, slotAt(2), 0)).toBe(true);
      expect(slotOccupied(stacked, slotAt(2), 1)).toBe(true);
    });

    it('別の段しか無ければ置ける（＝実在の支柱位置へも動かせる）', () => {
      expect(slotOccupied([postAt(2, 1)], slotAt(2), 0)).toBe(false);
      expect(slotOccupied([postAt(2, 0)], slotAt(2), 1)).toBe(false);
    });

    it('仮想の支柱位置は空き', () => {
      expect(slotOccupied(stacked, slotAt(4), 0)).toBe(false);
      expect(slotOccupied(stacked, slotAt(-1), 0)).toBe(false);
      expect(slotAt(4).x0).toBe(540 + 180);     // 右外 1 本目
      expect(slotAt(4).virtual).toBe(true);
    });

    it('段を指定しなければ従来どおり位置ごと（パレットから 1 本置くとき）', () => {
      expect(slotOccupied(stacked, slotAt(2))).toBe(true);
      expect(slotOccupied(stacked, slotAt(3))).toBe(false);
    });

    it('段を保ったまま移動先の部材を作れる（全高 1 本に化けない）', () => {
      const src = postAt(2, 1);
      const moved: ElevationPart = {
        ...slotToPart(slotAt(4), src.id),
        ...(src.segmentIndex != null ? { segmentIndex: src.segmentIndex } : {}),
        origin: 'manual',
      };
      expect(moved).toMatchObject({
        id: 'post:0:2:1', kind: 'post', origin: 'manual', postIndex: 4, segmentIndex: 1,
      });
      expect(moved.x0).toBeUndefined();   // 支柱は postXAt から座標を引く

      // 描画は「高さはそのまま・x だけ移動」。段を落とすと全高 1 本に化けていた。
      const bar = (p: ElevationPart) => {
        const line = partsToPrimitives({ geom, parts: [p] }).find((q) => q.kind === 'line' && q.x1 === q.x2);
        if (!line || line.kind !== 'line') throw new Error('支柱の棒が無い');
        return { x: line.x1, y0: line.y1, y1: line.y2 };
      };
      const before = bar(src), after = bar(moved);
      expect([after.y0, after.y1]).toEqual([before.y0, before.y1]);
      expect(after.x).toBe(720);
      expect(before.x).toBe(360);
    });
  });

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

    // ------------------------------------------------------------
    // 吸着の基準点。指の位置で寄せると、部材が長いぶん上の候補に付いて宙に浮いた。
    // ------------------------------------------------------------
    /** 掴んだ部材（上段・6 コマ品）。下端は seg1 の底。 */
    const grabbed: ElevationPart = {
      id: 'post:0:1:1', kind: 'post', scaffoldIndex: 0, origin: 'auto', postIndex: 1, segmentIndex: 1,
    };
    const curBottom = postMemberBottomMm(grabbed, sg);
    const px1 = sg.postXs[1];

    it('部材の下端を頭に合わせると、ぴったり頭に吸着する（宙に浮かない）', () => {
      const s = snapPostSlot(geom, grabbed, { x: px1, bottomMm: head }, curBottom, ext)!;
      expect(s.postIndex).toBe(1);
      expect(s.levelMm).toBe(head);
    });

    it('下端が頭の少し上でも頭へ吸着する（1 コマ上には飛ばない）', () => {
      const s = snapPostSlot(geom, grabbed, { x: px1, bottomMm: head + 100 }, curBottom, ext)!;
      expect(s.levelMm).toBe(head);
      // ちょうど 1 コマ上まで持っていけば 1 つ上の候補
      const up = snapPostSlot(geom, grabbed, { x: px1, bottomMm: head + 450 }, curBottom, ext)!;
      expect(up.levelMm).toBe(head + 450);
    });

    it('横へ動かしただけなら高さは変わらない（v2q の挙動を保つ）', () => {
      const s = snapPostSlot(geom, grabbed, { x: sg.postXs[2], bottomMm: curBottom }, curBottom, ext)!;
      expect(s.postIndex).toBe(2);
      expect(s.levelMm).toBeUndefined();
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
        ...slotToPart(slot, 'post:0:1:1'), komaCount: 6, origin: 'manual',
      };
      expect(moved).toMatchObject({ kind: 'post', postIndex: 1, levelMm: 5000, komaCount: 6 });

      const prims = partsToPrimitives({ geom: g5000, parts: [moved] });
      const bar = prims.find((p) => p.kind === 'line' && p.x1 === p.x2 && p.stroke === ELEV_PART_COLORS.post);
      if (!bar || bar.kind !== 'line') throw new Error('支柱の棒が無い');
      // 下端＝5000（＝既存の頭）、上端＝5000＋450×6（ローカル y は -mm/10）
      expect(bar.y1).toBe(-500);
      expect(bar.y2).toBe(-(5000 + 450 * 6) / 10);
      // 接合点にはスリーブ（縦帯）が出る。端キャップは上端だけ
      const sleeve = prims.find((p) => p.kind === 'line' && p.x1 === p.x2
        && p.stroke === ELEV_PART_COLORS.joint);
      if (!sleeve || sleeve.kind !== 'line') throw new Error('継ぎ目が無い');
      expect((sleeve.y1 + sleeve.y2) / 2).toBeCloseTo(-500);
      const caps = prims.filter((p) => p.kind === 'circle');
      expect(caps).toHaveLength(1);
      expect(caps[0].kind === 'circle' && caps[0].y).toBeCloseTo(-(5000 + 450 * 6) / 10);
    });

    it('同じ高さに既に継ぎ足していれば埋まり', () => {
      const slot = stackSlots[0];
      const placed: ElevationPart = { ...slotToPart(slot, 'x'), komaCount: 4 };
      expect(slotOccupied([placed], slot)).toBe(true);
      expect(slotOccupied([placed], stackSlots[1])).toBe(false);
      // 足元〜天端の支柱があっても、その上は空いている
      const column: ElevationPart = {
        id: 'post:0:1:0', kind: 'post', scaffoldIndex: 0, origin: 'auto', postIndex: 1, segmentIndex: 0,
      };
      expect(slotOccupied([column], slot)).toBe(false);
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
