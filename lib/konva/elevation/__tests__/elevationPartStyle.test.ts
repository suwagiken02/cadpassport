// ============================================================
// E-8-v2f/v2h: 部材が「線」ではなく「1 本ずつのモノ」に見えること。
// 実機指摘の回帰テスト:
//   v2f 前: 全部が細い線で部材と分からない
//   v2h 前: 太くはなったがモジュール感が弱い / コマが支柱色に溶けて見えない
// 平面(ScaffoldLayer)の視覚言語 = 太い色線（実寸 8 グリッド）＋大きな丸ハンドル（半径 8 グリッド）。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import { HANDRAIL_COLORS } from '@/lib/konva/handrailColors';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToParts, partsToPrimitives } from '../elevationParts';
import {
  ELEV_PART_COLORS, ELEV_PART_STYLE, insetRange, komaLevelsMm, nominalSpanMm,
  partWidthPx, railColorForSpanMm,
} from '../elevationPartStyle';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 });
const northCol: FaceSpanColumn = {
  face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};
const fe = buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 });
const prims = partsToPrimitives(faceElevationToParts(fe));
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
    // 支柱本体（コマの印は別色なので stroke で分ける）
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
    const sg = faceElevationToParts(fe).geom.scaffolds[0];
    const postLocals = sg.postXs.map((px) => px - faceElevationToParts(fe).geom.minXg);
    const railLines = byKind('rail').filter((p) => p.kind === 'line');
    for (const p of railLines) {
      if (p.kind !== 'line') continue;
      for (const px of postLocals) {
        // 端点が支柱の真上に乗っていない（= 切れ目がある）
        expect(Math.abs(p.x1 - px)).toBeGreaterThan(1);
        expect(Math.abs(p.x2 - px)).toBeGreaterThan(1);
      }
    }
  });

  it('踏板も 1 枚ずつ切れて見える（端を内側に寄せる）', () => {
    expect(ELEV_PART_STYLE.boardInsetGrid).toBeGreaterThan(0);
    const boardLines = byKind('board').filter((p) => p.kind === 'line');
    expect(boardLines.length).toBeGreaterThan(0);
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

  it('支柱は上下端にキャップを持つ（1 本につき 2 つ・輪郭あり）', () => {
    const posts = byKind('post');
    const postIds = new Set(posts.map((p) => p.meta!.id));
    expect(postIds.size).toBeGreaterThan(0);
    for (const id of Array.from(postIds)) {
      const caps = posts.filter((p) => p.meta!.id === id && p.kind === 'circle');
      expect(caps).toHaveLength(2);
      expect(caps.every((c) => c.kind === 'circle' && c.stroke === ELEV_PART_COLORS.postEdge)).toBe(true);
    }
  });
});

describe('色は平面の定数を参照する（二重管理しない）', () => {
  it('手摺はスパンの呼び寸ごとに平面と同じ色', () => {
    expect(railColorForSpanMm(1800)).toBe(HANDRAIL_COLORS[1800]);
    expect(railColorForSpanMm(1200)).toBe(HANDRAIL_COLORS[1200]);
    expect(railColorForSpanMm(600)).toBe(HANDRAIL_COLORS[600]);
  });

  it('規格外の長さは 1800 と同じ青にフォールバックする（暗背景で沈む色を出さない）', () => {
    expect(railColorForSpanMm(1234)).toBe(ELEV_PART_COLORS.rail);
    expect(ELEV_PART_COLORS.rail).toBe(HANDRAIL_COLORS[1800]);
  });

  it('この面の手摺は 1800 スパンなので平面の 1800 手摺と同色', () => {
    const railLine = byKind('rail').find((p) => p.kind === 'line')!;
    expect(railLine.kind === 'line' && railLine.stroke).toBe(HANDRAIL_COLORS[1800]);
  });
});

describe('nominalSpanMm: 入隅切断でも部材の呼び寸で色を決める', () => {
  const postXs = [0, 180, 330]; // 1800 スパンと 1500 スパン
  it('x0 を含むスパンの支柱間隔(mm)を返す', () => {
    expect(nominalSpanMm(postXs, 0)).toBe(1800);
    expect(nominalSpanMm(postXs, 90)).toBe(1800);   // 切断されて途中から始まっても呼び寸
    expect(nominalSpanMm(postXs, 180)).toBe(1500);
  });
  it('範囲外は最後のスパンにフォールバック', () => {
    expect(nominalSpanMm(postXs, 999)).toBe(1500);
    expect(nominalSpanMm([], 0)).toBe(1800);
  });
});

// ============================================================
// E-8-v2g/v2h: コマ（450 刻みの受け金具）。
// 実物の支柱には 450 刻みでコマが付いていて、職人はそれを目印に手摺を掛ける。
// 立面で見えないと手摺位置が読めない（鮎澤氏指摘）。明黄では支柱色に溶けるので濃色にする。
// ============================================================
describe('コマの列（ジャッキ上端起点・450 刻み・上端まで）', () => {
  it('GL+150 から 450 刻みで、上端を超えない', () => {
    expect(komaLevelsMm(150, 2000)).toEqual([150, 600, 1050, 1500, 1950]);
    expect(komaLevelsMm(150, 1950)).toEqual([150, 600, 1050, 1500, 1950]); // 上端ちょうどは含む
    expect(komaLevelsMm(150, 1949)).toEqual([150, 600, 1050, 1500]);
  });

  it('上端が起点より下なら空、ピッチが 0 以下でも空（無限ループにしない）', () => {
    expect(komaLevelsMm(150, 100)).toEqual([]);
    expect(komaLevelsMm(150, 2000, 0)).toEqual([]);
    expect(komaLevelsMm(150, 2000, -450)).toEqual([]);
  });

  it('エンジンが持つコマ格子と同じ定義', () => {
    const sg = faceElevationToParts(fe).geom.scaffolds[0];
    expect(sg.komaGridMm).toEqual(komaLevelsMm(sg.jackTopMm, sg.topRailMm));
  });
});

describe('コマの描画', () => {
  const komaMarks = byKind('post').filter((p) => p.kind === 'line' && p.stroke === ELEV_PART_COLORS.koma);
  const sg = faceElevationToParts(fe).geom.scaffolds[0];

  it('支柱 1 本ごとにコマ列ぶんの印が出る', () => {
    expect(komaMarks).toHaveLength(sg.postXs.length * sg.komaGridMm.length);
  });

  it('コマは水平の短い印で、支柱の中心に左右対称', () => {
    const m = komaMarks[0];
    if (m.kind !== 'line') throw new Error('line が出ていない');
    expect(m.y1).toBe(m.y2);                                     // 水平
    expect(m.x2 - m.x1).toBe(ELEV_PART_STYLE.komaHalfGrid * 2);   // 支柱をまたぐ幅
  });

  it('コマの高さはコマ列そのもの（ローカル y = -mm/10）', () => {
    const ys = new Set(komaMarks.map((p) => (p.kind === 'line' ? p.y1 : NaN)));
    expect(ys).toEqual(new Set(sg.komaGridMm.map((mm) => -mm / 10)));
  });

  it('支柱色に溶けない濃色で、不透明のまま乗る', () => {
    expect(ELEV_PART_COLORS.koma).not.toBe(ELEV_PART_COLORS.post);
    // 濃色（各チャンネルが暗い）＝金色の支柱の上でコントラストが出る
    const rgb = ELEV_PART_COLORS.koma.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    expect(Math.max(...rgb)).toBeLessThan(0x80);
    const m = komaMarks[0];
    expect(m.kind === 'line' && m.opacity).toBe(1);
  });

  it('支柱より張り出し、太さは px 固定（密なので実寸比にしない）', () => {
    expect(ELEV_PART_STYLE.komaHalfGrid * 2).toBeGreaterThan(ELEV_PART_STYLE.postWidthGrid);
    expect(ELEV_PART_STYLE.komaWidthPx).toBeGreaterThanOrEqual(2.5);
    const m = komaMarks[0];
    expect(m.kind === 'line' && m.widthGrid).toBeUndefined();
  });
});

describe('ジャッキはベース記号になる', () => {
  it('台形（塗り＋輪郭）＋底辺の太線', () => {
    const jacks = byKind('jack');
    const poly = jacks.find((p) => p.kind === 'polygon');
    expect(poly && poly.kind === 'polygon' && poly.stroke).toBe(ELEV_PART_COLORS.postEdge);
    const base = jacks.find((p) => p.kind === 'line');
    expect(base && base.kind === 'line' && base.widthGrid).toBe(ELEV_PART_STYLE.jackBaseWidthGrid);
    // 底辺は GL(=0) 上の水平線
    expect(base && base.kind === 'line' && [base.y1, base.y2]).toEqual([0, 0]);
  });
});
