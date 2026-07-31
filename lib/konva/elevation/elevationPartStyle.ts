// ============================================================
// 立面の部材の見た目 (E-8-v2f/v2g/v2h/v2j・pure・node 安全)
//
// 実機指摘の流れ:
//   v2f 前: 全部が細い線で「部材がそもそもわからない、線じゃん」
//   v2h 前: 太くはなったが「まだ平面に比べてモジュール感が弱い・連続した線に見える」
//           「コマが支柱色に溶けて見えない」
//   v2j 前: 「4 面配置で左 2 面が青・右 2 面が赤」＝手摺を平面と同じ長さ別カラーにしていたため、
//           面ごとに手摺サイズが揃っていると面全体の色が変わっていた。立面では情報にならない
//           ので全面統一色（平面の標準手摺 1800 と同じ青系）にする。
//
// ■ 平面(ScaffoldLayer)の実寸換算
//   平面は手摺 strokeWidth = 24*zoom px、丸ハンドル r = 24*zoom px、1グリッド = 3*zoom px。
//   つまり実寸で「太さ 8 グリッド(=80mm)・ハンドル半径 8 グリッド(=80mm)」。
//   立面もこの実寸比をそのまま使う（= 平面と同じ見た目）。
//
// ■ ただし px 下限を持たせる
//   立面は 1/100 前後まで縮めて配置できるので、実寸比だけだと線に潰れる。
//   線幅・半径は「max(下限px, グリッド値 × px/グリッド)」で描く。プリミティブは
//   width(=下限px) と widthGrid(=実寸) の両方を持ち、描画側が解決する。
//
// ■ モジュール感
//   ・手摺/踏板はスパン端から少し内側に描く → 支柱位置に切れ目ができ、連続線に見えない
//   ・両端の丸ハンドル（平面と同じ大きさ・塗り）で「1 本のモノ」に見せる
//   ・支柱は規格部材（8/6/4/2/1 コマ品）の積み重ねなので、継ぎ目に印を出す (= v2j)
//   ・コマは濃色の横棒ではっきり乗せる
//
// ここが部材描画の single source。partsToPrimitives（部材ブロック経路）と
// faceElevationToPrimitives（旧 primitives 経路）の両方がこの emit を呼ぶ。
// モーダルプレビュー(SVG)は別実装だが、同じ定数と partWidthPx を参照する。
//
// 座標はグループローカル（横=面軸グリッド、縦=-(mm/10)、GL=0・上が負）。
// ============================================================
import { HANDRAIL_COLORS } from '@/lib/konva/handrailColors';
import type { ElevationPrimitive, ElevationPrimitiveMeta } from '@/types';

// コマ格子・支柱の規格分割は komaGrid.ts。描画側からも引けるよう再 export する。
export {
  komaLevelsMm, komaLevelsFromJackMm, railKomaLevelsMm, splitPostKoma, postSegmentsMm,
  POST_KOMA_SIZES,
} from './komaGrid';

/** 選択色。平面(ScaffoldLayer)の選択色と同値。 */
export const ELEV_SELECT_COLOR = '#FF6B35';

/** 部材の色。 */
export const ELEV_PART_COLORS = {
  post: '#FFD700',
  /** 支柱の輪郭・端点キャップ（1 本の棒の輪郭を出す）。 */
  postEdge: '#7A6000',
  board: '#4ECDC4',
  /** 踏板の輪郭（パネルに見せるための濃い縁）。 */
  boardEdge: '#12514D',
  /**
   * 手摺の色 (= E-8-v2j)。全面統一。平面の標準手摺(1800)と同じ青系を参照する
   * （長さ別カラーは立面では面ごとに色が変わるだけで情報にならないため撤去した）。
   */
  rail: HANDRAIL_COLORS[1800],
  brace: '#B08CFF',
  /** コマ(受け金具)の印。明黄だと支柱色に溶けるので濃茶＝ホゾ受けの記号感。 */
  koma: '#3B2A00',
  /** 支柱の継ぎ目（規格部材のジョイント）。コマより明るく太くして区別する。 */
  joint: '#C86A00',
} as const;

/**
 * 部材の寸法。
 *   ○Grid = 実寸（1 グリッド = 10mm）。平面と同じ比率で太らせるための値。
 *   ○MinPx = 縮小時の下限（screen px）。これ以下には細くならない。
 */
export const ELEV_PART_STYLE = {
  // 手摺: 平面と同じ太さ（8 グリッド ＝ 80mm）
  railWidthGrid: 8,
  railWidthMinPx: 3.2,
  /** 手摺をスパン端から内側に寄せる量。支柱位置に切れ目を作る。 */
  railInsetGrid: 9,
  /**
   * 手摺端の下向きフック (= E-8-v2l)。実物のクサビ式手摺は両端に下向きのフック金具が付き、
   * 支柱のポケットに掛かる。立面＝横から見た形なので「端から下へ短い鉤」で描く。
   * 丸ハンドル（平面の表現）は実物と違ううえ、踏板(アンチ)と見分けが付きにくかった（鮎澤氏）。
   */
  railHookDropGrid: 12,   // 下向きの落ち 120mm
  railHookToeGrid: 5,     // 爪 50mm（支柱側＝外向き）
  railHookWidthGrid: 6,
  railHookWidthMinPx: 2.8,

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

  // 継ぎ目 (= E-8-v2j): コマより広く・太く出して規格部材の境目と分かるように。
  jointWidthPx: 3.5,
  jointHalfGrid: 6.5,
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
 * 手摺（コマ横線）: 太線＋両端の下向きフック金具 (= E-8-v2l・全面統一色)。
 * スパン端から内側に寄せて描くので、隣のスパンの手摺とつながって見えない。
 * フックは「縦に落ちて、支柱側へ爪が出る」鉤形。1 スパン 1 本の部材として読める。
 */
export function pushRail(
  out: Out, x0: number, x1: number, y: number, meta: ElevationPrimitiveMeta,
): void {
  const c = ELEV_PART_COLORS.rail;
  const S = ELEV_PART_STYLE;
  const { a, b } = insetRange(x0, x1, S.railInsetGrid);
  line(out, a, y, b, y, c, S.railWidthMinPx, S.railWidthGrid, 1, meta);
  // 両端のフック（縦の落ち＋外向きの爪）。爪は支柱側へ向ける＝掛かっているように見せる。
  const drop = y + S.railHookDropGrid;
  const hookLine = (x: number, toeX: number) => {
    line(out, x, y, x, drop, c, S.railHookWidthMinPx, S.railHookWidthGrid, 1, meta);
    line(out, x, drop, toeX, drop, c, S.railHookWidthMinPx, S.railHookWidthGrid, 1, meta);
  };
  hookLine(a, a - S.railHookToeGrid);
  hookLine(b, b + S.railHookToeGrid);
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

/** pushPost の描き分け。支柱を規格部材ごとに分けて描くための指定 (= E-8-v2j)。 */
export type PostDrawOpts = {
  /** コマ(受け金具)の縦位置（ローカル y）。 */
  komaYs?: number[];
  /** 下端キャップを描くか（規格部材の途中なら描かない）。既定 true。 */
  capBottom?: boolean;
  /** 上端キャップを描くか。既定 true。 */
  capTop?: boolean;
  /** 継ぎ目の印を出す縦位置（ローカル y）。上に別部材が載るときだけ指定する。 */
  jointY?: number;
};

/**
 * 支柱: 1 本の棒（太い縦線＋端キャップ）＋コマの印＋継ぎ目の印。
 * 実物の支柱には 450 刻みでコマが付いており、職人はそれを目印に手摺を掛けるので、
 * 立面でも見えないと手摺位置が読めない（鮎澤氏）。コマは濃色にして支柱の金色に溶けないようにする。
 * 支柱そのものは規格部材（8/6/4/2/1 コマ品）の積み重ねなので、継ぎ目にも印を出す。
 */
export function pushPost(
  out: Out, x: number, yBottom: number, yTop: number, meta: ElevationPrimitiveMeta,
  opts?: PostDrawOpts,
): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x, yBottom, x, yTop, C.post, S.postWidthMinPx, S.postWidthGrid, undefined, meta);
  for (const ky of opts?.komaYs ?? []) {
    line(out, x - S.komaHalfGrid, ky, x + S.komaHalfGrid, ky, C.koma, S.komaWidthPx, undefined, 1, meta);
  }
  if (opts?.jointY != null) {
    line(out, x - S.jointHalfGrid, opts.jointY, x + S.jointHalfGrid, opts.jointY,
      C.joint, S.jointWidthPx, undefined, 1, meta);
  }
  // 端キャップ（棒の端であることを明示。輪郭を付けて背景から浮かせる）
  const caps: number[] = [];
  if (opts?.capTop !== false) caps.push(yTop);
  if (opts?.capBottom !== false) caps.push(yBottom);
  for (const cy of caps) {
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
