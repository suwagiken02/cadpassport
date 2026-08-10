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

/** 手摺が実際に作っている枡（グリッド・左上と大きさ）。 */
export type StairCell = { x: number; y: number; w: number; h: number };

/** 座標比較の許容差（グリッド）。手摺は整数グリッドに乗るので十分小さくてよい。 */
const CELL_EPS = 1e-6;

type Seg = { a: number; b: number; at: number };

/**
 * 手摺を「水平の線分」「垂直の線分」に分ける。
 * 斜めの手摺は枡を作らないので捨てる。
 * a/b は伸びる向きの区間（昇順）、at はもう一方の軸の値。
 */
function axisSegments(handrails: Handrail[]): { hor: Seg[]; ver: Seg[] } {
  const hor: Seg[] = [], ver: Seg[] = [];
  for (const h of handrails) {
    const [p, q] = getHandrailEndpoints(h);
    if (Math.abs(p.y - q.y) < CELL_EPS) {
      hor.push({ a: Math.min(p.x, q.x), b: Math.max(p.x, q.x), at: p.y });
    } else if (Math.abs(p.x - q.x) < CELL_EPS) {
      ver.push({ a: Math.min(p.y, q.y), b: Math.max(p.y, q.y), at: p.x });
    }
  }
  return { hor, ver };
}

/** その線分が [from, to] を覆っているか（手摺が枡の 1 辺として通っているか）。 */
const covers = (s: Seg, at: number, from: number, to: number) =>
  Math.abs(s.at - at) < CELL_EPS && s.a <= from + CELL_EPS && s.b >= to - CELL_EPS;

/**
 * 実際に配置されている手摺が作る枡のうち、指定の大きさに一致するものを列挙する
 * (= P-1-fix10)。
 *
 * P-1 では「手摺が有るかに関わらず抽象的な 600×1800 の格子へ吸着する」仕様にしたが、
 * その格子と実際に置かれた手摺の位置は一致しないので、枡に入らなかった。
 * 実在の手摺から枡を見つけるのが正しい。
 *
 * 枡の条件: 上下 2 辺が水平手摺、左右 2 辺が垂直手摺で覆われていること。
 * 手摺は枡の辺より長くてもよい（1800 の手摺が枡の脇を通り過ぎる場合）。
 */
export function stairCellsFromHandrails(
  handrails: Handrail[], footprint: { w: number; h: number },
): StairCell[] {
  const { hor, ver } = axisSegments(handrails);
  const { w, h } = footprint;
  const out: StairCell[] = [];
  const seen = new Set<string>();
  for (const v of ver) {
    for (const t of hor) {
      const x = v.at, y = t.at;
      // 左辺(v) が縦に h ぶん、上辺(t) が横に w ぶん通っているか
      if (!covers(v, x, y, y + h) || !covers(t, y, x, x + w)) continue;
      // 右辺と下辺
      if (!ver.some((o) => covers(o, x + w, y, y + h))) continue;
      if (!hor.some((o) => covers(o, y + h, x, x + w))) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, w, h });
    }
  }
  return out;
}

/**
 * 階段の吸着先 (= P-1-fix10)。**実在の枡を優先し、無ければ抽象格子**。
 *
 * ・向きは自動で変えない（鮎澤氏）。パレットで選んだ向きの外形に合う枡だけを探す。
 * ・カーソルを含む枡があればそこ。無ければ最寄りの枡（近くに限る）。
 * ・枡が見つからない場所では従来どおり 600×1800 の格子へ寄せる
 *   （手摺がまだ無い場所にも置けること自体は維持する）。
 *
 * 返すのは階段の**左上角**の座標。ゴーストも配置もこの 1 本を通すので、
 * 「ゴーストの位置＝置かれる位置」が保たれる。
 */
export function snapStairToCell(
  cursor: { x: number; y: number }, angleDeg: number | undefined, handrails: Handrail[],
): { x: number; y: number } {
  const fp = stairFootprintGrid(angleDeg);
  // 探索範囲。遠くの枡へ飛ばさないため、かつドラッグ中の計算量を抑えるため。
  const reach = Math.max(fp.w, fp.h) * 2;
  const near = handrails.filter((hr) => {
    const [p, q] = getHandrailEndpoints(hr);
    const minX = Math.min(p.x, q.x) - reach, maxX = Math.max(p.x, q.x) + reach;
    const minY = Math.min(p.y, q.y) - reach, maxY = Math.max(p.y, q.y) + reach;
    return cursor.x >= minX && cursor.x <= maxX && cursor.y >= minY && cursor.y <= maxY;
  });

  const cells = stairCellsFromHandrails(near, fp);
  if (cells.length > 0) {
    const inside = cells.filter((c) =>
      cursor.x >= c.x - CELL_EPS && cursor.x <= c.x + c.w + CELL_EPS
      && cursor.y >= c.y - CELL_EPS && cursor.y <= c.y + c.h + CELL_EPS);
    const pool = inside.length > 0 ? inside : cells;
    const dist = (c: StairCell) => Math.hypot(c.x + c.w / 2 - cursor.x, c.y + c.h / 2 - cursor.y);
    const best = pool.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
    if (inside.length > 0 || dist(best) <= reach) return { x: best.x, y: best.y };
  }
  return snapStairToCellGrid(cursor, angleDeg);
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
