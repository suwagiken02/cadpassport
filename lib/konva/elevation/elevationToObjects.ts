// ============================================================
// 立面図 E-4a: FaceElevation → ElevationPrimitive[] 変換（pure・node 安全）
//
// ElevationModal の SVG 描画と同等の内容を、グループローカル・グリッド座標のプリミティブ列へ。
//   ・水平 = 変軸グリッド（左端を 0 に平行移動）。
//   ・垂直 = mm/10 グリッド。GL=0、上方向は負（キャンバス y 下向きに合わせる）。
//   ・線幅/文字サイズは px（縮尺に依らず一定）。
// ※ ElevationModal(プレビュー) とは二重実装だが許容（将来統合は E-8）。
// ============================================================
import type { ElevationPrimitive } from '@/types';
import type { FaceElevation } from './elevationEngine';

const C_OUTLINE = '#8a8a86';
const C_RIDGE = '#6b6b67';
const C_RIDGE_TXT = '#c9c9c6';
const C_BOARD = '#4ECDC4';
const C_RAIL = '#378ADD';
const C_POST = '#FFD700';
const C_DIM = '#8a8a86';
const C_DIM_TXT = '#9a9a96';

/** FaceElevation を、グループローカル座標のプリミティブ列へ変換する。
 *  fillOf: 建物 id → 塗り色（未指定は既定色）。高さ情報が無ければ空配列。 */
export function faceElevationToPrimitives(
  fe: FaceElevation,
  fillOf: (buildingId: string) => string = () => '#3d3d3a',
): ElevationPrimitive[] {
  const { buildingOutlines, scaffolds, roofBands, ridgeMaxMm } = fe;

  // ---- 変軸範囲・最高高さ ----
  let minXg = Infinity, maxXg = -Infinity, maxMm = 0, buildingTopMm = 0;
  const seeX = (gx: number) => { minXg = Math.min(minXg, gx); maxXg = Math.max(maxXg, gx); };
  for (const o of buildingOutlines) {
    for (const s of o.segments) {
      seeX(s.xStart); seeX(s.xEnd);
      maxMm = Math.max(maxMm, s.heightStartMm, s.heightEndMm);
      buildingTopMm = Math.max(buildingTopMm, s.heightStartMm, s.heightEndMm);
    }
  }
  for (const sc of scaffolds) { for (const px of sc.postXs) seeX(px); maxMm = Math.max(maxMm, sc.levels.topRailMm); }
  for (const rb of roofBands) { seeX(rb.xStart); seeX(rb.xEnd); }
  if (ridgeMaxMm != null) maxMm = Math.max(maxMm, ridgeMaxMm);

  if (!(maxMm >= 1 && Number.isFinite(minXg))) return [];

  const lx = (gx: number) => gx - minXg;      // 左端 0
  const ly = (mm: number) => -(mm / 10);       // GL=0、上は負
  const prims: ElevationPrimitive[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, dash?: number[], opacity?: number) =>
    prims.push({ kind: 'line', x1, y1, x2, y2, stroke, width, dash, opacity });
  const poly = (points: number[], fill?: string, fillOpacity?: number, stroke?: string, width?: number) =>
    prims.push({ kind: 'polygon', points, fill, fillOpacity, stroke, width });
  const text = (x: number, y: number, t: string, size: number, fill: string, anchor?: 'start' | 'middle' | 'end') =>
    prims.push({ kind: 'text', x, y, text: t, size, fill, anchor });

  // ---- 建物シルエット（多階は重ね） ----
  for (const o of buildingOutlines) {
    for (const s of o.segments) {
      poly(
        [lx(s.xStart), 0, lx(s.xStart), ly(s.heightStartMm), lx(s.xEnd), ly(s.heightEndMm), lx(s.xEnd), 0],
        fillOf(o.buildingId), 0.22, C_OUTLINE, 1.5,
      );
    }
  }

  // ---- 屋根投影バンド ----
  for (const band of roofBands) {
    const prof: number[] = [];
    for (const p of band.profile) { prof.push(lx(p.x), ly(p.mm)); }
    if (band.filledToRidge) {
      if (band.baseMm != null) {
        poly([...prof, lx(band.xEnd), ly(band.baseMm), lx(band.xStart), ly(band.baseMm)], fillOf(band.buildingId), 0.42, C_OUTLINE, 1.2);
      } else {
        poly([...prof, lx(band.xEnd), ly(band.ridgeMm), lx(band.xStart), ly(band.ridgeMm)], fillOf(band.buildingId), 0.42, C_OUTLINE, 1.2);
        line(lx(band.xStart), ly(band.ridgeMm), lx(band.xEnd), ly(band.ridgeMm), C_RIDGE, 1.4);
        text(lx(band.xEnd), ly(band.ridgeMm) - 3, `棟 ${band.ridgeMm}`, 9, C_RIDGE_TXT, 'end');
      }
    } else {
      // 妻けらば/フラット軒: プロファイルを線分列で描く（開いた折れ線）。
      for (let i = 0; i < band.profile.length - 1; i++) {
        line(lx(band.profile[i].x), ly(band.profile[i].mm), lx(band.profile[i + 1].x), ly(band.profile[i + 1].mm), C_OUTLINE, 1.3);
      }
    }
  }

  // 段違い作業床 1 セット（床帯＋手摺 +450/+900）。
  const floorSet = (floorMm: number, x0: number, x1: number) => {
    line(lx(x0), ly(floorMm), lx(x1), ly(floorMm), C_BOARD, 3, undefined, 0.6);
    line(lx(x0), ly(floorMm + 450), lx(x1), ly(floorMm + 450), C_RAIL, 0.8, undefined, 0.7);
    line(lx(x0), ly(floorMm + 900), lx(x1), ly(floorMm + 900), C_RAIL, 0.8, undefined, 0.7);
  };

  // ---- 足場（列ごと） ----
  for (const sc of scaffolds) {
    const jackTop = sc.levels.jackTopMm;
    const topRail = sc.levels.topRailMm;
    for (const b of sc.boards) line(lx(b.x0), ly(b.levelMm), lx(b.x1), ly(b.levelMm), C_BOARD, 3, undefined, 0.5);
    for (const r of sc.rails) line(lx(r.x0), ly(r.heightMm), lx(r.x1), ly(r.heightMm), C_RAIL, 0.7, undefined, 0.5);
    for (const px of sc.postXs) line(lx(px), ly(jackTop), lx(px), ly(topRail), C_POST, 1.6);
    // ジャッキ（支柱下端の小台形・グリッド）
    for (const px of sc.postXs) {
      const jx = lx(px);
      poly([jx - 0.3, ly(jackTop), jx + 0.3, ly(jackTop), jx + 0.6, 0, jx - 0.6, 0], C_POST, 0.85);
    }
    // 妻嵩上げ: 中間フル段＋最終床、支柱延長
    const postExtendTop = new Map<number, number>();
    for (const r of sc.spanRaises) {
      for (const fmm of r.intermediateFloorsMm) floorSet(fmm, r.x0, r.x1);
      floorSet(r.raisedFloorMm, r.x0, r.x1);
      const top = r.raisedFloorMm + 900;
      for (const px of [r.x0, r.x1]) postExtendTop.set(px, Math.max(postExtendTop.get(px) ?? topRail, top));
    }
    postExtendTop.forEach((top, px) => line(lx(px), ly(topRail), lx(px), ly(top), C_POST, 1.6));
  }

  // ---- GL 線 ----
  line(-1, 0, lx(maxXg) + 1, 0, C_RIDGE, 1, [4, 3]);
  text(-1, 4, 'GL', 10, C_OUTLINE, 'start');

  // ---- 寸法（縦: 代表 scaffold の各 level と天端／足場なしは建物高さ、 横: スパン部材長） ----
  const rep = scaffolds.reduce<typeof scaffolds[number] | null>(
    (best, s) => (!best || s.levels.floors > best.levels.floors ? s : best), null);
  if (rep) {
    line(-2, 0, -2, ly(rep.levels.topRailMm), C_DIM, 0.8);
    rep.levels.levels.forEach((lv, i) => {
      line(-2.4, ly(lv), -1.6, ly(lv), C_DIM, 0.8);
      text(-1.4, ly(lv) + 3, i === 0 ? `スタート ${lv}` : `${lv}`, 9, C_DIM_TXT, 'end');
    });
    line(-2.4, ly(rep.levels.topRailMm), -1.6, ly(rep.levels.topRailMm), C_DIM, 0.8);
    text(-1.4, ly(rep.levels.topRailMm) - 3, `天端 ${rep.levels.topRailMm}`, 9, C_RIDGE_TXT, 'end');
    // 横寸法
    rep.column.rails.forEach((lenMm, i) => {
      const x0 = rep.postXs[i], x1 = rep.postXs[i + 1];
      if (x1 == null) return;
      line(lx(x0), 1, lx(x1), 1, C_DIM, 0.8);
      text((lx(x0) + lx(x1)) / 2, 2.4, `${lenMm}`, 9, C_DIM_TXT, 'middle');
    });
  } else if (buildingTopMm > 0) {
    line(-2, 0, -2, ly(buildingTopMm), C_DIM, 0.8);
    line(-2.4, ly(buildingTopMm), -1.6, ly(buildingTopMm), C_DIM, 0.8);
    text(-1.4, ly(buildingTopMm) - 3, `建物 ${buildingTopMm}`, 9, C_RIDGE_TXT, 'end');
  }

  return prims;
}
