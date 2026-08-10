// ============================================================
// 平面パレットの姿図プレビュー（階段・単管）(= P-1-fix・pure・node 安全)
//
// 立面パレット（elevationPartPreview.ts）と同じ作りにする:
//   **プレビュー専用の絵は描かない**。キャンバスに描くのとまったく同じ幾何関数
//   （stairCornersGrid / stairTreadLinesGrid / stairArrowGrid / pipeEndpointsGrid）
//   の結果を、そのまま viewBox に収めて見せる。
//   ＝ パレットの絵・ドラッグ中のシャドー・置いた結果が食い違わない。
//
// 座標系: グリッド（1 = 10mm・y は下向きが正）。SVG 側は viewBox で収める。
//
// ■ 枠の取り方（ここが階段と単管で違う）
//   階段 … 枠は「長辺 180 グリッド」に固定する。外形に合わせて伸縮させると
//          0°(縦長) と 90°(横長) が同じ大きさに見えてしまい、向きが読めない。
//          固定しておけば、縦長は細長く・横長は寝た形に見える。
//   単管 … 枠は「最長の既製品 6m」に固定する。だから 1m は枠の 1/6 の長さ、
//          6m は枠いっぱいに見える＝チップの中で長さの違いが読める。
// ============================================================
import { mmToGrid } from './gridUtils';
import {
  PIPE_MAX_LENGTH_MM, STAIR_LENGTH_MM,
  pipeEndpointsGrid, stairArrowGrid, stairCornersGrid, stairFootprintGrid, stairTreadLinesGrid,
} from './planeParts';
import type { Pipe, Stair } from '@/types';

export type PreviewLine = { x1: number; y1: number; x2: number; y2: number };
export type PreviewView = { x: number; y: number; w: number; h: number };

/** 枠に対する余白（1.0 でぴったり）。立面の姿図と同じ詰め方。 */
const PREVIEW_MARGIN = 1.18;

export type StairPreview = {
  /** 外形（グリッド）。 */
  outline: { x: number; y: number; w: number; h: number };
  /** 段板の区切り線。 */
  treads: PreviewLine[];
  /** 上る向き（矢の先が上り側）。 */
  arrow: { from: { x: number; y: number }; to: { x: number; y: number } };
  view: PreviewView;
  /** グリッド 1 単位が SVG 何 px か。px 指定の線幅はこれで割る。 */
  scale: number;
};

export type PipePreview = {
  line: PreviewLine;
  view: PreviewView;
  scale: number;
};

/** 中心 c を中心にした、一辺 side の正方形 viewBox。 */
function squareView(cx: number, cy: number, side: number): PreviewView {
  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
}

/**
 * 階段の姿図。向き（0/90/180/270）と上り反転がそのまま絵に出る。
 * size は SVG の一辺(px)。
 */
export function stairPreview(
  opts: { angleDeg?: number; flip?: boolean } = {}, size = 76,
): StairPreview {
  const stair: Stair = { id: 'preview', x: 0, y: 0, angleDeg: opts.angleDeg, flip: opts.flip };
  const { w, h } = stairFootprintGrid(stair.angleDeg);
  const corners = stairCornersGrid(stair);

  // 枠は長辺で固定（向きが分かるように、外形に合わせて伸縮させない）。
  const side = mmToGrid(STAIR_LENGTH_MM) * PREVIEW_MARGIN;
  const view = squareView(corners[0].x + w / 2, corners[0].y + h / 2, side);

  return {
    outline: { x: stair.x, y: stair.y, w, h },
    treads: stairTreadLinesGrid(stair),
    arrow: stairArrowGrid(stair),
    view,
    scale: size / side,
  };
}

/**
 * 単管の姿図。選んでいる長さと角度がそのまま絵に出る。
 * 枠は最長の既製品(6m)に固定するので、長さの違いが絵の長さの違いとして見える。
 */
export function pipePreview(
  opts: { lengthMm: number; angleDeg?: number }, size = 76,
): PipePreview {
  const pipe: Pipe = { id: 'preview', x: 0, y: 0, lengthMm: opts.lengthMm, angleDeg: opts.angleDeg };
  const [a, b] = pipeEndpointsGrid(pipe);

  const side = mmToGrid(PIPE_MAX_LENGTH_MM) * PREVIEW_MARGIN;
  const view = squareView((a.x + b.x) / 2, (a.y + b.y) / 2, side);

  return {
    line: { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
    view,
    scale: size / side,
  };
}
