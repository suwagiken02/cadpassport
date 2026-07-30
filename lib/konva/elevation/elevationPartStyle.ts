// ============================================================
// 立面の部材の見た目 (E-8-v2f/v2g/v2h・pure・node 安全)
//
// 実機指摘の流れ:
//   v2f 前: 全部が細い線で「部材がそもそもわからない、線じゃん」
//   v2h 前: 太くはなったが「まだ平面に比べてモジュール感が弱い・連続した線に見える」
//           「コマが支柱色に溶けて見えない」
// → 1 本 = 1 モジュールに見える描画にする。
//
// ■ 平面(ScaffoldLayer)の実寸換算
//   平面は手摺 strokeWidth = 24*zoom px、丸ハンドル r = 24*zoom px、1グリッド = 3*zoom px。
//   つまり実寸で「太さ 8 グリッド(=80mm)・ハンドル半径 8 グリッド(=80mm)」。
//   立面もこの実寸比をそのまま使う（= 平面と同じ見た目）。
//
// ■ ただし px 下限を持たせる
//   立面は 1/100 前後まで縮めて配置できるので、実寸比だけだと線に潰れる。
//   そこで線幅・半径は「max(下限px, グリッド値 × px/グリッド)」で描く。
//   プリミティブは width(=下限px) と widthGrid(=実寸) の両方を持ち、描画側が解決する。
//
// ■ モジュール感
//   ・手摺/踏板はスパン端から少し内側に描く → 支柱位置に切れ目ができ、連続線に見えない
//   ・両端の丸ハンドル（平面と同じ大きさ・塗り）で「1 本のモノ」に見せる
//   ・支柱は上下端キャップで「1 本の棒」に、コマは濃色の横棒ではっきり乗せる
//
// ここが部材描画の single source。partsToPrimitives（部材ブロック経路）と
// faceElevationToPrimitives（旧 primitives 経路）の両方がこの emit を呼ぶ。
// モーダルプレビュー(SVG)は別実装だが、同じ定数と partWidthPx を参照する。
//
// 座標はグループローカル（横=面軸グリッド、縦=-(mm/10)、GL=0・上が負）。
// ============================================================
import { HANDRAIL_COLORS, getHandrailColor } from '@/lib/konva/handrailColors';
import { KOMA_PITCH_MM } from './elevationEngine';
import type { ElevationPrimitive, ElevationPrimitiveMeta, HandrailLengthMm } from '@/types';

/** 選択色。平面(ScaffoldLayer)の選択色と同値。 */
export const ELEV_SELECT_COLOR = '#FF6B35';

/** 部材の色。手摺は平面の長さ別カラー(HANDRAIL_COLORS)をそのまま使う。 */
export const ELEV_PART_COLORS = {
  post: '#FFD700',
  /** 支柱の輪郭・端点キャップ（1 本の棒の輪郭を出す）。 */
  postEdge: '#7A6000',
  board: '#4ECDC4',
  /** 踏板の輪郭（パネルに見せるための濃い縁）。 */
  boardEdge: '#12514D',
  /** 手摺の既定色 = 平面の 1800 手摺と同色。 */
  rail: getHandrailColor(1800),
  brace: '#B08CFF',
  braceEdge: '#4C2E8A',
  /** コマ(受け金具)の印 (= E-8-v2h)。明黄だと支柱色に溶けるので濃茶＝ホゾ受けの記号感。 */
  koma: '#3B2A00',
} as const;

/**
 * 部材の寸法。
 *   ○Grid = 実寸（1 グリッド = 10mm）。平面と同じ比率で太らせるための値。
 *   ○MinPx = 縮小時の下限（screen px）。これ以下には細くならない。
 */
export const ELEV_PART_STYLE = {
  // 手摺: 平面と完全に同じ（太さ 8 グリッド・ハンドル半径 8 グリッド）
  railWidthGrid: 8,
  railWidthMinPx: 3.2,
  railHandleGrid: 8,
  railHandleMinPx: 3,
  /** 手摺をスパン端から内側に寄せる量（ハンドル半径 8 ＋ 隙間 1）。支柱位置に切れ目を作る。 */
  railInsetGrid: 9,

  // 踏板: 1 枚のパネル（濃い縁 + 本体）
  boardWidthGrid: 7,
  boardWidthMinPx: 6,
  boardEdgeGrid: 10,
  boardEdgeMinPx: 8.4,
  /** 踏板をスパン端から内側に寄せる量（1 枚ずつ切れて見えるように）。 */
  boardInsetGrid: 2.5,

  // 支柱: 1 本の棒（実寸 60mm ≒ 単管）＋上下端キャップ
  postWidthGrid: 6,
  postWidthMinPx: 4.2,
  postCapGrid: 4.5,
  postCapMinPx: 2.8,

  // 筋交
  braceWidthGrid: 6,
  braceWidthMinPx: 3,
  braceHandleGrid: 6,
  braceHandleMinPx: 2.6,

  // ジャッキのベース記号
  jackBaseWidthGrid: 6,
  jackBaseMinPx: 5,
  /** ベース底辺の片側幅（グリッド）。 */
  jackBaseHalfGrid: 1.6,

  // コマ: 濃色の短い横棒。太さは px 固定（密なので実寸比で太らせると潰れる）。
  komaWidthPx: 2.5,
  /** コマの片側の張り出し（グリッド）。支柱(6)より広くして「乗っている」ように見せる。 */
  komaHalfGrid: 4.5,
} as const;

/**
 * 部材の線幅・半径(px)を解決する。
 * 平面と同じ実寸比（gridValue）で描き、縮小時も minPx を下回らせない。
 * pxPerGrid は「1 グリッドが画面上で何 px か」（= gridPx × view.scale）。
 */
export function partWidthPx(minPx: number, gridValue: number | undefined, pxPerGrid: number): number {
  if (gridValue == null || !(pxPerGrid > 0)) return minPx;
  return Math.max(minPx, gridValue * pxPerGrid);
}

/**
 * コマ（楔ポケット＝手摺の受け金具）の高さ列(mm)。
 * fromMm から 450 刻みで toMm 以下まで。ジャッキ上端(GL+150)起点で使う。
 * エンジンの ElevationLevels.komaGridMm と同じ定義（そちらは buildElevationLevels が持つ）。
 */
export function komaLevelsMm(
  fromMm: number, toMm: number, pitchMm: number = KOMA_PITCH_MM,
): number[] {
  const out: number[] = [];
  if (!(pitchMm > 0) || !(toMm >= fromMm)) return out;
  for (let h = fromMm; h <= toMm + 1e-6; h += pitchMm) out.push(Math.round(h));
  return out;
}

/**
 * スパン長(mm)から手摺色を引く。平面と同じ長さ別カラー。
 * 規格外の長さ（入隅切断などで端数になった場合）は 1800 と同じ青にフォールバックする
 * （平面の '#185FA5' フォールバックだと立面の暗背景で沈むため）。
 */
export function railColorForSpanMm(spanMm: number): string {
  return HANDRAIL_COLORS[Math.round(spanMm) as HandrailLengthMm] ?? ELEV_PART_COLORS.rail;
}

/**
 * x0 を含むスパンの「呼び寸」(mm)。手摺の色を平面と揃えるために使う。
 * 入隅で切断された手摺も部材としては元の長さなので、描画実長ではなく支柱間隔で引く。
 */
export function nominalSpanMm(postXs: number[], x0: number): number {
  for (let i = 0; i < postXs.length - 1; i++) {
    if (x0 >= postXs[i] - 1e-6 && x0 < postXs[i + 1] - 1e-6) return (postXs[i + 1] - postXs[i]) * 10;
  }
  const n = postXs.length;
  return n >= 2 ? (postXs[n - 1] - postXs[n - 2]) * 10 : 1800;
}

/**
 * スパン端から内側へ寄せた描画レンジ（支柱位置に切れ目を作る）。
 * 短い部材（入隅切断など）で反転しないよう、長さの 40% を上限にする。
 */
export function insetRange(x0: number, x1: number, insetGrid: number): { a: number; b: number } {
  const len = x1 - x0;
  if (!(len > 0)) return { a: x0, b: x1 };
  const g = Math.min(insetGrid, len * 0.4);
  return { a: x0 + g, b: x1 - g };
}

type Out = ElevationPrimitive[];

const line = (
  out: Out, x0: number, y0: number, x1: number, y1: number,
  stroke: string, minPx: number, widthGrid: number | undefined,
  opacity: number | undefined, meta: ElevationPrimitiveMeta,
) => out.push({
  kind: 'line', x1: x0, y1: y0, x2: x1, y2: y1,
  stroke, width: minPx, widthGrid, dash: undefined, opacity, meta,
});

const dot = (
  out: Out, x: number, y: number, minPx: number, rGrid: number | undefined, fill: string,
  opacity: number | undefined, meta: ElevationPrimitiveMeta,
) => out.push({ kind: 'circle', x, y, r: minPx, rGrid, fill, opacity, meta });

/**
 * 手摺（コマ横線）: 平面と同じ「長さ別カラーの太線＋両端の大きな丸ハンドル」。
 * スパン端から内側に寄せて描くので、隣のスパンの手摺とつながって見えない。
 * spanMm は色決めだけに使う（レンジは x0..x1＝入隅切断込みの実測）。
 */
export function pushRail(
  out: Out, x0: number, x1: number, y: number, spanMm: number, meta: ElevationPrimitiveMeta,
): void {
  const c = railColorForSpanMm(spanMm);
  const S = ELEV_PART_STYLE;
  const { a, b } = insetRange(x0, x1, S.railInsetGrid);
  line(out, a, y, b, y, c, S.railWidthMinPx, S.railWidthGrid, 1, meta);
  dot(out, a, y, S.railHandleMinPx, S.railHandleGrid, c, 1, meta);
  dot(out, b, y, S.railHandleMinPx, S.railHandleGrid, c, 1, meta);
}

/**
 * 踏板（作業床）: 1 枚のパネル。濃い縁の上に本体色を重ねて輪郭付きの帯にし、
 * スパン端は少し空けて「1 枚ずつ並んでいる」ように見せる。
 */
export function pushBoard(out: Out, x0: number, x1: number, y: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  const { a, b } = insetRange(x0, x1, S.boardInsetGrid);
  line(out, a, y, b, y, C.boardEdge, S.boardEdgeMinPx, S.boardEdgeGrid, 1, meta);
  line(out, a, y, b, y, C.board, S.boardWidthMinPx, S.boardWidthGrid, 1, meta);
}

/**
 * 支柱: 1 本の棒（太い縦線＋上下端キャップ）＋コマの印 (= E-8-v2g/v2h)。
 * komaYs はコマの縦位置（ローカル y）。実物の支柱には 450 刻みでコマが付いており、
 * 職人はそれを目印に手摺を掛けるので、立面でも見えないと手摺位置が読めない（鮎澤氏指摘）。
 * コマは濃色にして支柱の金色に溶けないようにする。
 */
export function pushPost(
  out: Out, x: number, yBottom: number, yTop: number, meta: ElevationPrimitiveMeta,
  komaYs?: number[],
): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x, yBottom, x, yTop, C.post, S.postWidthMinPx, S.postWidthGrid, undefined, meta);
  for (const ky of komaYs ?? []) {
    line(out, x - S.komaHalfGrid, ky, x + S.komaHalfGrid, ky, C.koma, S.komaWidthPx, undefined, 1, meta);
  }
  // 上下端キャップ（棒の端であることを明示。輪郭を付けて背景から浮かせる）
  for (const cy of [yTop, yBottom]) {
    out.push({
      kind: 'circle', x, y: cy, r: S.postCapMinPx, rGrid: S.postCapGrid,
      fill: C.post, stroke: C.postEdge, strokeWidth: 1, meta,
    });
  }
}

/** ジャッキ: ベース記号（下広がりの台形＋底辺の太線）。輪郭付きで 1 個のモノに見せる。 */
export function pushJack(out: Out, x: number, yTop: number, yGL: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  const h = S.jackBaseHalfGrid;
  out.push({
    kind: 'polygon',
    points: [x - 0.6, yTop, x + 0.6, yTop, x + h, yGL, x - h, yGL],
    fill: C.post, fillOpacity: 0.95, stroke: C.postEdge, width: 1, meta,
  });
  line(out, x - h, yGL, x + h, yGL, C.post, S.jackBaseMinPx, S.jackBaseWidthGrid, 1, meta);
}

/** 筋交: 太い斜線＋両端の丸ハンドル。 */
export function pushBrace(
  out: Out, x0: number, y0: number, x1: number, y1: number, meta: ElevationPrimitiveMeta,
): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x0, y0, x1, y1, C.brace, S.braceWidthMinPx, S.braceWidthGrid, 1, meta);
  dot(out, x0, y0, S.braceHandleMinPx, S.braceHandleGrid, C.brace, 1, meta);
  dot(out, x1, y1, S.braceHandleMinPx, S.braceHandleGrid, C.brace, 1, meta);
}
