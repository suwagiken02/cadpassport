import type { BuildingShape, Handrail, HeightMarker, Point } from '@/types';
import { mmToGrid } from '@/lib/konva/gridUtils';
import { getOutlinePolygon, projectPointToOutline } from '@/lib/konva/heightMarkerUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';
import { getHeightAtPosition } from '@/lib/konva/heightInterpolation';

const DEFAULT_PROJECTION_THRESHOLD_MM = 2000;

/**
 * 多角形の閉領域面積を m² で返す（シューレース公式、 絶対値、 CW/CCW 不問）。
 * Point[] はグリッド単位 (= 1 grid = 10mm) 前提、 グリッド² → m² 変換 (÷10,000) 込み。
 * 退化ケース (= 3 点未満) → 0。
 */
export function computePolygonArea(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  const gridArea = Math.abs(sum) / 2;
  return gridArea / 10_000;
}

/**
 * 建物の床面積 (m²)。 屋根あり/なし統一 outline で計算。
 */
export function getFloorArea(building: BuildingShape): number {
  const outline = getOutlinePolygon(building);
  return computePolygonArea(outline);
}

/**
 * 任意点を特定辺に射影して t (= 0..1) を返す internal helper。
 * findHostBuilding の両端 t 計算用、 辺端をはみ出る場合は clamp。
 */
function computeTOnEdge(point: Point, building: BuildingShape, edgeIndex: number): number {
  const outline = getOutlinePolygon(building);
  if (edgeIndex < 0 || edgeIndex >= outline.length) return 0;
  const p1 = outline[edgeIndex];
  const p2 = outline[(edgeIndex + 1) % outline.length];
  const ex = p2.x - p1.x;
  const ey = p2.y - p1.y;
  const len2 = ex * ex + ey * ey;
  if (len2 < 0.001) return 0;
  return Math.max(0, Math.min(1, ((point.x - p1.x) * ex + (point.y - p1.y) * ey) / len2));
}

/**
 * Handrail を最寄り建物に射影。
 * 中央点 (= 始点と終点の平均) で射影、 最短距離の建物を選ぶ。
 * 両端 t は中央点と同じ辺に対する射影 (= 角ハンドレールは clamp)。
 *
 * options.floorFilter: 指定で建物絞り (= Building.floor ?? 1 で判定)、 該当 0 個なら null
 * options.thresholdMm: 射影距離超過なら null、 default 2000mm
 */
export function findHostBuilding(
  handrail: Handrail,
  buildings: BuildingShape[],
  options?: {
    thresholdMm?: number;
    floorFilter?: 1 | 2;
  },
): {
  building: BuildingShape;
  edgeIndex: number;
  tStart: number;
  tEnd: number;
} | null {
  const thresholdMm = options?.thresholdMm ?? DEFAULT_PROJECTION_THRESHOLD_MM;
  const thresholdGrid = mmToGrid(thresholdMm);
  const floorFilter = options?.floorFilter;

  const candidates = floorFilter !== undefined
    ? buildings.filter((b) => (b.floor ?? 1) === floorFilter)
    : buildings;
  if (candidates.length === 0) return null;

  const [p1, p2] = getHandrailEndpoints(handrail);
  const midPoint: Point = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

  let bestBuilding: BuildingShape | null = null;
  let bestDist = Infinity;
  let bestEdgeIndex = -1;
  let bestEdgeIsAligned = false;

  for (const b of candidates) {
    const outline = getOutlinePolygon(b);
    // 全 edge を評価 (= alignment 判定が単一建物で機能するように、 projectPointToOutline 最近接 1 個では不十分)
    for (let i = 0; i < outline.length; i++) {
      const ep1 = outline[i];
      const ep2 = outline[(i + 1) % outline.length];
      // 点-線分距離を inline 計算 (= t を clamp、 projectPointToOutline と同等)
      const dx = ep2.x - ep1.x;
      const dy = ep2.y - ep1.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((midPoint.x - ep1.x) * dx + (midPoint.y - ep1.y) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const projX = ep1.x + t * dx;
      const projY = ep1.y + t * dy;
      const dist = Math.hypot(midPoint.x - projX, midPoint.y - projY);
      // edge direction と handrail direction の一致判定
      const edgeIsHorizontal = Math.abs(dy) < 0.01;
      const handrailIsHorizontal = handrail.direction === 'horizontal';
      const isAligned = edgeIsHorizontal === handrailIsHorizontal;
      // alignment 一致を優先、 同条件なら距離で判定
      const isBetter = isAligned && !bestEdgeIsAligned
        ? true
        : isAligned === bestEdgeIsAligned ? dist < bestDist : false;
      if (isBetter) {
        bestDist = dist;
        bestBuilding = b;
        bestEdgeIndex = i;
        bestEdgeIsAligned = isAligned;
      }
    }
  }

  if (!bestBuilding || bestEdgeIndex < 0 || bestDist > thresholdGrid) return null;

  const tStart = computeTOnEdge(p1, bestBuilding, bestEdgeIndex);
  const tEnd = computeTOnEdge(p2, bestBuilding, bestEdgeIndex);

  return { building: bestBuilding, edgeIndex: bestEdgeIndex, tStart, tEnd };
}

/**
 * 1 スパン (= Handrail) の平米 (m²)。
 * 計算: lengthMm × (両端建物高さ平均 + offsetMm) ÷ 1,000,000
 *
 * floorTag: 指定で建物絞り (= findHostBuilding に渡す)
 * 射影不能 / マーカー 0 個建物 (= getHeightAtPosition が null) → null
 */
export function computeSpanArea(
  handrail: Handrail,
  buildings: BuildingShape[],
  markers: HeightMarker[],
  offsetMm: number,
  floorTag?: 1 | 2,
): number | null {
  const host = findHostBuilding(handrail, buildings, { floorFilter: floorTag });
  if (!host) return null;

  const h1 = getHeightAtPosition(host.building, markers, host.edgeIndex, host.tStart);
  const h2 = getHeightAtPosition(host.building, markers, host.edgeIndex, host.tEnd);
  if (h1 == null || h2 == null) return null;

  const heightAvgMm = (h1 + h2) / 2;
  const scaffoldHeightMm = heightAvgMm + offsetMm;
  const spanAreaMm2 = handrail.lengthMm * scaffoldHeightMm;
  return spanAreaMm2 / 1_000_000;
}

/**
 * 全 Handrail を面 (= `${building.id}-${edgeIndex}`) ごとにグループ化。
 *
 * floorDesignation ルール (= ★12 確定):
 *   - undefined → 全建物対象 (= floor 無視、 片建物のみ案件)
 *   - あり + Handrail Map 登録済 → その floorTag で射影
 *   - あり + Handrail Map 未登録 → default 2F (= 保険挙動、 UI default と整合)
 *
 * 射影不能な Handrail は uncalculable に分離。
 */
export function groupHandrailsByFace(
  handrails: Handrail[],
  buildings: BuildingShape[],
  floorDesignation?: Map<string, 1 | 2>,
): {
  faceGroups: Map<string, Handrail[]>;
  uncalculable: Handrail[];
} {
  const faceGroups = new Map<string, Handrail[]>();
  const uncalculable: Handrail[] = [];

  for (const h of handrails) {
    let floorTag: 1 | 2 | undefined;
    if (floorDesignation !== undefined) {
      floorTag = floorDesignation.get(h.id) ?? 2;
    }
    const host = findHostBuilding(h, buildings, { floorFilter: floorTag });
    if (!host) {
      uncalculable.push(h);
      continue;
    }
    const faceKey = `${host.building.id}-${host.edgeIndex}`;
    const arr = faceGroups.get(faceKey) ?? [];
    arr.push(h);
    faceGroups.set(faceKey, arr);
  }

  return { faceGroups, uncalculable };
}

/**
 * 0-indexed 連番を Excel 風ラベルに変換 (= A, B, ..., Z, AA, AB, ..., AZ, BA, ...)。
 * 26 個超過時の挙動 (= 平米計算 Phase E-1)。
 */
function indexToLabel(i: number): string {
  let n = i;
  let label = '';
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * faceKey (= `${buildingId}-${edgeIndex}`) を building.id 昇順 → edgeIndex 昇順
 * でソートし、 ABCDEF... を決定論的に割り振り (= 平米計算 Phase E-1)。
 * building.id が uuidv4 (= '-' 含む) のため lastIndexOf で分離。
 */
function assignFaceLabels(faceAreas: Map<string, number>): Map<string, string> {
  const keys = Array.from(faceAreas.keys()).sort((a, b) => {
    const lastA = a.lastIndexOf('-');
    const lastB = b.lastIndexOf('-');
    const buildingIdA = a.slice(0, lastA);
    const buildingIdB = b.slice(0, lastB);
    if (buildingIdA !== buildingIdB) return buildingIdA.localeCompare(buildingIdB);
    const edgeA = parseInt(a.slice(lastA + 1), 10);
    const edgeB = parseInt(b.slice(lastB + 1), 10);
    return edgeA - edgeB;
  });
  const labels = new Map<string, string>();
  keys.forEach((key, i) => { labels.set(key, indexToLabel(i)); });
  return labels;
}

/**
 * 全足場の平米集計。 面別 + 全体合計 + byFloor 内部 breakdown。
 *
 * 各 Handrail を computeSpanArea で計算、 計算不能は uncalculable に分離。
 * uncalculable.reason (= 平米計算 Phase E-1):
 *   - 'projection-failed' → findHostBuilding が null (建物なし/距離超過)
 *   - 'height-undefined'  → host 取得後 getHeightAtPosition null (マーカー未配置)
 * byFloor:
 *   - floorDesignation 未指定 → 全 Handrail を floor1 に加算
 *   - 指定 → floorTag (= Map 登録 OR default 2F) に従って加算
 */
export function computeScaffoldAreaSummary(
  handrails: Handrail[],
  buildings: BuildingShape[],
  markers: HeightMarker[],
  offsetMm: number,
  floorDesignation?: Map<string, 1 | 2>,
): {
  faceAreas: Map<string, number>;
  faceLabels: Map<string, string>;
  total: number;
  uncalculable: { handrail: Handrail; reason: 'projection-failed' | 'height-undefined' }[];
  byFloor: { floor1: number; floor2: number };
} {
  const faceAreas = new Map<string, number>();
  const uncalculable: { handrail: Handrail; reason: 'projection-failed' | 'height-undefined' }[] = [];
  let total = 0;
  const byFloor = { floor1: 0, floor2: 0 };

  for (const h of handrails) {
    let floorTag: 1 | 2 | undefined;
    if (floorDesignation !== undefined) {
      floorTag = floorDesignation.get(h.id) ?? 2;
    }
    const host = findHostBuilding(h, buildings, { floorFilter: floorTag });
    if (!host) {
      uncalculable.push({ handrail: h, reason: 'projection-failed' });
      continue;
    }
    const area = computeSpanArea(h, buildings, markers, offsetMm, floorTag);
    if (area == null) {
      // host は OK だが computeSpanArea null → getHeightAtPosition 失敗確定
      uncalculable.push({ handrail: h, reason: 'height-undefined' });
      continue;
    }
    const faceKey = `${host.building.id}-${host.edgeIndex}`;
    faceAreas.set(faceKey, (faceAreas.get(faceKey) ?? 0) + area);
    total += area;
    if (floorDesignation === undefined) {
      byFloor.floor1 += area;
    } else if (floorTag === 2) {
      byFloor.floor2 += area;
    } else {
      byFloor.floor1 += area;
    }
  }

  const faceLabels = assignFaceLabels(faceAreas);
  return { faceAreas, faceLabels, total, uncalculable, byFloor };
}

/**
 * 全建物の床面積集計 (= 1F / 2F / 全体合計)。
 * Building.floor ?? 1 で 1F フォールバック。
 */
export function computeBuildingFloorAreaSummary(
  buildings: BuildingShape[],
): {
  floor1: number;
  floor2: number;
  total: number;
} {
  let floor1 = 0;
  let floor2 = 0;
  for (const b of buildings) {
    const area = getFloorArea(b);
    if ((b.floor ?? 1) === 2) {
      floor2 += area;
    } else {
      floor1 += area;
    }
  }
  return { floor1, floor2, total: floor1 + floor2 };
}

/**
 * 面プレビュー mini canvas 用の座標変換ジオメトリ (= 平米計算 Phase E-3)。
 * BuildingTemplateModal / AutoLayoutModal の PreviewSVG パターンを utility 化。
 *
 * - 入力 points の bbox を svgW × svgH の枠内 (pad 残し) に fit させる scale を算出
 * - toSvg(p) で grid 座標 → SVG 座標 (centered) に変換
 * - 退化ケース:
 *   - points 空 → bbox 全ゼロ、 scale 0、 toSvg は中央固定
 *   - 全点同一 / 1 点 → bw/bh = 0 を 1 で fallback、 中央に collapse
 */
export function computeAreaPreviewGeometry(
  points: Point[],
  svgW: number,
  svgH: number,
  pad: number,
): {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  scale: number;
  toSvg: (p: Point) => { x: number; y: number };
} {
  if (points.length === 0) {
    const cx = svgW / 2, cy = svgH / 2;
    return {
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      scale: 0,
      toSvg: () => ({ x: cx, y: cy }),
    };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const bw = (maxX - minX) || 1;
  const bh = (maxY - minY) || 1;
  const scale = Math.min((svgW - pad * 2) / bw, (svgH - pad * 2) / bh);
  const offsetX = pad + ((svgW - pad * 2) - bw * scale) / 2;
  const offsetY = pad + ((svgH - pad * 2) - bh * scale) / 2;
  const toSvg = (p: Point) => ({
    x: offsetX + (p.x - minX) * scale,
    y: offsetY + (p.y - minY) * scale,
  });
  return {
    bbox: { minX, minY, maxX, maxY },
    scale,
    toSvg,
  };
}
