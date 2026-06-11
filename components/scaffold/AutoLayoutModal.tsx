'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { Handrail, HandrailLengthMm, Point, ScaffoldStartConfig } from '@/types';
import { getHandrailColor } from '@/lib/konva/handrailColors';
import NumInput from '@/components/ui/NumInput';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import {
  getBuildingEdgesClockwise,
  computeAutoLayoutSequential,
  sequentialResultToAutoLayoutResult,
  placeHandrailsForEdge,
  getEdgesNotCoveredBy,
  generateSequentialCandidates,
  AutoLayoutResult,
  EdgeInfo,
  SequentialLayoutResult,
  SequentialCandidate,
  EdgeAdjustment,
  DEFAULT_EDGE_ADJUSTMENT,
  Bothmode2FResult,
  Bothmode1FResult,
  computeBothmode2FLayout,
  computeBothmode1FLayout,
  bothmodeResultsToAutoLayoutResult,
  findCollinearEdgePairs,
  splitBuilding1FAtBuilding2FVertices,
  splitBuilding2FAt1FVertices,
} from '@/lib/konva/autoLayoutUtils';
import { computeEdgeLabelPosition } from '@/lib/konva/buildingLabelUtils';
import { relabelByFace2F, relabelByFace1F, getBothmodeEdgesWithRelativeLabels, getNormalizedDistances, resolveScaffoldStartOnNormalized } from '@/lib/konva/labelUtils';
import VariationChangeButtons from '@/components/scaffold/VariationChangeButtons';
type Props = { onClose: () => void; onOpenScaffoldStart: () => void };

/** 建物プレビューSVG（辺ラベル付き、1F+2F同時対応） */
function PreviewSVG({ points, edges, focusedIndex, conflictHandrails, blinkEdgeIndex, subPoints, subEdges, subHighlightIndices, focusedSubIndex, scaffoldStart, showFloorPrefix }: {
  points: Point[];
  edges: EdgeInfo[];
  focusedIndex: number | null;
  conflictHandrails?: { x: number; y: number; lengthMm: number; direction: 'horizontal' | 'vertical' | number }[];
  blinkEdgeIndex?: number;
  /** 1F+2F同時モード用: サブ建物（= 1F）の points */
  subPoints?: Point[];
  /** サブ建物の全辺情報（ラベル付与用） */
  subEdges?: EdgeInfo[];
  /** サブ建物で強調する辺の index 集合（= 下屋辺） */
  subHighlightIndices?: Set<number>;
  /** サブ建物でフォーカスされた辺（離れ入力 focus 時） */
  focusedSubIndex?: number | null;
  /** スタート角マーカー表示用（主建物 points 側） */
  scaffoldStart?: ScaffoldStartConfig;
  /** Phase H-3d-3: bothmode で主建物ラベルに "2" プレフィックスを付ける (1F の "1A" 表記と対称) */
  showFloorPrefix?: boolean;
}) {
  if (points.length < 3) return null;

  // 1F と 2F の points を合わせたバウンディングボックスで描画スケール算出
  const allX = [...points.map(p => p.x), ...(subPoints?.map(p => p.x) ?? [])];
  const allY = [...points.map(p => p.y), ...(subPoints?.map(p => p.y) ?? [])];
  const minX = Math.min(...allX), minY = Math.min(...allY);
  const bw = (Math.max(...allX) - minX) || 1;
  const bh = (Math.max(...allY) - minY) || 1;

  const pad = 32, svgW = 280, svgH = 180;
  const scale = Math.min((svgW - pad * 2) / bw, (svgH - pad * 2) / bh);
  const offsetX = pad + ((svgW - pad * 2) - bw * scale) / 2;
  const offsetY = pad + ((svgH - pad * 2) - bh * scale) / 2;
  const toSvg = (p: Point) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale });

  const svgPts = points.map(toSvg);
  const pathD = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

  // サブ建物（1F）のパス
  const subSvgPts = subPoints?.map(toSvg);
  const subPathD = subSvgPts
    ? subSvgPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z'
    : null;

  return (
    <>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.15} } .conflict-rail{animation:blink 0.8s ease-in-out infinite}`}</style>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="mx-auto block">
        {/* サブ建物（1F）を背景に薄いアウトラインで描画 */}
        {subPathD && (
          <path d={subPathD} fill="rgba(160,160,170,0.15)" stroke="#888" strokeWidth={1} strokeDasharray="4 3" />
        )}

        {/* 主建物（2F または単一建物） */}
        <path d={pathD} fill="#3d3d3a" stroke="#1a1a18" strokeWidth={2} />

        {/* サブ建物の強調辺（= 下屋辺） */}
        {subEdges && subHighlightIndices && subEdges.filter(e => subHighlightIndices.has(e.index)).map(edge => {
          const s1 = toSvg(edge.p1);
          const s2 = toSvg(edge.p2);
          const mx = (s1.x + s2.x) / 2;
          const my = (s1.y + s2.y) / 2;
          const isFocused = focusedSubIndex === edge.index;
          const N = subEdges.length;
          const prevEdge = subEdges[(edge.index - 1 + N) % N];
          const nextEdge = subEdges[(edge.index + 1) % N];
          // Phase J-1: 凹角隣接辺は内側配置で重なり回避
          const labelPos = computeEdgeLabelPosition(edge, prevEdge, nextEdge, mx, my, 14);
          return (
            <React.Fragment key={`sub-${edge.index}`}>
              <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
                stroke={isFocused ? '#fbbf24' : '#10b981'} strokeWidth={isFocused ? 5 : 3} strokeLinecap="round" />
              <text x={labelPos.x} y={labelPos.y}
                textAnchor="middle" dominantBaseline="central"
                fill={isFocused ? '#fbbf24' : '#10b981'}
                fontWeight="bold"
                fontSize={11} fontFamily="monospace"
                paintOrder={labelPos.isInside ? 'stroke' : undefined}
                stroke={labelPos.isInside ? '#3d3d3a' : undefined}
                strokeWidth={labelPos.isInside ? 3 : undefined}
              >{`1${edge.label}`}</text>
            </React.Fragment>
          );
        })}

        {conflictHandrails?.map((h, i) => {
          const mmToG = (mm: number) => Math.round(mm / 10);
          const s1 = toSvg({ x: h.x, y: h.y });
          const s2 = h.direction === 'horizontal'
            ? toSvg({ x: h.x + mmToG(h.lengthMm), y: h.y })
            : toSvg({ x: h.x, y: h.y + mmToG(h.lengthMm) });
          return (
            <line key={`c${i}`}
              x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
              stroke="#FF6B35" strokeWidth={4} strokeLinecap="round"
              className="conflict-rail"
            />
          );
        })}
        {blinkEdgeIndex !== undefined && edges.filter(e => e.index === blinkEdgeIndex).map(edge => {
          const s1 = toSvg(edge.p1);
          const s2 = toSvg(edge.p2);
          return (
            <line key={`blink-${edge.index}`} x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
              stroke="#FF6B35" strokeWidth={6} strokeLinecap="round" className="conflict-rail" />
          );
        })}
        {edges.map(edge => {
          const s1 = toSvg(edge.p1);
          const s2 = toSvg(edge.p2);
          const mx = (s1.x + s2.x) / 2;
          const my = (s1.y + s2.y) / 2;
          const isFocused = focusedIndex === edge.index;

          const N = edges.length;
          const prevEdge = edges[(edge.index - 1 + N) % N];
          const nextEdge = edges[(edge.index + 1) % N];
          // Phase J-1: 凹角隣接辺は内側配置で重なり回避
          const labelPos = computeEdgeLabelPosition(edge, prevEdge, nextEdge, mx, my, 14);

          return (
            <React.Fragment key={edge.index}>
              {isFocused && (
                <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
                  stroke="#378ADD" strokeWidth={4} strokeLinecap="round" />
              )}
              <text x={labelPos.x} y={labelPos.y}
                textAnchor="middle" dominantBaseline="central"
                fill={isFocused ? '#378ADD' : '#ccc'}
                fontWeight={isFocused ? 'bold' : 'normal'}
                fontSize={isFocused ? 14 : 12} fontFamily="monospace"
                paintOrder={labelPos.isInside ? 'stroke' : undefined}
                stroke={labelPos.isInside ? '#3d3d3a' : undefined}
                strokeWidth={labelPos.isInside ? 3 : undefined}
              >{showFloorPrefix ? `2${edge.label}` : edge.label}</text>
            </React.Fragment>
          );
        })}
        {/* スタート角★マーカー（最前面） */}
        {scaffoldStart && scaffoldStart.startVertexIndex !== undefined && points.length > 0 && (() => {
          const idx = scaffoldStart.startVertexIndex! % points.length;
          const svgPt = toSvg(points[idx]);
          return (
            <text
              x={svgPt.x}
              y={svgPt.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={20}
              fontWeight="bold"
              fill="#FFD700"
              stroke="#000"
              strokeWidth={0.8}
              style={{ paintOrder: 'stroke' }}
            >
              ★
            </text>
          );
        })()}
      </svg>
    </>
  );
}

const FACE_LABEL: Record<string, string> = {
  north: '北', south: '南', east: '東', west: '西',
};

/** 手摺リストを "1800×3 + 600×1" 形式に整形 */
function formatRailsSummary(rails: HandrailLengthMm[]): string {
  if (rails.length === 0) return 'なし';
  const counts: Record<number, number> = {};
  for (const r of rails) counts[r] = (counts[r] ?? 0) + 1;
  const entries = Object.entries(counts)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => b[0] - a[0]);
  return entries.map(([len, cnt]) => `${len}×${cnt}`).join(' + ');
}

export default function AutoLayoutModal({ onClose, onOpenScaffoldStart }: Props) {
  const { canvasData, addHandrails, removeElements } = useCanvasStore();
  const enabledSizes = useHandrailSettingsStore(s => s.enabledSizes);
  const priorityConfig = useHandrailSettingsStore(s => s.priorityConfig);

  // 対象階（1F / 2F / both = 1F+2F同時）
  // 初期値: scaffoldStart1F があれば 1F、2F だけあれば 2F、旧 scaffoldStart があればその floor、どれもなければ 1F
  const [targetFloor, setTargetFloor] = useState<1 | 2 | 'both'>(() => {
    if (canvasData.scaffoldStart1F) return 1;
    if (canvasData.scaffoldStart2F) return 2;
    return (canvasData.scaffoldStart?.floor ?? 1) as 1 | 2;
  });

  // 1F建物 / 2F建物（最初に一致したもの）
  const building1F = useMemo(
    () => canvasData.buildings.find(b => (b.floor ?? 1) === 1) ?? null,
    [canvasData.buildings],
  );
  const building2F = useMemo(
    () => canvasData.buildings.find(b => b.floor === 2) ?? null,
    [canvasData.buildings],
  );

  // UI表示の「対象階建物」
  // 1Fのみ: 1F建物 / 2Fのみ: 2F建物 / both: 2F建物（常に全周配置されるため主表示）
  const building = useMemo(() => {
    if (targetFloor === 2) return building2F;
    if (targetFloor === 'both') return building2F; // bothは2Fを主表示
    return building1F;
  }, [targetFloor, building1F, building2F]);

  // Phase H-3d-2 修正A: 1Fポリゴンに2F頂点を投影して自動分割
  // 1F辺が「2F直下部分」と「下屋部分」の複合辺の場合、2F頂点で分割する。
  // bothmode 以外、または片方の建物がない場合は元の building1F をそのまま返す。
  const normalizedBuilding1F = useMemo(() => {
    if (targetFloor !== 'both' || !building1F || !building2F) return building1F;
    return splitBuilding1FAtBuilding2FVertices(building1F, building2F);
  }, [targetFloor, building1F, building2F]);

  // Phase H-3d-2 重大変更 (B1/B2 概念導入): 2Fポリゴンに 1F 頂点を投影して自動分割
  // 2F辺が下屋の境で分割されるため、bothmode 計算で各 2F 辺が常に 1 segment として扱える。
  // bothmode 以外、または片方の建物がない場合は元の building2F をそのまま返す。
  const normalizedBuilding2F = useMemo(() => {
    if (targetFloor !== 'both' || !building1F || !building2F) return building2F;
    return splitBuilding2FAt1FVertices(building1F, building2F);
  }, [targetFloor, building1F, building2F]);

  // bothモード時、1F のうち 2F で覆われていない辺（= 下屋辺）
  // 修正A + B1/B2: 両方分割済を基準にする。
  const uncoveredEdges1F = useMemo(() => {
    if (targetFloor !== 'both' || !normalizedBuilding1F || !normalizedBuilding2F) return [];
    return getEdgesNotCoveredBy(normalizedBuilding1F, normalizedBuilding2F);
  }, [targetFloor, normalizedBuilding1F, normalizedBuilding2F]);

  // Phase H-3d-6: scaffoldStart / normalizedScaffoldStart をラベル系 useMemo
  // (edges2FAll / subEdgesRelabeled) の前に定義する必要がある (= 宣言順依存)。
  // 元は collinear* の後に定義されていたが、 H-3d-6 で edges2FAll が
  // normalizedScaffoldStart に依存するようになったため上に移動。

  // scaffoldStart は対象階のものだけ有効扱い（別階のを引き継がない）
  // both モードは 2F 主表示なので 2F の scaffoldStart を使用
  // 優先順: 新フィールド (scaffoldStart1F / scaffoldStart2F) → 旧 scaffoldStart (後方互換)
  // 該当階の建物が存在しない場合は undefined（偽スタート角防止）
  const scaffoldStart = useMemo(() => {
    const effectiveFloor = targetFloor === 'both' ? 2 : targetFloor;
    const hasFloorBuilding = effectiveFloor === 1 ? !!building1F : !!building2F;
    if (!hasFloorBuilding) return undefined;
    const newSS = effectiveFloor === 1 ? canvasData.scaffoldStart1F : canvasData.scaffoldStart2F;
    if (newSS) return newSS;
    const legacy = canvasData.scaffoldStart;
    if (!legacy) return undefined;
    return (legacy.floor ?? 1) === effectiveFloor ? legacy : undefined;
  }, [canvasData.scaffoldStart1F, canvasData.scaffoldStart2F, canvasData.scaffoldStart, targetFloor, building1F, building2F]);

  // Phase H-3d-2 重大変更: scaffoldStart.startVertexIndex を normalizedBuilding2F の頂点 index に再マッピング。
  // 元の building2F.points と normalizedBuilding2F.points は順序が変わる場合がある (CW NW 起点へ正規化)。
  // 同じ物理座標の頂点を coordinate match で探し、その index を新 startVertexIndex とする。
  // bothmode 以外、または building2F/normalizedBuilding2F が同一の場合は元の scaffoldStart をそのまま返す。
  const normalizedScaffoldStart = useMemo(() => {
    if (!scaffoldStart || targetFloor !== 'both' || !building2F || !normalizedBuilding2F) {
      return scaffoldStart;
    }
    // H-3d-7 修正: ⭐ 起点を単一規約 (CW 辺順) で再解決する。
    // 旧実装は生 points 配列を CW 辺 index で引いており CCW 格納で別頂点を指していた。
    const { vertexIndex } = resolveScaffoldStartOnNormalized(
      building2F, normalizedBuilding2F, scaffoldStart.startVertexIndex ?? 0,
    );
    return { ...scaffoldStart, startVertexIndex: vertexIndex };
  }, [scaffoldStart, targetFloor, building2F, normalizedBuilding2F]);

  // bothモード時、2F 全辺（連動表示の参照用）
  // 修正 (B1/B2): 分割済の normalizedBuilding2F を基準にする (B 面が B1/B2 に分かれる)
  // Phase H-3d-6: ラベル付けは ⭐ 起点 CW 順 (relabelByFace2F、 同面分割は suffix 付与)。
  const edges2FAll = useMemo(() => {
    if (targetFloor !== 'both' || !normalizedBuilding2F) return [];
    const startIdx = (normalizedScaffoldStart?.startVertexIndex ?? 0)
      % normalizedBuilding2F.points.length;
    return relabelByFace2F(getBuildingEdgesClockwise(normalizedBuilding2F), startIdx);
  }, [targetFloor, normalizedBuilding2F, normalizedScaffoldStart]);

  // Phase H-3d-6: 共通起点 ⭐ の絶対座標。 1F 下屋 label の起点判定 (最近接) に使用。
  // 優先順: scaffoldStart2F (= normalizedScaffoldStart 経由) → scaffoldStart1F → null
  const commonStartPoint = useMemo<Point | null>(() => {
    // 2F の ⭐ あり: edges2FAll と同一規約 (CW 辺順) で ⭐ 座標を採る。
    // H-3d-7 修正: 生 points[idx] ではなく getBuildingEdgesClockwise の p1 を使用。
    if (normalizedScaffoldStart && normalizedBuilding2F) {
      const normEdges = getBuildingEdgesClockwise(normalizedBuilding2F);
      if (normEdges.length === 0) return null;
      const idx = (normalizedScaffoldStart.startVertexIndex ?? 0) % normEdges.length;
      return normEdges[idx]?.p1 ?? null;
    }
    // 2F の ⭐ なし、 1F の ⭐ あり: building1F.points[startVertexIndex] を採用
    // (1F は normalize 不要、 raw building1F の頂点座標をそのまま使う)
    const ss1F = canvasData.scaffoldStart1F;
    if (ss1F && building1F) {
      const idx = (ss1F.startVertexIndex ?? 0) % building1F.points.length;
      return building1F.points[idx] ?? null;
    }
    return null;
  }, [normalizedScaffoldStart, normalizedBuilding2F, canvasData.scaffoldStart1F, building1F]);

  // Phase H-3d-3: 下屋 (uncovered 1F) edges 専用の relabel。
  // Phase H-3d-6: relabelByFace1F (= ⭐ → 最近接 1F 頂点 → CW 巡回で最初に出会う
  // 下屋辺を 1A、 以降順次 1B, 1C, ...)。 旧 midpoint 距離方式から書き直し。
  const subEdgesRelabeled = useMemo(() => {
    if (targetFloor !== 'both' || !normalizedBuilding1F) return [];
    const allEdges1F = getBuildingEdgesClockwise(normalizedBuilding1F);
    const uncoveredIdxSet = new Set(uncoveredEdges1F.map(e => e.index));
    return relabelByFace1F(allEdges1F, uncoveredIdxSet, commonStartPoint);
  }, [targetFloor, normalizedBuilding1F, uncoveredEdges1F, commonStartPoint]);

  // Phase H-3d-2 Stage 5 Part D-2-a: bothmode の 1F⇔2F 連動ペア
  // 同一直線連動の 1F辺は希望離れ入力を無効化し「= 2F-X面」表示に切り替える。
  // 修正A + B1/B2: 両方分割済 (normalizedBuilding1F / normalizedBuilding2F) を基準にする。
  const collinearPairs = useMemo(() => {
    if (targetFloor !== 'both' || !normalizedBuilding1F || !normalizedBuilding2F) return [];
    return findCollinearEdgePairs(normalizedBuilding1F, normalizedBuilding2F);
  }, [targetFloor, normalizedBuilding1F, normalizedBuilding2F]);

  // 1F辺 index → 連動先 2F辺 のマップ (連動なしは undefined)
  const collinear1FToEdge2F = useMemo(() => {
    const map = new Map<number, EdgeInfo>();
    for (const pair of collinearPairs) {
      const e2 = edges2FAll.find(e => e.index === pair.edge2FIndex);
      if (e2) map.set(pair.edge1FIndex, e2);
    }
    return map;
  }, [collinearPairs, edges2FAll]);

  // 下屋辺の index セット（プレビュー強調 & 下屋入力 UI で利用）
  const uncoveredIdxSet1F = useMemo(
    () => new Set(uncoveredEdges1F.map(e => e.index)),
    [uncoveredEdges1F],
  );

  // 辺リストを取得
  // Phase H-3d-6: 単一階モードは ⭐ 起点 CW 順 + 同面分割 suffix で relabel。
  // Phase H-3e (共通根 1、 案 1A'): bothmode は helper 関数 getBothmodeEdgesWithRelativeLabels
  // 経由で raw 入力欄数を維持しつつ ⭐-relative ラベル表示を実現する。
  const edges = useMemo(() => {
    if (!building) return [];
    if (targetFloor === 'both' && normalizedBuilding2F && normalizedScaffoldStart) {
      return getBothmodeEdgesWithRelativeLabels(
        building, normalizedBuilding2F, normalizedScaffoldStart,
      );
    }
    const rawEdges = getBuildingEdgesClockwise(building);
    const startIdx = (scaffoldStart?.startVertexIndex ?? 0) % (building.points.length || 1);
    return relabelByFace2F(rawEdges, startIdx);
  }, [building, targetFloor, scaffoldStart, normalizedBuilding2F, normalizedScaffoldStart]);

  // スタート角に隣接する2辺（固定辺）
  const lockedEdgeIndices = useMemo(() => {
    if (!scaffoldStart || !building) return new Set<number>();
    const edgeList = getBuildingEdgesClockwise(building);
    const n = edgeList.length;
    const startIdx = scaffoldStart.startVertexIndex ?? 0;
    const outEdge = edgeList[startIdx % n];
    const inEdge = edgeList[(startIdx - 1 + n) % n];
    return new Set([outEdge.index, inEdge.index]);
  }, [scaffoldStart, building]);

  // 各辺の離れ（mm）: edgeIndex → number
  const defaultDist = scaffoldStart?.face1DistanceMm ?? 900;
  const [bulkMm, setBulkMm] = useState(900);  // 一括入力欄の現在値 (= 「全部に適用」 で各辺の離れに一斉コピー)
  const [distances, setDistances] = useState<Record<number, number>>(() => {
    const d: Record<number, number> = {};
    edges.forEach(e => {
      if (scaffoldStart) {
        const n = edges.length;
        const startIdx = scaffoldStart.startVertexIndex ?? 0;
        const outEdge = edges[startIdx % n];
        const inEdge = edges[(startIdx - 1 + n) % n];
        const outIsH = outEdge.face === 'north' || outEdge.face === 'south';
        const face1Edge = outIsH ? outEdge : inEdge;
        const face2Edge = outIsH ? inEdge : outEdge;
        if (e.index === face1Edge.index) { d[e.index] = scaffoldStart.face1DistanceMm; return; }
        if (e.index === face2Edge.index) { d[e.index] = scaffoldStart.face2DistanceMm; return; }
      }
      d[e.index] = defaultDist;
    });
    return d;
  });

  // Phase H-3e (共通根 2、 案 2C'): distances state は raw building の edge.index でキー
  // 保存されているが、 computeBothmode2FLayout は normalized building 上の edge.index で
  // 読み出すため、 helper 関数経由で re-keying する。
  // Phase H-3d-5 の normalizedScaffoldStart (= 上記) と対称的なパターン。
  // 1F 側 distances1F は既に normalized 経由に統一済 (= Phase H-3d-3 / H-3d-6) のため、
  // ここで対応するのは 2F の distances のみ。
  const normalizedDistances = useMemo(() => {
    if (targetFloor !== 'both' || !building2F || !normalizedBuilding2F) {
      return distances;
    }
    return getNormalizedDistances(building2F, normalizedBuilding2F, distances);
  }, [distances, targetFloor, building2F, normalizedBuilding2F]);

  // 下屋辺の変化時に distances1F を初期化（デフォルト 900mm）。
  // 既に入力があれば保持。
  useEffect(() => {
    setDistances1F(prev => {
      const next: Record<number, number> = {};
      uncoveredEdges1F.forEach(e => {
        next[e.index] = prev[e.index] ?? 900;
      });
      return next;
    });
  }, [uncoveredEdges1F]);

  // 対象階切替時は distances をその階用に再構築
  useEffect(() => {
    const d: Record<number, number> = {};
    edges.forEach(e => {
      if (scaffoldStart) {
        const n = edges.length;
        const startIdx = scaffoldStart.startVertexIndex ?? 0;
        const outEdge = edges[startIdx % n];
        const inEdge = edges[(startIdx - 1 + n) % n];
        const outIsH = outEdge.face === 'north' || outEdge.face === 'south';
        const face1Edge = outIsH ? outEdge : inEdge;
        const face2Edge = outIsH ? inEdge : outEdge;
        if (e.index === face1Edge.index) { d[e.index] = scaffoldStart.face1DistanceMm; return; }
        if (e.index === face2Edge.index) { d[e.index] = scaffoldStart.face2DistanceMm; return; }
      }
      d[e.index] = defaultDist;
    });
    setDistances(d);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFloor, building?.id]);

  const [result, setResult] = useState<AutoLayoutResult | null>(null);
  // 「1F+2F同時」モード専用: サブ階層（= 1F 下屋辺）の割付結果
  const [resultSub, setResultSub] = useState<AutoLayoutResult | null>(null);
  // 「1F+2F同時」モード専用: 1F下屋辺用の離れ（edgeIndex → mm）
  const [distances1F, setDistances1F] = useState<Record<number, number>>({});
  // 「1F+2F同時」モード専用: 1F下屋辺の候補選択 index
  const [selectionsSub, setSelectionsSub] = useState<Record<number, number>>({});
  const [focusedSubEdgeIndex, setFocusedSubEdgeIndex] = useState<number | null>(null);
  const [selections, setSelections] = useState<Record<number, number>>({});
  const [focusedEdgeIndex, setFocusedEdgeIndex] = useState<number | null>(null);
  const [showConflictConfirm, setShowConflictConfirm] = useState(false);
  const [showLockedAlert, setShowLockedAlert] = useState(false);
  // リリース戦略: 1F+2F モードは近日実装予定のためブロック表示
  // (= bothmode 関連実装は Phase H-3e (commit 0ed4ac5) で完成済、 「保留資産」 として温存)
  const [showComingSoonModal, setShowComingSoonModal] = useState(false);
  const [pendingHandrails, setPendingHandrails] = useState<Handrail[]>([]);
  const [conflictIds, setConflictIds] = useState<string[]>([]);
  // Phase H-3b-2-1 / H-3d-1: 順次決定の状態管理を 2F / 1F の 2 本立てに拡張
  // - 1Fのみ・2Fのみモードでは sequentialResult2F のみ使用、1F は null 維持
  // - bothmode では 2F 全周 + 1F 下屋辺の両方を保持
  const [sequentialResult2F, setSequentialResult2F] = useState<SequentialLayoutResult | null>(null);
  const [sequentialResult1F, setSequentialResult1F] = useState<SequentialLayoutResult | null>(null);
  const [userSelections2F, setUserSelections2F] = useState<Record<number, number>>({});
  const [userSelections1F, setUserSelections1F] = useState<Record<number, number>>({});
  // Phase I-2: 各辺ごとの「割り変更」「←/→」操作状態
  const [userAdjustments2F, setUserAdjustments2F] = useState<Record<number, EdgeAdjustment>>({});
  const [userAdjustments1F, setUserAdjustments1F] = useState<Record<number, EdgeAdjustment>>({});
  // Phase H-3d-2 Stage 5 残対応 Step 1 補足: bothmode で同一 edge に複数 segment が
  // ある場合に segment を識別する必要があるため、optional segmentIndex を追加。
  // 単一階モードでは undefined のまま (互換)。
  const [activeEdge, setActiveEdge] = useState<{ floor: 1 | 2; index: number; segmentIndex?: number } | null>(null);

  // Phase H-3d-2 Stage 5 Part A: bothmode 専用 state (Part B 以降で使用、現時点では未使用)
  // key 形式は `${edge2FIndex}-${segmentIndex}` の string (Stage 3/4 で定義済み)
  const [bothmodeResult2F, setBothmodeResult2F] = useState<Bothmode2FResult | null>(null);
  const [bothmodeResult1F, setBothmodeResult1F] = useState<Bothmode1FResult | null>(null);
  const [bothmodeSelections2F, setBothmodeSelections2F] = useState<Record<string, number>>({});
  const [bothmodeSelections1F, setBothmodeSelections1F] = useState<Record<string, number>>({});
  const [bothmodeAdjustments2F, setBothmodeAdjustments2F] = useState<Record<string, EdgeAdjustment>>({});
  const [bothmodeAdjustments1F, setBothmodeAdjustments1F] = useState<Record<string, EdgeAdjustment>>({});

  // Phase I-3-fix: 順次決定の表示順を scaffoldStart 起点 cascade 順に並べ替え。
  // 内部 cascade は (startIdx + k) % n で進むが edgeResults は物理 index 順で格納されるため、
  // UI 側で改めて cascade 順に並べ直す。scaffoldStart 無し時は startIdx=0 (= 物理順)。
  // ハンドラ内 (state 更新前の seqResult を扱う) でも使えるよう純粋関数として定義。
  const startIdxFor2F = useMemo(() => {
    if (!sequentialResult2F || !scaffoldStart) return 0;
    const n = sequentialResult2F.edgeResults.length;
    return n > 0 ? (scaffoldStart.startVertexIndex ?? 0) % n : 0;
  }, [sequentialResult2F, scaffoldStart]);
  const getCascadeOrderedEdges = (seqResult: SequentialLayoutResult, startIdx: number) => {
    const n = seqResult.edgeResults.length;
    if (n === 0) return [];
    return Array.from({ length: n }, (_, k) => seqResult.edgeResults[(startIdx + k) % n]);
  };
  const cascadeOrdered2F = useMemo(() => {
    if (!sequentialResult2F) return null;
    return getCascadeOrderedEdges(sequentialResult2F, startIdxFor2F);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequentialResult2F, startIdxFor2F]);
  // 1F は scaffoldStart 無し設計 (bothmode 1F 下屋辺)。startIdx=0 で物理 index 順 = 既存挙動。
  const cascadeOrdered1F = useMemo(() => {
    if (!sequentialResult1F) return null;
    return [...sequentialResult1F.edgeResults];
  }, [sequentialResult1F]);

  const getDistance = (idx: number) => distances[idx] ?? defaultDist;

  const setDistance = (idx: number, value: number) => {
    setDistances(prev => ({ ...prev, [idx]: value }));
    setResult(null);
    // 順次決定 state もリセット（1F/2F 両方）
    setSequentialResult2F(null);
    setSequentialResult1F(null);
    setUserSelections2F({});
    setUserSelections1F({});
    // Phase I-2: 離れ変更時は adjustments もリセット
    setUserAdjustments2F({});
    setUserAdjustments1F({});
    // Phase H-3d-2 Stage 5 Part A: bothmode state もリセット
    setBothmodeResult2F(null);
    setBothmodeResult1F(null);
    setBothmodeSelections2F({});
    setBothmodeSelections1F({});
    setBothmodeAdjustments2F({});
    setBothmodeAdjustments1F({});
    setActiveEdge(null);
  };

  const handleCalc = () => {
    if (!building) return;

    // Phase H-3d-2 Stage 5 Part B + 修正A + B1/B2: bothmode は normalizedBuilding1F/2F を使用
    // 単一階モードは下の既存ロジックで処理 (無変更)。
    if (targetFloor === 'both' && normalizedBuilding1F && normalizedBuilding2F && scaffoldStart) {
      const result2F = computeBothmode2FLayout(
        normalizedBuilding2F,
        normalizedBuilding1F,
        normalizedDistances,
        distances1F,
        normalizedScaffoldStart!,
        enabledSizes,
        priorityConfig,
        bothmodeSelections2F,
        bothmodeAdjustments2F,
      );
      setBothmodeResult2F(result2F);

      const result1F = computeBothmode1FLayout(
        normalizedBuilding1F,
        normalizedBuilding2F,
        result2F,
        distances1F,
        enabledSizes,
        priorityConfig,
        bothmodeSelections1F,
        bothmodeAdjustments1F,
      );
      setBothmodeResult1F(result1F);

      // 旧 state は混乱を避けるためクリア (Part C/D で旧 state を完全廃止予定)
      setSequentialResult2F(null);
      setSequentialResult1F(null);
      setResultSub(null);
      setSelectionsSub({});

      // Phase H-3d-2 Stage 5 Part D-1: bothmode 結果を AutoLayoutResult に変換して描画系に渡す
      const adapted = bothmodeResultsToAutoLayoutResult(result2F, result1F);
      setResult(adapted);
      const sel: Record<number, number> = {};
      adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
      setSelections(sel);

      // activeEdge: 最初の未解決セグメントへ (2F 優先 → 1F の順)
      const firstUnresolved2F = result2F.edgeSegments.find(s => !s.isLocked && !s.isAutoProgress);
      if (firstUnresolved2F) {
        setActiveEdge({
          floor: 2,
          index: firstUnresolved2F.edge2FIndex,
          segmentIndex: firstUnresolved2F.segmentIndex,
        });
      } else {
        const firstUnresolved1F = result1F.edgeSegments.find(s => !s.isLocked && !s.isAutoProgress);
        if (firstUnresolved1F) {
          setActiveEdge({
            floor: 1,
            index: firstUnresolved1F.edge1FIndex,
            segmentIndex: firstUnresolved1F.segmentIndex,
          });
        } else {
          setActiveEdge(null);
        }
      }
      return;
    }

    // 単一階モード (1Fのみ / 2Fのみ): 既存ロジックそのまま
    // 主建物（1Fのみ→1F、2Fのみ→2F）の順次決定
    const seqRes2F = computeAutoLayoutSequential(
      building, distances, scaffoldStart, enabledSizes, priorityConfig, userSelections2F, userAdjustments2F,
    );
    setSequentialResult2F(seqRes2F);
    const res = sequentialResultToAutoLayoutResult(seqRes2F);

    // bothmode: 1F 下屋辺の順次決定（H-3d-1: 1F 用 sequentialResult を独立保持）
    let seqRes1F: SequentialLayoutResult | null = null;
    if (targetFloor === 'both' && building1F && building2F && uncoveredEdges1F.length > 0) {
      const d1: Record<number, number> = {};
      getBuildingEdgesClockwise(building1F).forEach(e => {
        d1[e.index] = distances1F[e.index] ?? 900;
      });
      const fullSeq1F = computeAutoLayoutSequential(building1F, d1, undefined, enabledSizes, priorityConfig, userSelections1F, userAdjustments1F);
      // 下屋辺だけに edgeResults を絞り込む（filter 後の SequentialLayoutResult を組み立て）
      const uncoveredIdxSet = new Set(uncoveredEdges1F.map(e => e.index));
      const filteredEdgeResults = fullSeq1F.edgeResults.filter(er => uncoveredIdxSet.has(er.edge.index));
      // hasUnresolved を filter 後の辺で再判定
      const filteredHasUnresolved = filteredEdgeResults.some(er => !er.isLocked && !er.isAutoProgress);
      seqRes1F = { edgeResults: filteredEdgeResults, hasUnresolved: filteredHasUnresolved };
      setSequentialResult1F(seqRes1F);
      // 旧形式 resultSub も互換のため作成（handlePlace のため）
      const filteredAdapted = sequentialResultToAutoLayoutResult(seqRes1F);
      setResultSub(filteredAdapted);
      const selSub: Record<number, number> = {};
      filteredAdapted.edgeLayouts.forEach(el => { selSub[el.edge.index] = el.selectedIndex; });
      setSelectionsSub(selSub);
    } else {
      setSequentialResult1F(null);
      setResultSub(null);
      setSelectionsSub({});
    }

    setResult(res);
    const sel: Record<number, number> = {};
    res.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
    setSelections(sel);

    // Phase I-3-fix: cascade 順で「最初の未解決辺」を探す
    // 起点辺・閉じ辺も対象 (isLocked スキップを廃止、isAutoProgress のみスキップ)
    const startIdx2F = scaffoldStart && seqRes2F.edgeResults.length > 0
      ? (scaffoldStart.startVertexIndex ?? 0) % seqRes2F.edgeResults.length
      : 0;
    const ordered2F = getCascadeOrderedEdges(seqRes2F, startIdx2F);
    const firstUnresolved2F = ordered2F.find(er => !er.isAutoProgress);
    const has2FUnresolved = firstUnresolved2F !== undefined;
    if (has2FUnresolved && firstUnresolved2F) {
      setActiveEdge({ floor: 2, index: firstUnresolved2F.edge.index });
    } else if (seqRes1F) {
      const ordered1F = getCascadeOrderedEdges(seqRes1F, 0);
      const firstUnresolved1F = ordered1F.find(er => !er.isAutoProgress);
      if (firstUnresolved1F) {
        setActiveEdge({ floor: 1, index: firstUnresolved1F.edge.index });
      } else {
        setActiveEdge(null);
      }
    } else {
      setActiveEdge(null);
    }
  };

  // Phase H-3d-1 / Stage 5 Part C: 順次決定の候補選択（2F / 1F 両対応）
  // bothmode 用に segmentIndex (省略時 0) を受け取れるよう拡張。単一階モードは無視。
  const handleSequentialSelect = (
    floor: 1 | 2,
    edgeIndex: number,
    candIdx: number,
    segmentIndex: number = 0,
  ) => {
    if (!building) return;

    // Phase H-3d-2 Stage 5 Part C + 修正A + B1/B2: normalizedBuilding1F/2F を使用
    if (targetFloor === 'both' && normalizedBuilding1F && normalizedBuilding2F && scaffoldStart) {
      const key = `${edgeIndex}-${segmentIndex}`;

      if (floor === 2) {
        const newSelections2F = { ...bothmodeSelections2F, [key]: candIdx };
        setBothmodeSelections2F(newSelections2F);

        const result2F = computeBothmode2FLayout(
          normalizedBuilding2F, normalizedBuilding1F, normalizedDistances, distances1F,
          normalizedScaffoldStart!, enabledSizes, priorityConfig,
          newSelections2F, bothmodeAdjustments2F,
        );
        setBothmodeResult2F(result2F);

        // 2F 変更後は 1F も再計算 (cascade)
        const result1F = computeBothmode1FLayout(
          normalizedBuilding1F, normalizedBuilding2F, result2F, distances1F,
          enabledSizes, priorityConfig,
          bothmodeSelections1F, bothmodeAdjustments1F,
        );
        setBothmodeResult1F(result1F);

        // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
        const adapted = bothmodeResultsToAutoLayoutResult(result2F, result1F);
        setResult(adapted);
        const sel: Record<number, number> = {};
        adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
        setSelections(sel);

        // 次の未解決セグメントへ (cascade 順)
        const segs2F = result2F.edgeSegments;
        const curIdx = segs2F.findIndex(
          s => s.edge2FIndex === edgeIndex && s.segmentIndex === segmentIndex,
        );
        const next2F = curIdx >= 0
          ? segs2F.slice(curIdx + 1).find(s => !s.isLocked && !s.isAutoProgress)
          : undefined;
        if (next2F) {
          setActiveEdge({ floor: 2, index: next2F.edge2FIndex, segmentIndex: next2F.segmentIndex });
          return;
        }
        // 2F 全解決 → 1F 最初の未解決
        const first1F = result1F.edgeSegments.find(s => !s.isLocked && !s.isAutoProgress);
        if (first1F) {
          setActiveEdge({ floor: 1, index: first1F.edge1FIndex, segmentIndex: first1F.segmentIndex });
        } else {
          setActiveEdge(null);
        }
      } else {
        // floor === 1: 1F のみ再計算 (result2F は据え置き)
        if (!bothmodeResult2F) return;
        const newSelections1F = { ...bothmodeSelections1F, [key]: candIdx };
        setBothmodeSelections1F(newSelections1F);

        const result1F = computeBothmode1FLayout(
          normalizedBuilding1F, normalizedBuilding2F, bothmodeResult2F, distances1F,
          enabledSizes, priorityConfig,
          newSelections1F, bothmodeAdjustments1F,
        );
        setBothmodeResult1F(result1F);

        // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
        const adapted = bothmodeResultsToAutoLayoutResult(bothmodeResult2F, result1F);
        setResult(adapted);
        const sel: Record<number, number> = {};
        adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
        setSelections(sel);

        const segs1F = result1F.edgeSegments;
        const curIdx = segs1F.findIndex(
          s => s.edge1FIndex === edgeIndex && s.segmentIndex === segmentIndex,
        );
        const next1F = curIdx >= 0
          ? segs1F.slice(curIdx + 1).find(s => !s.isLocked && !s.isAutoProgress)
          : undefined;
        if (next1F) {
          setActiveEdge({ floor: 1, index: next1F.edge1FIndex, segmentIndex: next1F.segmentIndex });
        } else {
          setActiveEdge(null);
        }
      }
      return;
    }

    // 単一階モード (1Fのみ / 2Fのみ): 既存ロジック
    // 単一階モードでは activeEdge.floor は常に 2、floor === 1 ケースは到達しない。
    if (floor === 2) {
      const newSelections2F = { ...userSelections2F, [edgeIndex]: candIdx };
      setUserSelections2F(newSelections2F);

      const seqRes2F = computeAutoLayoutSequential(
        building, distances, scaffoldStart, enabledSizes, priorityConfig, newSelections2F, userAdjustments2F,
      );
      setSequentialResult2F(seqRes2F);
      const adapted = sequentialResultToAutoLayoutResult(seqRes2F);
      setResult(adapted);
      const sel: Record<number, number> = {};
      adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
      setSelections(sel);

      // Phase I-3-fix: cascade 順で次の未解決辺を探す
      const startIdx2F = scaffoldStart && seqRes2F.edgeResults.length > 0
        ? (scaffoldStart.startVertexIndex ?? 0) % seqRes2F.edgeResults.length
        : 0;
      const ordered2F = getCascadeOrderedEdges(seqRes2F, startIdx2F);
      const currentIdx2F = ordered2F.findIndex(er => er.edge.index === edgeIndex);
      const next2F = ordered2F
        .slice(currentIdx2F + 1)
        .find(er => !er.isAutoProgress);

      if (next2F) {
        setActiveEdge({ floor: 2, index: next2F.edge.index });
        return;
      }
      setActiveEdge(null);
    }
  };

  // Phase H-3d-1 / Stage 5 Part C: 順次決定で前の辺に戻る (2F / 1F 両対応、floor 跨ぎあり)
  // bothmode は辺単位で戻る (該当辺の全セグメント key をクリア)。
  const handleSequentialBack = () => {
    if (!building || !activeEdge) return;

    // Phase H-3d-2 Stage 5 Part C + 修正A + B1/B2: normalizedBuilding1F/2F を使用
    if (targetFloor === 'both' && normalizedBuilding1F && normalizedBuilding2F && scaffoldStart) {
      // 辺の全セグメント key を Record<string, T> から削除するヘルパー
      const stripEdge = <T,>(rec: Record<string, T>, edgeIdx: number): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(rec)) {
          if (!k.startsWith(`${edgeIdx}-`)) out[k] = v;
        }
        return out;
      };

      if (activeEdge.floor === 1) {
        if (!bothmodeResult1F || !bothmodeResult2F) return;
        const segs1F = bothmodeResult1F.edgeSegments;
        const curIdx = segs1F.findIndex(s => s.edge1FIndex === activeEdge.index);
        const prev = curIdx > 0
          ? [...segs1F].slice(0, curIdx).reverse().find(s => !s.isAutoProgress)
          : undefined;

        if (prev) {
          const newSelections1F = stripEdge(bothmodeSelections1F, prev.edge1FIndex);
          const newAdjustments1F = stripEdge(bothmodeAdjustments1F, prev.edge1FIndex);
          setBothmodeSelections1F(newSelections1F);
          setBothmodeAdjustments1F(newAdjustments1F);

          const result1F = computeBothmode1FLayout(
            normalizedBuilding1F, normalizedBuilding2F, bothmodeResult2F, distances1F,
            enabledSizes, priorityConfig,
            newSelections1F, newAdjustments1F,
          );
          setBothmodeResult1F(result1F);

          // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
          const adapted = bothmodeResultsToAutoLayoutResult(bothmodeResult2F, result1F);
          setResult(adapted);
          const sel: Record<number, number> = {};
          adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
          setSelections(sel);

          setActiveEdge({ floor: 1, index: prev.edge1FIndex, segmentIndex: prev.segmentIndex });
          return;
        }

        // 1F 内に戻る先なし → 2F の最後の未解決セグメントへ
        const last2F = [...bothmodeResult2F.edgeSegments].reverse().find(s => !s.isAutoProgress);
        if (last2F) {
          const newSelections2F = stripEdge(bothmodeSelections2F, last2F.edge2FIndex);
          const newAdjustments2F = stripEdge(bothmodeAdjustments2F, last2F.edge2FIndex);
          setBothmodeSelections2F(newSelections2F);
          setBothmodeAdjustments2F(newAdjustments2F);

          const result2F = computeBothmode2FLayout(
            normalizedBuilding2F, normalizedBuilding1F, normalizedDistances, distances1F,
            normalizedScaffoldStart!, enabledSizes, priorityConfig,
            newSelections2F, newAdjustments2F,
          );
          setBothmodeResult2F(result2F);

          const result1F = computeBothmode1FLayout(
            normalizedBuilding1F, normalizedBuilding2F, result2F, distances1F,
            enabledSizes, priorityConfig,
            bothmodeSelections1F, bothmodeAdjustments1F,
          );
          setBothmodeResult1F(result1F);

          // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
          const adapted = bothmodeResultsToAutoLayoutResult(result2F, result1F);
          setResult(adapted);
          const sel: Record<number, number> = {};
          adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
          setSelections(sel);

          setActiveEdge({ floor: 2, index: last2F.edge2FIndex, segmentIndex: last2F.segmentIndex });
        }
        return;
      }

      // activeEdge.floor === 2
      if (!bothmodeResult2F) return;
      const segs2F = bothmodeResult2F.edgeSegments;
      const curIdx = segs2F.findIndex(s => s.edge2FIndex === activeEdge.index);
      const prev = curIdx > 0
        ? [...segs2F].slice(0, curIdx).reverse().find(s => !s.isAutoProgress)
        : undefined;
      if (!prev) return;

      const newSelections2F = stripEdge(bothmodeSelections2F, prev.edge2FIndex);
      const newAdjustments2F = stripEdge(bothmodeAdjustments2F, prev.edge2FIndex);
      setBothmodeSelections2F(newSelections2F);
      setBothmodeAdjustments2F(newAdjustments2F);

      const result2F = computeBothmode2FLayout(
        normalizedBuilding2F, normalizedBuilding1F, normalizedDistances, distances1F,
        normalizedScaffoldStart!, enabledSizes, priorityConfig,
        newSelections2F, newAdjustments2F,
      );
      setBothmodeResult2F(result2F);

      const result1F = computeBothmode1FLayout(
        normalizedBuilding1F, normalizedBuilding2F, result2F, distances1F,
        enabledSizes, priorityConfig,
        bothmodeSelections1F, bothmodeAdjustments1F,
      );
      setBothmodeResult1F(result1F);

      // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
      const adapted = bothmodeResultsToAutoLayoutResult(result2F, result1F);
      setResult(adapted);
      const sel: Record<number, number> = {};
      adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
      setSelections(sel);

      setActiveEdge({ floor: 2, index: prev.edge2FIndex, segmentIndex: prev.segmentIndex });
      return;
    }

    // 単一階モード: 既存ロジック (activeEdge.floor は常に 2)
    if (activeEdge.floor === 2 && sequentialResult2F) {
      // Phase I-3-fix: cascade 順で前の未解決辺を探す
      const startIdx2F = scaffoldStart && sequentialResult2F.edgeResults.length > 0
        ? (scaffoldStart.startVertexIndex ?? 0) % sequentialResult2F.edgeResults.length
        : 0;
      const ordered2F = getCascadeOrderedEdges(sequentialResult2F, startIdx2F);
      const currentIdx = ordered2F.findIndex(er => er.edge.index === activeEdge.index);
      const prev2F = ordered2F
        .slice(0, currentIdx)
        .reverse()
        .find(er => !er.isAutoProgress);
      if (!prev2F) return;
      const newSelections2F = { ...userSelections2F };
      delete newSelections2F[prev2F.edge.index];
      setUserSelections2F(newSelections2F);
      // Phase I-2: 戻り辺の adjustments もクリア
      const newAdjustments2F = { ...userAdjustments2F };
      delete newAdjustments2F[prev2F.edge.index];
      setUserAdjustments2F(newAdjustments2F);
      const seqRes2F = computeAutoLayoutSequential(
        building, distances, scaffoldStart, enabledSizes, priorityConfig, newSelections2F, newAdjustments2F,
      );
      setSequentialResult2F(seqRes2F);
      setActiveEdge({ floor: 2, index: prev2F.edge.index });
    }
  };

  // 順次決定をキャンセル（両 floor の state をクリア）
  const handleSequentialCancel = () => {
    setActiveEdge(null);
    setSequentialResult2F(null);
    setSequentialResult1F(null);
    setUserSelections2F({});
    setUserSelections1F({});
    // Phase I-2: adjustments もクリア
    setUserAdjustments2F({});
    setUserAdjustments1F({});
    // Phase H-3d-2 Stage 5 Part A: bothmode state もクリア
    setBothmodeResult2F(null);
    setBothmodeResult1F(null);
    setBothmodeSelections2F({});
    setBothmodeSelections1F({});
    setBothmodeAdjustments2F({});
    setBothmodeAdjustments1F({});
    setResult(null);
    setResultSub(null);
  };

  // Phase I-2 / Stage 5 Part C: 「割り変更」「←/→」操作のハンドラ
  // - 「割り変更」(handleVariationChange): 該当 side の variationIdx を +1
  // - 「←/→」(handleOffsetChange): 該当 side の offsetIdx を ±1、variationIdx を 0 リセット
  // 更新後は再計算で後続辺にも伝播。bothmode は segmentIndex 対応 (key=`${edge}-${seg}`)。
  const applyAdjustmentsUpdate = (
    floor: 1 | 2,
    edgeIndex: number,
    updater: (cur: EdgeAdjustment) => EdgeAdjustment | null,
    segmentIndex: number = 0,
  ) => {
    if (!building) return;

    // Phase H-3d-2 Stage 5 Part C + 修正A + B1/B2: normalizedBuilding1F/2F を使用
    if (targetFloor === 'both' && normalizedBuilding1F && normalizedBuilding2F && scaffoldStart) {
      const key = `${edgeIndex}-${segmentIndex}`;
      const isF2 = floor === 2;
      const curRec = isF2 ? bothmodeAdjustments2F : bothmodeAdjustments1F;
      const cur = curRec[key] ?? DEFAULT_EDGE_ADJUSTMENT;
      const next = updater(cur);
      if (next === null) return;

      if (isF2) {
        const newAdjustments2F = { ...bothmodeAdjustments2F, [key]: next };
        setBothmodeAdjustments2F(newAdjustments2F);
        const result2F = computeBothmode2FLayout(
          normalizedBuilding2F, normalizedBuilding1F, normalizedDistances, distances1F,
          normalizedScaffoldStart!, enabledSizes, priorityConfig,
          bothmodeSelections2F, newAdjustments2F,
        );
        setBothmodeResult2F(result2F);
        const result1F = computeBothmode1FLayout(
          normalizedBuilding1F, normalizedBuilding2F, result2F, distances1F,
          enabledSizes, priorityConfig,
          bothmodeSelections1F, bothmodeAdjustments1F,
        );
        setBothmodeResult1F(result1F);

        // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
        const adapted = bothmodeResultsToAutoLayoutResult(result2F, result1F);
        setResult(adapted);
        const sel: Record<number, number> = {};
        adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
        setSelections(sel);
      } else {
        if (!bothmodeResult2F) return;
        const newAdjustments1F = { ...bothmodeAdjustments1F, [key]: next };
        setBothmodeAdjustments1F(newAdjustments1F);
        const result1F = computeBothmode1FLayout(
          normalizedBuilding1F, normalizedBuilding2F, bothmodeResult2F, distances1F,
          enabledSizes, priorityConfig,
          bothmodeSelections1F, newAdjustments1F,
        );
        setBothmodeResult1F(result1F);

        // Phase H-3d-2 Stage 5 Part D-1: 描画系へも反映
        const adapted = bothmodeResultsToAutoLayoutResult(bothmodeResult2F, result1F);
        setResult(adapted);
        const sel: Record<number, number> = {};
        adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
        setSelections(sel);
      }
      return;
    }

    // 単一階モード (floor === 2 のみ到達想定)
    const cur = userAdjustments2F[edgeIndex] ?? DEFAULT_EDGE_ADJUSTMENT;
    const next = updater(cur);
    if (next === null) return;
    const newAdjustments2F = { ...userAdjustments2F, [edgeIndex]: next };
    setUserAdjustments2F(newAdjustments2F);
    const seqRes2F = computeAutoLayoutSequential(
      building, distances, scaffoldStart, enabledSizes, priorityConfig, userSelections2F, newAdjustments2F,
    );
    setSequentialResult2F(seqRes2F);
    const adapted = sequentialResultToAutoLayoutResult(seqRes2F);
    setResult(adapted);
    const sel: Record<number, number> = {};
    adapted.edgeLayouts.forEach((el, i) => { sel[i] = el.selectedIndex; });
    setSelections(sel);
  };

  const handleVariationChange = (
    floor: 1 | 2,
    edgeIndex: number,
    side: 'larger' | 'smaller',
    direction: 'next' | 'prev' = 'next',
    segmentIndex: number = 0,
  ) => {
    applyAdjustmentsUpdate(floor, edgeIndex, cur => {
      const curVar = cur[side].variationIdx;
      if (direction === 'prev' && curVar === 0) return null; // ガード: 0 未満には行かない
      const newVar = direction === 'next' ? curVar + 1 : curVar - 1;
      return {
        ...cur,
        [side]: { ...cur[side], variationIdx: newVar },
      };
    }, segmentIndex);
  };

  const handleOffsetChange = (
    floor: 1 | 2,
    edgeIndex: number,
    side: 'larger' | 'smaller',
    direction: 'next' | 'prev',
    segmentIndex: number = 0,
  ) => {
    applyAdjustmentsUpdate(floor, edgeIndex, cur => {
      const curOffset = cur[side].offsetIdx;
      if (direction === 'prev' && curOffset === 0) return null; // ガード: 進めない
      const newOffset = direction === 'next' ? curOffset + 1 : curOffset - 1;
      return {
        ...cur,
        [side]: { offsetIdx: newOffset, variationIdx: 0 }, // variationIdx リセット
      };
    }, segmentIndex);
  };

  const handlePlace = () => {
    if (!result || !building) return;
    const allHandrails: Handrail[] = [];

    // L字辺も通常辺と同様に配置する（L字辺の特徴は「離れ固定 + ダイアログ対象外」のみ）。
    // ScaffoldStartModal で既に置かれた L字辺の始点手摺は、下の overlappingIds で検出されて
    // 削除ダイアログが出るので、ユーザーが置換を承認すれば正しい配置に再構成される。
    for (let i = 0; i < result.edgeLayouts.length; i++) {
      const el = result.edgeLayouts[i];
      const selIdx = selections[i] ?? 0;
      const candidate = el.candidates[selIdx];
      if (!candidate || candidate.rails.length === 0) continue;

      const placements = placeHandrailsForEdge(el, candidate.rails);
      // 所属階:
      // - bothmode: adapter が originFloor を埋めているのでそれを使う (2F 由来 → 2F、1F 由来 → 1F)
      // - 単一階: 1Fのみ → 1F、2Fのみ → 2F (originFloor は undefined)
      const placeFloor: 1 | 2 = el.originFloor ?? (targetFloor === 1 ? 1 : 2);
      for (const p of placements) {
        allHandrails.push({
          id: uuidv4(),
          x: p.x, y: p.y,
          lengthMm: p.lengthMm,
          direction: p.direction,
          color: getHandrailColor(p.lengthMm),
          floor: placeFloor,
        });
      }
    }

    // 1F+2F 同時: 1F のうち 2F で覆われない辺（下屋辺）の手摺を追加
    if (targetFloor === 'both' && resultSub) {
      for (const el of resultSub.edgeLayouts) {
        const selIdx = selectionsSub[el.edge.index] ?? 0;
        const candidate = el.candidates[selIdx];
        if (!candidate || candidate.rails.length === 0) continue;
        const placements = placeHandrailsForEdge(el, candidate.rails);
        for (const p of placements) {
          allHandrails.push({
            id: uuidv4(),
            x: p.x, y: p.y,
            lengthMm: p.lengthMm,
            direction: p.direction,
            color: getHandrailColor(p.lengthMm),
            floor: 1, // 下屋辺は1F部材
          });
        }
      }
    }

    if (allHandrails.length === 0) return;

    // 触れる既存手摺を検出（各手摺について同じ階のもののみ比較）。
    // 1F+2F同時モードでも、1F 手摺は 1F と、2F 手摺は 2F と比較される。
    const mmToG = (mm: number) => Math.round(mm / 10);
    const TOL = 2;
    const overlappingIds = canvasData.handrails.filter(existing => {
      return allHandrails.some(newH => {
        if ((newH.floor ?? 1) !== (existing.floor ?? 1)) return false;
        if (existing.direction !== newH.direction) return false;
        if (existing.direction === 'horizontal') {
          if (Math.abs(existing.y - newH.y) > TOL) return false;
          const e1 = existing.x, e2 = existing.x + mmToG(existing.lengthMm);
          const n1 = newH.x, n2 = newH.x + mmToG(newH.lengthMm);
          return e1 <= n2 + TOL && e2 >= n1 - TOL;
        } else {
          if (Math.abs(existing.x - newH.x) > TOL) return false;
          const e1 = existing.y, e2 = existing.y + mmToG(existing.lengthMm);
          const n1 = newH.y, n2 = newH.y + mmToG(newH.lengthMm);
          return e1 <= n2 + TOL && e2 >= n1 - TOL;
        }
      });
    }).map(h => h.id);

    // 干渉する既存部材がある場合はカスタム確認ダイアログ
    if (overlappingIds.length > 0) {
      setConflictIds(overlappingIds);
      setPendingHandrails(allHandrails);
      useCanvasStore.getState().setHighlightIds(overlappingIds);
      setShowConflictConfirm(true);
      return;
    }

    addHandrails(allHandrails);
    onClose();
  };

  const handleConflictOk = () => {
    useCanvasStore.getState().setHighlightIds([]);
    removeElements(conflictIds);
    addHandrails(pendingHandrails);
    setShowConflictConfirm(false);
    onClose();
  };

  const handleConflictCancel = () => {
    useCanvasStore.getState().setHighlightIds([]);
    setShowConflictConfirm(false);
  };

  if (!building) {
    return (
      <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-dark-surface border border-dark-border rounded-2xl p-6 text-center" onClick={e => e.stopPropagation()}>
          <p className="text-dimension mb-3">建物がありません</p>
          <button onClick={onClose} className="px-4 py-2 bg-accent text-white rounded-lg text-sm">閉じる</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 modal-overlay flex items-end sm:items-center justify-center z-50" onClick={(showConflictConfirm || activeEdge !== null) ? undefined : onClose}>
      <div className="bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-dark-surface px-4 py-3 border-b border-dark-border flex items-center justify-between z-10">
          <h2 className="font-bold text-lg">自動割付</h2>
          <button onClick={onClose} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* 対象階 */}
          <div>
            <label className="block text-xs text-dimension mb-1.5">対象階</label>
            <div className="flex gap-1.5">
              {([1, 2] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTargetFloor(f)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    targetFloor === f
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-dark-border text-dimension hover:border-accent/50'
                  }`}
                >
                  {f}Fのみ
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowComingSoonModal(true)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                  targetFloor === 'both'
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-dark-border text-dimension hover:border-accent/50'
                }`}
              >
                1F+2F
              </button>
            </div>
            {targetFloor === 'both' && (
              <p className="mt-1.5 text-[10px] text-dimension">
                {!building2F
                  ? '⚠️ 2F建物が未作成です。先に2Fを作成してください'
                  : !building1F
                  ? '⚠️ 1F建物が未作成です'
                  : uncoveredEdges1F.length === 0
                  ? '✓ 1F全辺が2Fで覆われます: 2F全周のみ配置、1F足場不要'
                  : `✓ 2F全周配置 + 1Fの下屋辺 ${uncoveredEdges1F.length} 本にも配置`}
              </p>
            )}
          </div>

          {!building && (
            <p className="text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
              {targetFloor === 2 ? '2F建物が未作成です。' : '建物が未作成です。'}
              躯体メニューから建物を先に作成してください。
            </p>
          )}

          {building && (
            <>
          {/* プレビューSVG（bothモードでは 1F を背景、下屋辺を緑で強調） */}
          {/* Phase H-3d-3: bothmode では normalize 後の 2F (B1/B2 等の分割辺込み) を表示 */}
          <PreviewSVG
            points={targetFloor === 'both' && normalizedBuilding2F ? normalizedBuilding2F.points : building.points}
            edges={targetFloor === 'both' ? edges2FAll : edges}
            focusedIndex={focusedEdgeIndex}
            conflictHandrails={showConflictConfirm ? canvasData.handrails.filter(h => conflictIds.includes(h.id)) : undefined}
            subPoints={targetFloor === 'both' && normalizedBuilding1F ? normalizedBuilding1F.points : undefined}
            subEdges={targetFloor === 'both' ? subEdgesRelabeled : undefined}
            subHighlightIndices={targetFloor === 'both' ? uncoveredIdxSet1F : undefined}
            focusedSubIndex={focusedSubEdgeIndex}
            scaffoldStart={normalizedScaffoldStart}
            showFloorPrefix={targetFloor === 'both'}
          />

          {/* 各辺の離れ入力 */}
          <div>
            <p className="text-sm text-dimension mb-2">各辺の離れ (mm)</p>
            {/* 一括入力 (= 全辺に同値を一斉コピー、 locked edge はスキップ) */}
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-dark-border/50">
              <span className="text-[10px] text-dimension w-12 shrink-0">一括</span>
              <NumInput
                value={bulkMm}
                onChange={setBulkMm}
                min={0} step={1}
                className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  edges.forEach(edge => {
                    if (!lockedEdgeIndices.has(edge.index)) {
                      setDistance(edge.index, bulkMm);
                    }
                  });
                }}
                className="px-3 py-1.5 bg-accent text-white text-xs font-bold rounded-lg shrink-0"
              >
                全部に適用
              </button>
            </div>
            <div className="space-y-1.5">
              {edges.map(edge => (
                <div key={edge.index} className="flex items-center gap-2">
                  <span className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold ${
                    focusedEdgeIndex === edge.index ? 'bg-accent text-white' : 'bg-dark-bg text-dimension'
                  }`}>
                    {/* Phase H-3d-3: bothmode は 1F 側 (1{label}) と対称に "2" prefix */}
                    {targetFloor === 'both' ? `2${edge.label}` : edge.label}
                  </span>
                  <span className="text-[10px] text-dimension w-6 shrink-0">{FACE_LABEL[edge.face]}</span>
                  {lockedEdgeIndices.has(edge.index) ? (
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={getDistance(edge.index)}
                        disabled
                        className="w-full bg-dark-bg border border-dark-border rounded-lg px-2 py-1.5 text-sm font-mono opacity-50 cursor-not-allowed"
                      />
                      <div
                        className="absolute inset-0 cursor-not-allowed"
                        onClick={() => setShowLockedAlert(true)}
                      />
                    </div>
                  ) : (
                    // NumInput: 内部テキストstate + blur/Enterでコミット。
                    // これにより入力途中の "9" や空欄を許容し、Backspace で自由に編集可能。
                    <NumInput
                      value={getDistance(edge.index)}
                      onChange={v => setDistance(edge.index, Math.max(0, v))}
                      onFocus={() => setFocusedEdgeIndex(edge.index)}
                      onBlur={() => setFocusedEdgeIndex(null)}
                      min={0} step={1}
                      className={`flex-1 bg-dark-bg border rounded-lg px-2 py-1.5 text-sm font-mono ${
                        focusedEdgeIndex === edge.index ? 'border-accent' : 'border-dark-border'
                      }`}
                    />
                  )}
                  {lockedEdgeIndices.has(edge.index) && (
                    <span className="text-[10px] text-dimension bg-dark-bg px-1.5 py-0.5 rounded border border-dark-border shrink-0">固定</span>
                  )}
                  <span className="text-[10px] text-dimension w-16 text-right shrink-0">{edge.lengthMm}mm</span>
                </div>
              ))}
            </div>
          </div>

          {scaffoldStart && (
            <p className="text-[10px] text-dimension">
              スタート角: {scaffoldStart.corner.toUpperCase()} /
              face1={scaffoldStart.face1FirstHandrail}mm /
              face2={scaffoldStart.face2FirstHandrail}mm
            </p>
          )}

          {/* 1F下屋辺の離れ入力（1F+2F同時モード・下屋辺あり時のみ表示） */}
          {/* Phase H-3d-2 Stage 5 Part D-2-a: 連動辺は「= 2F-X面」表示にして入力無効化 */}
          {targetFloor === 'both' && subEdgesRelabeled.length > 0 && (() => {
            const collinearCount = subEdgesRelabeled.filter(e => collinear1FToEdge2F.has(e.index)).length;
            return (
              <div>
                <p className="text-sm text-dimension mb-2 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />
                  1F 下屋辺の離れ (mm)
                  <span className="text-[10px] text-dimension/70">
                    ({subEdgesRelabeled.length} 本{collinearCount > 0 ? ` / うち ${collinearCount} 本は2Fと連動` : ''})
                  </span>
                </p>
                <div className="space-y-1.5">
                  {/* Phase H-3d-4 fix: 下屋単独 normalized ラベル (1A/1B/1C) を使うため
                      subEdgesRelabeled をループ元にする。 uncoveredEdges1F.label は
                      1F 全周連番のため "1C/1D/1E" 等になってしまう。 */}
                  {subEdgesRelabeled.map(edge => {
                    const linkedEdge2F = collinear1FToEdge2F.get(edge.index);
                    return (
                      <div key={`sub-${edge.index}`} className="flex items-center gap-2">
                        <span className={`w-8 h-6 flex items-center justify-center rounded text-xs font-bold ${
                          focusedSubEdgeIndex === edge.index ? 'bg-green-500 text-white' : 'bg-dark-bg text-green-400'
                        }`}>
                          1{edge.label}
                        </span>
                        <span className="text-[10px] text-dimension w-6 shrink-0">{FACE_LABEL[edge.face]}</span>
                        {linkedEdge2F ? (
                          <span className="flex-1 bg-dark-bg/50 border border-dark-border/50 rounded-lg px-2 py-1.5 text-sm font-mono text-dimension/70">
                            = 2F {linkedEdge2F.label}面と連動
                          </span>
                        ) : (
                          <NumInput
                            value={distances1F[edge.index] ?? 900}
                            onChange={v => {
                              setDistances1F(prev => ({ ...prev, [edge.index]: Math.max(0, v) }));
                              setResultSub(null);
                              // 順次決定 state をリセット（1F の距離変更は 1F のみ影響だが、安全のため両方）
                              setSequentialResult2F(null);
                              setSequentialResult1F(null);
                              setUserSelections2F({});
                              setUserSelections1F({});
                              // Phase H-3d-2 Stage 5 Part A: bothmode state もリセット
                              setBothmodeResult2F(null);
                              setBothmodeResult1F(null);
                              setBothmodeSelections2F({});
                              setBothmodeSelections1F({});
                              setBothmodeAdjustments2F({});
                              setBothmodeAdjustments1F({});
                              setActiveEdge(null);
                            }}
                            onFocus={() => setFocusedSubEdgeIndex(edge.index)}
                            onBlur={() => setFocusedSubEdgeIndex(null)}
                            min={0} step={1}
                            className={`flex-1 bg-dark-bg border rounded-lg px-2 py-1.5 text-sm font-mono ${
                              focusedSubEdgeIndex === edge.index ? 'border-green-500' : 'border-dark-border'
                            }`}
                          />
                        )}
                        <span className="text-[10px] text-dimension w-16 text-right shrink-0">{edge.lengthMm}mm</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 計算ボタン */}
          <button onClick={handleCalc} data-tutorial-id="autolayout-calc"
            className="w-full py-2.5 bg-dark-bg border border-accent text-accent font-bold rounded-xl text-sm hover:bg-accent/10 transition-colors"
          >
            計算する
          </button>

          {/* 計算結果 */}
          {result && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-canvas">
                {targetFloor === 'both' ? '割付結果 (2F全周)' : '割付結果'}
              </p>

              {result.edgeLayouts.map((el, i) => {
                // Phase H-3d-4: bothmode の 1F-origin entry は専用 1F セクションで描画 (下方)、
                // ここは 2F-origin / 単一階 (originFloor undefined) のみ。
                if (el.originFloor === 1) return null;
                const selIdx = selections[i] ?? 0;
                const candidate = el.candidates[selIdx];
                if (!candidate) return null;

                // Phase I-5: 部材変更用の seq 候補を取得
                // 規約: 主要建物の sequentialResult は常に sequentialResult2F に保存される
                // (handleCalc / handleSequentialSelect の規約)。
                // targetFloor=1 (1F のみモード) でも seqRes2F が使われる。
                // よって主要建物の handleVariationChange も常に floor=2 で呼ぶ。
                const mainFloor: 1 | 2 = 2;
                const seqEdge = sequentialResult2F?.edgeResults.find(er => er.edge.index === el.edge.index);
                const seqCand = seqEdge?.candidates[seqEdge.selectedIndex];
                const sideForVariation: 'larger' | 'smaller' | null = seqCand
                  ? (seqCand.side === 'exact' ? 'smaller' : seqCand.side)
                  : null;

                return (
                  <div key={i} className="bg-dark-bg rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold">
                        {/* Phase H-3d-3: bothmode は 1F 側 (1{label}) と対称に "2" prefix */}
                        {targetFloor === 'both' ? '2' : ''}{((targetFloor === 'both' ? edges2FAll : edges).find(e => e.index === el.edge.index)?.label ?? el.edge.label)} ({FACE_LABEL[el.edge.face]})
                        {el.locked && <span className="text-[10px] text-dimension ml-1">L字固定</span>}
                      </span>
                      <span className="text-[10px] text-dimension">
                        辺長 {el.edgeLengthMm}mm / 有効 {el.effectiveMm}mm
                      </span>
                    </div>

                    {candidate.rails.length > 0 ? (
                      <>
                        <p className="text-xs text-canvas font-mono mb-1">
                          {formatRailsSummary(candidate.rails)}
                        </p>
                        <div className="flex flex-wrap gap-1 mb-1">
                          {candidate.rails.map((r, ri) => (
                            <span key={ri} className="px-1.5 py-0.5 bg-handrail/20 text-handrail text-[11px] font-mono rounded">
                              {r}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-dimension">手摺なし</p>
                    )}

                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-mono ${
                        candidate.remainder === 0 ? 'text-green-400' :
                        candidate.remainder < 0 ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        端数: {candidate.remainder >= 0 ? '+' : ''}{candidate.remainder}mm
                        {candidate.remainder < 0 && ' (突出)'}
                      </span>
                      <span className="text-[10px] text-dimension">{candidate.count}本</span>
                    </div>

                    {/* Phase I-5: 部材変更ボタン (同じ離れで rails パターン切替) */}
                    {seqCand && sideForVariation && (
                      <div className="mt-2 pt-2 border-t border-dark-border flex justify-center">
                        <VariationChangeButtons
                          variationIdx={seqCand.variationIdx}
                          variationCount={seqCand.variationCount}
                          onChange={(dir) => handleVariationChange(mainFloor, el.edge.index, sideForVariation, dir)}
                        />
                      </div>
                    )}

                    {el.candidates.length > 1 && (
                      <div className="mt-2 pt-2 border-t border-dark-border">
                        <p className="text-[10px] text-dimension mb-1">候補：</p>
                        <div className="flex flex-wrap gap-1">
                          {el.candidates.map((c, ci) => (
                            <button key={ci}
                              onClick={() => setSelections(prev => ({ ...prev, [i]: ci }))}
                              className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                                selIdx === ci
                                  ? 'border-accent bg-accent/15 text-accent'
                                  : 'border-dark-border text-dimension hover:border-accent/50'
                              }`}
                            >
                              {formatRailsSummary(c.rails)} / {c.remainder >= 0 ? '+' : ''}{c.remainder}mm
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 1F 下屋辺の結果（bothモード + 下屋あり時のみ） */}
              {/* Phase H-3d-4: bothmode は result.edgeLayouts.filter(originFloor===1) を使用、
                  単一階モード (現状到達なし) は従来 resultSub 経由 */}
              {(() => {
                type SubEntry = { el: typeof result.edgeLayouts[number]; mergedIdx: number; useBothmodeState: boolean };
                const subEntries: SubEntry[] = targetFloor === 'both'
                  ? result.edgeLayouts
                      .map((el, mergedIdx) => ({ el, mergedIdx, useBothmodeState: true }))
                      .filter(({ el }) => el.originFloor === 1)
                  : (resultSub?.edgeLayouts.map((el, idx) => ({ el, mergedIdx: idx, useBothmodeState: false })) ?? []);
                if (subEntries.length === 0) return null;
                return (
                <div className="pt-3 mt-3 border-t border-dark-border space-y-2">
                  <p className="text-sm font-bold text-green-400">
                    割付結果 (1F 下屋辺)
                  </p>
                  {subEntries.map(({ el, mergedIdx, useBothmodeState }) => {
                    const selIdx = useBothmodeState
                      ? (selections[mergedIdx] ?? 0)
                      : (selectionsSub[el.edge.index] ?? 0);
                    const candidate = el.candidates[selIdx];
                    if (!candidate) return null;
                    // Phase I-5: 1F 下屋辺の部材変更用 seq 候補 (単一階のみ。bothmode は modal 経由のため非表示)
                    const seqEdgeSub = !useBothmodeState
                      ? sequentialResult1F?.edgeResults.find(er => er.edge.index === el.edge.index)
                      : undefined;
                    const seqCandSub = seqEdgeSub?.candidates[seqEdgeSub.selectedIndex];
                    const sideForVariationSub: 'larger' | 'smaller' | null = seqCandSub
                      ? (seqCandSub.side === 'exact' ? 'smaller' : seqCandSub.side)
                      : null;
                    return (
                      <div key={`sub-${el.edge.index}-${mergedIdx}`} className="bg-dark-bg rounded-xl p-3 border-l-2 border-green-500">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-green-400">
                            {/* Phase H-3d-3: 1F 下屋辺ラベルは subEdgesRelabeled (= uncovered のみ relabel) から引く */}
                            1{(subEdgesRelabeled.find(e => e.index === el.edge.index)?.label ?? el.edge.label)} ({FACE_LABEL[el.edge.face]})
                          </span>
                          <span className="text-[10px] text-dimension">
                            辺長 {el.edgeLengthMm}mm / 有効 {el.effectiveMm}mm
                          </span>
                        </div>
                        {candidate.rails.length > 0 ? (
                          <>
                            <p className="text-xs text-canvas font-mono mb-1">
                              {formatRailsSummary(candidate.rails)}
                            </p>
                            <div className="flex flex-wrap gap-1 mb-1">
                              {candidate.rails.map((r, ri) => (
                                <span key={ri} className="px-1.5 py-0.5 bg-green-500/20 text-green-300 text-[11px] font-mono rounded">
                                  {r}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-dimension">手摺なし</p>
                        )}
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-mono ${
                            candidate.remainder === 0 ? 'text-green-400' :
                            candidate.remainder < 0 ? 'text-red-400' : 'text-yellow-400'
                          }`}>
                            端数: {candidate.remainder >= 0 ? '+' : ''}{candidate.remainder}mm
                            {candidate.remainder < 0 && ' (突出)'}
                          </span>
                          <span className="text-[10px] text-dimension">{candidate.count}本</span>
                        </div>
                        {/* Phase I-5: 1F 下屋辺の部材変更ボタン (単一階モードのみ) */}
                        {seqCandSub && sideForVariationSub && (
                          <div className="mt-2 pt-2 border-t border-dark-border flex justify-center">
                            <VariationChangeButtons
                              variationIdx={seqCandSub.variationIdx}
                              variationCount={seqCandSub.variationCount}
                              onChange={(dir) => handleVariationChange(1, el.edge.index, sideForVariationSub, dir)}
                            />
                          </div>
                        )}
                        {el.candidates.length > 1 && (
                          <div className="mt-2 pt-2 border-t border-dark-border">
                            <p className="text-[10px] text-dimension mb-1">候補：</p>
                            <div className="flex flex-wrap gap-1">
                              {el.candidates.map((c, ci) => (
                                <button key={ci}
                                  onClick={() => useBothmodeState
                                    ? setSelections(prev => ({ ...prev, [mergedIdx]: ci }))
                                    : setSelectionsSub(prev => ({ ...prev, [el.edge.index]: ci }))
                                  }
                                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                                    selIdx === ci
                                      ? 'border-green-500 bg-green-500/15 text-green-400'
                                      : 'border-dark-border text-dimension hover:border-green-500/50'
                                  }`}
                                >
                                  {formatRailsSummary(c.rails)} / {c.remainder >= 0 ? '+' : ''}{c.remainder}mm
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })()}

              <button onClick={handlePlace} data-tutorial-id="autolayout-place"
                className="w-full py-3 bg-accent text-white font-bold rounded-xl text-lg"
              >
                配置する
              </button>
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {showConflictConfirm && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[90vw] max-w-sm bg-dark-surface border border-dark-border rounded-2xl shadow-2xl p-4">
          <p className="text-sm font-bold mb-1">干渉する既存部材があります</p>
          <p className="text-xs text-dimension mb-4">
            オレンジ色の部材（{conflictIds.length}本）が自動配置と干渉しています。削除して配置しますか？
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleConflictCancel}
              className="flex-1 py-2 border border-dark-border rounded-xl text-sm text-dimension"
            >
              キャンセル
            </button>
            <button
              onClick={handleConflictOk}
              data-tutorial-id="autolayout-conflict-ok"
              className="flex-1 py-2 bg-accent text-white font-bold rounded-xl text-sm"
            >
              削除して配置
            </button>
          </div>
        </div>
      )}

      {/* Phase H-3d-1: 順次決定モーダル（2F / 1F 両対応） */}
      {activeEdge !== null && (() => {
        // Phase H-3d-2 Stage 5 残対応 Step 1: bothmode/単一階両対応の統一形式
        type ActiveItem = {
          edge: EdgeInfo;
          startDistanceMm: number;
          desiredEndDistanceMm: number;
          candidates: SequentialCandidate[];
          selectedIndex: number;
          prevCornerIsConvex: boolean;
          nextCornerIsConvex: boolean;
          isLocked: boolean;
          isAutoProgress: boolean;
          segmentIndex: number;  // 単一階は常に 0、bothmode は segment.segmentIndex
          // Phase H-3d-2 ラベル衝突対応: 次の面のラベル (例 "B2", "1A", "2C") を desiredEndSource/endConstraint から事前計算
          nextFaceLabel: string;
        };

        let activeItem: ActiveItem | null = null;
        let totalNum = 0;
        let currentNum = 0;
        let prevStartDistMm: number | null = null;

        if (targetFloor === 'both' && (bothmodeResult2F || bothmodeResult1F)) {
          // bothmode: result2F の全 segments + result1F の全 segments を cascade 順に並べる
          type SegEntry = {
            seg: typeof bothmodeResult2F extends null ? never
              : NonNullable<typeof bothmodeResult2F>['edgeSegments'][number] | NonNullable<typeof bothmodeResult1F>['edgeSegments'][number];
            floor: 1 | 2;
            edgeIndex: number;
          };
          const allSegments: SegEntry[] = [];
          if (bothmodeResult2F) {
            for (const s of bothmodeResult2F.edgeSegments) {
              allSegments.push({ seg: s, floor: 2, edgeIndex: s.edge2FIndex });
            }
          }
          if (bothmodeResult1F) {
            for (const s of bothmodeResult1F.edgeSegments) {
              allSegments.push({ seg: s, floor: 1, edgeIndex: s.edge1FIndex });
            }
          }
          // Phase H-3d-2 Stage 5 残対応 Step 1 補足:
          // activeEdge.segmentIndex が指定されていれば一致するセグメントを優先、
          // されていなければ最初の未解決セグメントを使う (互換動作)。
          const curArrIdx = allSegments.findIndex(
            x => x.floor === activeEdge.floor
              && x.edgeIndex === activeEdge.index
              && (activeEdge.segmentIndex === undefined || x.seg.segmentIndex === activeEdge.segmentIndex)
              && !x.seg.isAutoProgress && !x.seg.isLocked,
          );
          if (curArrIdx < 0) return null;
          const cur = allSegments[curArrIdx];
          const seg = cur.seg;
          // Phase H-3d-2 ラベル衝突対応: 自身のラベルは normalizedBuilding の relabel 済 edges から取得
          // Phase H-3d-3: 1F は uncovered (下屋) のみ segment 化されるので subEdgesRelabeled から引く
          const relabeledSelf = cur.floor === 2
            ? edges2FAll.find(e => e.index === cur.edgeIndex)
            : subEdgesRelabeled.find(e => e.index === cur.edgeIndex);
          const synthEdge: EdgeInfo = {
            index: cur.edgeIndex,
            label: relabeledSelf?.label ?? String.fromCharCode(65 + cur.edgeIndex),
            p1: seg.startPoint,
            p2: seg.endPoint,
            lengthMm: seg.segmentLengthMm,
            face: seg.face,
            handrailDir: seg.handrailDir,
            nx: seg.nx,
            ny: seg.ny,
          };
          // 次の面のラベル: desiredEndSource (2F seg) / endConstraint (1F seg) を見て決定
          let nextFaceLabel = '?';
          if (cur.floor === 2) {
            const seg2F = seg as NonNullable<typeof bothmodeResult2F>['edgeSegments'][number];
            const src = seg2F.desiredEndSource;
            if (src.kind === 'next-2F-face') {
              const e2 = edges2FAll.find(e => e.index === src.edge2FIndex);
              nextFaceLabel = `2${e2?.label ?? '?'}`;
            } else {
              // 1F-face-pillar: 下屋 edge を指すので subEdgesRelabeled から引く
              const e1 = subEdgesRelabeled.find(e => e.index === src.edge1FIndex);
              nextFaceLabel = `1${e1?.label ?? '?'}`;
            }
          } else {
            const seg1F = seg as NonNullable<typeof bothmodeResult1F>['edgeSegments'][number];
            const ec = seg1F.endConstraint;
            if (ec.kind === 'collinear-with-2F') {
              const e2 = edges2FAll.find(e => e.index === ec.edge2FIndex);
              nextFaceLabel = `2${e2?.label ?? '?'}`;
            } else if (ec.kind === 'next-1F-face') {
              // 次も独立 (= 下屋 edge) を指すので subEdgesRelabeled から引く
              const e1 = subEdgesRelabeled.find(e => e.index === ec.edge1FIndex);
              nextFaceLabel = `1${e1?.label ?? '?'}`;
            } else {
              // pillar-to-2F: pillarPoint と startPoint が一致する 2F seg を探す
              if (bothmodeResult2F) {
                const pp = ec.pillarPoint;
                const seg2FAtPillar = bothmodeResult2F.edgeSegments.find(s2 =>
                  Math.abs(s2.startPoint.x - pp.x) < 0.001 && Math.abs(s2.startPoint.y - pp.y) < 0.001,
                );
                if (seg2FAtPillar) {
                  const e2 = edges2FAll.find(e => e.index === seg2FAtPillar.edge2FIndex);
                  nextFaceLabel = `2${e2?.label ?? '?'}`;
                }
              }
            }
          }
          activeItem = {
            edge: synthEdge,
            startDistanceMm: seg.startDistanceMm,
            desiredEndDistanceMm: seg.desiredEndDistanceMm,
            candidates: seg.candidates,
            selectedIndex: seg.selectedIndex,
            prevCornerIsConvex: seg.prevCornerIsConvex,
            nextCornerIsConvex: seg.nextCornerIsConvex,
            isLocked: seg.isLocked,
            isAutoProgress: seg.isAutoProgress,
            segmentIndex: seg.segmentIndex,
            nextFaceLabel,
          };
          const unresolvedAll = allSegments.filter(x => !x.seg.isAutoProgress && !x.seg.isLocked);
          totalNum = unresolvedAll.length;
          currentNum = unresolvedAll.findIndex(
            x => x.floor === cur.floor
              && x.edgeIndex === cur.edgeIndex
              && x.seg.segmentIndex === seg.segmentIndex,
          ) + 1;
          if (curArrIdx > 0) {
            prevStartDistMm = allSegments[curArrIdx - 1].seg.startDistanceMm;
          }
        } else {
          // 単一階: 既存ロジック (sequentialResult2F / sequentialResult1F から取得)
          const activeSeqResult = activeEdge.floor === 2 ? sequentialResult2F : sequentialResult1F;
          if (!activeSeqResult) return null;
          const er = activeSeqResult.edgeResults.find(er => er.edge.index === activeEdge.index);
          if (!er) return null;
          // 単一階用 nextFaceLabel: 物理 next edge の label を使う (旧ロジック踏襲)
          // Phase H-3d-4: 単一階モードでは edges がそのフロア (1F or 2F) のものなので
          // ternary 不要。 edges1FAll は bothmode 専用の dead path だったため副次バグ
          // (単一階 1F で nextFaceLabel='?' 表示) も併せて解消。
          const previewEdgesForNext = edges;
          const nPnext = previewEdgesForNext.length;
          const nextEdgeForLabel = nPnext > 0
            ? previewEdgesForNext[(er.edge.index + 1) % nPnext]
            : undefined;
          // Phase H-3d-6: er.edge は計算層由来で生 label のため、 表示用に relabel 済 label を埋める。
          // bothmode の synthEdge と対称な処理。
          const relabeledSelf = edges.find(e => e.index === er.edge.index);
          activeItem = {
            edge: relabeledSelf ? { ...er.edge, label: relabeledSelf.label } : er.edge,
            startDistanceMm: er.startDistanceMm,
            desiredEndDistanceMm: er.desiredEndDistanceMm,
            candidates: er.candidates,
            selectedIndex: er.selectedIndex,
            prevCornerIsConvex: er.prevCornerIsConvex,
            nextCornerIsConvex: er.nextCornerIsConvex,
            isLocked: er.isLocked,
            isAutoProgress: er.isAutoProgress,
            segmentIndex: 0,
            nextFaceLabel: nextEdgeForLabel?.label ?? '?',
          };
          // Phase I-3-fix: 進捗は cascade 順 (起点辺・閉じ辺も含む、autoProgress のみスキップ)
          const unresolved2F = (cascadeOrdered2F ?? []).filter(er => !er.isAutoProgress);
          const unresolved1F = (cascadeOrdered1F ?? []).filter(er => !er.isAutoProgress);
          totalNum = unresolved2F.length + unresolved1F.length;
          currentNum = activeEdge.floor === 2
            ? unresolved2F.findIndex(er => er.edge.index === activeEdge.index) + 1
            : unresolved2F.length + unresolved1F.findIndex(er => er.edge.index === activeEdge.index) + 1;
          // 物理 prev の startDist を取得 (単一階の旧ロジック)
          // Phase H-3d-4: 単一階モードでは edges がそのフロアのもの。 ternary 不要。
          const previewEdgesForPrev = edges;
          const nP = previewEdgesForPrev.length;
          if (nP > 0) {
            const prevPhysIdx = (er.edge.index - 1 + nP) % nP;
            const prevER = activeSeqResult.edgeResults.find(e => e.edge.index === prevPhysIdx);
            if (prevER) prevStartDistMm = prevER.startDistanceMm;
          }
        }
        if (!activeItem) return null;
        const activeEdgeResult = activeItem; // 既存コードへの互換エイリアス (以降の参照は activeItem ベース)

        // プレビュー用: 1F の場合は normalizedBuilding1F の points / edges を使用
        const previewBuilding = activeEdge.floor === 2 ? building : normalizedBuilding1F;

        // Phase H-3d-3 修正B: bothmode の modal preview は top-level と同じく
        // 主=2F / sub=1F 固定で表示 (= 設定画面のプレビューと整合)。
        // activeEdge.floor で focus 対象を切り替えるが、 主従構成は不変。
        const useBothmodePreview = targetFloor === 'both' && !!normalizedBuilding2F && !!normalizedBuilding1F;

        // Phase H-3d-4: 案 β。 単一階モードでも modal preview にラベル表示するため
        // edges に統一。 bothmode + activeEdge.floor === 2 のときのみ edges2FAll
        // (= split された 5 edges) を使う。
        // bothmode + activeEdge.floor === 1 のときは下流で mainEdges = edges2FAll に
        // 上書きされるため、 ここでの値は無関係。
        const previewEdges = useBothmodePreview && activeEdge.floor === 2
          ? edges2FAll
          : edges;

        const mainPoints = useBothmodePreview ? normalizedBuilding2F!.points : previewBuilding?.points;
        const mainEdges = useBothmodePreview ? edges2FAll : previewEdges;
        const mainFocusedIdx = useBothmodePreview
          ? (activeEdge.floor === 2 ? activeEdge.index : null)
          : activeEdge.index;
        const mainBlinkIdx = useBothmodePreview
          ? (activeEdge.floor === 2 ? activeEdge.index : undefined)
          : activeEdge.index;
        const subFocusedIdx = useBothmodePreview && activeEdge.floor === 1
          ? activeEdge.index : null;

        // Phase K-2-fix: floorLabel は targetFloor を見て判定
        // (activeEdge.floor は内部規約値。主要建物は常に 2 だが、
        //  表示は targetFloor=1 (1F のみ) でも '1F' にする必要がある)
        const floorLabel = activeEdge.floor === 1
          ? '1F 下屋辺'
          : (targetFloor === 1 ? '1F' : '2F');

        return (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto z-10">
              {/* ヘッダー */}
              <div className="px-4 py-3 border-b border-dark-border">
                <p className="font-bold text-sm">足場の繋ぎ方を選んでください（{floorLabel}）</p>
                <p className="text-xs text-dimension mt-0.5">未解決 {currentNum} / {totalNum} 面</p>
              </div>

              {/* プレビュー */}
              {/* Phase H-3d-3 修正B: bothmode は top-level と同じく主=2F + sub=1F (下屋) を表示 */}
              {mainPoints && (
                <div className="px-4 pt-3">
                  <PreviewSVG
                    points={mainPoints}
                    edges={mainEdges}
                    focusedIndex={mainFocusedIdx}
                    blinkEdgeIndex={mainBlinkIdx}
                    subPoints={useBothmodePreview ? normalizedBuilding1F!.points : undefined}
                    subEdges={useBothmodePreview ? subEdgesRelabeled : undefined}
                    subHighlightIndices={useBothmodePreview ? uncoveredIdxSet1F : undefined}
                    focusedSubIndex={subFocusedIdx}
                    scaffoldStart={activeEdge.floor === 2 ? normalizedScaffoldStart : undefined}
                    showFloorPrefix={useBothmodePreview}
                  />
                </div>
              )}

              {/* 該当辺の情報 */}
              <div className="mx-4 mt-2 px-3 py-2 rounded-xl bg-dark-bg border border-dark-border">
                <div className="text-sm font-bold">
                  📍 {floorLabel} {activeEdgeResult.edge.label}面（{FACE_LABEL[activeEdgeResult.edge.face]} / {activeEdgeResult.edge.lengthMm}mm）
                </div>
                <div className="text-[11px] text-dimension mt-1">
                  {/* Phase K-2-fix2: 「{currentFaceLabel}面の離れ ◯◯mm（...）」 */}
                  {activeEdgeResult.edge.label}面の離れ <span className="font-mono text-canvas">{activeEdgeResult.startDistanceMm}mm</span>
                  <span className="ml-1">
                    {(() => {
                      // 起点辺/閉じ辺判定: 2F のみ scaffoldStart 利用、1F は scaffoldStart=undefined
                      if (activeEdge.floor !== 2 || !scaffoldStart) {
                        return '（前辺の終端から継承されています）';
                      }
                      const nP = previewEdges.length;
                      const sIdx = (scaffoldStart.startVertexIndex ?? 0) % nP;
                      const cIdx = (sIdx - 1 + nP) % nP;
                      if (activeEdgeResult.edge.index === sIdx) return '（足場開始で固定されています）';
                      if (activeEdgeResult.edge.index === cIdx) return '（足場開始で固定されています - 閉じ辺）';
                      return '（前辺の終端から継承されています）';
                    })()}
                  </span>
                </div>
              </div>

              {/* Phase K-2-fix: 警告ボックス常時表示。
                  モーダルが立ち上がる時点で「希望離れが達成不可能」が確定しているため、
                  ロック辺/非ロック辺問わず警告色で表示する。
                  Phase H-3d-2 ラベル衝突対応: nextFaceLabel は activeItem.nextFaceLabel
                  (= desiredEndSource/endConstraint から正しく決定された 1F or 2F のラベル) を使用。 */}
              {(() => {
                return (
                  <div className="mx-4 mt-2 px-3 py-2 rounded-xl bg-yellow-500/5 border border-yellow-500/50">
                    <div className="text-sm font-bold text-yellow-400 flex items-center gap-1">
                      <span>⚠️</span>
                      <span>
                        {activeItem.nextFaceLabel}面を希望の離れ <span className="font-mono">{activeEdgeResult.desiredEndDistanceMm}mm</span> にすることは不可能です
                      </span>
                    </div>
                    <div className="text-[11px] text-yellow-300/80 mt-0.5">
                      以下から選択してください
                    </div>
                  </div>
                );
              })()}

              {/* Phase I-3: 候補ヘッダー + 候補カード + 操作ボタン */}
              {(() => {
                // Phase H-3d-2 Stage 5 残対応 Step 1: bothmode 時は bothmodeAdjustments を見る
                let activeAdj: EdgeAdjustment = DEFAULT_EDGE_ADJUSTMENT;
                if (targetFloor === 'both' && (bothmodeResult2F || bothmodeResult1F)) {
                  const adjs = activeEdge.floor === 2 ? bothmodeAdjustments2F : bothmodeAdjustments1F;
                  const key = `${activeEdge.index}-${activeItem.segmentIndex}`;
                  activeAdj = adjs[key] ?? DEFAULT_EDGE_ADJUSTMENT;
                } else {
                  const activeAdjustments = activeEdge.floor === 2 ? userAdjustments2F : userAdjustments1F;
                  activeAdj = activeAdjustments[activeEdge.index] ?? DEFAULT_EDGE_ADJUSTMENT;
                }
                const nPreview = previewEdges.length;
                const nextEdge = previewEdges[(activeEdgeResult.edge.index + 1) % nPreview];
                // Phase I-3-fix: 閉じ辺判定 (2F のみ、scaffoldStart 必須)
                const sIdx = activeEdge.floor === 2 && scaffoldStart
                  ? (scaffoldStart.startVertexIndex ?? 0) % nPreview
                  : 0;
                const closeIdx = (sIdx - 1 + nPreview) % nPreview;
                const isCloseCorner = activeEdge.floor === 2 && !!scaffoldStart
                  && activeEdgeResult.edge.index === closeIdx;
                // 物理 prev の startDist (bothmode は cascade 配列の前要素、単一階は前 edge)
                const prevStartForProbe = prevStartDistMm ?? (activeEdgeResult.startDistanceMm ?? 900);

                // 「→」枯れ判定: 該当 side で offsetIdx+1 の候補が存在するか probe
                const canAdvanceOffset = (side: 'larger' | 'smaller'): boolean => {
                  const probeAdj = {
                    larger: side === 'larger'
                      ? { offsetIdx: activeAdj.larger.offsetIdx + 1, variationIdx: 0 }
                      : { offsetIdx: 0, variationIdx: 0 },
                    smaller: side === 'smaller'
                      ? { offsetIdx: activeAdj.smaller.offsetIdx + 1, variationIdx: 0 }
                      : { offsetIdx: 0, variationIdx: 0 },
                  };
                  const probe = generateSequentialCandidates(
                    activeEdgeResult.edge.lengthMm,
                    activeEdgeResult.startDistanceMm,
                    activeEdgeResult.desiredEndDistanceMm,
                    activeEdgeResult.prevCornerIsConvex,
                    activeEdgeResult.nextCornerIsConvex,
                    prevStartForProbe,
                    enabledSizes,
                    priorityConfig,
                    probeAdj.larger.offsetIdx,
                    probeAdj.smaller.offsetIdx,
                    probeAdj.larger.variationIdx,
                    probeAdj.smaller.variationIdx,
                  );
                  return probe.some(c => c.side === side);
                };

                return (
                  <>
                    {/* 候補ヘッダー */}
                    <div className="px-4 pt-3 pb-1 text-xs font-bold text-canvas">
                      {activeEdgeResult.edge.label}面の割付候補
                    </div>

                    {/* 候補カードリスト */}
                    <div className="px-4 pb-4 space-y-2">
                      {activeEdgeResult.candidates.map((cand, idx) => {
                        // exact は ←/→ が無意味なので disabled。部材変更は smallerVariationIdx 流用で機能。
                        const isExact = cand.side === 'exact';
                        // ←/→ ハンドラに渡す side: exact のときは smaller (Phase I-1 仕様準拠)
                        const sideForHandler: 'larger' | 'smaller' = cand.side === 'exact' ? 'smaller' : cand.side;
                        const sideOffsetIdx = sideForHandler === 'larger'
                          ? activeAdj.larger.offsetIdx
                          : activeAdj.smaller.offsetIdx;

                        // 離れ変更←: exact / 閉じ辺 / offsetIdx===0 で disabled
                        const prevDisabled = isExact || isCloseCorner || sideOffsetIdx === 0;
                        // 離れ変更→: exact / 閉じ辺 / probe で枯れ で disabled
                        const nextDisabled = isExact || isCloseCorner || !canAdvanceOffset(sideForHandler);

                        const arrowBtnClass =
                          'px-2 py-1 text-xs rounded bg-dark-border/50 text-dimension hover:bg-dark-border hover:text-canvas disabled:opacity-30 disabled:cursor-not-allowed';

                        return (
                          <div
                            key={idx}
                            className="border border-dark-border rounded-xl bg-dark-bg overflow-hidden"
                          >
                            {/* Phase I-3-fix3: タップ可能エリアを青ストロークで明示
                                通常時は accent/40 の薄い青、hover で accent (=#378ADD) 100% に。
                                左右 margin は操作ボタン群の px-3 と揃える */}
                            <button
                              onClick={() => handleSequentialSelect(
                                activeEdge.floor,
                                activeEdge.index,
                                idx,
                                activeEdge.segmentIndex ?? activeItem.segmentIndex,
                              )}
                              className="block w-[calc(100%-1.5rem)] mx-3 mt-3 mb-2 p-3 border border-accent/40 hover:border-accent hover:bg-accent/10 rounded-lg transition-colors text-left"
                            >
                              <div className="flex flex-wrap gap-1 mb-2">
                                {cand.rails.map((r, ri) => (
                                  <span key={ri} className="px-1.5 py-0.5 bg-handrail/20 text-handrail text-[11px] font-mono rounded">
                                    {r}
                                  </span>
                                ))}
                              </div>
                              <div className="text-xs font-mono text-accent">
                                → {activeItem.nextFaceLabel}面の離れ: <span className="font-bold">{cand.actualEndDistanceMm}mm</span>
                              </div>
                            </button>
                            {/* Phase I-3-fix2: 操作ボタン
                                [←] 部材変更 [→] / [←] 離れ変更 [→]
                                各グループは ←/→ ボタン + 中央ラベル、部材変更のみ下にカウンタ */}
                            <div className="px-3 pb-3 flex flex-wrap gap-x-4 gap-y-2 items-start">
                              {/* 部材変更グループ (Phase I-5: 共通コンポーネント化) */}
                              <VariationChangeButtons
                                variationIdx={cand.variationIdx}
                                variationCount={cand.variationCount}
                                onChange={(dir) => handleVariationChange(
                                  activeEdge.floor,
                                  activeEdge.index,
                                  sideForHandler,
                                  dir,
                                  activeEdge.segmentIndex ?? activeItem.segmentIndex,
                                )}
                              />
                              {/* 離れ変更グループ */}
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleOffsetChange(
                                      activeEdge.floor,
                                      activeEdge.index,
                                      sideForHandler,
                                      'prev',
                                      activeEdge.segmentIndex ?? activeItem.segmentIndex,
                                    )}
                                    disabled={prevDisabled}
                                    className={arrowBtnClass}
                                    title="前の離れに戻る"
                                  >
                                    ←
                                  </button>
                                  <span className="text-xs text-dimension/70 px-1 select-none">離れ変更</span>
                                  <button
                                    onClick={() => handleOffsetChange(
                                      activeEdge.floor,
                                      activeEdge.index,
                                      sideForHandler,
                                      'next',
                                      activeEdge.segmentIndex ?? activeItem.segmentIndex,
                                    )}
                                    disabled={nextDisabled}
                                    className={arrowBtnClass}
                                    title="次の離れに進む"
                                  >
                                    →
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              {/* フッター */}
              <div className="px-4 py-3 border-t border-dark-border flex gap-2 justify-between">
                <button
                  onClick={handleSequentialBack}
                  disabled={currentNum <= 1}
                  className="px-3 py-2 text-xs border border-dark-border text-dimension rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← 前の辺に戻る
                </button>
                <button
                  onClick={handleSequentialCancel}
                  className="px-3 py-2 text-xs border border-dark-border text-dimension rounded-xl"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showLockedAlert && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowLockedAlert(false)} />
          <div className="relative bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <p className="font-bold text-sm mb-2">変更できません</p>
            <p className="text-xs text-dimension leading-relaxed mb-4">
              この面の離れは足場開始設定で確定された数値です。<br />
              変更する場合は「足場開始」ボタンから再設定してください。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLockedAlert(false)}
                className="flex-1 py-2.5 border border-dark-border text-dimension font-bold rounded-xl text-sm"
              >
                OK
              </button>
              <button
                onClick={() => {
                  setShowLockedAlert(false);
                  onClose();
                  onOpenScaffoldStart();
                }}
                className="flex-1 py-2.5 bg-accent text-white font-bold rounded-xl text-sm"
              >
                再設定する
              </button>
            </div>
          </div>
        </div>
      )}

      {showComingSoonModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowComingSoonModal(false)} />
          <div className="relative bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <p className="font-bold text-sm mb-2">近日実装予定</p>
            <p className="text-xs text-dimension leading-relaxed mb-4">
              1F+2F モードは近日実装予定です。<br />
              現在は 1Fのみ または 2Fのみ モードをご利用ください。
            </p>
            <button
              onClick={() => setShowComingSoonModal(false)}
              className="w-full py-2.5 bg-accent text-white font-bold rounded-xl text-sm"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
