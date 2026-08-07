// ============================================================
// 平面図の追加部材（階段・単管）の幾何 (= P-1・pure・node 安全)
//
// 既存の平面部材（手摺・支柱・アンチ）と同じく、位置はグリッド座標（1 = 10mm）で持つ。
// ここには「どこに置くか」「どんな形か」だけを置き、描画は Konva 側が使う。
//
// 階段: 600×1800mm。足場の 1 区画（600 手摺 2 本 × 1800 手摺 2 本で囲まれる枡）に
//       ぴったり納まる。手摺が実際に置いてあるかは見ない（区画の格子に合わせる）。
// 単管: 長さ自由・スナップ無し。既製品は 1〜6m。既定の角度は 45°。
// ============================================================
import { mmToGrid } from './gridUtils';
import type { Stair, Pipe } from '@/types';

/** 階段の実寸(mm)。600 手摺 × 1800 手摺の区画と同じ。 */
export const STAIR_WIDTH_MM = 600;
export const STAIR_LENGTH_MM = 1800;
/** 段板の枚数（600×1800 に並ぶ現場の標準的な見え方）。 */
export const STAIR_TREADS = 6;

/** 単管の既製品の長さ(mm)。任意長さは数値入力で作れる。 */
export const PIPE_PRESET_LENGTHS_MM = [1000, 2000, 3000, 4000, 5000, 6000] as const;
/** 単管の既定の角度(度)。0=右向き水平、正の値で時計回り（画面座標）。 */
export const PIPE_DEFAULT_ANGLE_DEG = 45;
/** 単管の長さの下限・上限(mm)。任意長さの入力を現実的な範囲に収める。 */
export const PIPE_MIN_LENGTH_MM = 100;
export const PIPE_MAX_LENGTH_MM = 6000;

/** 角度を 0/90/180/270 のいずれかに正規化する（階段は 90° 刻み）。 */
export function normalizeStairAngle(deg: number | undefined): 0 | 90 | 180 | 270 {
  const d = ((Math.round((deg ?? 0) / 90) * 90) % 360 + 360) % 360;
  return d as 0 | 90 | 180 | 270;
}

/**
 * 階段の外形（グリッド単位）。
 * 0°/180° は縦長（600 幅 × 1800 丈）、90°/270° は横長。
 */
export function stairFootprintGrid(angleDeg?: number): { w: number; h: number } {
  const a = normalizeStairAngle(angleDeg);
  const short = mmToGrid(STAIR_WIDTH_MM);    // 60
  const long = mmToGrid(STAIR_LENGTH_MM);    // 180
  return a === 90 || a === 270 ? { w: long, h: short } : { w: short, h: long };
}

/**
 * 階段を区画の格子へ吸着させる (= P-1)。
 *
 * 足場の区画は 600 手摺と 1800 手摺で仕切られるので、格子の目は
 * 「600 方向は 600mm ピッチ・1800 方向は 1800mm ピッチ」。
 * 手摺が実際に置いてあるかは見ない（置く前でも区画に合わせて置けるように）。
 *
 * 渡すのはカーソルのグリッド座標で、返すのは**左上角**の座標。
 */
export function snapStairToCellGrid(
  cursor: { x: number; y: number }, angleDeg?: number,
): { x: number; y: number } {
  const { w, h } = stairFootprintGrid(angleDeg);
  // カーソルを中心に置いたときの左上を、区画ピッチ（=外形そのもの）へ丸める
  const left = cursor.x - w / 2;
  const top = cursor.y - h / 2;
  return { x: Math.round(left / w) * w, y: Math.round(top / h) * h };
}

/** 階段の 4 隅（グリッド）。選択枠・当たり判定に使う。 */
export function stairCornersGrid(stair: Stair): { x: number; y: number }[] {
  const { w, h } = stairFootprintGrid(stair.angleDeg);
  return [
    { x: stair.x, y: stair.y }, { x: stair.x + w, y: stair.y },
    { x: stair.x + w, y: stair.y + h }, { x: stair.x, y: stair.y + h },
  ];
}

/**
 * 段板の区切り線（グリッド・ローカルではなく実座標）。
 * 上る方向に対して直角に並ぶので、外形の長辺を等分する。
 */
export function stairTreadLinesGrid(stair: Stair): { x1: number; y1: number; x2: number; y2: number }[] {
  const { w, h } = stairFootprintGrid(stair.angleDeg);
  const alongY = h > w;                       // 縦長＝段板は横線
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 1; i < STAIR_TREADS; i++) {
    const t = i / STAIR_TREADS;
    if (alongY) {
      const y = stair.y + h * t;
      out.push({ x1: stair.x, y1: y, x2: stair.x + w, y2: y });
    } else {
      const x = stair.x + w * t;
      out.push({ x1: x, y1: stair.y, x2: x, y2: stair.y + h });
    }
  }
  return out;
}

/**
 * 上る向きの矢印（グリッド）。矢印は「下る側 → 上る側」に伸びる。
 * angleDeg は外形の向き、flip は同じ外形のまま上り下りを入れ替える。
 */
export function stairArrowGrid(stair: Stair): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const { w, h } = stairFootprintGrid(stair.angleDeg);
  const a = normalizeStairAngle(stair.angleDeg);
  const cx = stair.x + w / 2, cy = stair.y + h / 2;
  const alongY = h > w;
  // 長辺方向に、外形の 8 割の長さで引く
  const half = (alongY ? h : w) * 0.4;
  // 0°=上へ / 180°=下へ / 90°=右へ / 270°=左へ。flip でさらに反転する。
  const up = a === 0 || a === 270;
  const dir = (stair.flip ? -1 : 1) * (up ? -1 : 1);
  return alongY
    ? { from: { x: cx, y: cy - half * dir }, to: { x: cx, y: cy + half * dir } }
    : { from: { x: cx - half * dir, y: cy }, to: { x: cx + half * dir, y: cy } };
}

/** 単管の両端（グリッド）。x/y は始点で、角度ぶん伸ばした先が終点。 */
export function pipeEndpointsGrid(pipe: Pipe): [{ x: number; y: number }, { x: number; y: number }] {
  const len = mmToGrid(pipe.lengthMm);
  const rad = ((pipe.angleDeg ?? PIPE_DEFAULT_ANGLE_DEG) * Math.PI) / 180;
  return [
    { x: pipe.x, y: pipe.y },
    { x: pipe.x + len * Math.cos(rad), y: pipe.y + len * Math.sin(rad) },
  ];
}

/** 単管の長さを実用範囲に丸める（任意長さの入力用）。 */
export function clampPipeLengthMm(mm: number): number {
  if (!Number.isFinite(mm)) return PIPE_PRESET_LENGTHS_MM[0];
  return Math.min(PIPE_MAX_LENGTH_MM, Math.max(PIPE_MIN_LENGTH_MM, Math.round(mm)));
}
