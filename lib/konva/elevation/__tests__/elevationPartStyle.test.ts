// ============================================================
// E-8-v2f: 部材が「線」ではなく「部材」に見えること。
// 実機指摘（平面はひと目で部材と分かるのに立面は全部細線）に対する回帰テスト。
// 平面(ScaffoldLayer)の視覚言語 = 太い色線＋両端の丸ハンドル。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { BuildingShape, Point } from '@/types';
import { HANDRAIL_COLORS } from '@/lib/konva/handrailColors';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToParts, partsToPrimitives } from '../elevationParts';
import {
  ELEV_PART_COLORS, ELEV_PART_STYLE, komaLevelsMm, nominalSpanMm, railColorForSpanMm,
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

describe('部材の太さ（細線に潰れない）', () => {
  it('手摺・踏板・支柱の線は平面並みに太い（旧 0.7/3/1.6 px から引き上げ）', () => {
    const S = ELEV_PART_STYLE;
    expect(S.railWidth).toBeGreaterThan(2);
    expect(S.boardWidth).toBeGreaterThan(4);
    expect(S.postWidth).toBeGreaterThan(3);
    // 踏板は「縁の方が太い」＝帯として輪郭が見える
    expect(S.boardEdgeWidth).toBeGreaterThan(S.boardWidth);
  });

  it('実際に出力される線もその太さで出る', () => {
    const railLines = byKind('rail').filter((p) => p.kind === 'line');
    expect(railLines.length).toBeGreaterThan(0);
    expect(railLines.every((p) => p.kind === 'line' && p.width === ELEV_PART_STYLE.railWidth)).toBe(true);
    // 支柱本体（コマの印は別色・別太さなので stroke で分ける）
    const postLines = byKind('post').filter((p) => p.kind === 'line' && p.stroke === ELEV_PART_COLORS.post);
    expect(postLines.length).toBeGreaterThan(0);
    expect(postLines.every((p) => p.kind === 'line' && p.width === ELEV_PART_STYLE.postWidth)).toBe(true);
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

  it('丸ハンドルは線の両端に置かれ、線と同じ色', () => {
    const rails = byKind('rail');
    const i = rails.findIndex((p) => p.kind === 'line');
    const line = rails[i], d0 = rails[i + 1], d1 = rails[i + 2];
    expect(line.kind === 'line' && d0.kind === 'circle' && d1.kind === 'circle').toBe(true);
    if (line.kind !== 'line' || d0.kind !== 'circle' || d1.kind !== 'circle') return;
    expect([d0.x, d0.y]).toEqual([line.x1, line.y1]);
    expect([d1.x, d1.y]).toEqual([line.x2, line.y2]);
    expect(d0.fill).toBe(line.stroke);
    expect(d0.r).toBe(ELEV_PART_STYLE.railHandleR);
  });

  it('支柱は上下端に端点マークを持つ（1 本につき 2 つ）', () => {
    const posts = byKind('post');
    const postIds = new Set(posts.map((p) => p.meta!.id));
    expect(postIds.size).toBeGreaterThan(0);
    for (const id of Array.from(postIds)) {
      expect(posts.filter((p) => p.meta!.id === id && p.kind === 'circle')).toHaveLength(2);
    }
  });
});

// ============================================================
// E-8-v2g: コマ（450 刻みの受け金具）。
// 実物の支柱には 450 刻みでコマが付いていて、職人はそれを目印に手摺を掛ける。
// 立面で見えないと手摺位置が読めない（鮎澤氏指摘）。
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
    const postCount = sg.postXs.length;
    expect(komaMarks).toHaveLength(postCount * sg.komaGridMm.length);
  });

  it('コマは水平の短い印で、支柱の中心に左右対称', () => {
    const m = komaMarks[0];
    if (m.kind !== 'line') throw new Error('line が出ていない');
    expect(m.y1).toBe(m.y2);                                  // 水平
    expect(m.x2 - m.x1).toBe(ELEV_PART_STYLE.komaHalfGrid * 2); // 支柱をまたぐ幅
  });

  it('コマの高さはコマ列そのもの（ローカル y = -mm/10）', () => {
    const ys = new Set(komaMarks.map((p) => (p.kind === 'line' ? p.y1 : NaN)));
    expect(ys).toEqual(new Set(sg.komaGridMm.map((mm) => -mm / 10)));
  });

  it('部材より控えめ・グリッドより主張（支柱より細く、不透明度も落とす）', () => {
    expect(ELEV_PART_STYLE.komaWidth).toBeLessThan(ELEV_PART_STYLE.postWidth);
    expect(ELEV_PART_STYLE.komaWidth).toBeGreaterThan(1); // 縮小しても消えない太さ
    const m = komaMarks[0];
    expect(m.kind === 'line' && m.opacity).toBe(0.85);
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

describe('ジャッキはベース記号になる', () => {
  it('台形（塗り）＋底辺の太線', () => {
    const jacks = byKind('jack');
    expect(jacks.some((p) => p.kind === 'polygon')).toBe(true);
    const base = jacks.find((p) => p.kind === 'line');
    expect(base && base.kind === 'line' && base.width).toBe(ELEV_PART_STYLE.jackBaseWidth);
    // 底辺は GL(=0) 上の水平線
    expect(base && base.kind === 'line' && [base.y1, base.y2]).toEqual([0, 0]);
  });
});
