// ============================================================
// E-8-v2f/v2h/v2j: 部材が「線」ではなく「1 本ずつのモノ」に見えること。
// 実機指摘の回帰テスト:
//   v2f 前: 全部が細い線で部材と分からない
//   v2h 前: 太くはなったがモジュール感が弱い / コマが支柱色に溶けて見えない
//   v2j 前: 4 面配置で面ごとに手摺の色が違う（長さ別カラーの引き継ぎ）
// 平面(ScaffoldLayer)の視覚言語 = 太い色線（実寸 8 グリッド）＋大きな丸ハンドル（半径 8 グリッド）。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import { HANDRAIL_COLORS } from '@/lib/konva/handrailColors';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToParts, partsToPrimitives } from '../elevationParts';
import {
  ELEV_PART_COLORS, ELEV_PART_STYLE, insetRange, komaLevelsFromJackMm, partWidthPx, postSegmentsMm,
} from '../elevationPartStyle';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 });
const northCol: FaceSpanColumn = {
  face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};
const fe = buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 });
const bundle = faceElevationToParts(fe);
const prims = partsToPrimitives(bundle);
const sg = bundle.geom.scaffolds[0];
const byKind = (kind: string) => prims.filter((p) => p.meta?.kind === kind);
/** 平面と同じ見え方になる基準倍率（1 グリッド = 3px = 平面の zoom 1）。 */
const PLAN_PX_PER_GRID = 3;

describe('partWidthPx: 実寸比で太らせ、縮小時は下限で潰さない', () => {
  it('拡大時は実寸比（グリッド値 × px/グリッド）', () => {
    expect(partWidthPx(3.2, 8, 3)).toBe(24);    // 平面の zoom 1 と同じ 24px
    expect(partWidthPx(3.2, 8, 1.5)).toBe(12);  // 半分のズームなら半分
  });
  it('縮小しても下限 px を切らない', () => {
    expect(partWidthPx(3.2, 8, 0.3)).toBe(3.2);
    expect(partWidthPx(3.2, 8, 0)).toBe(3.2);
  });
  it('実寸指定が無ければ下限 px のまま（背景要素は従来どおり）', () => {
    expect(partWidthPx(1.5, undefined, 3)).toBe(1.5);
  });
});

describe('部材の太さ（平面と同一の実寸比）', () => {
  it('手摺は平面と完全に同じ太さ・ハンドル径（実寸 8 グリッド = 80mm）', () => {
    const S = ELEV_PART_STYLE;
    // 平面: strokeWidth 24*zoom px / gridPx 3*zoom px → 8 グリッド。ハンドル r も同じ。
    expect(S.railWidthGrid).toBe(8);
    expect(S.railHandleGrid).toBe(8);
    expect(partWidthPx(S.railWidthMinPx, S.railWidthGrid, PLAN_PX_PER_GRID)).toBe(24);
    expect(partWidthPx(S.railHandleMinPx, S.railHandleGrid, PLAN_PX_PER_GRID)).toBe(24);
  });

  it('踏板は縁の方が太い＝パネルの輪郭が見える', () => {
    const S = ELEV_PART_STYLE;
    expect(S.boardEdgeGrid).toBeGreaterThan(S.boardWidthGrid);
    expect(S.boardEdgeMinPx).toBeGreaterThan(S.boardWidthMinPx);
  });

  it('支柱は単管相当の太さ（実寸 60mm）で、キャップは支柱より張り出す', () => {
    const S = ELEV_PART_STYLE;
    expect(S.postWidthGrid).toBe(6);
    expect(S.postCapGrid * 2).toBeGreaterThan(S.postWidthGrid); // 直径 > 太さ
  });

  it('実際に出力される線が実寸比の情報を持っている', () => {
    const railLines = byKind('rail').filter((p) => p.kind === 'line');
    expect(railLines.length).toBeGreaterThan(0);
    expect(railLines.every((p) => p.kind === 'line'
      && p.width === ELEV_PART_STYLE.railWidthMinPx
      && p.widthGrid === ELEV_PART_STYLE.railWidthGrid)).toBe(true);
    // 支柱本体（コマ・継ぎ目の印は別色なので stroke で分ける）
    const postLines = byKind('post').filter((p) => p.kind === 'line' && p.stroke === ELEV_PART_COLORS.post);
    expect(postLines.length).toBeGreaterThan(0);
    expect(postLines.every((p) => p.kind === 'line'
      && p.widthGrid === ELEV_PART_STYLE.postWidthGrid)).toBe(true);
  });
});

describe('モジュール感（支柱位置の切れ目）', () => {
  it('insetRange はスパン端から内側へ寄せる', () => {
    expect(insetRange(0, 180, 9)).toEqual({ a: 9, b: 171 });
  });
  it('短い部材でも反転しない（長さの 40% が上限）', () => {
    expect(insetRange(0, 10, 9)).toEqual({ a: 4, b: 6 });
    expect(insetRange(5, 5, 9)).toEqual({ a: 5, b: 5 });
  });

  it('手摺は支柱位置に届かない＝隣のスパンとつながらない', () => {
    const postLocals = sg.postXs.map((px) => px - bundle.geom.minXg);
    const railLines = byKind('rail').filter((p) => p.kind === 'line');
    for (const p of railLines) {
      if (p.kind !== 'line') continue;
      for (const px of postLocals) {
        expect(Math.abs(p.x1 - px)).toBeGreaterThan(1);
        expect(Math.abs(p.x2 - px)).toBeGreaterThan(1);
      }
    }
  });

  it('踏板も 1 枚ずつ切れて見える（端を内側に寄せる）', () => {
    expect(ELEV_PART_STYLE.boardInsetGrid).toBeGreaterThan(0);
    expect(byKind('board').filter((p) => p.kind === 'line').length).toBeGreaterThan(0);
  });
});

describe('丸ハンドル（平面と同じ「両端の●」）', () => {
  it('手摺は 1 本につき線 1 + 丸 2 で出る', () => {
    const rails = byKind('rail');
    const lines = rails.filter((p) => p.kind === 'line').length;
    const dots = rails.filter((p) => p.kind === 'circle').length;
    expect(lines).toBeGreaterThan(0);
    expect(dots).toBe(lines * 2);
  });

  it('丸ハンドルは線の両端に置かれ、線と同じ色・平面と同じ半径', () => {
    const rails = byKind('rail');
    const i = rails.findIndex((p) => p.kind === 'line');
    const line = rails[i], d0 = rails[i + 1], d1 = rails[i + 2];
    if (line.kind !== 'line' || d0.kind !== 'circle' || d1.kind !== 'circle') throw new Error('形が違う');
    expect([d0.x, d0.y]).toEqual([line.x1, line.y1]);
    expect([d1.x, d1.y]).toEqual([line.x2, line.y2]);
    expect(d0.fill).toBe(line.stroke);
    expect(d0.rGrid).toBe(ELEV_PART_STYLE.railHandleGrid);
  });
});

// ============================================================
// E-8-v2j: 手摺は全面統一色。
// 4 面配置で「左 2 面が青・右 2 面が赤」になっていたのは、平面の長さ別カラーを
// そのまま持ち込んでいたため（田の字は左列=南北・右列=東西なので、面ごとに
// 手摺サイズが揃っていると面全体の色が変わる）。立面では情報にならないので統一する。
// ============================================================
describe('手摺の色は全面統一', () => {
  it('平面の標準手摺(1800)と同じ青系', () => {
    expect(ELEV_PART_COLORS.rail).toBe(HANDRAIL_COLORS[1800]);
  });

  it('スパン長が違っても同じ色で出る', () => {
    const mixed: FaceSpanColumn = {
      face: 'south', floor: 1, depthCoord: 540, xStart: 0, xEnd: 330,
      rails: [1800, 1500], handrailIds: ['a', 'b'],
    };
    const feMixed = buildFaceElevation([mixed], [bld('M')], { defaultHeightMm: 6500 });
    const strokes = new Set(
      partsToPrimitives(faceElevationToParts(feMixed))
        .filter((p) => p.meta?.kind === 'rail' && p.kind === 'line')
        .map((p) => (p.kind === 'line' ? p.stroke : '')),
    );
    expect(strokes).toEqual(new Set([ELEV_PART_COLORS.rail]));
  });
});

// ============================================================
// E-8-v2g/v2h: コマ（450 刻みの受け金具）。
// ============================================================
describe('コマの描画', () => {
  const komaMarks = byKind('post').filter((p) => p.kind === 'line' && p.stroke === ELEV_PART_COLORS.koma);

  it('コマ列は皿+250 起点（エンジンと同じ定義）で、作業床もその列に乗る', () => {
    expect(sg.komaGridMm).toEqual(komaLevelsFromJackMm(sg.jackTopMm, sg.topRailMm));
    for (const lv of sg.levelsMm) expect(sg.komaGridMm).toContain(lv);
  });

  it('支柱 1 本ごとにコマ列ぶんの印が出る（分割しても重複・欠落なし）', () => {
    expect(komaMarks).toHaveLength(sg.postXs.length * sg.komaGridMm.length);
  });

  it('コマは水平の短い印で、支柱の中心に左右対称', () => {
    const m = komaMarks[0];
    if (m.kind !== 'line') throw new Error('line が出ていない');
    expect(m.y1).toBe(m.y2);
    expect(m.x2 - m.x1).toBe(ELEV_PART_STYLE.komaHalfGrid * 2);
  });

  it('コマの高さはコマ列そのもの（ローカル y = -mm/10）', () => {
    const ys = new Set(komaMarks.map((p) => (p.kind === 'line' ? p.y1 : NaN)));
    expect(ys).toEqual(new Set(sg.komaGridMm.map((mm) => -mm / 10)));
  });

  it('支柱色に溶けない濃色で、不透明のまま乗る', () => {
    expect(ELEV_PART_COLORS.koma).not.toBe(ELEV_PART_COLORS.post);
    const rgb = ELEV_PART_COLORS.koma.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    expect(Math.max(...rgb)).toBeLessThan(0x80);
    expect(komaMarks[0].kind === 'line' && komaMarks[0].opacity).toBe(1);
  });
});

// ============================================================
// E-8-v2j: 支柱は規格部材（8/6/4/2/1 コマ品）の積み重ね。
// ============================================================
describe('支柱の部材分割と継ぎ目', () => {
  const segs = postSegmentsMm(sg.jackTopMm, sg.komaGridMm.length, sg.topRailMm);
  const jointMarks = byKind('post').filter((p) => p.kind === 'line' && p.stroke === ELEV_PART_COLORS.joint);
  const postBars = byKind('post').filter((p) => p.kind === 'line' && p.stroke === ELEV_PART_COLORS.post);

  it('H=6500（14 コマ）は下から [6, 8]', () => {
    expect(sg.komaGridMm).toHaveLength(14);
    expect(segs.map((s) => s.komaCount)).toEqual([6, 8]);
  });

  it('部材ごとに 1 本の棒が出る', () => {
    expect(postBars).toHaveLength(sg.postXs.length * segs.length);
  });

  it('継ぎ目の印は部材の境目にだけ出る（最上段には出ない）', () => {
    expect(jointMarks).toHaveLength(sg.postXs.length * (segs.length - 1));
    const ys = new Set(jointMarks.map((p) => (p.kind === 'line' ? p.y1 : NaN)));
    expect(ys).toEqual(new Set([-segs[0].topMm / 10]));
    // 継ぎ目はコマより広く出す
    expect(ELEV_PART_STYLE.jointHalfGrid).toBeGreaterThan(ELEV_PART_STYLE.komaHalfGrid);
  });

  it('端キャップは支柱の一番下と一番上だけ（継ぎ目では出さない）', () => {
    const caps = byKind('post').filter((p) => p.kind === 'circle');
    expect(caps).toHaveLength(sg.postXs.length * 2);
  });

  it('部材は隙間なく積まれ、最上段は天端でクリップされる', () => {
    expect(segs[0].bottomMm).toBe(sg.jackTopMm);
    for (let i = 1; i < segs.length; i++) expect(segs[i].bottomMm).toBe(segs[i - 1].topMm);
    expect(segs[segs.length - 1].topMm).toBe(sg.topRailMm);
  });
});

describe('ジャッキはベース記号になる', () => {
  it('台形（塗り＋輪郭）＋底辺の太線', () => {
    const jacks = byKind('jack');
    const poly = jacks.find((p) => p.kind === 'polygon');
    expect(poly && poly.kind === 'polygon' && poly.stroke).toBe(ELEV_PART_COLORS.postEdge);
    const base = jacks.find((p) => p.kind === 'line');
    expect(base && base.kind === 'line' && base.widthGrid).toBe(ELEV_PART_STYLE.jackBaseWidthGrid);
    expect(base && base.kind === 'line' && [base.y1, base.y2]).toEqual([0, 0]);
  });
});
