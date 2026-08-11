import { Point, Handrail, HandrailLengthMm, Anti, BuildingShape, Obstacle, MagnetPin } from '@/types';
import { mmToGrid, INITIAL_GRID_PX } from './gridUtils';

/** 最近傍の手摺端点へのスナップ */
export const snapToHandrailEnd = (
  pos: Point,
  handrails: Handrail[],
  snapRadiusGrid: number = 2
): Point | null => {
  let closest: Point | null = null;
  let minDist = Infinity;

  for (const h of handrails) {
    const endpoints = getHandrailEndpoints(h);
    for (const ep of endpoints) {
      const dist = Math.hypot(ep.x - pos.x, ep.y - pos.y);
      if (dist < minDist && dist <= snapRadiusGrid) {
        minDist = dist;
        closest = ep;
      }
    }
  }
  return closest;
};

/** スナップ（端点優先、線分は補助）
 *  手摺の端点 + アンチの4隅をスナップ候補とする
 *  1. 全候補点を snapRadiusGrid 以内で探す → 見つかれば即採用
 *  2. 候補点が無い場合のみ、手摺線分上の最近傍点を狭い範囲で探す
 */
export const snapToHandrail = (
  pos: Point,
  handrails: Handrail[],
  snapRadiusGrid: number,
  antis?: Anti[]
): Point | null => {
  // --- Pass 1: 端点/隅点スナップ（優先） ---
  let closestEndpoint: Point | null = null;
  let minEndpointDist = Infinity;

  // 手摺の端点
  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    for (const ep of [p1, p2]) {
      const dist = Math.hypot(ep.x - pos.x, ep.y - pos.y);
      if (dist < minEndpointDist && dist <= snapRadiusGrid) {
        minEndpointDist = dist;
        closestEndpoint = ep;
      }
    }
  }

  // アンチの4隅
  if (antis) {
    for (const a of antis) {
      for (const cp of getAntiCorners(a)) {
        const dist = Math.hypot(cp.x - pos.x, cp.y - pos.y);
        if (dist < minEndpointDist && dist <= snapRadiusGrid) {
          minEndpointDist = dist;
          closestEndpoint = cp;
        }
      }
    }
  }

  if (closestEndpoint) return closestEndpoint;

  // --- Pass 2: 手摺線分上スナップ（候補点が無い場合のみ、範囲を絞る） ---
  const lineSnapRadius = Math.max(Math.round(snapRadiusGrid * 0.4), 3);
  let closestLine: Point | null = null;
  let minLineDist = Infinity;

  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    let t = ((pos.x - p1.x) * dx + (pos.y - p1.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = Math.round(p1.x + t * dx);
    const projY = Math.round(p1.y + t * dy);
    const dist = Math.hypot(projX - pos.x, projY - pos.y);

    if (dist < minLineDist && dist <= lineSnapRadius) {
      minLineDist = dist;
      closestLine = { x: projX, y: projY };
    }
  }

  return closestLine;
};

/** 手摺配置のスナップ（始点スナップ＋終点スナップの両方を考慮）
 *  - 始点スナップ: 配置起点を既存端点に合わせる
 *  - 終点スナップ: 配置終点（起点+length）が既存端点に近い場合、起点をずらして合わせる
 *  より近い方を採用。返り値は配置すべき始点座標。
 */
export const snapHandrailPlacement = (
  startPos: Point,
  lengthMm: HandrailLengthMm,
  direction: 'horizontal' | 'vertical' | number,
  handrails: Handrail[],
  snapRadiusGrid: number,
  antis?: Anti[]
): { snappedStart: Point; snapIndicator: Point } | null => {
  const lengthGrid = mmToGrid(lengthMm);

  // 終点を計算（角度対応）
  let endPos: Point;
  if (direction === 'horizontal') {
    endPos = { x: startPos.x + lengthGrid, y: startPos.y };
  } else if (direction === 'vertical') {
    endPos = { x: startPos.x, y: startPos.y + lengthGrid };
  } else {
    const rad = (direction as number) * (Math.PI / 180);
    endPos = {
      x: startPos.x + Math.round(lengthGrid * Math.cos(rad)),
      y: startPos.y + Math.round(lengthGrid * Math.sin(rad)),
    };
  }

  // 始点スナップ
  const startSnap = snapToHandrail(startPos, handrails, snapRadiusGrid, antis);
  const startDist = startSnap
    ? Math.hypot(startSnap.x - startPos.x, startSnap.y - startPos.y)
    : Infinity;

  // 終点スナップ
  const endSnap = snapToHandrail(endPos, handrails, snapRadiusGrid, antis);
  const endDist = endSnap
    ? Math.hypot(endSnap.x - endPos.x, endSnap.y - endPos.y)
    : Infinity;

  if (startDist === Infinity && endDist === Infinity) return null;

  if (startDist <= endDist && startSnap) {
    return { snappedStart: startSnap, snapIndicator: startSnap };
  }

  if (endSnap) {
    let adjustedStart: Point;
    if (direction === 'horizontal') {
      adjustedStart = { x: endSnap.x - lengthGrid, y: endSnap.y };
    } else if (direction === 'vertical') {
      adjustedStart = { x: endSnap.x, y: endSnap.y - lengthGrid };
    } else {
      const rad = (direction as number) * (Math.PI / 180);
      adjustedStart = {
        x: endSnap.x - Math.round(lengthGrid * Math.cos(rad)),
        y: endSnap.y - Math.round(lengthGrid * Math.sin(rad)),
      };
    }
    return { snappedStart: adjustedStart, snapIndicator: endSnap };
  }

  return null;
};

/** 手摺の両端点を取得 */
export const getHandrailEndpoints = (h: Handrail): [Point, Point] => {
  const lengthGrid = mmToGrid(h.lengthMm);
  let dx = 0;
  let dy = 0;

  if (h.direction === 'horizontal') {
    dx = lengthGrid;
  } else if (h.direction === 'vertical') {
    dy = lengthGrid;
  } else {
    const rad = (h.direction as number) * (Math.PI / 180);
    dx = Math.round(lengthGrid * Math.cos(rad));
    dy = Math.round(lengthGrid * Math.sin(rad));
  }

  return [
    { x: h.x, y: h.y },
    { x: h.x + dx, y: h.y + dy },
  ];
};

/** グリッド交点へのマグネットスナップ（太い線優先） */
export const snapToGridIntersection = (
  worldX: number,
  worldY: number,
  zoom: number,
): Point => {
  const MAJOR_STEP = 100;  // 太い線: 100グリッド = 1000mm
  const MINOR_STEP = 50;   // 細い線: 50グリッド = 500mm

  // スナップ範囲をグリッド単位に変換（画面上のピクセルから逆算）
  const gridPx = INITIAL_GRID_PX * zoom;
  const majorRange = 40 / gridPx; // 画面40px以内
  const minorRange = 20 / gridPx; // 画面20px以内

  // 太い線の最近接交点
  const majorX = Math.round(worldX / MAJOR_STEP) * MAJOR_STEP;
  const majorY = Math.round(worldY / MAJOR_STEP) * MAJOR_STEP;
  const majorDist = Math.hypot(worldX - majorX, worldY - majorY);
  if (majorDist <= majorRange) {
    return { x: majorX, y: majorY };
  }

  // 細い線の最近接交点
  const minorX = Math.round(worldX / MINOR_STEP) * MINOR_STEP;
  const minorY = Math.round(worldY / MINOR_STEP) * MINOR_STEP;
  const minorDist = Math.hypot(worldX - minorX, worldY - minorY);
  if (minorDist <= minorRange) {
    return { x: minorX, y: minorY };
  }

  // どちらにもスナップしない → 元の座標（グリッド1単位に丸め）
  return { x: Math.round(worldX), y: Math.round(worldY) };
};

/** 全建物・障害物の頂点を取得 */
export function getAllExistingVertices(buildings: BuildingShape[], obstacles: Obstacle[]): Point[] {
  const vertices: Point[] = [];
  for (const b of buildings) {
    for (const p of b.points) vertices.push(p);
  }
  for (const o of obstacles) {
    if (o.points) {
      for (const p of o.points) vertices.push(p);
    } else if (o.type !== 'custom_circle') {
      vertices.push(
        { x: o.x, y: o.y },
        { x: o.x + o.width, y: o.y },
        { x: o.x + o.width, y: o.y + o.height },
        { x: o.x, y: o.y + o.height },
      );
    }
  }
  return vertices;
}

/** 全建物・障害物の辺を取得 */
export function getAllExistingEdges(buildings: BuildingShape[], obstacles: Obstacle[]): { p1: Point; p2: Point }[] {
  const edges: { p1: Point; p2: Point }[] = [];
  for (const b of buildings) {
    for (let i = 0; i < b.points.length; i++) {
      edges.push({ p1: b.points[i], p2: b.points[(i + 1) % b.points.length] });
    }
  }
  for (const o of obstacles) {
    if (o.points) {
      for (let i = 0; i < o.points.length; i++) {
        edges.push({ p1: o.points[i], p2: o.points[(i + 1) % o.points.length] });
      }
    } else if (o.type !== 'custom_circle') {
      const p1 = { x: o.x, y: o.y }, p2 = { x: o.x + o.width, y: o.y };
      const p3 = { x: o.x + o.width, y: o.y + o.height }, p4 = { x: o.x, y: o.y + o.height };
      edges.push({ p1, p2 }, { p1: p2, p2: p3 }, { p1: p3, p2: p4 }, { p1: p4, p2: p1 });
    }
  }
  return edges;
}

/** 頂点への強スナップ */
export function snapToVertex(
  worldX: number, worldY: number, vertices: Point[], zoom: number, snapRangePx: number = 30
): Point | null {
  const gridPx = INITIAL_GRID_PX * zoom;
  const range = snapRangePx / gridPx;
  let closest: Point | null = null;
  let minDist = Infinity;
  for (const v of vertices) {
    const d = Math.hypot(v.x - worldX, v.y - worldY);
    if (d < range && d < minDist) { minDist = d; closest = v; }
  }
  return closest ? { x: closest.x, y: closest.y } : null;
}

/** 辺への弱スナップ */
export function snapToEdge(
  worldX: number, worldY: number, edges: { p1: Point; p2: Point }[], zoom: number, snapRangePx: number = 10
): Point | null {
  const gridPx = INITIAL_GRID_PX * zoom;
  const range = snapRangePx / gridPx;
  let closest: Point | null = null;
  let minDist = Infinity;
  for (const e of edges) {
    const dx = e.p2.x - e.p1.x, dy = e.p2.y - e.p1.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((worldX - e.p1.x) * dx + (worldY - e.p1.y) * dy) / len2));
    const px = e.p1.x + t * dx, py = e.p1.y + t * dy;
    const d = Math.hypot(px - worldX, py - worldY);
    if (d < range && d < minDist) { minDist = d; closest = { x: Math.round(px), y: Math.round(py) }; }
  }
  return closest;
}

/** アンチの4隅を取得 */
export const getAntiCorners = (a: Anti): Point[] => {
  const lenGrid = mmToGrid(a.lengthMm);
  const wGrid = mmToGrid(a.width);
  if (a.direction === 'horizontal') {
    return [
      { x: a.x, y: a.y },
      { x: a.x + lenGrid, y: a.y },
      { x: a.x, y: a.y + wGrid },
      { x: a.x + lenGrid, y: a.y + wGrid },
    ];
  }
  // vertical
  return [
    { x: a.x, y: a.y },
    { x: a.x + wGrid, y: a.y },
    { x: a.x, y: a.y + lenGrid },
    { x: a.x + wGrid, y: a.y + lenGrid },
  ];
};

/** 角度を15度単位にスナップ */
export const snapAngle = (angleDeg: number): number => {
  return Math.round(angleDeg / 15) * 15;
};

/** 2点間の角度（度） */
export const angleBetween = (from: Point, to: Point): number => {
  const rad = Math.atan2(to.y - from.y, to.x - from.x);
  return (rad * 180) / Math.PI;
};

/** 障害物の壁面スナップ範囲（デフォルト 2000mm = 200グリッド） */
export const OBSTACLE_WALL_SNAP_RANGE_GRID = mmToGrid(2000);

/**
 * 障害物を建物の壁面にスナップさせ、障害物の左上座標を返す。
 * 壁に近い場合は壁に沿って配置（外側に接地）、そうでなければ null を返す。
 *
 * @param cursor 障害物の想定中心位置（グリッド座標）
 * @param width 障害物の幅（グリッド単位、ポリゴン障害物はバウンディングボックスの幅）
 * @param height 障害物の高さ（グリッド単位）
 * @param buildings 全建物
 * @param rangeGrid スナップ有効距離（グリッド単位、デフォルト OBSTACLE_WALL_SNAP_RANGE_GRID）
 * @returns スナップ成功時は左上座標 {x, y}、対象辺がなければ null
 */
export function snapObstacleToWall(
  cursor: Point,
  width: number,
  height: number,
  buildings: BuildingShape[],
  rangeGrid: number = OBSTACLE_WALL_SNAP_RANGE_GRID,
): Point | null {
  let bestDist = Infinity;
  let result: Point | null = null;

  for (const b of buildings) {
    const pts = b.points;
    if (pts.length < 2) continue;

    // 建物中心（外向き法線の判定用）
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const len = Math.sqrt(ex * ex + ey * ey);
      if (len < 1) continue;

      // カーソルを辺に射影
      const t = Math.max(0, Math.min(1, ((cursor.x - p1.x) * ex + (cursor.y - p1.y) * ey) / (len * len)));
      const projX = p1.x + t * ex;
      const projY = p1.y + t * ey;
      const dist = Math.hypot(cursor.x - projX, cursor.y - projY);

      if (dist < bestDist && dist < rangeGrid) {
        bestDist = dist;

        // 外向き法線（建物中心の反対側）
        let nx = -ey / len;
        let ny = ex / len;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        if (Math.hypot(mid.x + nx - cx, mid.y + ny - cy) < Math.hypot(mid.x - cx, mid.y - cy)) {
          nx = -nx;
          ny = -ny;
        }

        // 辺の向き（水平寄り or 垂直寄り）で配置方向を決定
        const isHorizEdge = Math.abs(ey) < Math.abs(ex);
        if (isHorizEdge) {
          // 水平辺: 障害物の横中心を projX に合わせ、外向きに接地
          result = {
            x: Math.round(projX - width / 2),
            y: ny > 0 ? Math.round(projY) : Math.round(projY - height),
          };
        } else {
          // 垂直辺: 障害物の縦中心を projY に合わせ、外向きに接地
          result = {
            x: nx > 0 ? Math.round(projX) : Math.round(projX - width),
            y: Math.round(projY - height / 2),
          };
        }
      }
    }
  }

  return result;
}

/**
 * Phase M-6a: マグネットピンへの強力吸着。
 * ドラッグしたオブジェクトの参照点が、ピンの吸着範囲内にあれば
 * そのピンに完全一致するよう補正するオフセットを返す。
 *
 * 吸着範囲: 画面 50px / zoom と 実距離 300mm の大きい方（ハイブリッド）
 *   - ズームインしても 300mm の最低吸着範囲を保証
 *   - ズームアウトでは画面 50px 感覚で吸着
 *
 * @param refPoint オブジェクトの参照点（グリッド座標）
 * @param pins 全マグネットピン（floor フィルタなし）
 * @param zoom 現在のズーム
 * @returns refPoint をピンに合わせるためのオフセット（グリッド単位）+ pinId、または null
 */
export function snapToMagnetPin(
  refPoint: Point,
  pins: MagnetPin[],
  zoom: number,
): { dx: number; dy: number; pinId: string } | null {
  if (pins.length === 0) return null;

  // 強力マグネット: 画面 50px と 実距離 300mm (= 30 グリッド) の大きい方
  const SNAP_PX = 50;
  const MIN_THRESHOLD_GRID = 30; // 300mm = 30 グリッド
  const pixelBasedGrid = SNAP_PX / (INITIAL_GRID_PX * zoom);
  const thresholdGrid = Math.max(pixelBasedGrid, MIN_THRESHOLD_GRID);

  let bestPin: MagnetPin | null = null;
  let bestDist = Infinity;
  for (const pin of pins) {
    const dx = pin.x - refPoint.x;
    const dy = pin.y - refPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < thresholdGrid && dist < bestDist) {
      bestDist = dist;
      bestPin = pin;
    }
  }

  if (!bestPin) return null;

  return {
    dx: bestPin.x - refPoint.x,
    dy: bestPin.y - refPoint.y,
    pinId: bestPin.id,
  };
}

/**
 * 支柱を手摺の端点へ吸着させる (= P-2)。
 * 半径内でいちばん近い端点。無ければカーソル位置のまま。
 * 配置とシャドーが同じ位置になるよう、両方がこの 1 本を通る。
 */
export const snapPostToHandrailEnds = (
  gridPos: Point, handrails: Handrail[], snapRadius: number,
): Point => {
  let best: Point = gridPos;
  let bestDist = snapRadius;
  for (const h of handrails) {
    for (const p of getHandrailEndpoints(h)) {
      const d = Math.hypot(p.x - gridPos.x, p.y - gridPos.y);
      if (d < bestDist) { bestDist = d; best = { x: p.x, y: p.y }; }
    }
  }
  return best;
};
