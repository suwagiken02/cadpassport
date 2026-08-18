// ============================================================
// 方向入力の 1 歩ぶんの終点 (= S-2)・pure
//
// 実際の敷地は直角ばかりではないので、敷地だけ「斜め 4 方向」と「選んだ方向から
// さらに左右へ傾ける」を足す。躯体・屋根は上下左右の 4 方向のまま（平面の絶対原則
// 「建物と足場は必ず平行」を壊さないため）。ここは計算だけを持ち、どちらを使うかは
// 呼び出し側（＝ pendingTargetType）が決める。
//
// ■ 座標系
// キャンバスのグリッド。x は右が正、**y は下が正**（画面と同じ向き）。
// 角度は +x 軸から時計回り（画面で見たとおり）の度数。
//   right = 0 / downRight = 45 / down = 90 / downLeft = 135
//   left = 180 / upLeft = 225 / up = 270 / upRight = 315
//
// ■ 「左に傾ける」の意味
// 進む向きに対して**画面で見た左**へ傾ける。y が下向きなので、画面上の
// 反時計回り＝角度を減らす方向になる。
//   ↑ を左に 5° → 真上から少し左（西）へ
//   → を左に 5° → 真右から少し上（北）へ
//
// ■ 従来との一致
// 傾き 0 の上下左右は**三角関数を通さず、従来とまったく同じ足し算**で返す。
// cos(270°) が厳密な 0 にならないための誤差すら入れない＝1 ミリもずれない。
// ============================================================
import { GRID_UNIT_MM } from './gridUtils';
import type { Point } from '@/types';

/** 上下左右（躯体・屋根・障害物はこれだけ）。 */
export type PadDir4 = 'up' | 'down' | 'left' | 'right';
/** 斜めを含む 8 方向（敷地のみ）。 */
export type PadDir8 = PadDir4 | 'upLeft' | 'upRight' | 'downLeft' | 'downRight';
/** 傾ける向き。進行方向に対して画面で見た左／右。 */
export type TiltSide = 'left' | 'right';

export const PAD_DIRS_4: readonly PadDir4[] = ['up', 'down', 'left', 'right'];
export const PAD_DIRS_DIAGONAL: readonly PadDir8[] = ['upLeft', 'upRight', 'downLeft', 'downRight'];
export const PAD_DIRS_8: readonly PadDir8[] = [...PAD_DIRS_4, ...PAD_DIRS_DIAGONAL];

export const isDiagonalDir = (dir: PadDir8): boolean =>
  (PAD_DIRS_DIAGONAL as readonly string[]).includes(dir);

/** 方向の基準角(度)。画面座標（y が下向き）で +x 軸から時計回り。 */
export const DIR_BASE_DEG: Record<PadDir8, number> = {
  right: 0,
  downRight: 45,
  down: 90,
  downLeft: 135,
  left: 180,
  upLeft: 225,
  up: 270,
  upRight: 315,
};

/** キャラの向き（Konva の rotation・↑ が 0）。 */
export const DIR_FACING_ROTATION: Record<PadDir8, number> = {
  up: 0,
  upRight: 45,
  right: 90,
  downRight: 135,
  down: 180,
  downLeft: 225,
  left: 270,
  upLeft: 315,
};

/** 表示用の矢印と名前。 */
export const DIR_LABEL: Record<PadDir8, string> = {
  up: '↑ 上方向',
  down: '↓ 下方向',
  left: '← 左方向',
  right: '→ 右方向',
  upLeft: '↖ 左上方向',
  upRight: '↗ 右上方向',
  downLeft: '↙ 左下方向',
  downRight: '↘ 右下方向',
};

/** よく使う傾き角のプリセット（距離プリセットと同じ作法で並べる）。 */
export const TILT_PRESET_DEG: readonly number[] = [0, 5, 10, 15, 30, 45];

/** 傾きの上限（これ以上はもう「隣の方向」を選んだ方が早い）。 */
export const TILT_MAX_DEG = 89.9;

export const clampTiltDeg = (deg: number): number => {
  if (!Number.isFinite(deg)) return 0;
  return Math.min(TILT_MAX_DEG, Math.max(0, deg));
};

/** 実際に進む向き(度)。傾き 0 なら基準角そのもの。 */
export function headingDeg(dir: PadDir8, tiltDeg = 0, tiltSide: TiltSide = 'left'): number {
  const t = clampTiltDeg(tiltDeg);
  // 画面で見た左＝反時計回り＝角度を減らす（y が下向きのため）
  return DIR_BASE_DEG[dir] + (tiltSide === 'left' ? -t : t);
}

/** 浮動小数のごみを落とす（0.01mm まで）。座標の意味は変わらない。 */
const tidy = (v: number): number => Math.round(v * 1e4) / 1e4;

/**
 * その方向へ distanceMm だけ進んだ先（グリッド座標）。
 * 傾き 0 の上下左右は従来とまったく同じ足し算（三角関数を通さない）。
 */
export function stepEndpoint(
  from: Point,
  dir: PadDir8,
  distanceMm: number,
  tiltDeg = 0,
  tiltSide: TiltSide = 'left',
): Point {
  const distGrid = distanceMm / GRID_UNIT_MM;
  const t = clampTiltDeg(tiltDeg);

  if (t === 0) {
    // 従来の経路そのもの。誤差を 1 ビットも入れない。
    if (dir === 'up') return { x: from.x, y: from.y - distGrid };
    if (dir === 'down') return { x: from.x, y: from.y + distGrid };
    if (dir === 'left') return { x: from.x - distGrid, y: from.y };
    if (dir === 'right') return { x: from.x + distGrid, y: from.y };
  }

  const rad = (headingDeg(dir, t, tiltSide) * Math.PI) / 180;
  return {
    x: tidy(from.x + distGrid * Math.cos(rad)),
    y: tidy(from.y + distGrid * Math.sin(rad)),
  };
}
