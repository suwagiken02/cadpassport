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
  GRID_MM, movePart, newElevationPart, partPivotMm, partsToPrimitives,
  type ElevationPart, type ElevationPartGeometry, type ElevationPartKind,
} from './elevation/elevationParts';

/**
 * キャンバスの住人としての手動部材。
 * 形は立面部材と同一（描画・吸着・回転をそのまま共有するため）。座標の意味だけが違う。
 */
export type FreePart = ElevationPart;

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
