// ============================================================
// 立面図 E-4a: FaceElevation → ElevationPrimitive[] 変換（pure・node 安全）
//
// ElevationModal の SVG 描画と同等の内容を、グループローカル・グリッド座標のプリミティブ列へ。
//   ・水平 = 変軸グリッド（左端を 0 に平行移動）。
//   ・垂直 = mm/10 グリッド。GL=0、上方向は負（キャンバス y 下向きに合わせる）。
//   ・線幅/文字サイズは px（縮尺に依らず一定）。
// ※ ElevationModal(プレビュー) とは二重実装だが許容（将来統合は E-8）。
//
// E-8a: 全プリミティブに meta（意味タグ kind・安定 id・再マッチ用ヒント）を付ける。
//   部材単位の編集（選択/削除/移動）と、平面変更で再生成したときの差分引き継ぎに使う。
//   id は「kind＋高さ(mm)や添字・面軸座標」から組み立て、同じ図なら再生成しても同じ値になる。
//   幾何・色・順序は一切変えていない（描画は meta を無視すれば従来どおり）。
// ============================================================
import type {
  BuildingShape, ElevationPrimitive, ElevationPrimitiveMeta, Point,
} from '@/types';
import type { FaceElevation } from './elevationEngine';
import {
  komaLevelsFromJackMm, nominalSpanMm, pushBoard, pushJack, pushPost, pushRail,
} from './elevationPartStyle';

/** 立面ビューの初期配置位置（グループローカル原点 = 左下=GL・左端）。
 *  平面建物 bbox の右側に固定オフセット、GL(ローカル0)を建物下端 y に合わせる。建物無しは既定。 */
export function initialPlacementOrigin(buildings: BuildingShape[]): Point {
  const pts = buildings.flatMap((b) => b.points);
  if (pts.length === 0) return { x: 100, y: 200 };
  return { x: Math.max(...pts.map((p) => p.x)) + 30, y: Math.max(...pts.map((p) => p.y)) };
}

const C_OUTLINE = '#8a8a86';
const C_RIDGE = '#6b6b67';
const C_RIDGE_TXT = '#c9c9c6';
const C_DIM = '#8a8a86';
const C_DIM_TXT = '#9a9a96';

/** id に埋める座標の丸め（0.1 グリッド＝1mm 精度。浮動小数の揺れで id が変わらないように）。 */
export const q = (v: number): number => Math.round(v * 10) / 10;

/**
 * 面の描画範囲（E-8-v2a で切り出し）。ローカル原点(左端=0)と最高高さを決める。
 * 部材ブロック側（elevationParts）と座標基準を共有するため single source にする。
 * 高さ情報が無い（描くものが無い）場合は null。
 */
export function faceElevationExtent(fe: FaceElevation): {
  minXg: number; maxXg: number; maxMm: number; buildingTopMm: number;
} | null {
  const { buildingOutlines, scaffolds, roofBands, ridgeMaxMm } = fe;
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
  if (!(maxMm >= 1 && Number.isFinite(minXg))) return null;
  return { minXg, maxXg, maxMm, buildingTopMm };
}

/** FaceElevation を、グループローカル座標のプリミティブ列へ変換する。
 *  fillOf: 建物 id → 塗り色（未指定は既定色）。高さ情報が無ければ空配列。 */
export function faceElevationToPrimitives(
  fe: FaceElevation,
  fillOf: (buildingId: string) => string = () => '#3d3d3a',
): ElevationPrimitive[] {
  const { buildingOutlines, scaffolds, roofBands } = fe;

  // ---- 変軸範囲・最高高さ（部材ブロック側と共有・E-8-v2a）----
  const ext = faceElevationExtent(fe);
  if (!ext) return [];
  const { minXg, maxXg, buildingTopMm } = ext;

  const lx = (gx: number) => gx - minXg;      // 左端 0
  const ly = (mm: number) => -(mm / 10);       // GL=0、上は負
  const prims: ElevationPrimitive[] = [];
  const line = (
    x1: number, y1: number, x2: number, y2: number, stroke: string, width: number,
    dash?: number[], opacity?: number, meta?: ElevationPrimitiveMeta,
  ) => prims.push({ kind: 'line', x1, y1, x2, y2, stroke, width, dash, opacity, meta });
  const poly = (
    points: number[], fill?: string, fillOpacity?: number, stroke?: string, width?: number,
    meta?: ElevationPrimitiveMeta,
  ) => prims.push({ kind: 'polygon', points, fill, fillOpacity, stroke, width, meta });
  const text = (
    x: number, y: number, t: string, size: number, fill: string,
    anchor?: 'start' | 'middle' | 'end', meta?: ElevationPrimitiveMeta,
  ) => prims.push({ kind: 'text', x, y, text: t, size, fill, anchor, meta });

  // ---- 建物シルエット（多階は重ね） ----
  for (const o of buildingOutlines) {
    o.segments.forEach((s, k) => {
      poly(
        [lx(s.xStart), 0, lx(s.xStart), ly(s.heightStartMm), lx(s.xEnd), ly(s.heightEndMm), lx(s.xEnd), 0],
        fillOf(o.buildingId), 0.22, C_OUTLINE, 1.5,
        {
          kind: 'building', id: `building:${o.buildingId}:${k}`, index: k,
          buildingId: o.buildingId, heightMm: Math.max(s.heightStartMm, s.heightEndMm), x: q(lx(s.xStart)),
        },
      );
    });
  }

  // ---- 屋根投影バンド ----
  roofBands.forEach((band, bi) => {
    const key = band.roofId ?? band.buildingId;
    const prof: number[] = [];
    for (const p of band.profile) { prof.push(lx(p.x), ly(p.mm)); }
    if (band.filledToRidge) {
      if (band.baseMm != null) {
        poly(
          [...prof, lx(band.xEnd), ly(band.baseMm), lx(band.xStart), ly(band.baseMm)],
          fillOf(band.buildingId), 0.42, C_OUTLINE, 1.2,
          { kind: 'roof', id: `roof:${key}:${bi}`, index: bi, buildingId: band.buildingId, heightMm: band.ridgeMm },
        );
      } else {
        poly(
          [...prof, lx(band.xEnd), ly(band.ridgeMm), lx(band.xStart), ly(band.ridgeMm)],
          fillOf(band.buildingId), 0.42, C_OUTLINE, 1.2,
          { kind: 'roof', id: `roof:${key}:${bi}`, index: bi, buildingId: band.buildingId, heightMm: band.ridgeMm },
        );
        line(
          lx(band.xStart), ly(band.ridgeMm), lx(band.xEnd), ly(band.ridgeMm), C_RIDGE, 1.4,
          undefined, undefined,
          { kind: 'ridge', id: `ridge:${key}:${bi}`, index: bi, buildingId: band.buildingId, heightMm: band.ridgeMm },
        );
        text(
          lx(band.xEnd), ly(band.ridgeMm) - 3, `棟 ${band.ridgeMm}`, 9, C_RIDGE_TXT, 'end',
          { kind: 'text', id: `ridgeText:${key}:${bi}`, index: bi, buildingId: band.buildingId, heightMm: band.ridgeMm },
        );
      }
    } else {
      // 妻けらば/フラット軒: プロファイルを線分列で描く（開いた折れ線）。
      for (let i = 0; i < band.profile.length - 1; i++) {
        line(
          lx(band.profile[i].x), ly(band.profile[i].mm), lx(band.profile[i + 1].x), ly(band.profile[i + 1].mm),
          C_OUTLINE, 1.3, undefined, undefined,
          { kind: 'roof', id: `roof:${key}:${bi}:${i}`, index: i, buildingId: band.buildingId, heightMm: band.profile[i].mm },
        );
      }
    }
  });

  // 段違い作業床 1 セット（床帯＋手摺 +450/+900）。
  // E-8-v2f: 見た目は elevationPartStyle が single source（部材ブロック経路と共通）。
  const floorSet = (
    floorMm: number, x0: number, x1: number, idPrefix: string, spanIndex: number, spanMm: number,
  ) => {
    pushBoard(prims, lx(x0), lx(x1), ly(floorMm),
      { kind: 'raise', id: `${idPrefix}:board`, heightMm: floorMm, index: spanIndex, x: q(lx(x0)) });
    pushRail(prims, lx(x0), lx(x1), ly(floorMm + 450), spanMm,
      { kind: 'raise', id: `${idPrefix}:rail450`, heightMm: floorMm + 450, index: spanIndex, x: q(lx(x0)) });
    pushRail(prims, lx(x0), lx(x1), ly(floorMm + 900), spanMm,
      { kind: 'raise', id: `${idPrefix}:rail900`, heightMm: floorMm + 900, index: spanIndex, x: q(lx(x0)) });
  };

  // ---- 足場（列ごと） ----
  scaffolds.forEach((sc, si) => {
    const jackTop = sc.levels.jackTopMm;
    const topRail = sc.levels.topRailMm;
    for (const b of sc.boards) {
      pushBoard(prims, lx(b.x0), lx(b.x1), ly(b.levelMm),
        { kind: 'board', id: `board:${si}:${b.levelMm}:${q(lx(b.x0))}`, heightMm: b.levelMm, x: q(lx(b.x0)) });
    }
    for (const r of sc.rails) {
      pushRail(prims, lx(r.x0), lx(r.x1), ly(r.heightMm), nominalSpanMm(sc.postXs, r.x0),
        { kind: 'rail', id: `rail:${si}:${r.heightMm}:${q(lx(r.x0))}`, heightMm: r.heightMm, x: q(lx(r.x0)) });
    }
    // E-8-v2g: コマ(450 刻みの受け金具)を支柱上に描く。
    const komaYs = sc.levels.komaGridMm.map(ly);
    sc.postXs.forEach((px, pi) => {
      pushPost(prims, lx(px), ly(jackTop), ly(topRail),
        { kind: 'post', id: `post:${si}:${pi}`, index: pi, x: q(lx(px)), heightMm: topRail }, komaYs);
    });
    // ジャッキ（支柱下端のベース記号）
    sc.postXs.forEach((px, pi) => {
      pushJack(prims, lx(px), ly(jackTop), 0,
        { kind: 'jack', id: `jack:${si}:${pi}`, index: pi, x: q(lx(px)), heightMm: jackTop });
    });
    // 妻嵩上げ: 中間フル段＋最終床、支柱延長
    const postExtendTop = new Map<number, number>();
    for (const r of sc.spanRaises) {
      const spanMm = nominalSpanMm(sc.postXs, r.x0);
      r.intermediateFloorsMm.forEach((fmm, fi) => {
        floorSet(fmm, r.x0, r.x1, `raise:${si}:${r.spanIndex}:mid${fi}`, r.spanIndex, spanMm);
      });
      floorSet(r.raisedFloorMm, r.x0, r.x1, `raise:${si}:${r.spanIndex}:top`, r.spanIndex, spanMm);
      const top = r.raisedFloorMm + 900;
      for (const px of [r.x0, r.x1]) postExtendTop.set(px, Math.max(postExtendTop.get(px) ?? topRail, top));
    }
    postExtendTop.forEach((top, px) => {
      pushPost(prims, lx(px), ly(topRail), ly(top),
        { kind: 'post', id: `postExt:${si}:${q(lx(px))}`, x: q(lx(px)), heightMm: top },
        komaLevelsFromJackMm(jackTop, top).filter((h) => h > topRail + 1e-6).map(ly));
    });
  });

  // ---- GL 線 ----
  line(-1, 0, lx(maxXg) + 1, 0, C_RIDGE, 1, [4, 3], undefined, { kind: 'gl', id: 'gl', heightMm: 0 });
  text(-1, 4, 'GL', 10, C_OUTLINE, 'start', { kind: 'text', id: 'gl:text', heightMm: 0 });

  // ---- 寸法（縦: 代表 scaffold の各 level と天端／足場なしは建物高さ、 横: スパン部材長） ----
  const rep = scaffolds.reduce<typeof scaffolds[number] | null>(
    (best, s) => (!best || s.levels.floors > best.levels.floors ? s : best), null);
  if (rep) {
    line(-2, 0, -2, ly(rep.levels.topRailMm), C_DIM, 0.8, undefined, undefined,
      { kind: 'dim', id: 'dim:v', heightMm: rep.levels.topRailMm });
    rep.levels.levels.forEach((lv, i) => {
      line(-2.4, ly(lv), -1.6, ly(lv), C_DIM, 0.8, undefined, undefined,
        { kind: 'dim', id: `dim:level:${i}`, index: i, heightMm: lv });
      text(-1.4, ly(lv) + 3, i === 0 ? `スタート ${lv}` : `${lv}`, 9, C_DIM_TXT, 'end',
        { kind: 'dimText', id: `dimText:level:${i}`, index: i, heightMm: lv });
    });
    line(-2.4, ly(rep.levels.topRailMm), -1.6, ly(rep.levels.topRailMm), C_DIM, 0.8, undefined, undefined,
      { kind: 'dim', id: 'dim:top', heightMm: rep.levels.topRailMm });
    text(-1.4, ly(rep.levels.topRailMm) - 3, `天端 ${rep.levels.topRailMm}`, 9, C_RIDGE_TXT, 'end',
      { kind: 'dimText', id: 'dimText:top', heightMm: rep.levels.topRailMm });
    // 横寸法
    rep.column.rails.forEach((lenMm, i) => {
      const x0 = rep.postXs[i], x1 = rep.postXs[i + 1];
      if (x1 == null) return;
      line(lx(x0), 1, lx(x1), 1, C_DIM, 0.8, undefined, undefined,
        { kind: 'dim', id: `dim:span:${i}`, index: i, x: q(lx(x0)) });
      text((lx(x0) + lx(x1)) / 2, 2.4, `${lenMm}`, 9, C_DIM_TXT, 'middle',
        { kind: 'dimText', id: `dimText:span:${i}`, index: i, x: q(lx(x0)) });
    });
  } else if (buildingTopMm > 0) {
    line(-2, 0, -2, ly(buildingTopMm), C_DIM, 0.8, undefined, undefined,
      { kind: 'dim', id: 'dim:building', heightMm: buildingTopMm });
    line(-2.4, ly(buildingTopMm), -1.6, ly(buildingTopMm), C_DIM, 0.8, undefined, undefined,
      { kind: 'dim', id: 'dim:building:tick', heightMm: buildingTopMm });
    text(-1.4, ly(buildingTopMm) - 3, `建物 ${buildingTopMm}`, 9, C_RIDGE_TXT, 'end',
      { kind: 'dimText', id: 'dimText:building', heightMm: buildingTopMm });
  }

  return prims;
}
