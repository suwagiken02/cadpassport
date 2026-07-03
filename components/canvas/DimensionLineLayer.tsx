'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import { INITIAL_GRID_PX, gridToMm } from '@/lib/konva/gridUtils';
import { getEdgeOverhangs, computeOffsetPolygon } from '@/lib/konva/roofUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';
import {
  buildFloorDimDescriptors,
  getPresentFloors,
  readDimVisibility,
} from '@/lib/konva/dimensionLineFloors';
import { DEFAULT_DIMENSION_OFFSETS_MM } from '@/types';
import type { BuildingShape, DimensionLineKey, DimensionOffsetsMm, Handrail, Point } from '@/types';

// ============================================================
// Phase J-2: 建物寸法線リニューアル
// 業界標準 (JIS A 0150 / JIS Z 8317) 準拠の 2 段寸法線。
//
// 寸法線移動 (= 本 task): 種別ごとの mm offset を canvasData に保存。
// default 0 = 既存 hardcoded px 挙動完全維持、 ドラッグで法線方向のみ調整可。
// 同 (floor, category) の 4 face は単一キーで連動。
//
// S-4: N 階解禁。floors/offset/色/キー/visibility を dimensionLineFloors の純関数へ委譲し
//   存在階を昇順ユニークで反復(=N 階一般化)。offset は式 base+(maxFloor−floor)·step
//   (複数階時)・単独階は SOLO 定数。N=2({1,2}) では従来リテラルと完全一致(byte 不変)。
// ============================================================

const DRAG_COLOR = '#f59e0b'; // ドラッグ中ハイライト (= amber、 ★4 確定)
const BG_FILL = '#ffffff';
const BG_OPACITY = 0.92;
const LW = 8;
const TICK_LEN = 48;
const FONT_BASE = 128;
const PAD_X = 3;
const PAD_Y = 2;
const HIT_WIDTH = 20; // 透明ヒット領域 (= ★4 確定)
const PX_TO_MM = 10 / INITIAL_GRID_PX; // 10/3 ≈ 3.33 mm/px (zoom 非依存)

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
  padX: number, padY: number,
): React.ReactElement[] {
  const w = text.length * fs * 0.6 + padX * 2;
  const h = fs + padY * 2;
  return [
    <Rect key={`${k}B`} x={cx - w / 2} y={cy - h / 2}
      width={w} height={h} fill={BG_FILL} opacity={BG_OPACITY}
      cornerRadius={2} listening={false} />,
    <Text key={`${k}T`} x={cx - w / 2 + padX} y={cy - fs / 2}
      text={text} fontSize={fs} fontFamily="monospace"
      fill={color} listening={false} />,
  ];
}

/* ===== 円形建物 (templateId==='circle') の判定 + 寸法情報 ===== */
// 円は正36角形。微小辺の細分をやめ Φ(直径)/R(半径) で表示するための情報を返す。
// 直径は templateDims.diameter を採用するが、頂点手編集などで BBox 幅と >2% 乖離した
// 場合は陳腐化とみなし BBox 幅(mm)をフォールバック採用する。
function getCircleInfo(b: BuildingShape): {
  D: number; cx: number; cy: number;
  minX: number; maxX: number; minY: number; maxY: number;
  roofD: number | null; rMinX: number; rMaxX: number; rMinY: number; rMaxY: number;
} | null {
  if (b.templateId !== 'circle') return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of b.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!(minX < maxX && minY < maxY)) return null;

  const bbWmm = Math.round(gridToMm(maxX - minX));
  const declared = b.templateDims?.diameter;
  // 宣言値が BBox 幅と 2% 以内なら宣言値、それ以外(陳腐化)は BBox 幅を採用
  const D = (declared != null && Math.abs(declared - bbWmm) <= bbWmm * 0.02) ? declared : bbWmm;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  let roofD: number | null = null;
  let rMinX = minX, rMaxX = maxX, rMinY = minY, rMaxY = maxY;
  if (b.roof && b.roof.roofType !== 'none') {
    const ohs = getEdgeOverhangs(b, b.roof);
    const rp = computeOffsetPolygon(b.points, ohs);
    rMinX = Infinity; rMinY = Infinity; rMaxX = -Infinity; rMaxY = -Infinity;
    for (const p of rp) {
      rMinX = Math.min(rMinX, p.x); rMinY = Math.min(rMinY, p.y);
      rMaxX = Math.max(rMaxX, p.x); rMaxY = Math.max(rMaxY, p.y);
    }
    roofD = Math.round(gridToMm(rMaxX - rMinX));
  }
  return { D, cx, cy, minX, maxX, minY, maxY, roofD, rMinX, rMaxX, rMinY, rMaxY };
}

/* ===== 円用寸法線 (主線 + 両端目盛りのみ + Φ ラベル、内側細分なし) ===== */
function renderCircleDimLine(
  k: string, isH: boolean, axis: number, innerDir: number,
  lineS: number, lineE: number, label: string,
  fs: number, color: string, lw: number,
  padX: number, padY: number, tickLen: number,
): React.ReactElement[] {
  const els: React.ReactElement[] = [];
  els.push(
    <Line key={`${k}L`}
      points={isH ? [lineS, axis, lineE, axis] : [axis, lineS, axis, lineE]}
      stroke={color} strokeWidth={lw} listening={false} />,
  );
  [lineS, lineE].forEach((px, ti) => {
    els.push(
      <Line key={`${k}t${ti}`}
        points={isH
          ? [px, axis, px, axis + innerDir * tickLen]
          : [axis, px, axis + innerDir * tickLen, px]}
        stroke={color} strokeWidth={lw} listening={false} />,
    );
  });
  const mid = (lineS + lineE) / 2;
  const outerOff = -innerDir * (tickLen + fs / 2 + padY * 2);
  els.push(...renderLabel(
    isH ? mid : axis + outerOff,
    isH ? axis + outerOff : mid,
    label, fs, `${k}O`, color, padX, padY,
  ));
  return els;
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
  lw: number,
  padX: number, padY: number,
  tickLen: number,
): React.ReactElement[] {
  if (!spans.length) return [];
  const els: React.ReactElement[] = [];
  const lineS = spans[0].s;
  const lineE = spans[spans.length - 1].e;

  els.push(
    <Line key={`${k}L`}
      points={isH ? [lineS, axis, lineE, axis] : [axis, lineS, axis, lineE]}
      stroke={color} strokeWidth={lw} listening={false} />,
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
          ? [px, axis, px, axis + innerDir * tickLen]
          : [axis, px, axis + innerDir * tickLen, px]}
        stroke={color} strokeWidth={lw} listening={false} />,
    );
  }

  if (showInner) {
    spans.forEach((sp, i) => {
      if (sp.mm <= 0) return;
      const mid = (sp.s + sp.e) / 2;
      const off = innerDir * (tickLen + fs / 2 + padY * 2);
      els.push(...renderLabel(
        isH ? mid : axis + off,
        isH ? axis + off : mid,
        `${sp.mm}`, fs, `${k}i${i}`, color, padX, padY,
      ));
    });
  }

  const mid = (lineS + lineE) / 2;
  const outerOff = -innerDir * (tickLen + fs / 2 + padY * 2);
  els.push(...renderLabel(
    isH ? mid : axis + outerOff,
    isH ? axis + outerOff : mid,
    `${totalMm}`, fs, `${k}O`, color, padX, padY,
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
  lw: number,
  padX: number, padY: number,
  tickLen: number,
): React.ReactElement[] {
  if (!spans.length) return [];
  const els: React.ReactElement[] = [];

  els.push(
    <Line key={`${k}L`}
      points={isH ? [lineStart, axis, lineEnd, axis] : [axis, lineStart, axis, lineEnd]}
      stroke={color} strokeWidth={lw} listening={false} />,
  );

  const tickSet = new Set<number>();
  tickSet.add(lineStart); tickSet.add(lineEnd);
  for (const sp of spans) { tickSet.add(sp.s); tickSet.add(sp.e); }
  let ti = 0;
  for (const px of Array.from(tickSet)) {
    els.push(
      <Line key={`${k}t${ti++}`}
        points={isH
          ? [px, axis, px, axis + innerDir * tickLen]
          : [axis, px, axis + innerDir * tickLen, px]}
        stroke={color} strokeWidth={lw} listening={false} />,
    );
  }

  spans.forEach((sp, i) => {
    if (sp.mm <= 0) return;
    const mid = (sp.s + sp.e) / 2;
    const off = innerDir * (tickLen + fs / 2 + padY * 2);
    els.push(...renderLabel(
      isH ? mid : axis + off,
      isH ? axis + off : mid,
      `${sp.mm}`, fs, `${k}i${i}`, color, padX, padY,
    ));
  });

  const mid = (lineStart + lineEnd) / 2;
  const outerOff = -innerDir * (tickLen + fs / 2 + padY * 2);
  els.push(...renderLabel(
    isH ? mid : axis + outerOff,
    isH ? axis + outerOff : mid,
    `${totalMm}`, fs, `${k}O`, color, padX, padY,
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

  // S-7: bbox 端への厳密一致ではなく、手摺の向き(水平→北/南・垂直→東/西)＋ floor bbox 中心の
  //   どちら側か、で面分類する。範囲離れ継承(S-6-2)で手摺座標が動いても、隣接面の角張り出しが
  //   bbox 端を占めても、各手摺は自分の向きと位置だけで正しい面に入る(脱落/誤分類しない)。
  const TOL = 0.01;
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    const isH = Math.abs(p1.y - p2.y) < TOL;
    const isV = Math.abs(p1.x - p2.x) < TOL;
    if (isH && !isV) {
      const from = Math.min(p1.x, p2.x);
      const to = Math.max(p1.x, p2.x);
      if (to > from) (p1.y < cy ? byFace.north : byFace.south).push({ from, to });
    } else if (isV && !isH) {
      const from = Math.min(p1.y, p2.y);
      const to = Math.max(p1.y, p2.y);
      if (to > from) (p1.x < cx ? byFace.west : byFace.east).push({ from, to });
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
  const { canvasData, zoom, panX, panY, mode, selectActive, selectLock, isReorderMode } = useCanvasStore();
  const setDimensionOffsetMm = useCanvasStore(s => s.setDimensionOffsetMm);
  // 選択ON + ロック解除中、 または入替モード中のみ触れる (= 選択OFF + 非入替 = 閲覧モードで触れない)
  const selectListenDimension =
    (mode === 'select' && selectActive && !selectLock.dimension)
    || (mode === 'select' && isReorderMode);
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
      const mmDelta = sign * pixelDelta * (10 / (INITIAL_GRID_PX * zoom));  // zoom 依存 = world mm
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
  const mmDeltaToPx = (mm: number) => mm * gridPx / 10;  // zoom 依存 = 現在 zoom の px

  const { elements, dragInfos } = useMemo(() => {
    if (!visible || !canvasData.buildings.length) {
      return { elements: [] as React.ReactElement[], dragInfos: [] as DragInfo[] };
    }

    const fs = FONT_BASE * zoom;  // 完全 zoom 連動 = pure proportional
    const els: React.ReactElement[] = [];
    const infos: DragInfo[] = [];
    const gx = (g: number) => g * gridPx + panX;
    const gy = (g: number) => g * gridPx + panY;

    const overallBB = getOverallBB(canvasData.buildings, canvasData.handrails);
    if (!bbOk(overallBB)) return { elements: els, dragInfos: infos };

    // mm → px 換算 (= mm * gridPx / 10、 INITIAL_GRID_PX=20 で 1 grid=10mm)
    const mmToPx = (mm: number) => mm * gridPx / 10;

    // S-4: N 階一般化。存在階の昇順ユニークで反復し、offset(mm) は式
    //   base+(maxFloor−floor)·step(複数階時)・単独階は SOLO 定数(→dimBaseOffsetMm)。
    //   色は floorDimColor パレット、キーは `${cat}${floor}F`。N=2({1,2}) で従来リテラルと完全一致。
    //   px 換算(mmToPx) + ドラッグ相対 delta(mmDeltaToPx) は従来どおり後段で加算。
    const floorsPresent = getPresentFloors(canvasData.buildings);
    const floors: Array<{
      floor: number; offWall: number; offRoof: number; offScaffold: number; color: string;
      scaffoldKey: DimensionLineKey; wallKey: DimensionLineKey; roofKey: DimensionLineKey;
    }> = buildFloorDimDescriptors(floorsPresent).map(d => ({
      floor: d.floor,
      offWall: mmToPx(d.offWallMm) + mmDeltaToPx(effectiveOffsetMm[d.wallKey] ?? 0),
      offRoof: mmToPx(d.offRoofMm) + mmDeltaToPx(effectiveOffsetMm[d.roofKey] ?? 0),
      offScaffold: mmToPx(d.offScaffoldMm) + mmDeltaToPx(effectiveOffsetMm[d.scaffoldKey] ?? 0),
      color: d.color,
      scaffoldKey: d.scaffoldKey, wallKey: d.wallKey, roofKey: d.roofKey,
    }));

    // S-9: 共有壁(1F/2Fが同位置・同スパン)で寸法線が 1F/2F 2本ダブるのを 1 本化する。
    //   先に処理する階(1F)のキーを記録し、後の階(2F)の同一寸法はスキップする。キーの固定座標は
    //   floor の「建物bbox端」(handrail非依存)を使う＝総二階(1F手摺0本)でも共有壁が一致する。
    //   下屋/せり出しは建物bbox端 or スパンが違うので別キー→両方残る(S-8分離を維持)。
    const seenDim = new Set<string>();

    for (const { floor, offWall, offRoof, offScaffold, color, scaffoldKey, wallKey, roofKey } of floors) {
      const floorBuildings = canvasData.buildings.filter(b => (b.floor ?? 1) === floor);
      if (floorBuildings.length === 0) continue;
      const floorHandrails = canvasData.handrails.filter(h => (h.floor ?? 1) === floor);
      // 重複判定用: この階の建物のみの bbox(各面の壁直交固定座標)。
      let bldgBB = bb0();
      for (const b of floorBuildings) for (const p of b.points) bldgBB = bbG(bldgBB, p.x, p.y);

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
        if (b.templateId === 'circle') continue; // 円は微小辺の集約をやめ Φ/R で別描画
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

      // S-8: 寸法線の軸位置(壁直交方向)は overallBB ではなく「この階の bbox」を基準にする。
      //   下屋等で 1F/2F の外周が違う面では 1F 寸法が 1F の外周側・2F 寸法が 2F の外周側に分離して出る
      //   (overallBB だと両者が図面外周に重なり 2 本並ぶ)。面分類(S-7)・スパン・足場計算は不変。
      const fbb = getOverallBB(floorBuildings, floorHandrails);
      const floorBB = bbOk(fbb) ? fbb : overallBB;

      for (const face of ['north', 'south', 'east', 'west'] as Face[]) {
        const isH = face === 'north' || face === 'south';
        const sign = (face === 'north' || face === 'west') ? -1 : 1;
        const innerDir = -sign;

        const refGrid = isH
          ? (face === 'north' ? floorBB.minY : floorBB.maxY)
          : (face === 'west' ? floorBB.minX : floorBB.maxX);
        const refPx = isH ? gy(refGrid) : gx(refGrid);
        // S-9 重複排除キー用の壁固定座標(この面の建物bbox端・handrail非依存)
        const faceFixed = isH
          ? (face === 'north' ? bldgBB.minY : bldgBB.maxY)
          : (face === 'west' ? bldgBB.minX : bldgBB.maxX);

        // 段 (足場)
        const scfEdges = scaffoldData.byFace[face];
        const sDupKey = `S|${face}|${Math.round(faceFixed)}|${scfEdges.length ? Math.round(Math.min(...scfEdges.map(e => e.from))) : 0}|${scfEdges.length ? Math.round(Math.max(...scfEdges.map(e => e.to))) : 0}`;
        if (readDimVisibility(dimensionVisibility, 'scaffold', floor) && scfEdges.length > 0 && !seenDim.has(sDupKey)) {
          seenDim.add(sDupKey);
          const axisScaffold = refPx + sign * offScaffold;
          const spans: Span[] = scfEdges.map(e => ({
            s: isH ? gx(e.from) : gy(e.from),
            e: isH ? gx(e.to) : gy(e.to),
            mm: Math.round(gridToMm(e.to - e.from)),
          }));
          const total = spans.reduce((sum, sp) => sum + sp.mm, 0);
          const lineColor = previewMm?.key === scaffoldKey ? DRAG_COLOR : color;
          // floor が全部円のときは足場段も細分せず合計のみ (内側細分を抑止)
          const scfShowInner = spans.length > 1 && floorBuildings.some(b => b.templateId !== 'circle');
          els.push(...renderDimLine(
            `D${floor}S${face}`, isH, axisScaffold, innerDir, spans,
            scfShowInner, total, fs, lineColor, LW * zoom, PAD_X * zoom, PAD_Y * zoom, TICK_LEN * zoom,
          ));
          infos.push({
            key: scaffoldKey, face, isH, axis: axisScaffold,
            lineStart: spans[0].s, lineEnd: spans[spans.length - 1].e,
          });
        }

        // 段 (外壁)
        const wEdges = wallEdges[face];
        const wDupKey = `I|${face}|${Math.round(faceFixed)}|${wEdges.length ? Math.round(Math.min(...wEdges.map(e => e.from))) : 0}|${wEdges.length ? Math.round(Math.max(...wEdges.map(e => e.to))) : 0}`;
        if (readDimVisibility(dimensionVisibility, 'wall', floor) && wEdges.length > 0 && !seenDim.has(wDupKey)) {
          seenDim.add(wDupKey);
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
            spans.length > 1, total, fs, lineColor, LW * zoom, PAD_X * zoom, PAD_Y * zoom, TICK_LEN * zoom,
          ));
          infos.push({
            key: wallKey, face, isH, axis: axisWall,
            lineStart: spans[0].s, lineEnd: spans[spans.length - 1].e,
          });
        }

        // 外側 (屋根の出幅)
        const rEdges = roofEdges[face];
        const ovEdges = overhangEdges[face];
        const rDupKey = `O|${face}|${Math.round(faceFixed)}|${rEdges.length ? Math.round(Math.min(...rEdges.map(r => r.from))) : 0}|${rEdges.length ? Math.round(Math.max(...rEdges.map(r => r.to))) : 0}`;
        if (readDimVisibility(dimensionVisibility, 'roof', floor) && rEdges.length > 0 && ovEdges.length > 0 && !seenDim.has(rDupKey)) {
          seenDim.add(rDupKey);
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
            overhangSpans, lineStartPx, lineEndPx, totalMm, fs, lineColor, LW * zoom, PAD_X * zoom, PAD_Y * zoom, TICK_LEN * zoom,
          ));
          infos.push({
            key: roofKey, face, isH, axis: axisOuter,
            lineStart: lineStartPx, lineEnd: lineEndPx,
          });
        }
      }

      // === 円形建物 (templateId==='circle'): Φ/R 表示 (微小辺の細分なし) ===
      for (const b of floorBuildings) {
        const ci = getCircleInfo(b);
        if (!ci) continue;
        const lineColorW = previewMm?.key === wallKey ? DRAG_COLOR : color;
        const lineColorR = previewMm?.key === roofKey ? DRAG_COLOR : color;
        for (const face of ['north', 'south', 'east', 'west'] as Face[]) {
          const isH = face === 'north' || face === 'south';
          const sign = (face === 'north' || face === 'west') ? -1 : 1;
          const innerDir = -sign;
          const refGrid = isH
            ? (face === 'north' ? floorBB.minY : floorBB.maxY)
            : (face === 'west' ? floorBB.minX : floorBB.maxX);
          const refPx = isH ? gy(refGrid) : gx(refGrid);

          // 外壁段: Φ(直径)
          if (readDimVisibility(dimensionVisibility, 'wall', floor)) {
            const axisWall = refPx + sign * offWall;
            const lineS = isH ? gx(ci.minX) : gy(ci.minY);
            const lineE = isH ? gx(ci.maxX) : gy(ci.maxY);
            els.push(...renderCircleDimLine(
              `D${floor}CW${b.id}${face}`, isH, axisWall, innerDir, lineS, lineE,
              `Φ${ci.D}`, fs, lineColorW, LW * zoom, PAD_X * zoom, PAD_Y * zoom, TICK_LEN * zoom,
            ));
            infos.push({ key: wallKey, face, isH, axis: axisWall, lineStart: lineS, lineEnd: lineE });
          }

          // 屋根段: Φ(屋根直径)。屋根ありのときのみ
          if (ci.roofD != null && readDimVisibility(dimensionVisibility, 'roof', floor)) {
            const axisRoof = refPx + sign * offRoof;
            const lineS = isH ? gx(ci.rMinX) : gy(ci.rMinY);
            const lineE = isH ? gx(ci.rMaxX) : gy(ci.rMaxY);
            els.push(...renderCircleDimLine(
              `D${floor}CO${b.id}${face}`, isH, axisRoof, innerDir, lineS, lineE,
              `Φ${ci.roofD}`, fs, lineColorR, LW * zoom, PAD_X * zoom, PAD_Y * zoom, TICK_LEN * zoom,
            ));
            infos.push({ key: roofKey, face, isH, axis: axisRoof, lineStart: lineS, lineEnd: lineE });
          }
        }
        // 中心に R(半径) ラベル
        els.push(...renderLabel(
          gx(ci.cx), gy(ci.cy), `R${Math.round(ci.D / 2)}`,
          fs, `D${floor}CR${b.id}`, color, PAD_X * zoom, PAD_Y * zoom,
        ));
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
      startMm: storedOffsets[info.key] ?? 0,
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
              listening={selectListenDimension}
              onMouseDown={(e) => onHitDown(e, info)}
              onTouchStart={(e) => onHitDown(e, info)}
            />
          ))}
        </>
      )}
    </Layer>
  );
}
