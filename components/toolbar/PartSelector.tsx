'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import ElevationPartPalette from '@/components/elevation/ElevationPartPalette';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import { HandrailLengthMm, HandrailDirection, AntiWidth, ObstacleType } from '@/types';
import { screenToGrid, INITIAL_GRID_PX, mmToGrid } from '@/lib/konva/gridUtils';
import { snapHandrailPlacement, snapToHandrail, getHandrailEndpoints, snapObstacleToWall, snapToMagnetPin } from '@/lib/konva/snapUtils';
import { getHandrailColor } from '@/lib/konva/handrailColors';
import NumInput from '@/components/ui/NumInput';

/** アンチの既定サイズセット（手摺と intersect してパレット表示する）。規格別。 */
const ANTI_BASE_LENGTHS_METRIC: number[] = [1800, 1200, 900, 600, 400];
const ANTI_BASE_LENGTHS_INCH: number[] = [1829, 1524, 1219, 914, 610, 410, 305, 200];

const OBSTACLE_TYPES: { id: ObstacleType; label: string; color: string }[] = [
  { id: 'ecocute', label: 'エコキュート', color: '#B5D4F4' },
  { id: 'aircon', label: '室外機', color: '#C0DD97' },
  { id: 'bay_window', label: '出窓', color: '#FAC775' },
  { id: 'carport', label: 'カーポート', color: '#7B6DE8' },
  { id: 'sunroom', label: 'サンルーム', color: '#F5C4B3' },
  { id: 'balcony', label: 'バルコニー', color: '#5C4A33' },
  { id: 'custom_rect', label: '自由四角', color: '#D3D1C7' },
  { id: 'custom_circle', label: '自由円', color: '#D3D1C7' },
];

const OBSTACLE_DEFAULTS: Record<ObstacleType, { w: number; h: number }> = {
  ecocute: { w: 700, h: 1000 },
  aircon: { w: 800, h: 300 },
  bay_window: { w: 1200, h: 400 },
  carport: { w: 2500, h: 5000 },
  sunroom: { w: 2000, h: 2500 },
  balcony: { w: 2700, h: 900 },
  custom_rect: { w: 1000, h: 1000 },
  custom_circle: { w: 1000, h: 1000 },
};

const SNAP_PX = 80;

/** mm数値入力コンポーネント（キーボード入力対応） */
function MmInput({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = (s: string) => {
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= min) onChange(n);
    else setText(String(value));
  };
  return (
    <input
      type="text" inputMode="numeric" value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => commit(text)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(text); }}
      className="w-full bg-dark-surface border border-dark-border rounded px-2 py-1 text-xs font-mono"
    />
  );
}

type ToolbarDrag =
  | { type: 'handrail'; lengthMm: number; direction: 'horizontal' | 'vertical' | number; currentX: number; currentY: number }
  | { type: 'anti'; lengthMm: number; direction: 'horizontal' | 'vertical'; antiWidth: AntiWidth; currentX: number; currentY: number }
  | { type: 'post'; currentX: number; currentY: number }
  | { type: 'obstacle'; obstacleType: ObstacleType; widthMm: number; heightMm: number; rotation: number; currentX: number; currentY: number };

const ANGLE_PRESETS: { label: string; value: 'horizontal' | 'vertical' | number }[] = [
  { label: '横', value: 'horizontal' as const },
  { label: '縦', value: 'vertical' as const },
  { label: '15°', value: 15 },
  { label: '30°', value: 30 },
  { label: '45°', value: 45 },
  { label: '60°', value: 60 },
  { label: '75°', value: 75 },
];

function getAnglePreviewPoints(angle: number | 'horizontal' | 'vertical') {
  const W = 80, H = 80;
  const cx = W / 2, cy = H / 2;
  const len = 30;
  let dx = len, dy = 0;
  if (angle === 'vertical') { dx = 0; dy = len; }
  else if (typeof angle === 'number') {
    const rad = angle * Math.PI / 180;
    dx = Math.cos(rad) * len;
    dy = Math.sin(rad) * len;
  }
  return { W, H, cx, cy, dx, dy };
}

type PartTab = 'handrail' | 'post' | 'anti';
const PART_TABS: { id: PartTab; label: string }[] = [
  { id: 'handrail', label: '手摺' },
  { id: 'post', label: '支柱' },
  { id: 'anti', label: 'アンチ' },
];

export default function PartSelector() {
  // ===== E-8-v3c-fix2: 平面／立面の部材タブ =====
  const elevationViews = useCanvasStore((st) => st.canvasData.elevationViews);
  const paletteTab = useCanvasStore((st) => st.partPaletteTab);
  const lastElevationViewId = useCanvasStore((st) => st.lastElevationViewId);
  const selectedIds = useCanvasStore((st) => st.selectedIds);
  const modeNow = useCanvasStore((st) => st.mode);
  const elevViews = useMemo(() => elevationViews ?? [], [elevationViews]);
  const hasElevation = elevViews.length > 0;
  /** いま立面を触っている文脈か（既定タブの決定にだけ使う）。 */
  const elevationContext = modeNow === 'select'
    && selectedIds.some((id) => elevViews.some((v) => v.id === id));

  // 立面を選んだ状態で開いたら立面タブから始める（外したときに勝手に平面へ戻さない）。
  useEffect(() => {
    if (elevationContext) useCanvasStore.getState().setPartPaletteTab('elevation');
  }, [elevationContext]);

  /** 立面タブのとき、置き先のビューを確保する（未選択なら直近の立面を選ぶ）。 */
  useEffect(() => {
    if (!hasElevation || paletteTab !== 'elevation' || elevationContext) return;
    const target = elevViews.find((v) => v.id === lastElevationViewId) ?? elevViews[0];
    const st = useCanvasStore.getState();
    if (st.mode !== 'select') st.setMode('select');
    st.setSelectedIds([target.id]);
    st.setLastElevationViewId(target.id);
  }, [paletteTab, hasElevation, elevationContext, elevViews, lastElevationViewId]);

  const FACE_LABEL: Record<string, string> = {
    north: '北面', south: '南面', east: '東面', west: '西面',
  };
  const targetView = elevViews.find((v) => selectedIds.includes(v.id))
    ?? elevViews.find((v) => v.id === lastElevationViewId) ?? elevViews[0];
  const targetViewLabel = targetView ? (FACE_LABEL[targetView.face] ?? '立面') : null;

  const paletteTabs = hasElevation ? (
    <div className="flex items-center gap-1 mb-2">
      {([['plane', '平面部材'], ['elevation', '立面部材']] as const).map(([id, label]) => (
        <button key={id} type="button"
          onClick={() => useCanvasStore.getState().setPartPaletteTab(id)}
          className={`px-3 py-1 rounded-lg text-[11px] font-bold border ${
            paletteTab === id ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
          }`}>
          {label}
        </button>
      ))}
    </div>
  ) : null;
  const {
    mode, setMode,
    selectedHandrailLength, setSelectedHandrailLength,
    selectedAntiWidth, setSelectedAntiWidth,
    selectedAntiLength, setSelectedAntiLength,
    addHandrail, addAnti, addPost, addObstacle,
    canvasData, setHandrailPreview, setSnapPoint,
    isDarkMode,
  } = useCanvasStore();
  const enabledSizes = useHandrailSettingsStore(s => s.enabledSizes);
  const unitSystem = useHandrailSettingsStore(s => s.unitSystem);
  // 部材設定に連動したサイズリスト（降順）
  const handrailLengths = useMemo<HandrailLengthMm[]>(
    () => [...enabledSizes].sort((a, b) => b - a),
    [enabledSizes],
  );
  // アンチは規格別の基本長さのうち、有効なものだけ
  const antiBaseLengths = unitSystem === 'inch' ? ANTI_BASE_LENGTHS_INCH : ANTI_BASE_LENGTHS_METRIC;
  const antiLengths = useMemo<number[]>(
    () => antiBaseLengths.filter(l => (enabledSizes as number[]).includes(l)),
    [enabledSizes, antiBaseLengths],
  );
  const [expanded, setExpanded] = useState(true);
  const [toolbarDrag, setToolbarDrag] = useState<ToolbarDrag | null>(null);
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [handrailAngle, setHandrailAngle] = useState<number | 'horizontal' | 'vertical'>('horizontal');
  const [showAngleModal, setShowAngleModal] = useState(false);
  const [trashHover, setTrashHover] = useState(false);
  const trashRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  // スマホ手摺プレビュー: タップ判定用（pointerdown 時の座標と 5px 以上動いたかのフラグ）
  const previewTapStartRef = useRef<{ x: number; y: number } | null>(null);
  const previewDraggedRef = useRef(false);

  // --- フローティングパネル状態 ---
  const defaultW = 600;
  const defaultH = 400;
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    return { x: Math.max(0, (window.innerWidth - defaultW) / 2), y: window.innerHeight - 72 - defaultH - 8 };
  });
  const [panelSize, setPanelSize] = useState({ w: defaultW, h: defaultH });
  const [panelDrag, setPanelDrag] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [panelResize, setPanelResize] = useState<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // パネルドラッグ
  useEffect(() => {
    if (!panelDrag) return;
    const onMove = (e: PointerEvent) => {
      setPanelPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, panelDrag.origX + e.clientX - panelDrag.startX)),
        y: Math.max(0, Math.min(window.innerHeight - 40, panelDrag.origY + e.clientY - panelDrag.startY)),
      });
    };
    const onUp = () => setPanelDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [panelDrag]);

  // パネルリサイズ
  useEffect(() => {
    if (!panelResize) return;
    const onMove = (e: PointerEvent) => {
      setPanelSize({
        w: Math.max(280, Math.min(900, panelResize.origW + e.clientX - panelResize.startX)),
        h: Math.max(120, Math.min(500, panelResize.origH + e.clientY - panelResize.startY)),
      });
    };
    const onUp = () => setPanelResize(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [panelResize]);

  // 障害物パネル用の状態
  const [selectedObstacleType, setSelectedObstacleType] = useState<ObstacleType | null>(null);
  const [obsWidthMm, setObsWidthMm] = useState(800);
  const [obsHeightMm, setObsHeightMm] = useState(300);
  const [obsRotation, setObsRotation] = useState(0);

  const selectObstacle = (type: ObstacleType) => {
    setSelectedObstacleType(type);
    const def = OBSTACLE_DEFAULTS[type];
    setObsWidthMm(def.w);
    setObsHeightMm(def.h);
    setObsRotation(0);
  };

  // --- 手摺ドラッグ ---
  const handleHandrailDown = useCallback(
    (lengthMm: HandrailLengthMm, angle: HandrailDirection, e: React.PointerEvent) => {
      e.preventDefault();
      setSelectedHandrailLength(lengthMm);
      setToolbarDrag({ type: 'handrail', lengthMm, direction: angle, currentX: e.clientX, currentY: e.clientY });
    }, [setSelectedHandrailLength]
  );

  // --- アンチドラッグ ---
  const handleAntiDown = useCallback(
    (lengthMm: number, width: AntiWidth, dir: 'horizontal' | 'vertical', e: React.PointerEvent) => {
      e.preventDefault();
      setSelectedAntiWidth(width);
      setSelectedAntiLength(lengthMm);
      setToolbarDrag({ type: 'anti', lengthMm, direction: dir, antiWidth: width, currentX: e.clientX, currentY: e.clientY });
    }, [setSelectedAntiWidth, setSelectedAntiLength]
  );

  // --- 支柱ドラッグ ---
  const handlePostDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setToolbarDrag({ type: 'post', currentX: e.clientX, currentY: e.clientY });
    }, []
  );

  // --- 障害物ドラッグ ---
  const handleObstacleDown = useCallback(
    (e: React.PointerEvent) => {
      if (!selectedObstacleType) return;
      e.preventDefault();
      const rw = obsRotation === 90 || obsRotation === 270 ? obsHeightMm : obsWidthMm;
      const rh = obsRotation === 90 || obsRotation === 270 ? obsWidthMm : obsHeightMm;
      setToolbarDrag({
        type: 'obstacle', obstacleType: selectedObstacleType,
        widthMm: rw, heightMm: rh, rotation: obsRotation,
        currentX: e.clientX, currentY: e.clientY,
      });
    }, [selectedObstacleType, obsWidthMm, obsHeightMm, obsRotation]
  );

  // --- 削除判定: パレットパネル全体にドロップで削除 ---
  const isOverTrash = useCallback((x: number, y: number): boolean => {
    // PC: フローティングパネル全体
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    // モバイル: 固定パレット全体
    if (mobilePanelRef.current) {
      const rect = mobilePanelRef.current.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    // フォールバック: 旧ゴミ箱エリア
    if (trashRef.current) {
      const rect = trashRef.current.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  }, []);

  // --- グローバルポインターイベント ---
  useEffect(() => {
    if (!toolbarDrag) return;

    const getCanvasRect = (e: PointerEvent): DOMRect | null => {
      const el = document.querySelector('.konvajs-content');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) return rect;
      return null;
    };

    const onMove = (e: PointerEvent) => {
      setToolbarDrag((prev) => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null);
      setTrashHover(isOverTrash(e.clientX, e.clientY));

      if (toolbarDrag.type === 'post') {
        // 支柱はプレビューなし
        useCanvasStore.getState().setHandrailPreview(null);
        useCanvasStore.getState().setSnapPoint(null);
        return;
      }

      if (toolbarDrag.type === 'obstacle') {
        useCanvasStore.getState().setHandrailPreview(null);
        useCanvasStore.getState().setSnapPoint(null);
        const cr = getCanvasRect(e);
        if (cr) {
          const { zoom, panX, panY, canvasData } = useCanvasStore.getState();
          const gridPos = screenToGrid(e.clientX - cr.left, e.clientY - cr.top, panX, panY, zoom);
          const wg = mmToGrid(toolbarDrag.widthMm);
          const hg = mmToGrid(toolbarDrag.heightMm);
          // 壁スナップを試行。成功ならその位置、失敗ならカーソル中心に配置
          const snapped = snapObstacleToWall(gridPos, wg, hg, canvasData.buildings);
          useCanvasStore.getState().setObstaclePreview({
            x: snapped ? snapped.x : gridPos.x - Math.round(wg / 2),
            y: snapped ? snapped.y : gridPos.y - Math.round(hg / 2),
            widthGrid: wg, heightGrid: hg,
            type: toolbarDrag.obstacleType,
          });
        } else {
          useCanvasStore.getState().setObstaclePreview(null);
        }
        return;
      }

      const canvasRect = getCanvasRect(e);
      if (canvasRect) {
        const { zoom, panX, panY, canvasData } = useCanvasStore.getState();
        const gridPos = screenToGrid(e.clientX - canvasRect.left, e.clientY - canvasRect.top, panX, panY, zoom);
        const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
        const result = snapHandrailPlacement(
          gridPos, toolbarDrag.lengthMm as HandrailLengthMm, toolbarDrag.direction,
          canvasData.handrails, snapRadius, canvasData.antis
        );
        const previewPos = result ? result.snappedStart : gridPos;
        useCanvasStore.getState().setSnapPoint(result ? result.snapIndicator : null);
        useCanvasStore.getState().setHandrailPreview({
          x: previewPos.x, y: previewPos.y,
          lengthMm: toolbarDrag.lengthMm, direction: toolbarDrag.direction,
        });
      } else {
        useCanvasStore.getState().setHandrailPreview(null);
        useCanvasStore.getState().setSnapPoint(null);
      }
    };

    const onUp = (e: PointerEvent) => {
      // ゴミ箱にドロップ → 配置キャンセル
      if (isOverTrash(e.clientX, e.clientY)) {
        setToolbarDrag(null);
        setTrashHover(false);
        useCanvasStore.getState().setHandrailPreview(null);
        useCanvasStore.getState().setObstaclePreview(null);
        useCanvasStore.getState().setSnapPoint(null);
        return;
      }

      const canvasRect = getCanvasRect(e);
      if (canvasRect && toolbarDrag) {
        const { zoom, panX, panY, canvasData, activeFloor } = useCanvasStore.getState();
        const gridPos = screenToGrid(e.clientX - canvasRect.left, e.clientY - canvasRect.top, panX, panY, zoom);

        if (toolbarDrag.type === 'handrail') {
          const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
          const result = snapHandrailPlacement(gridPos, toolbarDrag.lengthMm as HandrailLengthMm, toolbarDrag.direction, canvasData.handrails, snapRadius, canvasData.antis);
          const dropPos = result ? result.snappedStart : gridPos;
          if (result) { useCanvasStore.getState().setSnapPoint(result.snapIndicator); setTimeout(() => useCanvasStore.getState().setSnapPoint(null), 400); }
          // S-5e-4b: パレット drop の手摺に activeFloor を付与（従来は floor 未付与＝常に 1F 扱いの不具合）。
          //   activeFloor=1(単一階/既定)では従来と同一（h.floor ?? 1）。
          addHandrail({ id: uuidv4(), x: dropPos.x, y: dropPos.y, lengthMm: toolbarDrag.lengthMm as HandrailLengthMm, direction: toolbarDrag.direction, color: getHandrailColor(toolbarDrag.lengthMm as HandrailLengthMm), floor: activeFloor });
        } else if (toolbarDrag.type === 'anti') {
          const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
          const result = snapHandrailPlacement(gridPos, toolbarDrag.lengthMm as HandrailLengthMm, toolbarDrag.direction, canvasData.handrails, snapRadius, canvasData.antis);
          const dropPos = result ? result.snappedStart : gridPos;
          if (result) { useCanvasStore.getState().setSnapPoint(result.snapIndicator); setTimeout(() => useCanvasStore.getState().setSnapPoint(null), 400); }
          addAnti({ id: uuidv4(), x: dropPos.x, y: dropPos.y, width: toolbarDrag.antiWidth, lengthMm: toolbarDrag.lengthMm, direction: toolbarDrag.direction });
        } else if (toolbarDrag.type === 'post') {
          const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
          let snapX = gridPos.x;
          let snapY = gridPos.y;
          let bestDist = snapRadius;
          for (const h of canvasData.handrails) {
            const [p1, p2] = getHandrailEndpoints(h);
            for (const p of [p1, p2]) {
              const d = Math.hypot(p.x - gridPos.x, p.y - gridPos.y);
              if (d < bestDist) {
                bestDist = d;
                snapX = p.x;
                snapY = p.y;
              }
            }
          }
          addPost({ id: uuidv4(), x: snapX, y: snapY });
        } else if (toolbarDrag.type === 'obstacle') {
          const wGrid = mmToGrid(toolbarDrag.widthMm);
          const hGrid = mmToGrid(toolbarDrag.heightMm);

          // Phase M-6a-place: ピン優先吸着（最近傍角×最近傍ピン）
          const cx = gridPos.x;
          const cy = gridPos.y;
          const corners = toolbarDrag.obstacleType === 'custom_circle'
            ? [{ x: cx, y: cy }]
            : [
                { x: cx - wGrid / 2, y: cy - hGrid / 2 },
                { x: cx + wGrid / 2, y: cy - hGrid / 2 },
                { x: cx + wGrid / 2, y: cy + hGrid / 2 },
                { x: cx - wGrid / 2, y: cy + hGrid / 2 },
              ];
          const pins = canvasData.magnetPins ?? [];
          let bestPinSnap: { dx: number; dy: number; pinId: string } | null = null;
          let bestCorr = Infinity;
          for (const c of corners) {
            const snap = snapToMagnetPin(c, pins, zoom);
            if (snap) {
              const corr = Math.hypot(snap.dx, snap.dy);
              if (corr < bestCorr) {
                bestCorr = corr;
                bestPinSnap = snap;
              }
            }
          }

          let finalX: number;
          let finalY: number;
          if (bestPinSnap) {
            // ピン優先: 中心を補正してから左上算出
            finalX = Math.round(cx + bestPinSnap.dx - wGrid / 2);
            finalY = Math.round(cy + bestPinSnap.dy - hGrid / 2);
          } else {
            // ピン圏外: 既存の壁スナップ → カーソル中心配置
            const snapped = snapObstacleToWall(gridPos, wGrid, hGrid, canvasData.buildings);
            finalX = snapped ? snapped.x : gridPos.x - Math.round(wGrid / 2);
            finalY = snapped ? snapped.y : gridPos.y - Math.round(hGrid / 2);
          }
          addObstacle({ id: uuidv4(), type: toolbarDrag.obstacleType, x: finalX, y: finalY, width: wGrid, height: hGrid });
        }
      }

      setToolbarDrag(null);
      setTrashHover(false);
      useCanvasStore.getState().setHandrailPreview(null);
      useCanvasStore.getState().setObstaclePreview(null);
      // スナップインジケーターを確実にクリア（setTimeoutより後に実行されても安全）
      setTimeout(() => useCanvasStore.getState().setSnapPoint(null), 500);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [toolbarDrag, addHandrail, addAnti, addPost, addObstacle, isOverTrash]);

  if (mode === 'erase' || mode === 'building') return null;

  // E-8-v3c-fix2: 平面／立面の切替はタブで明示する。
  //   文脈の推測（立面を選択中か）だけに頼ると、何も選んでいない状態で「部材」を開いたときに
  //   平面へ落ちて「立面パレットが出ない」になる。推測は既定タブの決定にだけ使い、
  //   ユーザーはいつでも手で切り替えられるようにする。
  if (hasElevation && paletteTab === 'elevation') {
    return (
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-2 max-w-[94vw]">
        {paletteTabs}
        <ElevationPartPalette showText={false} />
        <p className="text-[10px] text-dimension">
          {targetViewLabel
            ? `立面図の部材（${targetViewLabel}に置きます）`
            : '立面図がありません。📐 から配置してください'}
        </p>
      </div>
    );
  }

  // タブ系モードかどうか（'view' = 図面を開いた直後の閲覧モード。 部材パレットを開いた時点で
  // タブ＋部材リストを表示する。 配置は mode 非依存のドラッグ&ドロップなのでこれだけで配置可能）
  const isTabMode = mode === 'handrail' || mode === 'post' || mode === 'anti' || mode === 'select' || mode === 'view';
  const activeTab: PartTab = (mode === 'handrail' || mode === 'post' || mode === 'anti') ? mode : 'handrail';

  // --- カーソル追従プレビュー ---
  const dragPreview = toolbarDrag && (
    toolbarDrag.type === 'post' ? (
      <div style={{ position: 'fixed', left: toolbarDrag.currentX, top: toolbarDrag.currentY, transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 9999 }}>
        <div style={{
          width: 16, height: 16, borderRadius: '50%',
          border: '3px solid #1a1a1a',
          backgroundColor: 'rgba(30,30,30,0.7)',
          boxShadow: '0 0 0 2px white, 0 0 8px rgba(0,0,0,0.5)',
        }} />
      </div>
    ) : (
      <div style={{ position: 'fixed', left: toolbarDrag.currentX, top: toolbarDrag.currentY - 20, transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 9999 }}>
        <div className={`${
          toolbarDrag.type === 'anti' ? 'bg-amber-500/80' :
          toolbarDrag.type === 'obstacle' ? 'bg-purple-500/80' : 'bg-handrail/80'
        } text-white text-xs font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap flex items-center gap-1`}>
          {toolbarDrag.type === 'obstacle' ? (
            <span>{OBSTACLE_TYPES.find(o => o.id === toolbarDrag.obstacleType)?.label}</span>
          ) : (
            <>
              <span>{toolbarDrag.direction === 'horizontal' ? '━' : toolbarDrag.direction === 'vertical' ? '┃' : `${toolbarDrag.direction}°`}</span>
              <span>{toolbarDrag.type === 'anti' ? `${toolbarDrag.antiWidth}×` : ''}{toolbarDrag.lengthMm}</span>
            </>
          )}
        </div>
      </div>
    )
  );

  const modeLabel = mode === 'obstacle' ? '障害物' : mode === 'memo' ? 'メモ' : '部材';
  const pos = panelPos;

  // --- 共通コンテンツ ---
  const dirSwitch = (
    <div className="flex rounded-lg border border-dark-border overflow-hidden">
      <button onClick={() => setDirection('horizontal')}
        className={`px-2.5 py-1 text-xs font-bold transition-colors ${
          direction === 'horizontal' ? 'bg-accent text-white' : 'bg-dark-bg text-dimension'
        }`}>━ 横</button>
      <button onClick={() => setDirection('vertical')}
        className={`px-2.5 py-1 text-xs font-bold transition-colors ${
          direction === 'vertical' ? 'bg-accent text-white' : 'bg-dark-bg text-dimension'
        }`}>┃ 縦</button>
    </div>
  );

  const ap = getAnglePreviewPoints(handrailAngle);
  const angleSelector = (
    <div className="space-y-1.5">
      <div className="flex gap-1 flex-wrap">
        {ANGLE_PRESETS.map((p) => (
          <button key={String(p.value)} onClick={() => setHandrailAngle(p.value)}
            className={`px-2 py-1 rounded text-xs font-bold transition-colors ${
              handrailAngle === p.value ? 'bg-accent text-white' : 'bg-dark-bg text-dimension border border-dark-border'
            }`}
          >{p.label}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <svg
          width={ap.W} height={ap.H}
          className="bg-dark-bg rounded-lg border border-dark-border cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => handleHandrailDown(selectedHandrailLength, handrailAngle, e)}
        >
          <line x1={ap.cx - ap.dx} y1={ap.cy - ap.dy} x2={ap.cx + ap.dx} y2={ap.cy + ap.dy}
            stroke="#378ADD" strokeWidth={3} strokeLinecap="round" />
          <circle cx={ap.cx - ap.dx} cy={ap.cy - ap.dy} r={3} fill="#378ADD" />
          <circle cx={ap.cx + ap.dx} cy={ap.cy + ap.dy} r={3} fill="#378ADD" />
        </svg>
        <div className="flex items-center gap-1">
          <NumInput
            value={typeof handrailAngle === 'number' ? handrailAngle : handrailAngle === 'horizontal' ? 0 : 90}
            onChange={(v) => setHandrailAngle(v)}
            min={0}
            className="w-16 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono"
          />
          <span className="text-[10px] text-dimension">°</span>
        </div>
        <div className="flex gap-0.5">
          <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) - 10)}
            className="px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors"
          >-10°</button>
          <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) - 1)}
            className="px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors"
          >-1°</button>
          <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + 1)}
            className="px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors"
          >+1°</button>
          <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + 10)}
            className="px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors"
          >+10°</button>
        </div>
      </div>
    </div>
  );

  const handrailButtons = (
    <div className="flex gap-1.5 overflow-x-auto sm:flex-wrap">
      {handrailLengths.map((l) => (
        <button key={`hr-${l}`} onClick={() => setSelectedHandrailLength(l)} onPointerDown={(e) => handleHandrailDown(l, handrailAngle, e)}
          className={`px-2 py-1.5 rounded-lg text-xs font-mono select-none touch-none shrink-0 ${selectedHandrailLength === l ? 'bg-handrail text-white' : 'bg-dark-bg text-canvas border border-dark-border'}`}
        >{l}</button>
      ))}
    </div>
  );

  // アンチ幅は規格別（メートル: 400/250、 インチ: 500/240）
  const antiWidthWide: AntiWidth = unitSystem === 'inch' ? 500 : 400;
  const antiWidthNarrow: AntiWidth = unitSystem === 'inch' ? 240 : 250;
  const antiButtons = (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-amber-500 font-bold w-7 shrink-0">{antiWidthWide}</span>
        <div className="flex gap-1 overflow-x-auto sm:flex-wrap">{antiLengths.map((l) => (
          <button key={`aw-${l}`} onPointerDown={(e) => handleAntiDown(l, antiWidthWide, direction, e)}
            className="px-2 py-1 rounded text-[11px] font-mono select-none touch-none shrink-0 bg-amber-600 text-white border border-amber-700">{l}</button>
        ))}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-yellow-600 font-bold w-7 shrink-0">{antiWidthNarrow}</span>
        <div className="flex gap-1 overflow-x-auto sm:flex-wrap">{antiLengths.map((l) => (
          <button key={`an-${l}`} onPointerDown={(e) => handleAntiDown(l, antiWidthNarrow, direction, e)}
            className="px-2 py-1 rounded text-[11px] font-mono select-none touch-none shrink-0 bg-yellow-500 text-gray-900 border border-yellow-600">{l}</button>
        ))}</div>
      </div>
    </div>
  );

  const trashArea = (
    <div
      ref={trashRef}
      className={`shrink-0 flex items-center justify-center gap-2 py-2 mx-2 mb-2 rounded-lg border-2 border-dashed transition-colors ${
        trashHover ? 'border-red-500 bg-red-500/20 text-red-400' : 'border-dark-border/60 text-dimension/60'
      }`}
    >
      <span className="text-sm">🗑️</span>
      <span className="text-[10px]">ドロップで削除</span>
    </div>
  );

  return (
    <>
      {/* ===== モバイル（sm未満）: 画面下部固定バー ===== */}
      <div ref={mobilePanelRef} data-palette-panel className={`sm:hidden fixed bottom-16 left-0 right-0 z-50 border-t ${isDarkMode ? 'bg-gray-300 border-gray-400' : 'bg-dark-surface/95 border-dark-border'}`}>
        {/* E-8-v3c-fix2: 平面／立面の切替（立面がある図面だけ出る） */}
        {paletteTabs && <div className="px-3 pt-2">{paletteTabs}</div>}
        {isTabMode && (
          <>
            {/* タブ */}
            <div className="flex border-b border-dark-border">
              {PART_TABS.map((tab) => (
                <button key={tab.id} onClick={() => setMode(tab.id)}
                  className={`flex-1 py-1.5 text-xs font-bold ${
                    activeTab === tab.id ? 'text-accent border-b-2 border-accent' : 'text-dimension'
                  }`}
                >{tab.label}</button>
              ))}
            </div>

            <div className="px-3 py-2">
              {activeTab === 'handrail' && (
                <div className="relative -my-[10px]">
                  {/* 角度モーダル: パネル上側にせり上がる */}
                  {showAngleModal && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 z-10 bg-dark-surface border border-dark-border rounded-lg shadow-lg p-2">
                      <div className="grid grid-cols-4 gap-2">
                        <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + 10)}
                          className="py-2 rounded-lg text-xs font-bold bg-dark-bg border border-dark-border text-canvas">+10°</button>
                        <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + 1)}
                          className="py-2 rounded-lg text-xs font-bold bg-dark-bg border border-dark-border text-canvas">+1°</button>
                        <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) - 10)}
                          className="py-2 rounded-lg text-xs font-bold bg-dark-bg border border-dark-border text-canvas">-10°</button>
                        <button onClick={() => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) - 1)}
                          className="py-2 rounded-lg text-xs font-bold bg-dark-bg border border-dark-border text-canvas">-1°</button>
                      </div>
                    </div>
                  )}

                  {/* メインレイアウト: [プレビュー+角度ボタン縦並び] | サイズ2行グリッド */}
                  <div className="flex items-stretch gap-2">
                    {/* 左: プレビュー(上) + 角度ボタン(下、10px) 縦並び */}
                    <div className="flex flex-col shrink-0">
                      <div className="w-20 h-20">
                        <svg
                          width={ap.W} height={ap.H}
                          className="block bg-dark-bg rounded-lg border border-dark-border cursor-pointer active:opacity-80 select-none"
                          style={{ touchAction: 'none' }}
                          onPointerDown={(e) => {
                            previewTapStartRef.current = { x: e.clientX, y: e.clientY };
                            previewDraggedRef.current = false;
                            handleHandrailDown(selectedHandrailLength, handrailAngle, e);
                          }}
                          onPointerMove={(e) => {
                            const s = previewTapStartRef.current;
                            if (!s) return;
                            if (Math.hypot(e.clientX - s.x, e.clientY - s.y) >= 5) {
                              previewDraggedRef.current = true;
                            }
                          }}
                          onPointerUp={() => {
                            if (previewTapStartRef.current && !previewDraggedRef.current) {
                              setHandrailAngle((prev) => {
                                if (prev === 'horizontal') return 'vertical';
                                if (prev === 'vertical') return 'horizontal';
                                return 'horizontal';
                              });
                            }
                            previewTapStartRef.current = null;
                            previewDraggedRef.current = false;
                          }}
                          onPointerCancel={() => {
                            previewTapStartRef.current = null;
                            previewDraggedRef.current = false;
                          }}
                        >
                          <line x1={ap.cx - ap.dx} y1={ap.cy - ap.dy} x2={ap.cx + ap.dx} y2={ap.cy + ap.dy}
                            stroke="#378ADD" strokeWidth={3} strokeLinecap="round" />
                          <circle cx={ap.cx - ap.dx} cy={ap.cy - ap.dy} r={3} fill="#378ADD" />
                          <circle cx={ap.cx + ap.dx} cy={ap.cy + ap.dy} r={3} fill="#378ADD" />
                        </svg>
                      </div>
                      <button
                        onClick={() => setShowAngleModal((v) => !v)}
                        className={`w-20 h-[20px] flex-none min-h-0 text-[8px] leading-none whitespace-nowrap overflow-hidden flex items-center justify-center rounded border transition-colors ${showAngleModal ? 'bg-accent text-white border-accent' : 'bg-dark-bg text-canvas border-dark-border'}`}
                      >
                        <span className="whitespace-nowrap leading-none">角度</span>
                      </button>
                    </div>

                    {/* 右: サイズ2行グリッド、列数 = ceil(N/2) */}
                    <div
                      className="flex-1 grid grid-rows-2 gap-1"
                      style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(handrailLengths.length / 2))}, minmax(0, 1fr))` }}
                    >
                      {handrailLengths.map((l) => (
                        <button key={`hr-m-${l}`}
                          onClick={() => setSelectedHandrailLength(l)}
                          onPointerDown={(e) => handleHandrailDown(l, handrailAngle, e)}
                          className={`w-full h-full rounded-lg text-[10px] font-mono select-none touch-none ${selectedHandrailLength === l ? 'bg-handrail text-white' : 'bg-dark-bg text-canvas border border-dark-border'}`}
                        >{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'post' && (
                <div className="flex items-center gap-2">
                  <button
                    onPointerDown={handlePostDown}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-bg border border-dark-border text-canvas text-sm select-none touch-none"
                  >
                    <span className="w-3 h-3 rounded-full bg-canvas inline-block" />
                    支柱をドラッグして配置
                  </button>
                </div>
              )}
              {activeTab === 'anti' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-dimension">ドラッグで配置</p>
                    {dirSwitch}
                  </div>
                  {antiButtons}
                </div>
              )}
            </div>
          </>
        )}

        {mode === 'obstacle' && (
          <div className="px-3 py-2 space-y-1.5">
            {/* 種類選択 */}
            <div className="flex gap-1.5 overflow-x-auto">
              {OBSTACLE_TYPES.map((o) => (
                <button key={o.id} data-tutorial-id={`obstacle-type-${o.id}`} onClick={() => selectObstacle(o.id)}
                  className={`px-2 py-1 rounded-lg text-[10px] shrink-0 ${selectedObstacleType === o.id ? 'ring-2 ring-accent' : ''}`}
                  style={{ backgroundColor: o.color, color: '#333' }}
                >{o.label}</button>
              ))}
            </div>
            {selectedObstacleType && (
              <>
                {/* サイズ入力 + 角度 */}
                <div className="flex items-end gap-1.5">
                  <div className="flex-1">
                    <label className="text-[9px] text-dimension">幅</label>
                    <MmInput value={obsWidthMm} onChange={setObsWidthMm} min={100} />
                  </div>
                  <span className="text-dimension text-[10px] pb-1">×</span>
                  <div className="flex-1">
                    <label className="text-[9px] text-dimension">{selectedObstacleType === 'custom_circle' ? '半径' : '奥行'}</label>
                    <MmInput value={obsHeightMm} onChange={setObsHeightMm} min={100} />
                  </div>
                  {selectedObstacleType !== 'custom_circle' && (
                    <div className="flex gap-0.5 shrink-0">
                      {[0, 90, 180, 270].map((deg) => (
                        <button key={deg} onClick={() => setObsRotation(deg)}
                          className={`w-7 h-7 rounded text-[10px] border ${
                            obsRotation === deg ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                          }`}
                        >{deg}°</button>
                      ))}
                    </div>
                  )}
                </div>
                {/* ドラッグして配置 + 壁方向入力 */}
                <div className="flex gap-1.5">
                  <div
                    data-tutorial-id="obstacle-place-area"
                    onPointerDown={handleObstacleDown}
                    className="flex-1 relative flex items-center justify-center h-11 rounded-lg border-2 border-dashed border-dark-border cursor-grab active:cursor-grabbing select-none touch-none"
                    style={{ backgroundColor: OBSTACLE_TYPES.find(o => o.id === selectedObstacleType)?.color + '30' }}
                  >
                    <div
                      className="rounded"
                      style={{
                        width: selectedObstacleType === 'custom_circle' ? 20 : Math.min(36, Math.max(14, obsWidthMm / 40)),
                        height: selectedObstacleType === 'custom_circle' ? 20 : Math.min(24, Math.max(10, obsHeightMm / 40)),
                        borderRadius: selectedObstacleType === 'custom_circle' ? '50%' : 2,
                        backgroundColor: OBSTACLE_TYPES.find(o => o.id === selectedObstacleType)?.color,
                        transform: `rotate(${obsRotation}deg)`,
                      }}
                    />
                    <span className="absolute bottom-0.5 text-[8px] text-dimension">ドラッグ配置</span>
                  </div>
                  {selectedObstacleType !== 'custom_circle' && (
                    <button
                      onClick={() => {
                        useCanvasStore.getState().setPendingTargetType('obstacle');
                        useCanvasStore.getState().setPendingObstacleType(selectedObstacleType);
                        useCanvasStore.getState().setBuildingInputMethod('direction');
                        useCanvasStore.getState().setMode('building');
                        useCanvasStore.getState().clearDirectionPoints();
                      }}
                      className="shrink-0 px-2 h-11 rounded-lg text-[10px] font-bold border border-dark-border text-dimension hover:text-accent hover:border-accent transition-colors"
                    >
                      🏗 壁方向
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'memo' && (
          <div className="px-3 py-2"><p className="text-xs text-dimension">タップしてメモを配置</p></div>
        )}
      </div>

      {/* ===== PC（sm以上）: フローティングパネル ===== */}
      <div
        ref={panelRef}
        data-palette-panel
        style={{
          left: pos.x, top: pos.y,
          width: panelSize.w, height: expanded ? panelSize.h : 'auto',
        }}
        className={`hidden sm:flex fixed z-50 opacity-95 flex-col rounded-xl shadow-2xl border ${isDarkMode ? 'bg-gray-300 border-gray-400 text-gray-800' : 'bg-dark-surface border-dark-border text-canvas'}`}
      >
        {/* ヘッダー（ドラッグハンドル） */}
        <div
          className="flex items-center justify-between px-3 py-1.5 cursor-grab active:cursor-grabbing select-none shrink-0 border-b border-dark-border"
          onPointerDown={(e) => {
            e.preventDefault();
            setPanelDrag({ startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y });
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-dimension text-sm leading-none">⠿</span>
            <span className="text-xs font-bold text-canvas">{modeLabel}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-dimension hover:text-canvas text-sm px-1 leading-none"
          >
            {expanded ? '－' : '＋'}
          </button>
        </div>

        {/* コンテンツ */}
        {expanded && (
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            {/* E-8-v3c-fix2: 平面／立面の切替（立面がある図面だけ出る） */}
            {paletteTabs && <div className="px-3 pt-2 shrink-0">{paletteTabs}</div>}
            {isTabMode && (
              <>
                <div className="flex border-b border-dark-border shrink-0">
                  {PART_TABS.map((tab) => (
                    <button key={tab.id} onClick={() => setMode(tab.id)}
                      className={`flex-1 py-1.5 text-xs font-bold transition-colors ${
                        activeTab === tab.id ? 'text-accent border-b-2 border-accent' : 'text-dimension hover:text-canvas'
                      }`}
                    >{tab.label}</button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-2">
                  {activeTab === 'handrail' && (
                    <div className="space-y-2">
                      <p className="text-xs text-dimension">ドラッグしてキャンバスに配置</p>
                      {angleSelector}
                      {handrailButtons}
                    </div>
                  )}

                  {activeTab === 'post' && (
                    <div className="space-y-3">
                      <p className="text-xs text-dimension">ドラッグしてキャンバスに配置</p>
                      <button
                        onPointerDown={handlePostDown}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-bg border border-dark-border text-canvas text-sm select-none touch-none cursor-grab active:cursor-grabbing"
                      >
                        <span className="w-3 h-3 rounded-full bg-canvas inline-block" />
                        支柱
                      </button>
                      <p className="text-[10px] text-dimension">手摺端点の近くで自動スナップします</p>
                    </div>
                  )}

                  {activeTab === 'anti' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-dimension">ドラッグしてキャンバスに配置</p>
                        {dirSwitch}
                      </div>
                      {antiButtons}
                    </div>
                  )}
                </div>
              </>
            )}

            {mode === 'obstacle' && (
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                <div>
                  <p className="text-xs text-dimension mb-2">障害物の種類</p>
                  <div className="flex flex-wrap gap-1.5">
                    {OBSTACLE_TYPES.map((o) => (
                      <button key={o.id} onClick={() => selectObstacle(o.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs ${selectedObstacleType === o.id ? 'ring-2 ring-accent' : ''}`}
                        style={{ backgroundColor: o.color, color: '#333' }}
                      >{o.label}</button>
                    ))}
                  </div>
                </div>
                {selectedObstacleType && (
                  <div className="bg-dark-bg rounded-xl p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-dimension">幅(mm)</label>
                        <MmInput value={obsWidthMm} onChange={setObsWidthMm} min={100} />
                      </div>
                      <span className="text-dimension mt-3">×</span>
                      <div className="flex-1">
                        <label className="text-[10px] text-dimension">{selectedObstacleType === 'custom_circle' ? '半径(mm)' : '奥行(mm)'}</label>
                        <MmInput value={obsHeightMm} onChange={setObsHeightMm} min={100} />
                      </div>
                    </div>
                    {selectedObstacleType !== 'custom_circle' && (
                      <div>
                        <label className="text-[10px] text-dimension">向き</label>
                        <div className="flex gap-1 mt-1">
                          {[0, 90, 180, 270].map((deg) => (
                            <button key={deg} onClick={() => setObsRotation(deg)}
                              className={`flex-1 py-1 rounded text-xs border transition-colors ${
                                obsRotation === deg ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                              }`}
                            >{deg}°</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div
                      onPointerDown={handleObstacleDown}
                      className="relative flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-dark-border cursor-grab active:cursor-grabbing select-none touch-none"
                      style={{ backgroundColor: OBSTACLE_TYPES.find(o => o.id === selectedObstacleType)?.color + '30' }}
                    >
                      <div
                        className="rounded"
                        style={{
                          width: selectedObstacleType === 'custom_circle' ? 32 : Math.min(60, Math.max(20, obsWidthMm / 30)),
                          height: selectedObstacleType === 'custom_circle' ? 32 : Math.min(40, Math.max(14, obsHeightMm / 30)),
                          borderRadius: selectedObstacleType === 'custom_circle' ? '50%' : 2,
                          backgroundColor: OBSTACLE_TYPES.find(o => o.id === selectedObstacleType)?.color,
                          transform: `rotate(${obsRotation}deg)`,
                        }}
                      />
                      <span className="absolute bottom-1 text-[10px] text-dimension">ドラッグして配置</span>
                    </div>
                    {selectedObstacleType !== 'custom_circle' && (
                      <div className="pt-1 border-t border-dark-border">
                        <button
                          onClick={() => {
                            useCanvasStore.getState().setPendingTargetType('obstacle');
                            useCanvasStore.getState().setPendingObstacleType(selectedObstacleType);
                            useCanvasStore.getState().setBuildingInputMethod('direction');
                            useCanvasStore.getState().setMode('building');
                            useCanvasStore.getState().clearDirectionPoints();
                          }}
                          className="w-full py-1.5 rounded text-[11px] font-bold border border-dark-border text-dimension hover:text-accent hover:border-accent transition-colors"
                        >
                          🏗 壁方向入力
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {mode === 'memo' && (
              <div className="px-3 py-2"><p className="text-xs text-dimension">タップしてメモを配置</p></div>
            )}

            {trashArea}
          </div>
        )}

        {/* リサイズハンドル */}
        {expanded && (
          <div
            className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5"
            onPointerDown={(e) => {
              e.preventDefault();
              setPanelResize({ startX: e.clientX, startY: e.clientY, origW: panelSize.w, origH: panelSize.h });
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-dimension/40">
              <path d="M9 1L1 9M9 4L4 9M9 7L7 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>

      {dragPreview}
    </>
  );
}
