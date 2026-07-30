// ============================================================
// 立面の部材の見た目 (E-8-v2f・pure・node 安全)
//
// 実機指摘: 平面図の部材は「太い色線＋両端の丸ハンドル」で一目で部材と分かるのに、
// 立面図は全部が細い線で「部材がそもそもわからない、線じゃん」。
// Parts-first でデータは部材になったので、描画も平面と同じ視覚言語に揃える。
//
// ここが部材描画の single source。
//   ・partsToPrimitives (= 部材ブロックからの描画・キャンバス配置版)
//   ・faceElevationToPrimitives (= 旧 primitives 経路・部材化前のビュー)
// の両方がこの emit 関数を呼ぶので、二重管理にならない
// （「部材から起こした絵 == 自動生成の絵」の一致テストがそのまま見た目の保証になる）。
// モーダルプレビュー(SVG)は別実装だが、色・太さはここの定数を参照する。
//
// 単位の約束:
//   ・座標はグループローカル（横=面軸グリッド、縦=-(mm/10)、GL=0・上が負）
//   ・太さ(width)・ハンドル半径(r) は screen px。描画側は strokeScaleEnabled=false なので
//     viewBox 縮尺やズームに依らず一定＝縮小配置しても部材が線に潰れない。
//     平面は zoom 比例(24*zoom px)だが、立面は 1/100 前後まで縮めて置けるため px 固定にし、
//     平面の「線の太さとハンドル径の比率」だけを写している。
// ============================================================
import { HANDRAIL_COLORS, getHandrailColor } from '@/lib/konva/handrailColors';
import type { ElevationPrimitive, ElevationPrimitiveMeta, HandrailLengthMm } from '@/types';

/** 選択色。平面(ScaffoldLayer)の選択色と同値。 */
export const ELEV_SELECT_COLOR = '#FF6B35';

/** 部材の色。手摺は平面の長さ別カラー(HANDRAIL_COLORS)をそのまま使う。 */
export const ELEV_PART_COLORS = {
  post: '#FFD700',
  board: '#4ECDC4',
  /** 踏板の輪郭（帯に見せるための濃い縁）。 */
  boardEdge: '#1E6F6A',
  /** 手摺の既定色 = 平面の 1800 手摺と同色。 */
  rail: getHandrailColor(1800),
  brace: '#B08CFF',
} as const;

/** 部材の太さ・ハンドル径（screen px）と、ジャッキのベース幅（グリッド）。 */
export const ELEV_PART_STYLE = {
  railWidth: 3.2,
  railHandleR: 3,
  boardWidth: 6,
  boardEdgeWidth: 8.4,
  postWidth: 4.2,
  postCapR: 2.6,
  braceWidth: 3,
  braceHandleR: 2.4,
  /** ジャッキのベース記号の底辺（太さ px）。 */
  jackBaseWidth: 5,
  /** 同・底辺の片側幅（グリッド＝実寸 14mm 相当）。 */
  jackBaseHalfGrid: 1.4,
} as const;

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

type Out = ElevationPrimitive[];

const line = (
  out: Out, x0: number, y0: number, x1: number, y1: number,
  stroke: string, width: number, opacity: number | undefined, meta: ElevationPrimitiveMeta,
) => out.push({ kind: 'line', x1: x0, y1: y0, x2: x1, y2: y1, stroke, width, dash: undefined, opacity, meta });

const dot = (
  out: Out, x: number, y: number, r: number, fill: string,
  opacity: number | undefined, meta: ElevationPrimitiveMeta,
) => out.push({ kind: 'circle', x, y, r, fill, opacity, meta });

/**
 * 手摺（コマ横線）: 平面と同じ「長さ別カラーの太線＋両端の丸ハンドル」。
 * spanMm は色決めだけに使う（描画レンジは x0..x1＝入隅切断込みの実測）。
 */
export function pushRail(
  out: Out, x0: number, x1: number, y: number, spanMm: number, meta: ElevationPrimitiveMeta,
): void {
  const c = railColorForSpanMm(spanMm);
  const S = ELEV_PART_STYLE;
  line(out, x0, y, x1, y, c, S.railWidth, 0.95, meta);
  dot(out, x0, y, S.railHandleR, c, 0.95, meta);
  dot(out, x1, y, S.railHandleR, c, 0.95, meta);
}

/**
 * 踏板（作業床）: 塗りのある帯。濃い縁の太線の上に本体色を重ねて「輪郭付きの帯」にする
 * （太さを px 固定にしたいので rect ではなく線 2 枚で作る）。
 */
export function pushBoard(out: Out, x0: number, x1: number, y: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x0, y, x1, y, C.boardEdge, S.boardEdgeWidth, 0.9, meta);
  line(out, x0, y, x1, y, C.board, S.boardWidth, 0.95, meta);
}

/** 支柱: 太い縦線＋上下端の端点マーク。 */
export function pushPost(out: Out, x: number, yBottom: number, yTop: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x, yBottom, x, yTop, C.post, S.postWidth, undefined, meta);
  dot(out, x, yTop, S.postCapR, C.post, undefined, meta);
  dot(out, x, yBottom, S.postCapR, C.post, undefined, meta);
}

/** ジャッキ: ベース記号（下広がりの台形＋底辺の太線）。 */
export function pushJack(out: Out, x: number, yTop: number, yGL: number, meta: ElevationPrimitiveMeta): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  const h = S.jackBaseHalfGrid;
  out.push({
    kind: 'polygon',
    points: [x - 0.5, yTop, x + 0.5, yTop, x + h, yGL, x - h, yGL],
    fill: C.post, fillOpacity: 0.9, stroke: undefined, width: undefined, meta,
  });
  line(out, x - h, yGL, x + h, yGL, C.post, S.jackBaseWidth, 1, meta);
}

/** 筋交: 太い斜線＋両端の丸ハンドル。 */
export function pushBrace(
  out: Out, x0: number, y0: number, x1: number, y1: number, meta: ElevationPrimitiveMeta,
): void {
  const C = ELEV_PART_COLORS, S = ELEV_PART_STYLE;
  line(out, x0, y0, x1, y1, C.brace, S.braceWidth, 0.9, meta);
  dot(out, x0, y0, S.braceHandleR, C.brace, 0.9, meta);
  dot(out, x1, y1, S.braceHandleR, C.brace, 0.9, meta);
}
