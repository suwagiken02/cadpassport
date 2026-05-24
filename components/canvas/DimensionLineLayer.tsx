'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import { INITIAL_GRID_PX, gridToMm } from '@/lib/konva/gridUtils';
import { getEdgeOverhangs, computeOffsetPolygon } from '@/lib/konva/roofUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';
import { DEFAULT_DIMENSION_OFFSETS_MM } from '@/types';
import type { BuildingShape, DimensionLineKey, DimensionOffsetsMm, Handrail, Point } from '@/types';

// ============================================================
// Phase J-2: 建物寸法線リニューアル
// 業界標準 (JIS A 0150 / JIS Z 8317) 準拠の 2 段寸法線。
//
// 寸法線移動 (= 本 task): 種別ごとの mm offset を canvasData に保存。
// default 0 = 既存 hardcoded px 挙動完全維持、 ドラッグで法線方向のみ調整可。
// 同 (floor, category) の 4 face は単一キーで連動。
// ============================================================

const COLOR_1F = '#444';
const COLOR_2F = '#378ADD';
const DRAG_COLOR = '#f59e0b'; // ドラッグ中ハイライト (= amber、 ★4 確定)
const BG_FILL = '#ffffff';
const BG_OPACITY = 0.92;
const LW = 1;
const TICK_LEN = 6;
const FONT_BASE = 16;
const PAD_X = 3;
const PAD_Y = 2;
const HIT_WIDTH = 20; // 透明ヒット領域 (= ★4 確定)
const PX_TO_MM = 10 / INITIAL_GRID_PX; // 10/3 ≈ 3.33 mm/px (zoom 非依存)

// 軸オフセット (= 紙上 mm 単位、 zoom 連動で px 換算、 PDF 印刷範囲内保証)
const OFF_SCAFFOLD_SOLO_MM = 150;   // ≒ 30 px @ zoom=1 既存互換
const OFF_WALL_SOLO_MM = 300;       // ≒ 60 px @ zoom=1
const OFF_ROOF_SOLO_MM = 550;       // ≒ 110 px @ zoom=1

const OFF_SCAFFOLD_2F_BOTH_MM = 100;   // ≒ 20 px @ zoom=1
const OFF_SCAFFOLD_1F_BOTH_MM = 175;   // ≒ 35 px @ zoom=1
const OFF_WALL_2F_BOTH_MM = 350;       // ≒ 70 px @ zoom=1
const OFF_ROOF_2F_BOTH_MM = 600;       // ≒ 120 px @ zoom=1
const OFF_WALL_1F_BOTH_MM = 900;       // ≒ 180 px @ zoom=1
const OFF_ROOF_1F_BOTH_MM = 1200;      // ≒ 240 px @ zoom=1

type Face = 'north' | 'south' | 'east' | 'west';
type BB = { minX: number; minY: number; maxX: number; maxY: number };
type Span = { s: number; e: number; mm: number };

/** 透明 hit Line 用、 ドラッグ開始情報のレンダー時メタデータ */
type DragInfo = {
  key: DimensionLineKey;
  face: Face;
  isH: boolean;
  axis: number;
  lineStart: number;
  lineEnd: number;
};

const bb0 = (): BB => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const bbG = (b: BB, x: number, y: number): BB => ({
  minX: Math.min(b.minX, x), minY: Math.min(b.minY, y),
  maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y),
});
const bbOk = (b: BB) => b.minX < b.maxX && b.minY < b.maxY;

/* ===== ラベル描画 (白背景 + 指定色文字) ===== */
function renderLabel(
  cx: number, cy: number, text: string, fs: number, k: string, color: string,
): React.ReactElement[] {
  const w = text.length * fs * 0.6 + PAD_X * 2;
  const h = fs + PAD_Y * 2;
  return [
    <Rect key={`${k}B`} x={cx - w / 2} y={cy - h / 2}
      width={w} height={h} fill={BG_FILL} opacity={BG_OPACITY}
      cornerRadius={2} listening={false} />,
    <Text key={`${k}T`} x={cx - w / 2 + PAD_X} y={cy - fs / 2}
      text={text} fontSize={fs} fontFamily="monospace"
      fill={color} listening={false} />,
  ];
}

/* ===== 1 本の寸法線 (主線 + 目盛り + 各 span ラベル + 合計ラベル) ===== */
function renderDimLine(
  k: string, isH: boolean, axis: number,
  innerDir: number,
  spans: Span[],
  showInner: boolean,
  totalMm: number,
  fs: number,
  color: string,
): React.ReactElement[] {
  if (!spans.length) return [];
  const els: React.ReactElement[] = [];
  const lineS = spans[0].s;
  const lineE = spans[spans.length - 1].e;

  els.push(
    <Line key={`${k}L`}
      points={isH ? [lineS, axis, lineE, axis] : [axis, lineS, axis, lineE]}
      stroke={color} strokeWidth={LW} listening={false} />,
  );

  const tickSet = new Set<number>();
  tickSet.add(lineS); tickSet.add(lineE);
  if (showInner) {
    for (const sp of spans) { tickSet.add(sp.s); tickSet.add(sp.e); }
  }
  let ti = 0;
  for (const px of Array.from(tickSet)) {
    els.push(
      <Line key={`${k}t${ti++}`}
        points={isH
          ? [px, axis, px, axis + innerDir * TICK_LEN]
          : [axis, px, axis + innerDir * TICK_LEN, px]}
        stroke={color} strokeWidth={LW} listening={false} />,
    );
  }

  if (showInner) {
    spans.forEach((sp, i) => {
      if (sp.mm <= 0) return;
      const mid = (sp.s + sp.e) / 2;
      const off = innerDir * (TICK_LEN + fs / 2 + 4);
      els.push(...renderLabel(
        isH ? mid : axis + off,
        isH ? axis + off : mid,
        `${sp.mm}`, fs, `${k}i${i}`, color,
      ));
    });
  }

  const mid = (lineS + lineE) / 2;
  const outerOff = -innerDir * (TICK_LEN + fs / 2 + 4);
  els.push(...renderLabel(
    isH ? mid : axis + outerOff,
    isH ? axis + outerOff : mid,
    `${totalMm}`, fs, `${k}O`, color,
  ));

  return els;
}

/* ===== 屋根の出幅区間 (各辺ごとに差分) ===== */
function getOverhangRangesPerEdge(
  buildingPts: Point[],
  overhangs: number[],
  targetFace: Face,
): { from: number; to: number }[] {
  const n = buildingPts.length;
  if (n < 3) return [];
  const roofPoly = computeOffsetPolygon(buildingPts, overhangs);

  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += buildingPts[i].x * buildingPts[j].y - buildingPts[j].x * buildingPts[i].y;
  }
  const ws = area2 > 0 ? 1 : -1;

  const result: { from: number; to: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = buildingPts[i];
    const p2 = buildingPts[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const nx = ws * dy;
    const ny = -ws * dx;
    let face: Face;
    if (Math.abs(ny) >= Math.abs(nx)) face = ny < 0 ? 'north' : 'south';
    else face = nx > 0 ? 'east' : 'west';
    if (face !== targetFace) continue;

    const rp1 = roofPoly[i];
    const rp2 = roofPoly[(i + 1) % n];
    const isH = face === 'north' || face === 'south';
    const bodyFrom = isH ? Math.min(p1.x, p2.x) : Math.min(p1.y, p2.y);
    const bodyTo = isH ? Math.max(p1.x, p2.x) : Math.max(p1.y, p2.y);
    const roofFrom = isH ? Math.min(rp1.x, rp2.x) : Math.min(rp1.y, rp2.y);
    const roofTo = isH ? Math.max(rp1.x, rp2.x) : Math.max(rp1.y, rp2.y);

    if (roofFrom < bodyFrom) result.push({ from: roofFrom, to: bodyFrom });
    if (roofTo > bodyTo) result.push({ from: bodyTo, to: roofTo });
  }
  result.sort((a, b) => a.from - b.from);
  return result;
}

/* ===== 屋根の出幅寸法線 ===== */
function renderOverhangLine(
  k: string, isH: boolean, axis: number,
  innerDir: number,
  spans: Span[],
  lineStart: number,
  lineEnd: number,
  totalMm: number,
  fs: number,
  color: string,
): React.ReactElement[] {
  if (!spans.length) return [];
  const els: React.ReactElement[] = [];

  els.push(
    <Line key={`${k}L`}
      points={isH ? [lineStart, axis, lineEnd, axis] : [axis, lineStart, axis, lineEnd]}
      stroke={color} strokeWidth={LW} listening={false} />,
  );

  const tickSet = new Set<number>();
  tickSet.add(lineStart); tickSet.add(lineEnd);
  for (const sp of spans) { tickSet.add(sp.s); tickSet.add(sp.e); }
  let ti = 0;
  for (const px of Array.from(tickSet)) {
    els.push(
      <Line key={`${k}t${ti++}`}
        points={isH
          ? [px, axis, px, axis + innerDir * TICK_LEN]
          : [axis, px, axis + innerDir * TICK_LEN, px]}
        stroke={color} strokeWidth={LW} listening={false} />,
    );
  }

  spans.forEach((sp, i) => {
    if (sp.mm <= 0) return;
    const mid = (sp.s + sp.e) / 2;
    const off = innerDir * (TICK_LEN + fs / 2 + 4);
    els.push(...renderLabel(
      isH ? mid : axis + off,
      isH ? axis + off : mid,
      `${sp.mm}`, fs, `${k}i${i}`, color,
    ));
  });

  const mid = (lineStart + lineEnd) / 2;
  const outerOff = -innerDir * (TICK_LEN + fs / 2 + 4);
  els.push(...renderLabel(
    isH ? mid : axis + outerOff,
    isH ? axis + outerOff : mid,
    `${totalMm}`, fs, `${k}O`, color,
  ));

  return els;
}

/* ===== ポリゴンから方位別 face 辺を抽出 ===== */
function getFaceEdges(pts: Point[]): Record<Face, { from: number; to: number }[]> {
  const result: Record<Face, { from: number; to: number }[]> = {
    north: [], south: [], east: [], west: [],
  };
  if (pts.length < 3) return result;

  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area2 += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const ws = area2 > 0 ? 1 : -1;

  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const nx = ws * dy;
    const ny = -ws * dx;
    let face: Face;
    if (Math.abs(ny) >= Math.abs(nx)) face = ny < 0 ? 'north' : 'south';
    else face = nx > 0 ? 'east' : 'west';

    if (face === 'north' || face === 'south') {
      const from = Math.min(p1.x, p2.x);
      const to = Math.max(p1.x, p2.x);
      if (to > from) result[face].push({ from, to });
    } else {
      const from = Math.min(p1.y, p2.y);
      const to = Math.max(p1.y, p2.y);
      if (to > from) result[face].push({ from, to });
    }
  }

  for (const f of ['north', 'south', 'east', 'west'] as Face[]) {
    result[f].sort((a, b) => a.from - b.from);
  }
  return result;
}

/* ===== 足場線用: 該当 floor の手摺を方位別に分類 ===== */
function getFloorScaffoldEdges(
  handrails: Handrail[],
): { byFace: Record<Face, { from: number; to: number }[]>; bb: BB } {
  const byFace: Record<Face, { from: number; to: number }[]> = {
    north: [], south: [], east: [], west: [],
  };
  let bb = bb0();
  if (handrails.length === 0) return { byFace, bb };

  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    bb = bbG(bb, p1.x, p1.y);
    bb = bbG(bb, p2.x, p2.y);
  }
  if (!bbOk(bb)) return { byFace, bb };

  const TOL = 0.01;
  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    if (Math.abs(p1.y - bb.minY) < TOL && Math.abs(p2.y - bb.minY) < TOL) {
      const from = Math.min(p1.x, p2.x);
      const to = Math.max(p1.x, p2.x);
      if (to > from) byFace.north.push({ from, to });
    }
    if (Math.abs(p1.y - bb.maxY) < TOL && Math.abs(p2.y - bb.maxY) < TOL) {
      const from = Math.min(p1.x, p2.x);
      const to = Math.max(p1.x, p2.x);
      if (to > from) byFace.south.push({ from, to });
    }
    if (Math.abs(p1.x - bb.minX) < TOL && Math.abs(p2.x - bb.minX) < TOL) {
      const from = Math.min(p1.y, p2.y);
      const to = Math.max(p1.y, p2.y);
      if (to > from) byFace.west.push({ from, to });
    }
    if (Math.abs(p1.x - bb.maxX) < TOL && Math.abs(p2.x - bb.maxX) < TOL) {
      const from = Math.min(p1.y, p2.y);
      const to = Math.max(p1.y, p2.y);
      if (to > from) byFace.east.push({ from, to });
    }
  }
  for (const f of ['north', 'south', 'east', 'west'] as Face[]) {
    byFace[f].sort((a, b) => a.from - b.from);
  }
  return { byFace, bb };
}

/* ===== 全 floor + 屋根輪郭 + 手摺の合算 BBox ===== */
function getOverallBB(buildings: BuildingShape[], handrails: Handrail[]): BB {
  let bb = bb0();
  for (const b of buildings) {
    for (const p of b.points) bb = bbG(bb, p.x, p.y);
    if (b.roof && b.roof.roofType !== 'none') {
      const ohs = getEdgeOverhangs(b, b.roof);
      const roofPts = computeOffsetPolygon(b.points, ohs);
      for (const p of roofPts) bb = bbG(bb, p.x, p.y);
    }
  }
  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    bb = bbG(bb, p1.x, p1.y);
    bb = bbG(bb, p2.x, p2.y);
  }
  return bb;
}

/* ================================================================
   メインコンポーネント
   ================================================================ */
export default function DimensionLineLayer({ visible = true }: { visible?: boolean }) {
  const { canvasData, zoom, panX, panY } = useCanvasStore();
  const setDimensionOffsetMm = useCanvasStore(s => s.setDimensionOffsetMm);
  const dimensionVisibility = useHandrailSettingsStore(s => s.dimensionVisibility);
  const gridPx = INITIAL_GRID_PX * zoom;

  // 寸法線移動 (= 保存済 offset + ドラッグ中 preview、 ★2/★5 確定)
  const storedOffsets: DimensionOffsetsMm = canvasData.dimensionOffsetsMm ?? DEFAULT_DIMENSION_OFFSETS_MM;
  const [previewMm, setPreviewMm] = useState<{ key: DimensionLineKey; mm: number } | null>(null);

  const layerRef = useRef<Konva.Layer>(null);
  const draggingRef = useRef<{
    key: DimensionLineKey;
    face: Face;
    startPointer: { x: number; y: number };
    startMm: number;
  } | null>(null);
  const previewMmRef = useRef<{ key: DimensionLineKey; mm: number } | null>(null);
  useEffect(() => { previewMmRef.current = previewMm; }, [previewMm]);

  // Stage pointer 監視 (= ドラッグ追跡、 HeightMarkerLayer と同パターン)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const stage = layer.getStage();
    if (!stage) return;

    const onMove = () => {
      if (!draggingRef.current) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const { key, face, startPointer, startMm } = draggingRef.current;
      const isH = face === 'north' || face === 'south';
      const sign = (face === 'north' || face === 'west') ? -1 : 1;
      // 法線方向のみ反映: north/south = Y、 east/west = X、 接線方向の動きは無視
      const pixelDelta = isH ? (pointer.y - startPointer.y) : (pointer.x - startPointer.x);
      // sign で「外向き = mm 増加」に正規化
      const mmDelta = sign * pixelDelta * PX_TO_MM;
      setPreviewMm({ key, mm: Math.round(startMm + mmDelta) });
    };
    const onUp = () => {
      if (draggingRef.current && previewMmRef.current) {
        setDimensionOffsetMm(previewMmRef.current.key, previewMmRef.current.mm);
      }
      draggingRef.current = null;
      setPreviewMm(null);
    };

    stage.on('pointermove.dimensiondrag', onMove);
    stage.on('pointerup.dimensiondrag', onUp);
    return () => {
      stage.off('pointermove.dimensiondrag');
      stage.off('pointerup.dimensiondrag');
    };
  }, [canvasData, zoom, panX, panY, setDimensionOffsetMm]);

  // Effective offsets (= stored + drag preview)
  const effectiveOffsetMm: DimensionOffsetsMm = useMemo(() => {
    if (!previewMm) return storedOffsets;
    return { ...storedOffsets, [previewMm.key]: previewMm.mm };
  }, [storedOffsets, previewMm]);

  // Mm → Px 変換 (zoom 非依存、 既存 hardcoded px 同スケール)
  const mmDeltaToPx = (mm: number) => Math.round(mm * INITIAL_GRID_PX / 10);

  const { elements, dragInfos } = useMemo(() => {
    if (!visible || !canvasData.buildings.length) {
      return { elements: [] as React.ReactElement[], dragInfos: [] as DragInfo[] };
    }

    const fs = FONT_BASE * zoom;  // pure proportional (= 建物との比一定)
    const els: React.ReactElement[] = [];
    const infos: DragInfo[] = [];
    const gx = (g: number) => g * gridPx + panX;
    const gy = (g: number) => g * gridPx + panY;

    const overallBB = getOverallBB(canvasData.buildings, canvasData.handrails);
    if (!bbOk(overallBB)) return { elements: els, dragInfos: infos };

    const has1FBuilding = canvasData.buildings.some(b => (b.floor ?? 1) === 1);
    const has2FBuilding = canvasData.buildings.some(b => b.floor === 2);
    const isBothmode = has1FBuilding && has2FBuilding;

    // mm → px 換算 (= mm * gridPx / 10、 INITIAL_GRID_PX=20 で 1 grid=10mm)
    const mmToPx = (mm: number) => mm * gridPx / 10;
    const offsetsBase = isBothmode
      ? {
          wall1F: mmToPx(OFF_WALL_1F_BOTH_MM), roof1F: mmToPx(OFF_ROOF_1F_BOTH_MM),
          wall2F: mmToPx(OFF_WALL_2F_BOTH_MM), roof2F: mmToPx(OFF_ROOF_2F_BOTH_MM),
          scaffold1F: mmToPx(OFF_SCAFFOLD_1F_BOTH_MM), scaffold2F: mmToPx(OFF_SCAFFOLD_2F_BOTH_MM),
        }
      : {
          wall1F: mmToPx(OFF_WALL_SOLO_MM), roof1F: mmToPx(OFF_ROOF_SOLO_MM),
          wall2F: mmToPx(OFF_WALL_SOLO_MM), roof2F: mmToPx(OFF_ROOF_SOLO_MM),
          scaffold1F: mmToPx(OFF_SCAFFOLD_SOLO_MM), scaffold2F: mmToPx(OFF_SCAFFOLD_SOLO_MM),
        };

    // ★5 相対 mm delta: base px + mmDelta * 0.3 (zoom 非依存) で px 換算
    const offsets = {
      wall1F: offsetsBase.wall1F + mmDeltaToPx(effectiveOffsetMm.wall1F),
      roof1F: offsetsBase.roof1F + mmDeltaToPx(effectiveOffsetMm.roof1F),
      wall2F: offsetsBase.wall2F + mmDeltaToPx(effectiveOffsetMm.wall2F),
      roof2F: offsetsBase.roof2F + mmDeltaToPx(effectiveOffsetMm.roof2F),
      scaffold1F: offsetsBase.scaffold1F + mmDeltaToPx(effectiveOffsetMm.scaffold1F),
      scaffold2F: offsetsBase.scaffold2F + mmDeltaToPx(effectiveOffsetMm.scaffold2F),
    };

    const floors: Array<{
      floor: 1 | 2; offWall: number; offRoof: number; offScaffold: number; color: string;
      scaffoldKey: DimensionLineKey; wallKey: DimensionLineKey; roofKey: DimensionLineKey;
    }> = [
      { floor: 1, offWall: offsets.wall1F, offRoof: offsets.roof1F, offScaffold: offsets.scaffold1F,
        color: COLOR_1F, scaffoldKey: 'scaffold1F', wallKey: 'wall1F', roofKey: 'roof1F' },
      { floor: 2, offWall: offsets.wall2F, offRoof: offsets.roof2F, offScaffold: offsets.scaffold2F,
        color: COLOR_2F, scaffoldKey: 'scaffold2F', wallKey: 'wall2F', roofKey: 'roof2F' },
    ];

    for (const { floor, offWall, offRoof, offScaffold, color, scaffoldKey, wallKey, roofKey } of floors) {
      const floorBuildings = canvasData.buildings.filter(b => (b.floor ?? 1) === floor);
      if (floorBuildings.length === 0) continue;
      const floorHandrails = canvasData.handrails.filter(h => (h.floor ?? 1) === floor);

      const wallEdges: Record<Face, { from: number; to: number }[]> = {
        north: [], south: [], east: [], west: [],
      };
      const roofEdges: Record<Face, { from: number; to: number }[]> = {
        north: [], south: [], east: [], west: [],
      };
      const overhangEdges: Record<Face, { from: number; to: number }[]> = {
        north: [], south: [], east: [], west: [],
      };

      for (const b of floorBuildings) {
        const bodyEdges = getFaceEdges(b.points);
        for (const f of ['north', 'south', 'east', 'west'] as Face[]) {
          wallEdges[f].push(...bodyEdges[f]);
        }
        if (b.roof && b.roof.roofType !== 'none') {
          const ohs = getEdgeOverhangs(b, b.roof);
          const roofPts = computeOffsetPolygon(b.points, ohs);
          const rEdges = getFaceEdges(roofPts);
          for (const f of ['north', 'south', 'east', 'west'] as Face[]) {
            roofEdges[f].push(...rEdges[f]);
            overhangEdges[f].push(...getOverhangRangesPerEdge(b.points, ohs, f));
          }
        }
      }

      for (const f of ['north', 'south', 'east', 'west'] as Face[]) {
        wallEdges[f].sort((a, b) => a.from - b.from);
        roofEdges[f].sort((a, b) => a.from - b.from);
        overhangEdges[f].sort((a, b) => a.from - b.from);
      }

      const scaffoldData = getFloorScaffoldEdges(floorHandrails);

      for (const face of ['north', 'south', 'east', 'west'] as Face[]) {
        const isH = face === 'north' || face === 'south';
        const sign = (face === 'north' || face === 'west') ? -1 : 1;
        const innerDir = -sign;

        const refGrid = isH
          ? (face === 'north' ? overallBB.minY : overallBB.maxY)
          : (face === 'west' ? overallBB.minX : overallBB.maxX);
        const refPx = isH ? gy(refGrid) : gx(refGrid);

        // 段 (足場)
        const scaffoldVisKey = floor === 1 ? 'scaffold1F' : 'scaffold2F';
        const scfEdges = scaffoldData.byFace[face];
        if (dimensionVisibility[scaffoldVisKey] && scfEdges.length > 0) {
          const axisScaffold = refPx + sign * offScaffold;
          const spans: Span[] = scfEdges.map(e => ({
            s: isH ? gx(e.from) : gy(e.from),
            e: isH ? gx(e.to) : gy(e.to),
            mm: Math.round(gridToMm(e.to - e.from)),
          }));
          const total = spans.reduce((sum, sp) => sum + sp.mm, 0);
          const lineColor = previewMm?.key === scaffoldKey ? DRAG_COLOR : color;
          els.push(...renderDimLine(
            `D${floor}S${face}`, isH, axisScaffold, innerDir, spans,
            spans.length > 1, total, fs, lineColor,
          ));
          infos.push({
            key: scaffoldKey, face, isH, axis: axisScaffold,
            lineStart: spans[0].s, lineEnd: spans[spans.length - 1].e,
          });
        }

        // 段 (外壁)
        const wallVisKey = floor === 1 ? 'wall1F' : 'wall2F';
        const wEdges = wallEdges[face];
        if (dimensionVisibility[wallVisKey] && wEdges.length > 0) {
          const axisWall = refPx + sign * offWall;
          const spans: Span[] = wEdges.map(e => ({
            s: isH ? gx(e.from) : gy(e.from),
            e: isH ? gx(e.to) : gy(e.to),
            mm: Math.round(gridToMm(e.to - e.from)),
          }));
          const total = spans.reduce((sum, sp) => sum + sp.mm, 0);
          const lineColor = previewMm?.key === wallKey ? DRAG_COLOR : color;
          els.push(...renderDimLine(
            `D${floor}I${face}`, isH, axisWall, innerDir, spans,
            spans.length > 1, total, fs, lineColor,
          ));
          infos.push({
            key: wallKey, face, isH, axis: axisWall,
            lineStart: spans[0].s, lineEnd: spans[spans.length - 1].e,
          });
        }

        // 外側 (屋根の出幅)
        const roofVisKey = floor === 1 ? 'roof1F' : 'roof2F';
        const rEdges = roofEdges[face];
        const ovEdges = overhangEdges[face];
        if (dimensionVisibility[roofVisKey] && rEdges.length > 0 && ovEdges.length > 0) {
          const axisOuter = refPx + sign * offRoof;
          const lineStartGrid = Math.min(...rEdges.map(r => r.from));
          const lineEndGrid = Math.max(...rEdges.map(r => r.to));
          const lineStartPx = isH ? gx(lineStartGrid) : gy(lineStartGrid);
          const lineEndPx = isH ? gx(lineEndGrid) : gy(lineEndGrid);
          const totalMm = Math.round(gridToMm(lineEndGrid - lineStartGrid));
          const overhangSpans: Span[] = ovEdges.map(o => ({
            s: isH ? gx(o.from) : gy(o.from),
            e: isH ? gx(o.to) : gy(o.to),
            mm: Math.round(gridToMm(o.to - o.from)),
          }));
          const lineColor = previewMm?.key === roofKey ? DRAG_COLOR : color;
          els.push(...renderOverhangLine(
            `D${floor}O${face}`, isH, axisOuter, innerDir,
            overhangSpans, lineStartPx, lineEndPx, totalMm, fs, lineColor,
          ));
          infos.push({
            key: roofKey, face, isH, axis: axisOuter,
            lineStart: lineStartPx, lineEnd: lineEndPx,
          });
        }
      }
    }

    return { elements: els, dragInfos: infos };
  }, [canvasData, zoom, panX, panY, gridPx, visible, dimensionVisibility, effectiveOffsetMm, previewMm]);

  // 透明 hit Line の mousedown / touchstart: ドラッグ開始
  const onHitDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, info: DragInfo) => {
    e.cancelBubble = true;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    draggingRef.current = {
      key: info.key,
      face: info.face,
      startPointer: { x: pointer.x, y: pointer.y },
      startMm: storedOffsets[info.key],
    };
  };

  return (
    <Layer ref={layerRef} listening={visible}>
      {visible && elements.length > 0 && (
        <>
          {elements}
          {dragInfos.map((info) => (
            <Line
              key={`hit-${info.key}-${info.face}`}
              points={info.isH
                ? [info.lineStart, info.axis, info.lineEnd, info.axis]
                : [info.axis, info.lineStart, info.axis, info.lineEnd]}
              stroke="transparent"
              strokeWidth={1}
              hitStrokeWidth={HIT_WIDTH}
              listening={true}
              onMouseDown={(e) => onHitDown(e, info)}
              onTouchStart={(e) => onHitDown(e, info)}
            />
          ))}
        </>
      )}
    </Layer>
  );
}
