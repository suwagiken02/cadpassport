// ============================================================
// キャンバス直下の手動部材 (= E-8-v5a)・pure。
//
// 設計思想（鮎澤氏）: 「自動は構造を持つ、手動は自由」。
//   CAD の中身は線と点の集合で、「平面図」「立面図」は絵の**読み方のラベル**であって、
//   部材を所有する入れ物ではない。平面用/立面用の区別が要るのは自動生成と自動割付の
//   ときだけ。手で置いたものは図面に所属せず、キャンバスのどこにでも置ける。
//
// これまで手動部材は elevationViews[].parts の住人だった。そのため
//   ・再生成のたびに引き継ぎ（rematch）が要る
//   ・置き場所が無くなると孤立（orphan）する
//   ・どの足場連に属すか（scaffoldIndex）を決めないといけない
//   ・置いた場所からどのビューの持ち物かを推測しないといけない
// という処理が必要だった。所属をやめれば、これらは**前提ごと不要**になる。
//
// ■ 座標系
//   部材の中身は立面部材（ElevationPart）とまったく同じ形で、位置だけ意味が違う:
//     x0Mm / x1Mm … キャンバス X（グリッド）を mm にしたもの   xMm = gx * 10
//     levelMm     … キャンバス Y（グリッド）を上向き mm にしたもの yMm = -gy * 10
//   こうすると partsToPrimitives が出す座標が**そのままキャンバスのグリッド**になる。
//   ＝ 描画・回転・吸着の実装を立面と 1 本で共有できる（見た目も完全に一致する）。
//
// ■ 縮尺とビュー追従（鮎澤氏の判断・E-8-v5a 時点）
//   ・常に実寸で描く（立面ビューの scale には追従しない）
//   ・ビューを動かしても付いていかない（キャンバスの絶対座標）
//   実機を見てから見直す前提。まずは思想どおり素直に作る。
//
// ■ 既存データ
//   elevationViews[].parts の旧手動部材は**移行しない**。今までどおり動く。
//   新しく置いたものだけがここに入る。
//   （立面ビューは縮小配置(scale)されているので、ビュー内の 1800mm 手摺は縮んだ寸法で
//     描かれている。実寸のキャンバス直下へ移すと見た目が 2〜5 倍に化けるため。）
// ============================================================
import type { ElevationPrimitive } from '@/types';
import {
  GRID_MM, isDrawingAid, movePart, newElevationPart, partPivotMm, partsToPrimitives,
  type ElevationPart, type ElevationPartGeometry, type ElevationPartKind,
} from './elevation/elevationParts';

// 「部材ではない」判定は elevationParts が唯一の定義。ここからも使えるよう通す。
export { isDrawingAid };

/**
 * キャンバスの住人としての手動部材。
 * 形は立面部材と同一（描画・吸着・回転をそのまま共有するため）。座標の意味だけが違う。
 */
export type FreePart = ElevationPart;

/** 補助線・目印だけ。 */
export const aidPartsOf = (parts: FreePart[] | undefined): FreePart[] =>
  (parts ?? []).filter((p) => isDrawingAid(p.kind));

/** 部材だけ（補助線・目印を除く）。 */
export const scaffoldPartsOf = (parts: FreePart[] | undefined): FreePart[] =>
  (parts ?? []).filter((p) => !isDrawingAid(p.kind));

/**
 * freeParts は「足場という手がかり」を持たない。
 * partsToPrimitives / movePart / partPivotMm は sg が undefined でも自由座標だけで
 * 完結する（E-8-v4a で足場非依存にした）。geom は常にこの空き地でよい。
 */
export const FREE_GEOM: ElevationPartGeometry = { minXg: 0, scaffolds: [] };

/** キャンバスのグリッド座標 → 部材の座標(mm・Y は上向き)。 */
export function gridToPartMm(p: { x: number; y: number }): { xMm: number; yMm: number } {
  return { xMm: p.x * GRID_MM, yMm: -p.y * GRID_MM };
}

/** 部材の座標(mm・Y は上向き) → キャンバスのグリッド座標。 */
export function partMmToGrid(p: { xMm: number; yMm: number }): { x: number; y: number } {
  return { x: p.xMm / GRID_MM, y: -p.yMm / GRID_MM };
}

/** 描画プリミティブ（座標はキャンバスのグリッドそのもの）。立面と同じ絵になる。 */
export function freePartsToPrimitives(parts: FreePart[]): ElevationPrimitive[] {
  return partsToPrimitives({ parts, geom: FREE_GEOM });
}

/**
 * パレットから 1 本作る。置きたい位置はキャンバスのグリッド。
 * scaffoldIndex は形を揃えるための 0 固定（参照する足場が無いので意味を持たない）。
 */
export function newFreePart(
  kind: ElevationPartKind, id: string, atGrid: { x: number; y: number },
  opts?: { sizeMm?: number; komaCount?: number; flip?: boolean; angleDeg?: number },
): FreePart {
  return newElevationPart(kind, id, 0, gridToPartMm(atGrid), opts);
}

/**
 * 2 点から補助線を作る (= E-8-v5c)。起点 a → 終点 b をそのまま結ぶ。
 *
 * ElevationPart は高さ(levelMm)を 1 つしか持たないので、線は
 * 「中心・長さ・傾き」で表す（筋交と同じ持ち方）。傾きは既存の angleDeg 回転が
 * そのまま効くので、新しいフィールドを 1 つも足さずに任意の向きを表せる。
 *
 * 角度の向き: 部材の angleDeg は「右端が上がる向きが正」。キャンバスの y は
 * 下向きなので、画面で右上がりに引いた線は正の角度になる。
 */
export function aidLineFromPoints(
  id: string, a: { x: number; y: number }, b: { x: number; y: number },
): FreePart {
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sizeMm = Math.hypot(dx, dy) * GRID_MM;
  // atan2 は画面座標（y 下向き）。部材の角度は上向き正なので符号を反転する。
  const angleDeg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return newFreePart('line', id, center, { sizeMm, angleDeg });
}

/** 補助線として意味を持つ最短の長さ(mm)。これ未満は「点を 2 回押しただけ」とみなす。 */
export const AID_LINE_MIN_MM = 50;

/** その 2 点で線を引けるか（短すぎる誤タップを弾く）。 */
export function canDrawAidLine(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) * GRID_MM >= AID_LINE_MIN_MM;
}

/** グリッド単位で動かす（自由座標を書き換えるだけ。置ける/置けないの判定はしない）。 */
export function moveFreePart(part: FreePart, dxGrid: number, dyGrid: number): FreePart {
  return movePart(part, undefined, { dxMm: dxGrid * GRID_MM, dyMm: -dyGrid * GRID_MM });
}

/** 基準点（回転の軸＝置いたときに指した点）のグリッド座標。範囲選択の代表点に使う。 */
export function freePartAnchorGrid(part: FreePart): { x: number; y: number } | null {
  const pv = partPivotMm(part, undefined);
  return pv ? partMmToGrid(pv) : null;
}

export type FreePartBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** 実際に描かれる範囲（グリッド）。出力の枠・全体表示に使う。 */
export function freePartsBoundsGrid(parts: FreePart[] | undefined): FreePartBounds | null {
  if (!parts || parts.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  for (const p of freePartsToPrimitives(parts)) {
    if (p.kind === 'line') { see(p.x1, p.y1); see(p.x2, p.y2); }
    else if (p.kind === 'rect') { see(p.x, p.y); see(p.x + p.w, p.y + p.h); }
    else if (p.kind === 'polygon') {
      for (let k = 0; k < p.points.length; k += 2) see(p.points[k], p.points[k + 1]);
    } else see(p.x, p.y);   // text / circle（半径は px なので中心点だけ見る）
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** 手動部材の id（既存 id と衝突しない連番）。立面側と同じ流儀。 */
export function nextFreePartId(parts: FreePart[] | undefined, kind: ElevationPartKind): string {
  const used = new Set((parts ?? []).map((p) => p.id));
  let n = 1;
  while (used.has(`free:${kind}:${n}`)) n++;
  return `free:${kind}:${n}`;
}
