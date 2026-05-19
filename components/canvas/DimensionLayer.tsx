'use client';

import React from 'react';
import { Layer, Line, Rect, Text } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX, gridToMm, mmToGrid } from '@/lib/konva/gridUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';
import { getBuildingEdgesClockwise } from '@/lib/konva/autoLayoutUtils';
import { StartCorner } from '@/types';

const GUIDE_COLOR = '#378ADD';
const GUIDE_OPACITY = 0.3;
const COLOR_OK = '#888780';
const COLOR_WARN = '#E85D3A';
const ARROW = 4;
const TOL = 15;

/** ガイド線 + ラベル */
function Guide({
  x1, y1, x2, y2, label, zoom, color,
}: {
  x1: number; y1: number; x2: number; y2: number;
  label: string; zoom: number; color: string;
}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return null;
  const a = ARROW * zoom;
  const fs = Math.max(12, 14 * zoom);
  const isV = Math.abs(dx) < Math.abs(dy);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const tw = label.length * fs * 0.65 + 6, th = fs + 4;

  return (
    <>
      <Line points={[x1, y1, x2, y2]}
        stroke={GUIDE_COLOR} strokeWidth={1} opacity={GUIDE_OPACITY} listening={false} />
      {isV ? (
        <>
          <Line points={[x1 - a, y1 + a, x1, y1, x1 + a, y1 + a]}
            stroke={GUIDE_COLOR} strokeWidth={1} opacity={GUIDE_OPACITY} listening={false} />
          <Line points={[x2 - a, y2 - a, x2, y2, x2 + a, y2 - a]}
            stroke={GUIDE_COLOR} strokeWidth={1} opacity={GUIDE_OPACITY} listening={false} />
        </>
      ) : (
        <>
          <Line points={[x1 + a, y1 - a, x1, y1, x1 + a, y1 + a]}
            stroke={GUIDE_COLOR} strokeWidth={1} opacity={GUIDE_OPACITY} listening={false} />
          <Line points={[x2 - a, y2 - a, x2, y2, x2 - a, y2 + a]}
            stroke={GUIDE_COLOR} strokeWidth={1} opacity={GUIDE_OPACITY} listening={false} />
        </>
      )}
      <Rect x={mx - tw / 2} y={my - th / 2} width={tw} height={th}
        fill="white" opacity={0.75} cornerRadius={2} listening={false} />
      <Text x={mx - (label.length * fs * 0.65) / 2} y={my - fs / 2}
        text={label} fontSize={fs} fontFamily="monospace" fontStyle="bold"
        fill={color} listening={false} />
    </>
  );
}

/**
 * コーナー頂点のインデックスを特定する。
 * NW: -x-y が最大, NE: +x-y, SE: +x+y, SW: -x+y
 */
function findCornerVertexIndex(
  pts: { x: number; y: number }[],
  corner: StartCorner,
): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let score = 0;
    score += (corner === 'ne' || corner === 'se') ? p.x : -p.x;
    score += (corner === 'se' || corner === 'sw') ? p.y : -p.y;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

export default function DimensionLayer() {
  const { canvasData, zoom, panX, panY, showDimensions } = useCanvasStore();
  const gridPx = INITIAL_GRID_PX * zoom;

  if (!showDimensions) return <Layer listening={false} />;
  if (!canvasData.buildings.length || !canvasData.handrails.length) return <Layer listening={false} />;

  const gx = (g: number) => g * gridPx + panX;
  const gy = (g: number) => g * gridPx + panY;
  const elements: React.ReactElement[] = [];

  // 描画対象の scaffoldStart を収集（1F/2F 両方保持対応）
  // 新フィールド (scaffoldStart1F / scaffoldStart2F) 優先、無ければ旧 scaffoldStart をフォールバック
  // 該当階の建物が存在しない場合はスキップ（偽寸法線防止）
  const has1FBuilding = canvasData.buildings.some(b => (b.floor ?? 1) === 1);
  const has2FBuilding = canvasData.buildings.some(b => b.floor === 2);
  const dimensionJobs: NonNullable<typeof canvasData.scaffoldStart>[] = [];
  if (canvasData.scaffoldStart1F && has1FBuilding) {
    dimensionJobs.push(canvasData.scaffoldStart1F);
  }
  if (canvasData.scaffoldStart2F && has2FBuilding) {
    dimensionJobs.push(canvasData.scaffoldStart2F);
  }
  if (dimensionJobs.length === 0 && canvasData.scaffoldStart) {
    const legacyFloor = canvasData.scaffoldStart.floor ?? 1;
    const hasLegacyBuilding = canvasData.buildings.some(b => (b.floor ?? 1) === legacyFloor);
    if (hasLegacyBuilding) {
      dimensionJobs.push(canvasData.scaffoldStart);
    }
  }

  let mainLogicRan = false;
  for (const scaffoldStart of dimensionJobs) {
    const targetFloor = scaffoldStart.floor ?? 1;

    // 全手摺の端点（同階のみ）
    const eps: { x: number; y: number }[] = [];
    for (const h of canvasData.handrails) {
      if ((h.floor ?? 1) !== targetFloor) continue;
      const [p1, p2] = getHandrailEndpoints(h);
      eps.push(p1, p2);
    }

    if (canvasData.buildings.length === 0) continue;
    const building = canvasData.buildings.find(b => (b.floor ?? 1) === targetFloor) ?? canvasData.buildings[0];
    const edges = getBuildingEdgesClockwise(building);
    const n = edges.length;
    if (n < 3) continue;

    const corner = scaffoldStart.corner;
    const face1Dist = mmToGrid(scaffoldStart.face1DistanceMm);
    const face2Dist = mmToGrid(scaffoldStart.face2DistanceMm);
    const pts = edges.map(e => e.p1);

    // コーナー頂点（巡回開始点）
    const startIdx = scaffoldStart.startVertexIndex != null
      ? scaffoldStart.startVertexIndex % n
      : findCornerVertexIndex(pts, corner);

    // 分割ステップ: CW巡回で凸角を数え、凸角の半数に達した時点で分割
    // step 0..splitStep-1 = Path1（CW腕、forward: p1→p2）
    // step splitStep..n-1 = Path2（CCW腕、reversed: p2→p1）
    //
    // 凸角判定: CW巡回で前辺→次辺のクロス積が正 = 右折 = 凸角（外角90度）
    // 矩形(4頂点): 凸角4→半数2→step2で分割
    // L字(6頂点): 凸角4→半数2→step... ではなく凸角の総数/2で分割
    // T字(8頂点): 凸角6→半数3→step位置で分割

    // まず全凸角を数える
    let totalConvex = 0;
    for (let s = 0; s < n; s++) {
      const idx = (startIdx + s) % n;
      const prevIdx = (startIdx + s - 1 + n) % n;
      const prevEdge = edges[prevIdx];
      const currEdge = edges[idx];
      // クロス積: prev方向 × curr方向 （CWで正 = 右折 = 凸角）
      const ax = prevEdge.p2.x - prevEdge.p1.x;
      const ay = prevEdge.p2.y - prevEdge.p1.y;
      const bx = currEdge.p2.x - currEdge.p1.x;
      const by = currEdge.p2.y - currEdge.p1.y;
      const cross = ax * by - ay * bx;
      if (cross > 0) totalConvex++;
    }
    const halfConvex = Math.ceil(totalConvex / 2);

    // CW巡回で凸角を数え、半数に達したステップで分割
    let convexCount = 0;
    let splitStep = Math.floor(n / 2); // フォールバック
    for (let s = 0; s < n; s++) {
      const idx = (startIdx + s) % n;
      const prevIdx = (startIdx + s - 1 + n) % n;
      const prevEdge = edges[prevIdx];
      const currEdge = edges[idx];
      const ax = prevEdge.p2.x - prevEdge.p1.x;
      const ay = prevEdge.p2.y - prevEdge.p1.y;
      const bx = currEdge.p2.x - currEdge.p1.x;
      const by = currEdge.p2.y - currEdge.p1.y;
      const cross = ax * by - ay * bx;
      if (cross > 0) convexCount++;
      if (convexCount >= halfConvex && s > 0) {
        splitStep = s;
        break;
      }
    }

    // 前ステップの足場ライン座標を記憶（コーナー部の手摺を拾うため）
    let prevScaffoldX: number | null = null; // 前の垂直辺のscaffoldCoord
    let prevScaffoldY: number | null = null; // 前の水平辺のscaffoldCoord

    for (let step = 0; step < n; step++) {
      const idx = (startIdx + step) % n;
      const edge = edges[idx];
      const isReversed = step >= splitStep;
      const isH = edge.face === 'north' || edge.face === 'south';

      // 進行方向と終点
      const farEnd = isReversed ? edge.p1 : edge.p2;
      const progressDx = isReversed ? edge.p1.x - edge.p2.x : edge.p2.x - edge.p1.x;
      const progressDy = isReversed ? edge.p1.y - edge.p2.y : edge.p2.y - edge.p1.y;

      // 足場ラインの固定軸座標
      const dist = isH ? face1Dist : face2Dist;
      let scaffoldCoord: number;
      if (edge.face === 'north') scaffoldCoord = ((edge.p1.y + edge.p2.y) / 2) - dist;
      else if (edge.face === 'south') scaffoldCoord = ((edge.p1.y + edge.p2.y) / 2) + dist;
      else if (edge.face === 'east') scaffoldCoord = ((edge.p1.x + edge.p2.x) / 2) + dist;
      else /* west */ scaffoldCoord = ((edge.p1.x + edge.p2.x) / 2) - dist;

      // 辺の基本X/Y範囲
      let edgeMinX = Math.min(edge.p1.x, edge.p2.x) - TOL;
      let edgeMaxX = Math.max(edge.p1.x, edge.p2.x) + TOL;
      let edgeMinY = Math.min(edge.p1.y, edge.p2.y) - TOL;
      let edgeMaxY = Math.max(edge.p1.y, edge.p2.y) + TOL;

      // 水平辺: 前の垂直辺のscaffoldX方向に加え、全端点Xの範囲まで拡張
      if (isH) {
        // 前ステップのscaffoldX方向への拡張（既存）
        if (prevScaffoldX !== null) {
          edgeMinX = Math.min(edgeMinX, prevScaffoldX - TOL);
          edgeMaxX = Math.max(edgeMaxX, prevScaffoldX + TOL);
        }
        // scaffoldCoord付近の全端点Xも範囲に含める
        const nearYeps = eps.filter(ep => Math.abs(ep.y - scaffoldCoord) < TOL);
        for (const ep of nearYeps) {
          edgeMinX = Math.min(edgeMinX, ep.x - TOL);
          edgeMaxX = Math.max(edgeMaxX, ep.x + TOL);
        }
      }
      // 垂直辺: 前の水平辺のscaffoldY方向への拡張
      if (!isH && prevScaffoldY !== null) {
        edgeMinY = Math.min(edgeMinY, prevScaffoldY - TOL);
        edgeMaxY = Math.max(edgeMaxY, prevScaffoldY + TOL);
      }

      // L字内側辺スキップ: 足場ラインに手摺がない辺
      // scaffoldCoordと全端点の最小距離を計算し、離れ距離の2倍より遠ければ内側辺と判断
      if (isH) {
        const minDistY = eps.length > 0 ? Math.min(...eps.map(ep => Math.abs(ep.y - scaffoldCoord))) : Infinity;
        if (minDistY > face1Dist * 2) continue;
      } else {
        const minDistX = eps.length > 0 ? Math.min(...eps.map(ep => Math.abs(ep.x - scaffoldCoord))) : Infinity;
        if (minDistX > face2Dist * 2) continue;
      }

      // 足場ライン付近 かつ 拡張済み範囲内 の手摺端点を収集
      const coords: number[] = [];
      for (const ep of eps) {
        if (isH && Math.abs(ep.y - scaffoldCoord) < TOL && ep.x >= edgeMinX && ep.x <= edgeMaxX) {
          coords.push(ep.x);
        }
        if (!isH && Math.abs(ep.x - scaffoldCoord) < TOL && ep.y >= edgeMinY && ep.y <= edgeMaxY) {
          coords.push(ep.y);
        }
      }

      // 今回のscaffoldCoordを記憶（次ステップで使用）
      if (isH) prevScaffoldY = scaffoldCoord;
      else prevScaffoldX = scaffoldCoord;

      if (coords.length === 0) continue;

      // リード（進行方向の最先端）と残り距離
      // 各辺には2つの端点(p1, p2)がある。
      // FWD辺: 進行=p1→p2、lead=p2側の最先端、remain=p2-lead
      // REV辺: 進行=p2→p1、lead=p1側の最先端、remain=p1-lead
      //
      // ただし、手摺がfarEnd側を超えている場合(remain<0)、
      // 反対端(otherEnd)側の残りも計算し、正の方を採用する。
      // これにより、splitStepの境界付近の辺で正しいガイドが出る。
      const otherEnd = isReversed ? edge.p2 : edge.p1;

      let lead: number, remainGrid: number, guideEnd: { x: number; y: number };
      if (isH) {
        const leadFwd = progressDx > 0 ? Math.max(...coords) : Math.min(...coords);
        const remainFwd = progressDx > 0 ? farEnd.x - leadFwd : leadFwd - farEnd.x;

        // farEnd側の残りが負なら、otherEnd側からの残りを試す
        if (remainFwd < 0) {
          const leadRev = progressDx > 0 ? Math.min(...coords) : Math.max(...coords);
          const remainRev = progressDx > 0 ? leadRev - otherEnd.x : otherEnd.x - leadRev;
          if (remainRev > 0) {
            // otherEnd側に余裕がある → そちらのガイドを表示
            lead = leadRev;
            remainGrid = remainRev;
            guideEnd = otherEnd;
          } else {
            // 両方超えている → farEnd側のマイナスを表示
            lead = leadFwd;
            remainGrid = remainFwd;
            guideEnd = farEnd;
          }
        } else {
          lead = leadFwd;
          remainGrid = remainFwd;
          guideEnd = farEnd;
        }
      } else {
        const leadFwd = progressDy > 0 ? Math.max(...coords) : Math.min(...coords);
        const remainFwd = progressDy > 0 ? farEnd.y - leadFwd : leadFwd - farEnd.y;

        if (remainFwd < 0) {
          const leadRev = progressDy > 0 ? Math.min(...coords) : Math.max(...coords);
          const remainRev = progressDy > 0 ? leadRev - otherEnd.y : otherEnd.y - leadRev;
          if (remainRev > 0) {
            lead = leadRev;
            remainGrid = remainRev;
            guideEnd = otherEnd;
          } else {
            lead = leadFwd;
            remainGrid = remainFwd;
            guideEnd = farEnd;
          }
        } else {
          lead = leadFwd;
          remainGrid = remainFwd;
          guideEnd = farEnd;
        }
      }

      const remainMm = Math.round(gridToMm(remainGrid));
      const color = remainMm >= 0 ? COLOR_OK : COLOR_WARN;

      // otherEnd 側の残り距離も計算（手摺からの反対方向）
      let remainOtherGrid: number;
      if (isH) {
        const leadOther = progressDx > 0 ? Math.min(...coords) : Math.max(...coords);
        remainOtherGrid = progressDx > 0 ? leadOther - otherEnd.x : otherEnd.x - leadOther;
      } else {
        const leadOther = progressDy > 0 ? Math.min(...coords) : Math.max(...coords);
        remainOtherGrid = progressDy > 0 ? leadOther - otherEnd.y : otherEnd.y - leadOther;
      }
      const remainOtherMm = Math.round(gridToMm(remainOtherGrid));
      const colorOther = remainOtherMm >= 0 ? COLOR_OK : COLOR_WARN;

      // ── ガイド描画: farEnd 側 ──
      // scaffoldStart 角フィルタ (= Task #7 訂正版):
      // 辺が scaffoldStart 頂点を含む step (= 隣接 2 辺) のみ、
      // 両端 (= farEnd + otherEnd) のガイドを描画。
      const startVertex = pts[startIdx];
      const edgeContainsStart =
        (Math.abs(farEnd.x - startVertex.x) < 1e-6 && Math.abs(farEnd.y - startVertex.y) < 1e-6) ||
        (Math.abs(otherEnd.x - startVertex.x) < 1e-6 && Math.abs(otherEnd.y - startVertex.y) < 1e-6);
      if (edgeContainsStart) {
        if (isH) {
          const x1 = Math.min(lead, guideEnd.x);
          const x2 = Math.max(lead, guideEnd.x);
          elements.push(
            <Guide key={`guide-${edge.label}`}
              x1={gx(x1)} y1={gy(scaffoldCoord)}
              x2={gx(x2)} y2={gy(scaffoldCoord)}
              label={`${remainMm}`} zoom={zoom} color={color} />,
          );
        } else {
          const y1 = Math.min(lead, guideEnd.y);
          const y2 = Math.max(lead, guideEnd.y);
          elements.push(
            <Guide key={`guide-${edge.label}`}
              x1={gx(scaffoldCoord)} y1={gy(y1)}
              x2={gx(scaffoldCoord)} y2={gy(y2)}
              label={`${remainMm}`} zoom={zoom} color={color} />,
          );
        }
      }

      // ── ガイド描画: otherEnd 側（反対方向の残り） ──
      // scaffoldStart 角フィルタ (= Task #7 訂正版、
      // edgeContainsStart は farEnd 側で計算済み)
      if (edgeContainsStart) {
        if (isH) {
          const leadOther = progressDx > 0 ? Math.min(...coords) : Math.max(...coords);
          const ox1 = Math.min(leadOther, otherEnd.x);
          const ox2 = Math.max(leadOther, otherEnd.x);
          if (Math.abs(ox2 - ox1) > 0) {
            elements.push(
              <Guide key={`guide-${edge.label}-o`}
                x1={gx(ox1)} y1={gy(scaffoldCoord)}
                x2={gx(ox2)} y2={gy(scaffoldCoord)}
                label={`${remainOtherMm}`} zoom={zoom} color={colorOther} />,
            );
          }
        } else {
          const leadOther = progressDy > 0 ? Math.min(...coords) : Math.max(...coords);
          const oy1 = Math.min(leadOther, otherEnd.y);
          const oy2 = Math.max(leadOther, otherEnd.y);
          if (Math.abs(oy2 - oy1) > 0) {
            elements.push(
              <Guide key={`guide-${edge.label}-o`}
                x1={gx(scaffoldCoord)} y1={gy(oy1)}
                x2={gx(scaffoldCoord)} y2={gy(oy2)}
                label={`${remainOtherMm}`} zoom={zoom} color={colorOther} />,
            );
          }
        }
      }
    }

    mainLogicRan = true;
  }

  if (mainLogicRan) {
    return <Layer listening={false}>{elements}</Layer>;
  }

  // ── フォールバック: scaffoldStart未設定時はBBOXベース ──
  // フォールバックは単一階（1F）のみの簡易版（旧仕様互換）
  const eps: { x: number; y: number }[] = [];
  for (const h of canvasData.handrails) {
    if ((h.floor ?? 1) !== 1) continue;
    const [p1, p2] = getHandrailEndpoints(h);
    eps.push(p1, p2);
  }
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const b of canvasData.buildings)
    for (const p of b.points) {
      if (p.x < bMinX) bMinX = p.x; if (p.y < bMinY) bMinY = p.y;
      if (p.x > bMaxX) bMaxX = p.x; if (p.y > bMaxY) bMaxY = p.y;
    }
  let hMinX = Infinity, hMinY = Infinity, hMaxX = -Infinity, hMaxY = -Infinity;
  for (const p of eps) {
    if (p.x < hMinX) hMinX = p.x; if (p.y < hMinY) hMinY = p.y;
    if (p.x > hMaxX) hMaxX = p.x; if (p.y > hMaxY) hMaxY = p.y;
  }

  const nd = bMinY - hMinY;
  if (nd !== 0) {
    const mm = Math.round(gridToMm(Math.abs(nd)));
    const pts = eps.filter(p => Math.abs(p.y - hMinY) < 2);
    const lx = pts.length ? Math.min(...pts.map(p => p.x)) : (bMinX + bMaxX) / 2;
    elements.push(<Guide key="dim-n" x1={gx(lx)} y1={gy(bMinY)} x2={gx(lx)} y2={gy(hMinY)} label={`${mm}`} zoom={zoom} color={COLOR_OK} />);
  }
  const sd = hMaxY - bMaxY;
  if (sd !== 0) {
    const mm = Math.round(gridToMm(Math.abs(sd)));
    const pts = eps.filter(p => Math.abs(p.y - hMaxY) < 2);
    const lx = pts.length ? Math.min(...pts.map(p => p.x)) : (bMinX + bMaxX) / 2;
    elements.push(<Guide key="dim-s" x1={gx(lx)} y1={gy(bMaxY)} x2={gx(lx)} y2={gy(hMaxY)} label={`${mm}`} zoom={zoom} color={COLOR_OK} />);
  }
  const ed = hMaxX - bMaxX;
  if (ed !== 0) {
    const mm = Math.round(gridToMm(Math.abs(ed)));
    const pts = eps.filter(p => Math.abs(p.x - hMaxX) < 2);
    const ty = pts.length ? Math.min(...pts.map(p => p.y)) : (bMinY + bMaxY) / 2;
    elements.push(<Guide key="dim-e" x1={gx(bMaxX)} y1={gy(ty)} x2={gx(hMaxX)} y2={gy(ty)} label={`${mm}`} zoom={zoom} color={COLOR_OK} />);
  }
  const wd = bMinX - hMinX;
  if (wd !== 0) {
    const mm = Math.round(gridToMm(Math.abs(wd)));
    const pts = eps.filter(p => Math.abs(p.x - hMinX) < 2);
    const ty = pts.length ? Math.min(...pts.map(p => p.y)) : (bMinY + bMaxY) / 2;
    elements.push(<Guide key="dim-w" x1={gx(bMinX)} y1={gy(ty)} x2={gx(hMinX)} y2={gy(ty)} label={`${mm}`} zoom={zoom} color={COLOR_OK} />);
  }

  return <Layer listening={false}>{elements}</Layer>;
}
