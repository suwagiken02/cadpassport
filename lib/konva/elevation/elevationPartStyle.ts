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
import { KOMA_PITCH_MM } from './komaGrid';
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
  /** 継ぎ目スリーブの縁取り・境目の線 (= E-8-v2o)。輪郭を出して膨らみとして読ませる。 */
  jointEdge: '#4A2000',
  /**
   * 作図の補助（補助線・目印）(= E-8-v5c)。**部材ではない**ので、図面の主役
   * （黒＝建物・青＝手摺・黄＝支柱）より必ず控えめな灰色にする。
   * 主役を隠さないことが最優先なので、色でも線種でも一目で「下地」と分かる形にした。
   */
  aid: '#9CA3AF',
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
  /**
   * 手摺をスパン端から内側に寄せる量。支柱位置に切れ目を作る。
   * E-8-v2u: ポケット(コマ)の外縁と同じにして、フックがフランジに掛かる位置で終わるようにした。
   */
  railInsetGrid: 4.5,
  /**
   * 手摺端の下向きフック＝クサビ(オス) (= E-8-v2l / E-8-v2u)。
   * 実物のクサビ式手摺は両端に下向きのフック金具が付き、支柱のポケット(フランジ)に
   * 上から差し込んで固定する。立面＝横から見た形なので「端で下へ折れ、爪が支柱側へ回り込む」
   * 鉤で描く。端をポケットの外縁に合わせてあるので、掛かると爪がフランジを抱く絵になる。
   */
  railHookDropGrid: 6,    // 下向きの落ち 60mm（フランジをまたぐ深さ）
  railHookToeGrid: 4.5,   // 爪 45mm（支柱側＝フランジの下へ回り込む）
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

  // コマ = ポケット（受け口・メス）(= E-8-v2u)。
  //   単なる横棒では「どこに刺さるのか」が読めなかった（鮎澤氏）。実物のフランジは
  //   支柱の左右へ張り出した皿で、そこへ手摺のクサビを上から落とし込む。
  //   記号も「左右へ張り出した皿＋外端の立ち上がり（受け口が上を向いている）」にする。
  komaWidthPx: 2.5,
  /** コマの片側の張り出し（グリッド）。支柱(6)より広くして「乗っている」ように見せる。 */
  komaHalfGrid: 4.5,
  /** 受け口の立ち上がり（皿の外端で上を向く唇）。 */
  komaLipGrid: 2.5,

  // 継ぎ目 (= E-8-v2o → E-8-v2u): オス・メスのペアで描く。
  //   ・部材の上端 = 受け（メス）。次の部材を受けるカップ。支柱より太い短い帯＋濃い縁取り
  //   ・部材の下端 = ホゾ（オス）。下の部材のカップへ差し込む細い突起（支柱より細い）
  //   両方が同じ高さで出会うと、太いカップの中に細いホゾが刺さった絵になる。
  //   どちらの部材が先に描かれても分かるよう、ホゾはカップより長く出す。
  /** 受け（カップ）の縦の長さ。上端から下へこのぶん。 */
  jointCupLenGrid: 5,
  /** 受けの太さ（支柱 6 より太い＝飲み込む側）。 */
  jointCupGrid: 11,
  jointCupMinPx: 6,
  /** 受けの縁取り（本体より一回り外・濃色）。 */
  jointCupEdgeGrid: 14,
  jointCupEdgeMinPx: 7.5,
  /** ホゾ（差し込み）の長さ。カップ(5)より長く出して、刺さっているのが分かるように。 */
  jointSpigotLenGrid: 7,
  /** ホゾの太さ（支柱 6 より細い＝飲み込まれる側）。 */
  jointSpigotGrid: 3.2,
  jointSpigotMinPx: 2.2,
  /** 受け口の縁（カップの口を示す線）の張り出し（片側）。コマ(4.5)より広い。 */
  jointHalfGrid: 8,
  /** 受け口の縁の太さ(px 固定)。コマ(2.5)より太い。 */
  jointWidthPx: 3,
  // 作図の補助 (= E-8-v5c)。部材より細く・薄く・破線＝図面の主役を隠さない。
  aidWidthGrid: 2,          // 20mm 相当（手摺 8 の 1/4）
  aidWidthMinPx: 1,
  aidOpacity: 0.9,
  /** 破線の刻み（グリッド）。実寸なのでズームに追従する。 */
  aidDashGrid: [12, 8] as number[],
  /** 目印の十字の腕の長さ（グリッド＝150mm）。 */
  aidPointArmGrid: 15,
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
 * 部材を掴める幅(px) (= E-8-v2p)。指の基準で、見た目より広い透明ヒットを持たせる。
 *
 * 実機: 「支柱を掴む判定が難しすぎる。細い縦線を正確に踏まないと選択・ドラッグできない」。
 * 支柱は細い縦線で、しかも長さ方向にしか逃げ場が無いので最優先で広げる。
 * 手摺・踏板は 450mm 刻みで上下に並ぶため、広げすぎると隣の段と食い合って
 * 狙った段を選べなくなる。そこで「コマ間隔の 80%」で頭打ちにする
 * （ズームを引くほど自動的に細くなり、隣と取り合わない）。
 * 見た目より細くはしない（太い部材はその太さぶん掴める）。
 */
export const ELEV_HIT_PX = {
  /** 支柱・ジャッキ（細い縦線）。左右合計。 */
  post: 22,
  /** 手摺・踏板・嵩上げ（横線）。上下合計。 */
  rail: 18,
  /** 背景要素（寸法線・文字など）。 */
  other: 14,
} as const;

export function partHitPx(
  kind: ElevationPrimitiveMeta['kind'] | undefined, visualPx: number, pxPerGrid: number,
): number {
  const isPost = kind === 'post' || kind === 'jack';
  const isSpanPart = kind === 'rail' || kind === 'board' || kind === 'raise';
  const target = isPost ? ELEV_HIT_PX.post : isSpanPart ? ELEV_HIT_PX.rail : ELEV_HIT_PX.other;
  // 上下に並ぶ部材だけ、隣の段と食い合わないところで止める（支柱の左右は隣の支柱まで遠い）。
  const cap = isSpanPart && pxPerGrid > 0
    ? (KOMA_PITCH_MM / 10) * pxPerGrid * 0.8
    : Infinity;
  return Math.max(visualPx, Math.min(target, cap));
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

/**
 * コマ ＝ ポケット（受け口・メス）(= E-8-v2u)。
 * 支柱の左右へ張り出した皿（フランジ）＋外端の立ち上がり。受け口が上を向いているので、
 * 手摺のクサビ（下向きフック）が上から落ちて掛かる、という関係が形で読める。
 */
export function pushKoma(out: Out, x: number, y: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  const inner = S.postWidthGrid / 2;      // 支柱の縁から出す
  line(out, x - S.komaHalfGrid, y, x + S.komaHalfGrid, y, C.koma, S.komaWidthPx, undefined, 1, meta);
  for (const dir of [-1, 1]) {
    // 外端の唇（上向き）。ここがクサビの落ちる口。
    line(out, x + dir * S.komaHalfGrid, y, x + dir * S.komaHalfGrid, y - S.komaLipGrid,
      C.koma, S.komaWidthPx, undefined, 1, meta);
  }
  void inner;
}

/**
 * 部材の上端 ＝ 受け（メス・カップ）(= E-8-v2u)。
 * 支柱より太い短い帯＋濃い縁取り＋口の線。次の部材のホゾをここで飲み込む。
 * どの支柱部材の上端にも出るので、「ここに継げる」が常に見えている。
 */
export function pushJointCup(out: Out, x: number, yTop: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  const yIn = yTop + S.jointCupLenGrid;   // ローカル y は下向きが正＝上端から下へ
  line(out, x, yTop, x, yIn, C.jointEdge, S.jointCupEdgeMinPx, S.jointCupEdgeGrid, 1, meta);
  line(out, x, yTop, x, yIn, C.joint, S.jointCupMinPx, S.jointCupGrid, 1, meta);
  // 口（受け側の縁）。カップより左右へはみ出させて「開いている」ことを示す。
  line(out, x - S.jointHalfGrid, yTop, x + S.jointHalfGrid, yTop,
    C.jointEdge, S.jointWidthPx, undefined, 1, meta);
}

/**
 * 部材の下端 ＝ ホゾ（オス・差し込み）(= E-8-v2u)。
 * 支柱より細い突起を下へ出す。下に部材があればその受け（カップ）の中に入り、
 * 無ければ宙に突き出したまま＝まだ接合していないことが分かる。
 */
export function pushJointSpigot(
  out: Out, x: number, yBottom: number, meta: ElevationPrimitiveMeta,
): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x, yBottom, x, yBottom + S.jointSpigotLenGrid,
    C.joint, S.jointSpigotMinPx, S.jointSpigotGrid, 1, meta);
}

/** pushPost の描き分け。支柱を規格部材ごとに分けて描くための指定 (= E-8-v2j/v2u)。 */
export type PostDrawOpts = {
  /** コマ(ポケット)の縦位置（ローカル y）。 */
  komaYs?: number[];
  /**
   * 下端を「足元（座）」として描くか。既定 true。
   * false ＝下に別の部材がある／継ぎ足した部材なので、ホゾ（オス）を出す。
   */
  capBottom?: boolean;
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
  for (const ky of opts?.komaYs ?? []) pushKoma(out, x, ky, meta);
  // E-8-v2u: 端は接合のオス・メスで描く。上端＝受け（カップ）、下端＝ホゾ（差し込み）。
  //   上下の部材が同じ高さで出会うと、太いカップに細いホゾが刺さった絵になる。
  pushJointCup(out, x, yTop, meta);
  if (opts?.capBottom !== false) {
    // 足元（ジャッキに載る側）は座。差し込みではないので丸で締める。
    out.push({
      kind: 'circle', x, y: yBottom, r: S.postCapMinPx, rGrid: S.postCapGrid,
      fill: C.post, stroke: C.postEdge, strokeWidth: 1, meta,
    });
  } else {
    pushJointSpigot(out, x, yBottom, meta);
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

/**
 * 補助線 (= E-8-v5c)。部材の装飾（フック・コマ・輪郭）を一切持たない素の破線。
 * 傾きは呼び出し側（partsToPrimitives）の angleDeg 回転がそのまま効くので、
 * ここでは常に水平の 1 本として出す。
 */
export function pushAidLine(
  out: Out, x0: number, x1: number, y: number, meta: ElevationPrimitiveMeta,
): void {
  out.push({
    kind: 'line', x1: x0, y1: y, x2: x1, y2: y,
    stroke: ELEV_PART_COLORS.aid,
    width: ELEV_PART_STYLE.aidWidthMinPx, widthGrid: ELEV_PART_STYLE.aidWidthGrid,
    dash: ELEV_PART_STYLE.aidDashGrid, opacity: ELEV_PART_STYLE.aidOpacity, meta,
  });
}

/**
 * 目印 (= E-8-v5c)。**十字（＋）で描く**。
 * 円ではなく線 2 本にしてあるのは、DXF が circle を出力しないため
 * （dxfExport は line/rect/polygon だけを出す）。十字なら出力にもそのまま乗る。
 * 大きさは実寸（ズームに追従）で、他の部材と作法を揃える。
 */
export function pushAidPoint(
  out: Out, x: number, y: number, meta: ElevationPrimitiveMeta,
): void {
  const r = ELEV_PART_STYLE.aidPointArmGrid;
  const seg = (x0: number, y0: number, x1: number, y1: number) => out.push({
    kind: 'line' as const, x1: x0, y1: y0, x2: x1, y2: y1,
    stroke: ELEV_PART_COLORS.aid,
    width: ELEV_PART_STYLE.aidWidthMinPx, widthGrid: ELEV_PART_STYLE.aidWidthGrid,
    dash: undefined, opacity: ELEV_PART_STYLE.aidOpacity, meta,
  });
  seg(x - r, y, x + r, y);
  seg(x, y - r, x, y + r);
}
