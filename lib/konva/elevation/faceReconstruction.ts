// ============================================================
// 立面図 E-1: 配置済み部材 → 面ごとスパン列の復元（pure・node 安全）
//
// 設計方針（設計調査 + ユーザー確定）:
//   自動割付の中間状態（layoutByFloor / FloorEdgeSegment / 面ごとの離れ）は
//   永続化されないため使わない。永続化された Handrail[]（＋ Post[]/Anti[]）から
//   面ごとのスパン列を再構成する（A 案）。手置き手摺も座標だけで拾うので反映される。
//
//   面分類ロジックは DimensionLineLayer.tsx:320-402 の getFaceEdges /
//   getFloorScaffoldEdges（向き＝水平→北/南・垂直→東/西、floor bbox 中心の
//   どちら側か）を pure 化して流用。ただし元実装が捨てている
//     ・部材長 lengthMm の保持
//     ・固定軸座標（＝離れ/奥行き）でのグループ化
//   を追加し、同方向・異奥行き（L 字の 2 列）を別 FaceSpanColumn に分離する。
//
//   座標系: すべてグリッド単位（1 grid = 10mm、Handrail.x/y と同じ）。
//   rails のみ部材長 mm（Handrail.lengthMm と同じ）。E-2 で描画時に換算する。
//   斜め壁・円形・斜め手摺は Phase 1 スコープ外（軸平行のみ復元、斜めは除外）。
// ============================================================
import type { Handrail, Post, Anti } from '@/types';
import { getFloor } from '@/types';
import { mmToGrid } from '../gridUtils';
import { getHandrailEndpoints } from '../snapUtils';

export type Face = 'north' | 'south' | 'east' | 'west';

/**
 * 1 つの「離れ（奥行き）」に対応する、面上の連続スパン列。
 * 同方向でも固定軸座標（depthCoord）が異なれば別 Column になる（L 字の 2 列）。
 */
export type FaceSpanColumn = {
  face: Face;
  /** 所属階（Handrail.floor ?? 1）。 */
  floor: number;
  /** 固定軸座標（グリッド）＝奥行き線の位置。N/S→y、E/W→x。 */
  depthCoord: number;
  /** 可変軸区間の開始（グリッド）。N/S→x、E/W→y。 */
  xStart: number;
  /** 可変軸区間の終了（グリッド）。 */
  xEnd: number;
  /** 可変軸ソート順の部材長（mm）列。 */
  rails: number[];
  /** rails と同順の手摺 id。 */
  handrailIds: string[];
};

/** 固定軸クラスタの許容差（グリッド）。1 grid = 10mm なので 3 grid = 30mm。 */
const DEPTH_TOL = 3;
/** 軸平行判定の許容差（グリッド）。純水平/垂直は 0、斜めは除外。 */
const AXIS_TOL = 0.01;

/** 面分類の中間表現（軸平行手摺 1 本分）。 */
type Oriented = {
  id: string;
  lengthMm: number;
  isHorizontal: boolean;
  /** 固定軸座標（水平→y、垂直→x）。 */
  fixed: number;
  /** 可変軸の最小・最大。 */
  vMin: number;
  vMax: number;
};

/** 単一 floor の手摺を、向き＋ bbox 中心のどちら側かで 4 面に分類する。斜め・退化は除外。 */
function classifyByFace(handrails: Handrail[]): Record<Face, Oriented[]> {
  const out: Record<Face, Oriented[]> = { north: [], south: [], east: [], west: [] };

  const axisParallel: Oriented[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    let isHorizontal: boolean;
    if (dy <= AXIS_TOL && dx > AXIS_TOL) isHorizontal = true;
    else if (dx <= AXIS_TOL && dy > AXIS_TOL) isHorizontal = false;
    else continue; // 斜め手摺・退化（長さ 0）は Phase 1 スコープ外
    axisParallel.push({
      id: h.id,
      lengthMm: h.lengthMm,
      isHorizontal,
      fixed: isHorizontal ? p1.y : p1.x,
      vMin: isHorizontal ? Math.min(p1.x, p2.x) : Math.min(p1.y, p2.y),
      vMax: isHorizontal ? Math.max(p1.x, p2.x) : Math.max(p1.y, p2.y),
    });
    minX = Math.min(minX, p1.x, p2.x); maxX = Math.max(maxX, p1.x, p2.x);
    minY = Math.min(minY, p1.y, p2.y); maxY = Math.max(maxY, p1.y, p2.y);
  }
  if (axisParallel.length === 0) return out;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const o of axisParallel) {
    if (o.isHorizontal) (o.fixed < cy ? out.north : out.south).push(o);
    else (o.fixed < cx ? out.west : out.east).push(o);
  }
  return out;
}

/** 1 面分の Oriented を、固定軸座標クラスタ（＝離れ）ごとに Column 化する。 */
function buildColumns(face: Face, floor: number, items: Oriented[]): FaceSpanColumn[] {
  if (items.length === 0) return [];

  // 固定軸でソート → 隣接が DEPTH_TOL 以内なら同一クラスタ（＝同じ離れの壁列）。
  const sorted = [...items].sort((a, b) => a.fixed - b.fixed);
  const clusters: Oriented[][] = [];
  let cur: Oriented[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].fixed - cur[cur.length - 1].fixed) <= DEPTH_TOL) {
      cur.push(sorted[i]);
    } else {
      clusters.push(cur);
      cur = [sorted[i]];
    }
  }
  clusters.push(cur);

  return clusters.map(cluster => {
    // 可変軸で並べてスパン列を得る（vMin 昇順、同点は vMax）。
    const byVar = [...cluster].sort((a, b) => a.vMin - b.vMin || a.vMax - b.vMax);
    return {
      face,
      floor,
      depthCoord: cluster.reduce((s, o) => s + o.fixed, 0) / cluster.length,
      xStart: Math.min(...byVar.map(o => o.vMin)),
      xEnd: Math.max(...byVar.map(o => o.vMax)),
      rails: byVar.map(o => o.lengthMm),
      handrailIds: byVar.map(o => o.id),
    };
  });
}

/**
 * 配置済み手摺から面ごとのスパン列を復元する。
 * @param handrails 全手摺（floor 混在可）。
 * @param floor 指定時はその階のみ。未指定は全階を階ごとに独立処理（bbox 中心も階ごと）。
 * @returns 決定的順序（floor → face[N,E,S,W] → depthCoord → xStart）の FaceSpanColumn[]。
 */
export function reconstructFaces(handrails: Handrail[], floor?: number): FaceSpanColumn[] {
  const floors = floor !== undefined
    ? [floor]
    : Array.from(new Set(handrails.map(getFloor))).sort((a, b) => a - b);

  const FACE_ORDER: Face[] = ['north', 'east', 'south', 'west'];
  const faceRank: Record<Face, number> = { north: 0, east: 1, south: 2, west: 3 };

  const columns: FaceSpanColumn[] = [];
  for (const f of floors) {
    const floorHandrails = handrails.filter(h => getFloor(h) === f);
    const byFace = classifyByFace(floorHandrails);
    for (const face of FACE_ORDER) {
      columns.push(...buildColumns(face, f, byFace[face]));
    }
  }

  columns.sort((a, b) =>
    a.floor - b.floor ||
    faceRank[a.face] - faceRank[b.face] ||
    a.depthCoord - b.depthCoord ||
    a.xStart - b.xStart,
  );
  return columns;
}

/** FaceSpanColumn に対応付いた支柱・踏板（E-2 の縦割付・踏板描画で使用）。 */
export type FacePartsRef = {
  /** depth 線上の支柱の可変軸座標（グリッド、昇順）。 */
  postCoords: number[];
  /** depth 線上の踏板の可変軸区間（グリッド、start 昇順）。 */
  antiSpans: { start: number; end: number; id: string }[];
};

/**
 * FaceSpanColumn に対応する Post（支柱）・Anti（踏板）を、
 * 固定軸（depth）近接＋可変軸区間内＋同 floor で対応付ける。E-2 用の最小実装。
 * 踏板は幅（width）ぶん depth 線から離れて置かれ得るため、固定軸許容に幅を加える。
 */
export function associatePartsToFace(
  column: FaceSpanColumn,
  posts: Post[],
  antis: Anti[],
  tol: number = DEPTH_TOL,
): FacePartsRef {
  const isHorizontal = column.face === 'north' || column.face === 'south';
  const within = (v: number) => v >= column.xStart - tol && v <= column.xEnd + tol;

  const postCoords: number[] = [];
  for (const p of posts) {
    if (getFloor(p) !== column.floor) continue;
    const fixed = isHorizontal ? p.y : p.x;
    const varc = isHorizontal ? p.x : p.y;
    if (Math.abs(fixed - column.depthCoord) <= tol && within(varc)) postCoords.push(varc);
  }
  postCoords.sort((a, b) => a - b);

  const antiSpans: { start: number; end: number; id: string }[] = [];
  for (const a of antis) {
    if (getFloor(a) !== column.floor) continue;
    if ((a.direction === 'horizontal') !== isHorizontal) continue;
    const lenGrid = mmToGrid(a.lengthMm);
    const fixed = isHorizontal ? a.y : a.x;
    const start = isHorizontal ? a.x : a.y;
    const end = start + lenGrid;
    const fixedTol = tol + mmToGrid(a.width); // 踏板幅ぶんの depth ずれを許容
    if (Math.abs(fixed - column.depthCoord) <= fixedTol && (within(start) || within(end))) {
      antiSpans.push({ start, end, id: a.id });
    }
  }
  antiSpans.sort((x, y) => x.start - y.start);

  return { postCoords, antiSpans };
}
