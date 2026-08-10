// ============================================================
// 平面図の追加部材（階段・単管）の幾何 (= P-1・pure・node 安全)
//
// 既存の平面部材（手摺・支柱・アンチ）と同じく、位置はグリッド座標（1 = 10mm）で持つ。
// ここには「どこに置くか」「どんな形か」だけを置き、描画は Konva 側が使う。
//
// 階段: 600×1800mm。**辺が近くの手摺にぴったり沿う位置**へ吸着する (= P-1-fix11)。
//       手摺 1 本で成立し、囲まれている必要は無い（実務では 3 方向・2 方向しか
//       囲われていないことが多い）。手摺が無い場所では 600×1800 の格子へ寄せる。
// 単管: 長さ自由・スナップ無し。既製品は 1〜6m。既定は 5m / 45°。
// ============================================================
import { mmToGrid } from './gridUtils';
import { getHandrailEndpoints } from './snapUtils';
import type { Stair, Pipe, Handrail } from '@/types';

/** 階段の実寸(mm)。600 手摺 × 1800 手摺の区画と同じ。 */
export const STAIR_WIDTH_MM = 600;
export const STAIR_LENGTH_MM = 1800;
/** 段板の枚数（600×1800 に並ぶ現場の標準的な見え方）。 */
export const STAIR_TREADS = 6;

/** 単管の既製品の長さ(mm)。任意長さは数値入力で作れる。 */
export const PIPE_PRESET_LENGTHS_MM = [1000, 2000, 3000, 4000, 5000, 6000] as const;
/** 単管の既定の角度(度)。0=右向き水平、正の値で時計回り（画面座標）。 */
export const PIPE_DEFAULT_ANGLE_DEG = 45;
/** 単管の既定の長さ(mm) (= P-1-fix10)。現場でいちばん使うのが 5m（鮎澤氏）。 */
export const PIPE_DEFAULT_LENGTH_MM = 5000;
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

/** 座標比較の許容差（グリッド）。手摺は整数グリッドに乗るので十分小さくてよい。 */
const RAIL_EPS = 1e-6;

/** 軸に沿った手摺の線分。at は線の位置、a..b は伸びる区間（昇順）。 */
type Seg = { a: number; b: number; at: number };

/**
 * 手摺を「水平の線分」「垂直の線分」に分ける。
 * 斜めの手摺には辺を沿わせられないので捨てる。
 */
function axisSegments(handrails: Handrail[]): { hor: Seg[]; ver: Seg[] } {
  const hor: Seg[] = [], ver: Seg[] = [];
  for (const h of handrails) {
    const [p, q] = getHandrailEndpoints(h);
    if (Math.abs(p.y - q.y) < RAIL_EPS) {
      hor.push({ a: Math.min(p.x, q.x), b: Math.max(p.x, q.x), at: p.y });
    } else if (Math.abs(p.x - q.x) < RAIL_EPS) {
      ver.push({ a: Math.min(p.y, q.y), b: Math.max(p.y, q.y), at: p.x });
    }
  }
  return { hor, ver };
}

/**
 * 手摺に沿う方向の位置 (= P-1-fix11)。
 *
 * 階段の角が手摺の端点に揃う位置を優先し、遠ければカーソルの位置に合わせて
 * 手摺の上を滑らせる。手摺が階段の辺より短くても長くても同じ扱いでよい。
 * 「囲まれた枡」は、手摺の長さが辺と同じなので端点＝正解の位置に一致する。
 *
 * cursorAlong: カーソルの、手摺に沿う方向の座標
 * size:        その方向の階段の寸法
 * a, b:        手摺の区間
 */
function alongRailPos(cursorAlong: number, size: number, a: number, b: number): number {
  const free = cursorAlong - size / 2;          // カーソルを辺の中央に置いたとき
  const tol = size / 2;                         // 角合わせに寄せる範囲
  let best: number | null = null, bestD = tol;
  for (const corner of [a, b - size]) {         // 手前の角合わせ / 奥の角合わせ
    const d = Math.abs(corner - free);
    if (d <= bestD) { bestD = d; best = corner; }
  }
  return best ?? Math.round(free);
}

/** 点から線分までの距離（近い手摺を選ぶのに使う）。 */
function distToSeg(p: { x: number; y: number }, s: Seg, horizontal: boolean): number {
  const along = horizontal ? p.x : p.y;
  const across = horizontal ? p.y : p.x;
  const clamped = Math.min(Math.max(along, s.a), s.b);
  return Math.hypot(along - clamped, across - s.at);
}

/**
 * 階段の吸着先 (= P-1-fix11)。**階段の辺が手摺にぴったり沿う位置**へ寄せる。
 *
 * P-1-fix10 では「4 辺が手摺で囲まれた枡」を探したが、実務では 3 方向・
 * 2 方向しか囲われていないことも多く、囲まれていないと吸着しないのでは使えない
 * （鮎澤氏）。手摺 1 本で成立する形にする。
 *
 * ・階段の 4 辺のいずれかが、近くの手摺の線に重なる位置に置く
 * ・対象はその辺と平行な手摺。手摺の長さは問わない（1800/1200/900/600…）
 * ・沿う方向の位置は「角が手摺の端点に揃う位置」を優先し、遠ければカーソルに合わせる
 * ・手摺のどちら側へ出すかは、カーソルが手摺のどちら側にあるかで決める
 * ・候補が複数あれば、カーソルに近い手摺を優先する
 * ・近くに手摺が無ければ従来どおり 600×1800 の格子へ寄せる
 * ・向きは自動で変えない。選んだ向きの外形のまま
 *
 * 返すのは階段の**左上角**。ゴーストも配置もこの 1 本を通す。
 */
export function snapStairToCell(
  cursor: { x: number; y: number }, angleDeg: number | undefined, handrails: Handrail[],
): { x: number; y: number } {
  const { w, h } = stairFootprintGrid(angleDeg);
  /** ここより遠い手摺には吸着しない（階段の長辺ぶん）。 */
  const reach = Math.max(w, h);

  const { hor, ver } = axisSegments(handrails);
  let best: { x: number; y: number } | null = null;
  let bestD = reach;

  for (const s of hor) {
    const d = distToSeg(cursor, s, true);
    if (d > bestD) continue;
    // 上辺を乗せる（カーソルが下側）か、下辺を乗せる（カーソルが上側）か
    const y = cursor.y >= s.at ? s.at : s.at - h;
    bestD = d;
    best = { x: alongRailPos(cursor.x, w, s.a, s.b), y };
  }
  for (const s of ver) {
    const d = distToSeg(cursor, s, false);
    if (d > bestD) continue;
    const x = cursor.x >= s.at ? s.at : s.at - w;
    bestD = d;
    best = { x, y: alongRailPos(cursor.y, h, s.a, s.b) };
  }

  return best ?? snapStairToCellGrid(cursor, angleDeg);
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

/**
 * 階段・単管の色 (= P-1-fix)。
 * キャンバス（PlanePartLayer）とパレットの姿図（PlanePartPreview）が
 * 同じ定義を見るように、pure 側に 1 箇所だけ置く。
 */
export const PLANE_PART_COLORS = {
  /** 階段の面。 */
  stairFill: '#9CA3AF',
  /** 階段の輪郭と段板の区切り。 */
  stairStroke: '#4B5563',
  /** 上る向きの矢印。 */
  stairArrow: '#1F2937',
  /** 単管（鋼管の銀鼠）。 */
  pipe: '#6B7280',
} as const;

/** 単管の長さを実用範囲に丸める（任意長さの入力用）。 */
export function clampPipeLengthMm(mm: number): number {
  if (!Number.isFinite(mm)) return PIPE_PRESET_LENGTHS_MM[0];
  return Math.min(PIPE_MAX_LENGTH_MM, Math.max(PIPE_MIN_LENGTH_MM, Math.round(mm)));
}
