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
import type { BuildingOutlineSegment, FaceElevation } from './elevationEngine';
import {
  komaLevelsFromJackMm, postSegmentsMm, pushBoard, pushJack, pushPost, pushRail,
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

/**
 * 建物シルエットの「連続して見える範囲」(= E-9-fix4)。
 * top は上端の折れ線（＝建物の実際の輪郭）、base は下端の折れ線（GL or 手前の建物の上端）。
 * clippedStart/End は、その端が遮蔽で切れた境目（＝縦の輪郭線を引いてはいけない側）か。
 */
export type OutlineRun = {
  top: { x: number; mm: number }[];
  base: { x: number; mm: number }[];
  clippedStart: boolean;
  clippedEnd: boolean;
  /** この面の壁の奥行き。違う壁（L 字の段差）は別 run＝境目に縦線を描く。 */
  depthCoord?: number;
};

/**
 * 連続するセグメントを 1 つの run にまとめる (= E-9-fix4)。
 *
 * 妻（辺内部の高さマーカーで分割された 2 辺）や、遮蔽クリップで分かれた区間を
 * 1 枚の面として扱うためのもの。x が接し、上端・下端が連続していれば同じ run。
 * これをしないと継ぎ目に縦線が描かれる（実機: 棟頂点の真下から GL までの縦線）。
 */
export function outlineRuns(segments: BuildingOutlineSegment[]): OutlineRun[] {
  const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
  const baseOf = (s: BuildingOutlineSegment) => (
    s.basePath && s.basePath.length >= 2
      ? s.basePath
      : [{ x: s.xStart, mm: s.baseStartMm ?? 0 }, { x: s.xEnd, mm: s.baseEndMm ?? 0 }]
  );
  const runs: OutlineRun[] = [];
  for (const s of [...segments].sort((a, b) => a.xStart - b.xStart)) {
    const base = baseOf(s);
    const last = runs[runs.length - 1];
    const joins = last
      && eq(last.top[last.top.length - 1].x, s.xStart)
      && eq(last.top[last.top.length - 1].mm, s.heightStartMm)
      && eq(last.base[last.base.length - 1].mm, base[0].mm)
      && !last.clippedEnd && !s.clippedStart
      // E-5-fix2: 奥行きが違う壁の境目（L 字の段差）は本物の角なので分けたまま＝縦線を残す。
      && last.depthCoord === s.depthCoord;
    if (joins) {
      last.top.push({ x: s.xEnd, mm: s.heightEndMm });
      for (const p of base.slice(1)) last.base.push(p);
      last.clippedEnd = !!s.clippedEnd;
      continue;
    }
    runs.push({
      top: [{ x: s.xStart, mm: s.heightStartMm }, { x: s.xEnd, mm: s.heightEndMm }],
      base: base.map((p) => ({ ...p })),
      clippedStart: !!s.clippedStart,
      clippedEnd: !!s.clippedEnd,
      depthCoord: s.depthCoord,
    });
  }
  return runs;
}

/**
 * 建物シルエットと屋根投影バンドのプリミティブ (= E-9-fix5)。
 *
 * キャンバス配置版(faceElevationToPrimitives)とプレビュー(ElevationModal)の**唯一の出所**。
 * 以前はプレビューが独自の SVG を描いており、遮蔽の下端(baseStartMm/basePath)も
 * 継ぎ目の印(clippedStart/End)も無視していたため、修正が実機に届かなかった。
 *
 * 座標は部材プリミティブ(partsToPrimitives)と同じローカル系（横=グリッド−minXg・縦=−mm/10）。
 */
export function buildingAndRoofPrimitives(
  fe: FaceElevation,
  fillOf: (buildingId: string) => string = () => '#3d3d3a',
  minXgIn?: number,
): ElevationPrimitive[] {
  const { buildingOutlines, roofBands } = fe;
  const minXg = minXgIn ?? faceElevationExtent(fe)?.minXg;
  if (minXg == null || !Number.isFinite(minXg)) return [];
  const lx = (gx: number) => gx - minXg;
  const ly = (mm: number) => -(mm / 10);
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
  // E-9-fix4: 面は「連続して見える範囲ごとに 1 枚」（outlineRuns）で塗り、輪郭線は
  //   **元の建物の輪郭だけ**を引く。セグメントの継ぎ目（妻の頂点で分かれた辺・遮蔽で
  //   切れた境目）に線を引くと、実機では「棟の真下から GL まで走る縦線」になる。
  const yb = (mm: number) => (mm ? ly(mm) : 0);          // 0 は -0 を作らずそのまま GL
  for (const o of buildingOutlines) {
    outlineRuns(o.segments).forEach((run, k) => {
      const meta = (suffix?: string): ElevationPrimitiveMeta => ({
        kind: 'building', id: `building:${o.buildingId}:${k}${suffix ?? ''}`, index: k,
        buildingId: o.buildingId,
        heightMm: Math.max(...run.top.map((p) => p.mm)), x: q(lx(run.top[0].x)),
      });
      // 塗り: 下端の折れ線 → 上端の折れ線 → 下端を戻る（内部に線を作らないよう線幅 0）。
      const pts: number[] = [];
      for (const p of run.base) pts.push(lx(p.x), yb(p.mm));
      for (let i = run.top.length - 1; i >= 0; i--) pts.push(lx(run.top[i].x), ly(run.top[i].mm));
      poly(pts, fillOf(o.buildingId), 0.22, undefined, 0, meta());
      // 輪郭: 上端（建物の実際の輪郭）。
      for (let i = 0; i < run.top.length - 1; i++) {
        const p = run.top[i], nx = run.top[i + 1];
        line(lx(p.x), ly(p.mm), lx(nx.x), ly(nx.mm), C_OUTLINE, 1.5, undefined, undefined, meta(`:t${i}`));
      }
      // 輪郭: 左右の縦辺は「元の壁の端」だけ（遮蔽で切れた側は引かない）。
      const first = run.top[0], last = run.top[run.top.length - 1];
      const b0 = run.base[0], b1 = run.base[run.base.length - 1];
      if (!run.clippedStart && Math.abs(first.mm - b0.mm) > 1e-6) {
        line(lx(first.x), yb(b0.mm), lx(first.x), ly(first.mm), C_OUTLINE, 1.5, undefined, undefined, meta(':s'));
      }
      if (!run.clippedEnd && Math.abs(last.mm - b1.mm) > 1e-6) {
        line(lx(last.x), yb(b1.mm), lx(last.x), ly(last.mm), C_OUTLINE, 1.5, undefined, undefined, meta(':e'));
      }
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

  return prims;
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

  // ---- 建物シルエット・屋根投影バンド ----
  // E-9-fix5: プレビュー(ElevationModal)と同じ 1 本の経路。ここに独自の描画を置くと
  //   「テストは通るのに実機の絵が直らない」が起きる（部材で E-8-v2l が通った道）。
  prims.push(...buildingAndRoofPrimitives(fe, fillOf, minXg));

  // 段違い作業床 1 セット（床帯＋手摺 +450/+900）。
  // E-8-v2f: 見た目は elevationPartStyle が single source（部材ブロック経路と共通）。
  const floorSet = (
    floorMm: number, x0: number, x1: number, idPrefix: string, spanIndex: number,
  ) => {
    pushBoard(prims, lx(x0), lx(x1), ly(floorMm),
      { kind: 'raise', id: `${idPrefix}:board`, heightMm: floorMm, index: spanIndex, x: q(lx(x0)) });
    pushRail(prims, lx(x0), lx(x1), ly(floorMm + 450),
      { kind: 'raise', id: `${idPrefix}:rail450`, heightMm: floorMm + 450, index: spanIndex, x: q(lx(x0)) });
    pushRail(prims, lx(x0), lx(x1), ly(floorMm + 900),
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
      pushRail(prims, lx(r.x0), lx(r.x1), ly(r.heightMm),
        { kind: 'rail', id: `rail:${si}:${r.heightMm}:${q(lx(r.x0))}`, heightMm: r.heightMm, x: q(lx(r.x0)) });
    }
    // E-8-v2g: コマ(450 刻みの受け金具)を支柱上に描く。
    // E-8-v2j: 支柱は規格部材（8/6/4/2/1 コマ品）の積み重ねなので段ごとに描き、継ぎ目に印を出す。
    const segs = postSegmentsMm(jackTop, sc.levels.komaGridMm.length, topRail);
    sc.postXs.forEach((px, pi) => {
      if (segs.length === 0) {
        pushPost(prims, lx(px), ly(jackTop), ly(topRail),
          { kind: 'post', id: `post:${si}:${pi}`, index: pi, x: q(lx(px)), heightMm: topRail },
          { komaYs: sc.levels.komaGridMm.map(ly) });
        return;
      }
      segs.forEach((seg, gi) => {
        pushPost(prims, lx(px), ly(seg.bottomMm), ly(seg.topMm),
          { kind: 'post', id: `post:${si}:${pi}:${gi}`, index: pi, x: q(lx(px)), heightMm: seg.topMm },
          {
            komaYs: sc.levels.komaGridMm
              .filter((h) => h >= seg.bottomMm - 1e-6 && h <= seg.topMm + 1e-6).map(ly),
            // E-8-v2u: 上端は常に受け（カップ）。下端は足元だけ座で、以降はホゾ。
            capBottom: gi === 0,
          });
      });
    });
    // ジャッキ（支柱下端のベース記号）
    sc.postXs.forEach((px, pi) => {
      pushJack(prims, lx(px), ly(jackTop), 0,
        { kind: 'jack', id: `jack:${si}:${pi}`, index: pi, x: q(lx(px)), heightMm: jackTop });
    });
    // 妻嵩上げ: 中間フル段＋最終床、支柱延長
    const postExtendTop = new Map<number, number>();
    for (const r of sc.spanRaises) {
      r.intermediateFloorsMm.forEach((fmm, fi) => {
        floorSet(fmm, r.x0, r.x1, `raise:${si}:${r.spanIndex}:mid${fi}`, r.spanIndex);
      });
      floorSet(r.raisedFloorMm, r.x0, r.x1, `raise:${si}:${r.spanIndex}:top`, r.spanIndex);
      const top = r.raisedFloorMm + 900;
      for (const px of [r.x0, r.x1]) postExtendTop.set(px, Math.max(postExtendTop.get(px) ?? topRail, top));
    }
    postExtendTop.forEach((top, px) => {
      pushPost(prims, lx(px), ly(topRail), ly(top),
        { kind: 'post', id: `postExt:${si}:${q(lx(px))}`, x: q(lx(px)), heightMm: top },
        { komaYs: komaLevelsFromJackMm(jackTop, top).filter((h) => h > topRail + 1e-6).map(ly) });
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
