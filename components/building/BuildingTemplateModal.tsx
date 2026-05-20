'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { BUILDING_TEMPLATES, buildFromTemplate } from '@/lib/konva/buildingBuilder';
import { BuildingTemplateId, BuildingInputMethod, RoofType, RoofConfig, Point } from '@/types';
import { DEFAULT_COLS, DEFAULT_ROWS } from '@/lib/konva/gridUtils';
import NumInput from '@/components/ui/NumInput';
import { computeEdgeLabelPosition } from '@/lib/konva/buildingLabelUtils';

type Props = { onClose: () => void; floor?: 1 | 2; floor1Building?: import('@/types').BuildingShape };

// --- SVG shape icons ---
const SHAPE_PATHS: Record<BuildingTemplateId, string> = {
  rect: 'M2,2 H22 V22 H2 Z',
  l_ne: 'M2,2 H15 V10 H22 V22 H2 Z',
  l_nw: 'M9,2 H22 V22 H2 V10 H9 Z',
  l_se: 'M2,2 H22 V14 H15 V22 H2 Z',
  l_sw: 'M2,2 H22 V22 H9 V14 H2 Z',
  convex_s: 'M2,2 H22 V16 H17 V22 H7 V16 H2 Z',
  convex_n: 'M7,2 H17 V8 H22 V22 H2 V8 H7 Z',
  convex_e: 'M2,2 H16 V7 H22 V17 H16 V22 H2 Z',
  convex_w: 'M8,2 H22 V22 H8 V17 H2 V7 H8 Z',
  u_s: 'M2,2 H22 V22 H16 V14 H8 V22 H2 Z',
  u_n: 'M2,2 H8 V10 H16 V2 H22 V22 H2 Z',
  t_cross: 'M8,2 H16 V8 H22 V16 H16 V22 H8 V16 H2 V8 H8 Z',
  circle: 'M12,2 A10,10 0 1,1 12,22 A10,10 0 1,1 12,2 Z',
};

/** 全辺のdimKeyを返す（edgeIndex順） */
function getAllEdgeKeys(id: BuildingTemplateId): string[] {
  switch (id) {
    case 'rect': return ['top', 'right', 'bottom', 'left'];
    // L字: tw/th/cw/ch が独立、残りは派生
    case 'l_ne': return ['tw', 'e1', 'cw', 'e3', 'e4', 'th']; // e1=tw-cw(上の短辺), e3=th-ch, e4=ch → wait
    // Let me trace l_ne carefully:
    // P0(0,0)→P1(tw-cw,0): edge0 = tw-cw (派生)
    // P1→P2(tw-cw,ch): edge1 = ch
    // P2→P3(tw,ch): edge2 = cw
    // P3→P4(tw,th): edge3 = th-ch (派生)
    // P4→P5(0,th): edge4 = tw
    // P5→P0(0,0): edge5 = th
    default: break;
  }
  // Fallback: use generic names
  const tpl = BUILDING_TEMPLATES.find(t => t.id === id);
  if (!tpl) return [];
  const pts = tpl.buildPoints(tpl.dimensions.reduce((a, d) => ({ ...a, [d.key]: d.defaultMm }), {} as Record<string, number>));
  return pts.map((_, i) => `e${i}`);
}

// Actually, let me simplify the whole approach dramatically.
// Instead of trying to name every edge, I'll keep the existing system but:
// 1. Add "autoCalc" checkbox
// 2. When ON: derived edges show computed values (read-only) - current behavior
// 3. When OFF: derived edges become editable, with their own state keys

/** Map of dim keys that are directly editable (from template.dimensions) */
function getIndependentKeys(id: BuildingTemplateId): Set<string> {
  const tpl = BUILDING_TEMPLATES.find(t => t.id === id);
  if (!tpl) return new Set();
  return new Set(tpl.dimensions.map(d => d.key));
}

/** Map dimension keys to polygon edge indices */
function getKeyEdgeMap(id: BuildingTemplateId): Record<string, number> {
  switch (id) {
    case 'rect': return { top: 0, right: 1, bottom: 2, left: 3 };
    case 'l_ne': return { tw: 0, ch: 1, cw: 2, th: 5 };
    case 'l_nw': return { tw: 1, th: 2, cw: 4, ch: 5 };
    case 'l_se': return { tw: 0, cw: 2, ch: 3, th: 5 };
    case 'l_sw': return { tw: 0, th: 1, cw: 3, ch: 4 };
    case 'convex_s': return { tw: 0, th: 1, pw: 4, ph: 3, px: 6 };
    case 'convex_n': return { pw: 0, ph: 1, tw: 3, th: 4, px: 7 };
    case 'convex_e': return { tw: 0, th: 1, pw: 3, ph: 4, py: 2 };
    case 'convex_w': return { tw: 0, th: 1, pw: 5, ph: 6, py: 7 };
    case 'u_s': return { tw: 0, th: 1, ow: 4, od: 3 };
    case 'u_n': return { tw: 5, th: 6, ow: 2, od: 3 };
    case 't_cross': return { vw: 0, vh: 6, hw: 3, hh: 4 };
    case 'circle': return { diameter: 0 };
    default: return {};
  }
}

function getDimLabel(_id: BuildingTemplateId, key: string): string {
  const map = getKeyEdgeMap(_id);
  const edgeIdx = map[key];
  if (edgeIdx === undefined) return key;
  return String.fromCharCode(65 + edgeIdx);
}

function getEdgeKeyMap(id: BuildingTemplateId): Record<number, string> {
  const m = getKeyEdgeMap(id);
  const rev: Record<number, string> = {};
  for (const [k, v] of Object.entries(m)) rev[v] = k;
  return rev;
}

/** PreviewSVG */
function PreviewSVG({ templateId, dims, focusedKey }: {
  templateId: BuildingTemplateId; dims: Record<string, number>; focusedKey: string | null;
}) {
  const tpl = BUILDING_TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return null;
  const rawPts = tpl.buildPoints(dims);
  if (rawPts.length < 3) return null;

  const xs = rawPts.map(p => p.x);
  const ys = rawPts.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const bw = (Math.max(...xs) - minX) || 1;
  const bh = (Math.max(...ys) - minY) || 1;

  const pad = 24, svgW = 280, svgH = 200;
  const scale = Math.min((svgW - pad * 2) / bw, (svgH - pad * 2) / bh);
  const offsetX = pad + ((svgW - pad * 2) - bw * scale) / 2;
  const offsetY = pad + ((svgH - pad * 2) - bh * scale) / 2;
  const toSvg = (p: Point) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale });

  const svgPts = rawPts.map(toSvg);
  const pathD = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

  const edgeCount = svgPts.length;
  const keyToEdge = getKeyEdgeMap(templateId);
  const focusedEdge = focusedKey ? keyToEdge[focusedKey] : undefined;

  const centroidX = svgPts.reduce((s, p) => s + p.x, 0) / edgeCount;
  const centroidY = svgPts.reduce((s, p) => s + p.y, 0) / edgeCount;
  const edgeKeyMap = getEdgeKeyMap(templateId);

  // 円形は辺ラベル不要
  if (templateId === 'circle') {
    return (
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="mx-auto block">
        <path d={pathD} fill="#3d3d3a" stroke="#1a1a18" strokeWidth={2} />
      </svg>
    );
  }

  // Phase J-1: 各辺の外向き法線 (centroid 比較で算出) と
  // computeEdgeLabelPosition の凹角内側配置を統合
  const edgesForLabel = svgPts.map((p1, i) => {
    const p2 = svgPts[(i + 1) % edgeCount];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if ((((p1.x + p2.x) / 2 + nx - centroidX) ** 2 + ((p1.y + p2.y) / 2 + ny - centroidY) ** 2) <
        (((p1.x + p2.x) / 2 - nx - centroidX) ** 2 + ((p1.y + p2.y) / 2 - ny - centroidY) ** 2)) {
      nx = -nx; ny = -ny;
    }
    return { nx, ny, p1, p2 };
  });

  type LabelEntry = {
    cx: number; cy: number; isInside: boolean;
    letter: string; highlighted: boolean; hasDimKey: boolean;
  };
  const labels: LabelEntry[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const e = edgesForLabel[i];
    const prev = edgesForLabel[(i - 1 + edgeCount) % edgeCount];
    const next = edgesForLabel[(i + 1) % edgeCount];
    const mx = (e.p1.x + e.p2.x) / 2, my = (e.p1.y + e.p2.y) / 2;
    const labelPos = computeEdgeLabelPosition(e, prev, next, mx, my, 16);
    const dk = edgeKeyMap[i];
    labels.push({
      cx: labelPos.x, cy: labelPos.y, isInside: labelPos.isInside,
      letter: String.fromCharCode(65 + i),
      highlighted: dk !== undefined && focusedKey === dk,
      hasDimKey: dk !== undefined,
    });
  }

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="mx-auto block">
      <path d={pathD} fill="#3d3d3a" stroke="#1a1a18" strokeWidth={2} />
      {focusedEdge !== undefined && (() => {
        const p1 = svgPts[focusedEdge], p2 = svgPts[(focusedEdge + 1) % edgeCount];
        return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#378ADD" strokeWidth={4} strokeLinecap="round" />;
      })()}
      {labels.map(el => (
        <text key={el.letter} x={el.cx} y={el.cy}
          textAnchor="middle" dominantBaseline="central"
          fill={el.highlighted ? '#378ADD' : el.hasDimKey ? '#ccc' : '#666'}
          fontWeight={el.highlighted ? 'bold' : 'normal'}
          fontSize={el.highlighted ? 14 : 12} fontFamily="monospace"
          paintOrder={el.isInside ? 'stroke' : undefined}
          stroke={el.isInside ? '#3d3d3a' : undefined}
          strokeWidth={el.isInside ? 3 : undefined}
        >{el.letter}</text>
      ))}
    </svg>
  );
}

export default function BuildingTemplateModal({ onClose, floor, floor1Building }: Props) {
  const { addBuilding, buildingInputMethod, setBuildingInputMethod, zoomToFitBuildings } = useCanvasStore();
  const [selectedTemplate, setSelectedTemplate] = useState<BuildingTemplateId>('rect');
  const [dims, setDims] = useState<Record<string, number>>({});
  const [step, setStep] = useState<'select' | 'dims'>('select');
  const [focusedDimKey, setFocusedDimKey] = useState<string | null>(null);
  const [roofType, setRoofType] = useState<RoofType>('yosemune');
  const [roofOverhangMm, setRoofOverhangMm] = useState(600);
  const [katanagareDir, setKatanagareDir] = useState<'north' | 'south' | 'east' | 'west'>('south');
  const [kirizumaGable, setKirizumaGable] = useState<'ew' | 'ns'>('ew');
  const [autoCalc, setAutoCalc] = useState(true);
  const [unit, setUnit] = useState<'m' | 'mm'>('mm');
  const [uniformRoof, setUniformRoof] = useState(true);
  const [edgeOverhangs, setEdgeOverhangs] = useState<Record<number, number>>({});
  const [anchorPoint, setAnchorPoint] = useState<'tl' | 'tr' | 'bl' | 'br' | 'center'>('tl');

  const template = BUILDING_TEMPLATES.find(t => t.id === selectedTemplate);

  // 単位変換ヘルパー: 内部値は常にmm
  const mmToDisplay = (mm: number): number => unit === 'm' ? mm / 1000 : mm;
  const displayToMm = (val: number): number => unit === 'm' ? Math.round(val * 1000) : val;

  // autoCalc ON時の連動更新
  const updateDim = (key: string, value: number) => {
    const next = { ...dims, [key]: value };
    if (autoCalc && selectedTemplate === 'rect') {
      if (key === 'top') next.bottom = value;
      if (key === 'bottom') next.top = value;
      if (key === 'right') next.left = value;
      if (key === 'left') next.right = value;
    }
    setDims(next);
  };

  const handleToggleAutoCalc = (checked: boolean) => {
    setAutoCalc(checked);
    if (checked) {
      // ONに戻す: 派生値を再計算
      setDims(prev => {
        const next = { ...prev };
        if (selectedTemplate === 'rect') {
          next.bottom = next.top;
          next.left = next.right;
        }
        return next;
      });
    }
  };

  const handleSelectTemplate = (id: BuildingTemplateId) => {
    setSelectedTemplate(id);
    const tpl = BUILDING_TEMPLATES.find(t => t.id === id);
    if (tpl) {
      const defaultDims: Record<string, number> = {};

      // 2F作成時かつ1F建物と同じテンプレートの場合のみ1Fの寸法を引き継ぐ
      const shouldInherit = floor === 2 && floor1Building && id === floor1Building.templateId;

      tpl.dimensions.forEach(d => {
        if (shouldInherit && floor1Building?.templateDims?.[d.key] !== undefined) {
          defaultDims[d.key] = floor1Building.templateDims[d.key]!;
        } else {
          defaultDims[d.key] = d.defaultMm;
        }
      });
      setDims(defaultDims);
    }
    setFocusedDimKey(null);
    setAutoCalc(true);
    setStep('dims');
  };

  const handleCreate = () => {
    const centerX = Math.round(DEFAULT_COLS / 2);
    const centerY = Math.round(DEFAULT_ROWS / 2);
    const points = buildFromTemplate(selectedTemplate, dims, centerX, centerY);
    if (points.length === 0) { onClose(); return; }

    const roof: RoofConfig | undefined = roofType !== 'none' ? {
      roofType, uniformMm: uniformRoof ? roofOverhangMm : 600,
      northMm: null, southMm: null, eastMm: null, westMm: null,
      edgeOverhangsMm: uniformRoof ? undefined : edgeOverhangs,
      katanagareDirection: roofType === 'katanagare' ? katanagareDir : undefined,
      kirizumaGableFace: roofType === 'kirizuma' ? kirizumaGable : undefined,
    } : undefined;

    // 2F建物は仮配置モードで配置
    if (floor === 2) {
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      let anchorX = 0, anchorY = 0;
      if (anchorPoint === 'tl') { anchorX = minX; anchorY = minY; }
      else if (anchorPoint === 'tr') { anchorX = maxX; anchorY = minY; }
      else if (anchorPoint === 'bl') { anchorX = minX; anchorY = maxY; }
      else if (anchorPoint === 'br') { anchorX = maxX; anchorY = maxY; }
      else { anchorX = (minX + maxX) / 2; anchorY = (minY + maxY) / 2; }

      const normalizedPoints = points.map(p => ({ x: p.x - anchorX, y: p.y - anchorY }));

      useCanvasStore.getState().setBuilding2FDraft({
        points: normalizedPoints,
        anchorPoint,
        floor: 2,
        fill: '#5a5a7a',
        roof,
        templateId: selectedTemplate,
        templateDims: { ...dims },
      });
      onClose();
      return;
    }

    // 1F建物は即配置
    addBuilding({ id: uuidv4(), type: 'polygon', points, fill: '#3d3d3a', floor: 1, roof, templateId: selectedTemplate, templateDims: { ...dims } });
    requestAnimationFrame(() => {
      zoomToFitBuildings(window.innerWidth, window.innerHeight - 120);
    });
    onClose();
  };

  // 派生辺かどうかの判定
  const isRect = selectedTemplate === 'rect';
  const isCircle = selectedTemplate === 'circle';
  const independentKeys = template ? new Set(template.dimensions.map(d => d.key)) : new Set<string>();
  const edgeKeyMap = getEdgeKeyMap(selectedTemplate);

  // 派生辺があるかどうか（rect以外で辺数 > dimKey数）
  const rawPts = template ? template.buildPoints(dims) : [];
  const edgeCount = rawPts.length;
  const hasDerived = Object.keys(edgeKeyMap).length < edgeCount;
  // rect は独自の連動ロジック。他テンプレートは派生辺あり。円形は不要
  const showAutoCalcCheckbox = !isCircle && (isRect || hasDerived);

  // 各辺の行データを構築
  const buildRows = () => {
    if (!template) return [];
    const rows: { edgeIdx: number; letter: string; dimKey: string | null; value: number; editable: boolean; locked: boolean }[] = [];

    for (let i = 0; i < edgeCount; i++) {
      const letter = String.fromCharCode(65 + i);
      const dk = edgeKeyMap[i]; // dimKeyがあれば独立辺

      if (dk) {
        // rect の対辺連動: autoCalc ON で bottom/left はロック
        const isLockedRect = isRect && autoCalc && (dk === 'bottom' || dk === 'left');
        const dim = template.dimensions.find(d => d.key === dk);
        rows.push({
          edgeIdx: i, letter, dimKey: dk,
          value: dims[dk] ?? dim?.defaultMm ?? 0,
          editable: !isLockedRect,
          locked: isLockedRect,
        });
      } else {
        // 派生辺
        const p1 = rawPts[i], p2 = rawPts[(i + 1) % edgeCount];
        const lenMm = Math.round(Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) * 10);

        if (autoCalc) {
          // 自動計算: 読み取り専用
          rows.push({ edgeIdx: i, letter, dimKey: null, value: lenMm, editable: false, locked: true });
        } else {
          // 手動入力: 編集可能（dimKeyとしてe0, e1...を使う）
          const edgeKey = `_e${i}`;
          const currentVal = dims[edgeKey] ?? lenMm;
          rows.push({ edgeIdx: i, letter, dimKey: edgeKey, value: currentVal, editable: true, locked: false });
        }
      }
    }
    return rows;
  };

  return (
    <div className="fixed inset-0 modal-overlay flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div className="bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-dark-surface px-4 py-3 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-bold text-lg">{floor === 2 ? '2F建物入力' : '建物入力'}</h2>
          <button onClick={onClose} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        <div className="flex border-b border-dark-border">
          {(['template', 'direction'] as BuildingInputMethod[]).map(m => (
            <button key={m}
              onClick={() => {
                setBuildingInputMethod(m);
                if (m === 'direction') {
                  useCanvasStore.getState().setPendingBuildingFloor(floor || 1);
                  useCanvasStore.getState().setMode('building');
                  useCanvasStore.getState().setHeightMarkerMode(false);
                  useCanvasStore.getState().clearDirectionPoints();
                  onClose();
                }
              }}
              className={`flex-1 py-3 text-sm ${buildingInputMethod === m ? 'text-accent border-b-2 border-accent' : 'text-dimension'}`}
            >{m === 'template' ? 'テンプレート' : '壁方向入力'}</button>
          ))}
        </div>

        {step === 'select' && (
          <div className="p-4">
            <div className="grid grid-cols-4 gap-2">
              {BUILDING_TEMPLATES.map(t => (
                <button key={t.id} onClick={() => handleSelectTemplate(t.id)}
                  className={`flex flex-col items-center p-2 rounded-xl border transition-colors ${
                    selectedTemplate === t.id ? 'border-accent bg-accent/10' : 'border-dark-border hover:border-accent/50'
                  }`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" className="mb-1">
                    <path d={SHAPE_PATHS[t.id]} fill="#3d3d3a" stroke="#888" strokeWidth={1} />
                  </svg>
                  <span className="text-[10px] text-center leading-tight">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'dims' && template && (
          <div className="p-4">
            <button onClick={() => setStep('select')} className="text-accent text-sm mb-3">← テンプレート選択に戻る</button>

            <PreviewSVG templateId={selectedTemplate} dims={dims} focusedKey={focusedDimKey} />

            {/* Auto-calc checkbox */}
            {showAutoCalcCheckbox && (
              <label className="flex items-center gap-2 mt-3 mb-1 cursor-pointer">
                <input type="checkbox" checked={autoCalc}
                  onChange={e => handleToggleAutoCalc(e.target.checked)}
                  className="w-4 h-4 rounded border-dark-border accent-accent"
                />
                <span className="text-xs text-dimension">
                  {isRect ? '対辺を同じにする' : '派生辺を自動計算する'}
                </span>
              </label>
            )}

            {/* Unit toggle */}
            <div className="flex items-center gap-2 mt-2 mb-1">
              <span className="text-xs text-dimension">単位:</span>
              <div className="flex rounded-lg border border-dark-border overflow-hidden">
                {(['m', 'mm'] as const).map(u => (
                  <button key={u} onClick={() => setUnit(u)}
                    className={`px-3 py-1 text-xs font-bold transition-colors ${
                      unit === u ? 'bg-accent text-white' : 'bg-dark-bg text-dimension hover:text-canvas'
                    }`}>{u}</button>
                ))}
              </div>
            </div>

            {/* Dimension inputs */}
            <div className="space-y-2 mt-2">
              {isCircle ? (
                /* 円形: 直径のみ */
                <div className="flex items-center gap-2">
                  <span className="shrink-0 px-1.5 h-6 flex items-center justify-center rounded text-xs font-bold bg-dark-bg text-dimension">
                    直径<span className="font-normal text-[10px] ml-0.5">({unit})</span>
                  </span>
                  <NumInput value={mmToDisplay(dims.diameter ?? 6000)}
                    onChange={(v) => updateDim('diameter', displayToMm(v))}
                    min={unit === 'm' ? 0.1 : 100} step={unit === 'm' ? 0.001 : 1}
                    className="flex-1 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-canvas text-right font-mono text-sm focus:outline-none focus:border-accent"
                  />
                  <span className="text-dimension text-xs w-6">{unit}</span>
                </div>
              ) : (
                /* 多角形: 各辺の入力 */
                buildRows().map(row => (
                  <div key={row.letter} className="flex items-center gap-2">
                    <span className={`shrink-0 px-1.5 h-6 flex items-center justify-center rounded text-xs font-bold ${
                      row.editable && focusedDimKey === row.dimKey ? 'bg-accent text-white'
                      : row.editable ? 'bg-dark-bg text-dimension'
                      : 'bg-dark-bg/50 text-dimension/50'
                    }`}>{row.letter}<span className="font-normal text-[10px] ml-0.5">({unit})</span></span>
                    {row.editable ? (
                      <NumInput value={mmToDisplay(row.value)}
                        onChange={(v) => { if (row.dimKey) updateDim(row.dimKey, displayToMm(v)); }}
                        min={unit === 'm' ? 0.1 : 100}
                        onFocus={() => setFocusedDimKey(row.dimKey)}
                        onBlur={() => setFocusedDimKey(null)}
                        className={`flex-1 px-3 py-2 bg-dark-bg border rounded-lg text-canvas text-right font-mono text-sm focus:outline-none ${
                          focusedDimKey === row.dimKey ? 'border-accent' : 'border-dark-border'
                        }`}
                      />
                    ) : (
                      <div className="flex-1 px-3 py-2 bg-dark-bg/60 border border-dark-border/50 rounded-lg text-dimension/70 text-right font-mono text-sm">
                        {mmToDisplay(row.value)}
                      </div>
                    )}
                    <span className="text-dimension text-xs w-6">{unit}</span>
                  </div>
                ))
              )}
            </div>

            {/* Roof config */}
            <div className="mt-4 pt-3 border-t border-dark-border">
              <p className="text-sm text-dimension mb-2">屋根形状</p>
              <div className="flex gap-2 mb-3">
                {([['yosemune', '寄棟'], ['kirizuma', '切妻'], ['katanagare', '片流れ'], ['none', 'なし']] as [RoofType, string][]).map(([id, label]) => (
                  <button key={id} onClick={() => setRoofType(id)}
                    className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                      roofType === id ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                    }`}>{label}</button>
                ))}
              </div>
              {roofType === 'kirizuma' && (
                <div className="mb-3">
                  <p className="text-xs text-dimension mb-1">妻面の方向</p>
                  <div className="flex gap-2">
                    {([['ew', '東西面が妻面'], ['ns', '南北面が妻面']] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setKirizumaGable(id)}
                        className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                          kirizumaGable === id ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                        }`}>{label}</button>
                    ))}
                  </div>
                </div>
              )}
              {roofType === 'katanagare' && (
                <div className="mb-3">
                  <p className="text-xs text-dimension mb-1">水下方向（軒側）</p>
                  <div className="flex gap-2">
                    {([['north', '北'], ['south', '南'], ['east', '東'], ['west', '西']] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setKatanagareDir(id)}
                        className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                          katanagareDir === id ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                        }`}>{label}</button>
                    ))}
                  </div>
                </div>
              )}
              {roofType !== 'none' && (
                <div className="space-y-2 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={uniformRoof}
                      onChange={(e) => setUniformRoof(e.target.checked)}
                      className="w-4 h-4 rounded border-dark-border accent-accent"
                    />
                    <span className="text-xs text-dimension">全面同じ出幅</span>
                  </label>

                  {uniformRoof ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-dimension shrink-0">出幅</span>
                      <NumInput value={mmToDisplay(roofOverhangMm)}
                        onChange={(v) => setRoofOverhangMm(displayToMm(v))}
                        min={0} step={unit === 'm' ? 0.05 : 50}
                        className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm"
                      />
                      <span className="text-xs text-dimension">{unit}</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {buildRows().map(row => {
                        const val = edgeOverhangs[row.edgeIdx] ?? roofOverhangMm;
                        return (
                          <div key={row.edgeIdx} className="flex items-center gap-2">
                            <span className="shrink-0 px-1.5 h-6 flex items-center justify-center rounded text-xs font-bold bg-dark-bg text-dimension">
                              {row.letter}
                            </span>
                            <NumInput value={mmToDisplay(val)}
                              onChange={(v) => setEdgeOverhangs(prev => ({ ...prev, [row.edgeIdx]: displayToMm(v) }))}
                              min={0} step={unit === 'm' ? 0.05 : 50}
                              className="flex-1 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-canvas text-right font-mono text-sm focus:outline-none focus:border-accent"
                            />
                            <span className="text-xs text-dimension w-6">{unit}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {floor === 2 && (
              <div className="mt-3 pt-3 border-t border-dark-border">
                <p className="text-sm text-dimension mb-2">基準点</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    ['tl', '左上'], ['', ''], ['tr', '右上'],
                    ['', ''], ['center', '中央'], ['', ''],
                    ['bl', '左下'], ['', ''], ['br', '右下'],
                  ] as const).map(([id, label], idx) => (
                    id ? (
                      <button key={id} onClick={() => setAnchorPoint(id as typeof anchorPoint)}
                        className={`py-1.5 rounded-lg text-xs border transition-colors ${
                          anchorPoint === id ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                        }`}>{label}</button>
                    ) : <div key={idx} />
                  ))}
                </div>
              </div>
            )}

            <button onClick={handleCreate} className="w-full mt-4 py-3 bg-accent text-white font-bold rounded-xl text-lg">
              配置する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
