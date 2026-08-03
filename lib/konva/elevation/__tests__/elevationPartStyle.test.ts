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
  ELEV_HIT_PX, ELEV_PART_COLORS, ELEV_PART_STYLE, insetRange, komaLevelsFromJackMm,
  partHitPx, partWidthPx, postSegmentsMm,
} from '../elevationPartStyle';
import { KOMA_PITCH_MM } from '../komaGrid';

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

// ============================================================
// E-8-v2p: 掴める幅（指の基準）。
// 実機「支柱を掴む判定が難しすぎる。細い縦線を正確に踏まないと選択・ドラッグできない」。
// ============================================================
describe('partHitPx: 見た目より広い掴みしろ', () => {
  /** コマ間隔（グリッド）。手摺・踏板はこの間隔で上下に並ぶ。 */
  const KOMA_GRID = KOMA_PITCH_MM / 10;

  it('支柱・ジャッキは指の基準まで広げる（細い縦線・逃げ場が無いので最優先）', () => {
    expect(partHitPx('post', 4.2, 1.2)).toBe(ELEV_HIT_PX.post);
    expect(partHitPx('jack', 5, 1.2)).toBe(ELEV_HIT_PX.post);
    expect(ELEV_HIT_PX.post).toBeGreaterThanOrEqual(20);   // 実機要件（左右合計 20px 以上）
    expect(ELEV_HIT_PX.post).toBeGreaterThan(ELEV_HIT_PX.rail);
  });

  it('見た目より細くはしない（太い部材はその太さぶん掴める）', () => {
    expect(partHitPx('post', 40, 5)).toBe(40);
    expect(partHitPx('rail', 40, 5)).toBe(40);
  });

  it('手摺・踏板も指の基準まで広げる', () => {
    expect(partHitPx('rail', 3.2, 1.2)).toBe(ELEV_HIT_PX.rail);
    expect(partHitPx('board', 6, 1.2)).toBe(ELEV_HIT_PX.rail);
    expect(partHitPx('raise', 6, 1.2)).toBe(ELEV_HIT_PX.rail);
  });

  it('引いたズームでは隣の段と食い合わないところで頭打ちにする', () => {
    // pxPerGrid=0.3 → コマ間隔は 45×0.3=13.5px しかない。18px も広げると隣段と取り合う。
    expect(partHitPx('rail', 1, 0.3)).toBeCloseTo(KOMA_GRID * 0.3 * 0.8);   // 10.8px
    // どの倍率でも「掴みしろ < コマ間隔」＝隣の段の中心には届かない
    for (const s of [0.1, 0.3, 0.5, 1.2, 3, 8]) {
      expect(partHitPx('rail', ELEV_PART_STYLE.railWidthGrid * s, s))
        .toBeLessThan(KOMA_GRID * s);
    }
  });

  it('支柱は間隔の頭打ちを受けない（左右は隣の支柱まで遠い）', () => {
    expect(partHitPx('post', 1, 0.3)).toBe(ELEV_HIT_PX.post);
    expect(partHitPx('post', 1, 0.05)).toBe(ELEV_HIT_PX.post);
  });

  it('背景要素（寸法線・文字）は従来どおりの幅', () => {
    expect(partHitPx('dim', 0.8, 1.2)).toBe(ELEV_HIT_PX.other);
    expect(partHitPx(undefined, 0.8, 1.2)).toBe(ELEV_HIT_PX.other);
  });

  it('pxPerGrid が 0 でも壊れない', () => {
    expect(partHitPx('rail', 3.2, 0)).toBe(ELEV_HIT_PX.rail);
    expect(partHitPx('post', 4.2, 0)).toBe(ELEV_HIT_PX.post);
  });
});

describe('部材の太さ（平面と同一の実寸比）', () => {
  it('手摺は平面と完全に同じ太さ（実寸 8 グリッド = 80mm）', () => {
    const S = ELEV_PART_STYLE;
    // 平面: strokeWidth 24*zoom px / gridPx 3*zoom px → 8 グリッド。
    expect(S.railWidthGrid).toBe(8);
    expect(partWidthPx(S.railWidthMinPx, S.railWidthGrid, PLAN_PX_PER_GRID)).toBe(24);
    // フックは本体より細い爪（実物のフック金具。丸ハンドルは E-8-v2l で廃止）
    expect(S.railHookWidthGrid).toBeLessThan(S.railWidthGrid);
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
    // 本体は実寸 8 グリッド、両端のフックは細い爪。どちらも実寸比の情報を持つ。
    expect(railLines.every((p) => p.kind === 'line' && (
      (p.width === ELEV_PART_STYLE.railWidthMinPx && p.widthGrid === ELEV_PART_STYLE.railWidthGrid)
      || (p.width === ELEV_PART_STYLE.railHookWidthMinPx
        && p.widthGrid === ELEV_PART_STYLE.railHookWidthGrid)
    ))).toBe(true);
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

  it('手摺は自分のスパンからはみ出さない（隣のスパンとつながらない）', () => {
    // E-8-v2u: 端はポケットの外縁まで来て、爪が支柱側へ回り込む（＝掛かって見える）。
    //   支柱の中心は越えないので、隣のスパンの手摺と重ならない。
    const minXg = bundle.geom.minXg;
    for (const part of bundle.parts.filter((p) => p.kind === 'rail')) {
      const lo = (part.x0 ?? 0) - minXg, hi = (part.x1 ?? 0) - minXg;
      const lines = partsToPrimitives({ geom: bundle.geom, parts: [part] })
        .filter((p) => p.kind === 'line');
      for (const p of lines) {
        if (p.kind !== 'line') continue;
        for (const x of [p.x1, p.x2]) {
          expect(x).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(x).toBeLessThanOrEqual(hi + 1e-6);
        }
      }
    }
  });

  it('踏板も 1 枚ずつ切れて見える（端を内側に寄せる）', () => {
    expect(ELEV_PART_STYLE.boardInsetGrid).toBeGreaterThan(0);
    expect(byKind('board').filter((p) => p.kind === 'line').length).toBeGreaterThan(0);
  });
});

// ============================================================
// E-8-v2l: 手摺端は「下向きのフック金具」。実物のクサビ式手摺は両端に下向きフックが付き、
// 支柱のポケットへ掛かる。丸ハンドル（平面の表現）は実物と違ううえ、踏板(アンチ)と
// 見分けが付きにくかった（鮎澤氏・実物写真確認済み）。
// ============================================================
describe('手摺端の下向きフック', () => {
  it('手摺に丸は出ない（丸ハンドルは廃止）', () => {
    expect(byKind('rail').filter((p) => p.kind === 'circle')).toEqual([]);
  });

  it('手摺 1 本 = 本体 1 + フック 4 本（縦＋爪 × 両端）の線で出る', () => {
    const railParts = bundle.parts.filter((p) => p.kind === 'rail');
    const railLines = byKind('rail').filter((p) => p.kind === 'line');
    expect(railParts.length).toBeGreaterThan(0);
    expect(railLines.length).toBe(railParts.length * 5);
  });

  it('フックは両端で下へ落ち、爪は支柱側（外向き）へ出る', () => {
    const L = byKind('rail').filter((p) => p.kind === 'line').slice(0, 5);
    const [body, aDrop, aToe, bDrop, bToe] = L;
    if (body.kind !== 'line' || aDrop.kind !== 'line' || aToe.kind !== 'line'
      || bDrop.kind !== 'line' || bToe.kind !== 'line') throw new Error('形が違う');
    const S = ELEV_PART_STYLE;
    // 本体は水平
    expect(body.y1).toBe(body.y2);
    // 左端: 本体端から真下へ（ローカル座標は +y が下）
    expect(aDrop.x1).toBe(body.x1);
    expect(aDrop.x2).toBe(body.x1);
    expect(aDrop.y1).toBe(body.y1);
    expect(aDrop.y2).toBe(body.y1 + S.railHookDropGrid);
    // 左端の爪は外向き（左）へ水平に出る
    expect(aToe.y1).toBe(aDrop.y2);
    expect(aToe.y2).toBe(aDrop.y2);
    expect(aToe.x2).toBe(body.x1 - S.railHookToeGrid);
    // 右端: 真下へ落ちて、爪は外向き（右）へ
    expect(bDrop.x1).toBe(body.x2);
    expect(bDrop.y2).toBe(body.y1 + S.railHookDropGrid);
    expect(bToe.x2).toBe(body.x2 + S.railHookToeGrid);
    // 色は本体と同じ（1 本のモノに見せる）
    expect([aDrop.stroke, aToe.stroke, bDrop.stroke, bToe.stroke])
      .toEqual([body.stroke, body.stroke, body.stroke, body.stroke]);
  });

  it('端はポケットの外縁に合い、爪はフランジの下へ回り込む（＝掛かって見える）', () => {
    const S = ELEV_PART_STYLE;
    // 端の位置 = コマ（ポケット）の張り出しと同じ → クサビが皿の外縁に落ちる
    expect(S.railInsetGrid).toBe(S.komaHalfGrid);
    // 爪は支柱の中心までで止める（越えると隣スパンの手摺と重なる）
    expect(S.railHookToeGrid).toBeLessThanOrEqual(S.railInsetGrid);
    // 落ちはフランジ（皿）をまたぐ深さ。唇より深く、部材の太さ程度
    expect(S.railHookDropGrid).toBeGreaterThan(S.komaLipGrid);
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

  // E-8-v2u: コマは「受け口（メス）」。皿（水平）＋外端の唇（上向き）の 3 本で 1 個。
  const plates = komaMarks.filter((p) => p.kind === 'line' && p.y1 === p.y2);
  const lips = komaMarks.filter((p) => p.kind === 'line' && p.x1 === p.x2);

  it('支柱 1 本ごとにコマ列ぶんの受け口が出る（分割しても重複・欠落なし）', () => {
    const komaCount = sg.postXs.length * sg.komaGridMm.length;
    expect(plates).toHaveLength(komaCount);
    expect(lips).toHaveLength(komaCount * 2);          // 左右の唇
    expect(komaMarks).toHaveLength(komaCount * 3);
  });

  it('皿は水平で支柱の中心に左右対称', () => {
    const m = plates[0];
    if (m.kind !== 'line') throw new Error('line が出ていない');
    expect(m.y1).toBe(m.y2);
    expect(m.x2 - m.x1).toBe(ELEV_PART_STYLE.komaHalfGrid * 2);
  });

  it('唇は皿の外端から「上向き」に立つ＝受け口が上を向いている', () => {
    const S = ELEV_PART_STYLE;
    const plate = plates[0];
    if (plate.kind !== 'line') throw new Error('形が違う');
    const center = (plate.x1 + plate.x2) / 2;   // その皿が付いている支柱
    const pair = lips.filter((p) => p.kind === 'line' && p.y1 === plate.y1
      && Math.abs(p.x1 - center) <= S.komaHalfGrid + 1e-6);
    expect(pair).toHaveLength(2);
    for (const p of pair) {
      if (p.kind !== 'line') throw new Error('形が違う');
      expect(Math.abs(p.x1)).toBeCloseTo(Math.abs(p.x2));          // 垂直
      expect(p.y2).toBe(p.y1 - S.komaLipGrid);                      // ローカル y は上が負
      expect(Math.abs(p.x1 - (plate.x1 + plate.x2) / 2)).toBeCloseTo(S.komaHalfGrid);
    }
  });

  it('コマの高さはコマ列そのもの（ローカル y = -mm/10）', () => {
    const ys = new Set(plates.map((p) => (p.kind === 'line' ? p.y1 : NaN)));
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

  // E-8-v2u: 接合はオス・メスのペア。
  //   上端 = 受け（カップ・太い）／下端 = ホゾ（差し込み・細い）。
  const S = ELEV_PART_STYLE;
  const vert = (stroke: string, widthGrid: number) => byKind('post').filter(
    (p) => p.kind === 'line' && p.stroke === stroke && p.x1 === p.x2 && p.widthGrid === widthGrid);
  const cups = vert(ELEV_PART_COLORS.joint, S.jointCupGrid);
  const spigots = vert(ELEV_PART_COLORS.joint, S.jointSpigotGrid);

  it('受け（メス）は部材の上端すべてに出る＝「ここに継げる」が常に見える', () => {
    expect(cups).toHaveLength(sg.postXs.length * segs.length);
    for (const p of cups) {
      if (p.kind !== 'line') throw new Error('形が違う');
      expect(p.y2).toBe(p.y1 + S.jointCupLenGrid);   // 上端から下へ（ローカル y は下が正）
    }
    // 部材の天の高さに出ている
    const ys = new Set(cups.map((p) => (p.kind === 'line' ? p.y1 : NaN)));
    expect(ys).toEqual(new Set(segs.map((s) => -s.topMm / 10)));
  });

  it('ホゾ（オス）は下に部材がある側だけに出て、受けより長く突き出す', () => {
    expect(spigots).toHaveLength(sg.postXs.length * (segs.length - 1));
    for (const p of spigots) {
      if (p.kind !== 'line') throw new Error('形が違う');
      expect(p.y1).toBeCloseTo(-segs[0].topMm / 10);          // 上段の下端＝継ぎ目
      expect(p.y2).toBe(p.y1 + S.jointSpigotLenGrid);         // 下へ差し込む
    }
    // 差し込みが見えるよう、ホゾはカップより長い
    expect(S.jointSpigotLenGrid).toBeGreaterThan(S.jointCupLenGrid);
  });

  it('太さがオス・メスの関係になっている（飲み込む側/飲み込まれる側）', () => {
    expect(S.jointCupGrid).toBeGreaterThan(S.postWidthGrid);      // 受けは支柱より太い
    expect(S.jointSpigotGrid).toBeLessThan(S.postWidthGrid);      // ホゾは支柱より細い
    expect(S.jointCupEdgeGrid).toBeGreaterThan(S.jointCupGrid);   // 縁取りが一回り外
    expect(S.jointCupEdgeMinPx).toBeGreaterThan(S.jointCupMinPx); // 縮小時も縁が残る
    const edges = vert(ELEV_PART_COLORS.jointEdge, S.jointCupEdgeGrid);
    expect(edges).toHaveLength(cups.length);
  });

  it('継ぎ目では受けとホゾが同じ高さで出会う＝刺さって見える', () => {
    const jointY = -segs[0].topMm / 10;
    const cupHere = cups.filter((p) => p.kind === 'line' && p.y1 === jointY);
    const spigotHere = spigots.filter((p) => p.kind === 'line' && p.y1 === jointY);
    expect(cupHere).toHaveLength(sg.postXs.length);
    expect(spigotHere).toHaveLength(sg.postXs.length);
    // 受け口の縁（口の線）はコマより広く・太い＝コマと取り違えない
    expect(S.jointHalfGrid).toBeGreaterThan(S.komaHalfGrid);
    expect(S.jointWidthPx).toBeGreaterThan(S.komaWidthPx);
    const mouths = byKind('post').filter((p) => p.kind === 'line'
      && p.stroke === ELEV_PART_COLORS.jointEdge && p.y1 === p.y2);
    expect(mouths).toHaveLength(cups.length);
  });

  it('丸は足元（ジャッキに載る座）だけ', () => {
    const caps = byKind('post').filter((p) => p.kind === 'circle');
    expect(caps).toHaveLength(sg.postXs.length);
    for (const c of caps) {
      expect(c.kind === 'circle' && c.y).toBeCloseTo(-sg.jackTopMm / 10);
    }
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
