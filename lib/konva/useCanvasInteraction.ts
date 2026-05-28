'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { screenToGrid, INITIAL_GRID_PX, mmToGrid } from './gridUtils';
import { snapToHandrail, snapHandrailPlacement, getHandrailEndpoints, snapToGridIntersection, getAllExistingVertices, getAllExistingEdges, snapToVertex, snapToEdge, snapObstacleToWall } from './snapUtils';
import { getHandrailColor } from './handrailColors';
import { getEdgeOverhangs, computeOffsetPolygon } from './roofUtils';
import { mmToGrid as toMmGrid } from './gridUtils';
import { Point, Handrail, HandrailDirection, HandrailLengthMm, Obstacle, CanvasData } from '@/types';

const SNAP_PX = 80;
const HIT_TOL = 25; // 手摺ヒット判定のグリッド許容差（250mm、タッチ操作対応）
let lastTouchTime = 0;

/** id からカテゴリを判別（move-select モード用） */
type MoveSelectCat = 'scaffold' | 'building' | 'obstacle' | 'memo';
function getCategoryFromId(id: string, canvasData: CanvasData): MoveSelectCat | null {
  if (canvasData.handrails.some(h => h.id === id)) return 'scaffold';
  if (canvasData.posts.some(p => p.id === id)) return 'scaffold';
  if (canvasData.antis.some(a => a.id === id)) return 'scaffold';
  if (canvasData.buildings.some(b => b.id === id)) return 'building';
  if (canvasData.obstacles.some(o => o.id === id)) return 'obstacle';
  if (canvasData.memos.some(m => m.id === id)) return 'memo';
  return null;
}

/** クリック位置に最も近い手摺を見つける（距離がHIT_TOL以内） */
function findHandrailAtPos(pos: Point, handrails: Handrail[]): Handrail | null {
  let best: Handrail | null = null;
  let bestDist = HIT_TOL;
  for (const h of handrails) {
    const [p1, p2] = getHandrailEndpoints(h);
    // 線分と点の最短距離
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) {
      const d = Math.hypot(pos.x - p1.x, pos.y - p1.y);
      if (d < bestDist) { bestDist = d; best = h; }
      continue;
    }
    const t = Math.max(0, Math.min(1, ((pos.x - p1.x) * dx + (pos.y - p1.y) * dy) / len2));
    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    const d = Math.hypot(pos.x - projX, pos.y - projY);
    if (d < bestDist) { bestDist = d; best = h; }
  }
  return best;
}

/** 寸法計測時のスナップ（頂点強・辺弱） */
function snapMeasurePoint(rawPos: Point, s: ReturnType<typeof useCanvasStore.getState>): Point {
  const STRONG_SNAP = 25;
  const WEAK_SNAP = 15;

  const gridX = rawPos.x;
  const gridY = rawPos.y;
  let snapX = gridX, snapY = gridY;
  let bestDist = Infinity;

  const vertices: { x: number; y: number }[] = [];
  const edges: { p1: { x: number; y: number }; p2: { x: number; y: number } }[] = [];

  // 建物
  for (const b of s.canvasData.buildings) {
    const pts = b.points;
    for (const p of pts) vertices.push(p);
    for (let i = 0; i < pts.length; i++) {
      edges.push({ p1: pts[i], p2: pts[(i + 1) % pts.length] });
    }
    // 屋根の出幅頂点・辺
    if (b.roof) {
      const overhangs = getEdgeOverhangs(b, b.roof);
      if (!overhangs.every(o => o === 0)) {
        const roofPts = computeOffsetPolygon(b.points, overhangs);
        for (const p of roofPts) vertices.push(p);
        for (let i = 0; i < roofPts.length; i++) {
          edges.push({ p1: roofPts[i], p2: roofPts[(i + 1) % roofPts.length] });
        }
      }
    }
  }

  // 障害物
  for (const o of s.canvasData.obstacles) {
    if (o.points) {
      for (const p of o.points) vertices.push(p);
      for (let i = 0; i < o.points.length; i++) {
        edges.push({ p1: o.points[i], p2: o.points[(i + 1) % o.points.length] });
      }
    } else if (o.type !== 'custom_circle') {
      const p1 = { x: o.x, y: o.y }, p2 = { x: o.x + o.width, y: o.y };
      const p3 = { x: o.x + o.width, y: o.y + o.height }, p4 = { x: o.x, y: o.y + o.height };
      vertices.push(p1, p2, p3, p4);
      edges.push({ p1, p2 }, { p1: p2, p2: p3 }, { p1: p3, p2: p4 }, { p1: p4, p2: p1 });
    }
  }

  // 手摺端点
  for (const h of s.canvasData.handrails) {
    const lengthGrid = Math.round(h.lengthMm / 10);
    vertices.push({ x: h.x, y: h.y });
    if (h.direction === 'horizontal') {
      vertices.push({ x: h.x + lengthGrid, y: h.y });
      edges.push({ p1: { x: h.x, y: h.y }, p2: { x: h.x + lengthGrid, y: h.y } });
    } else if (h.direction === 'vertical') {
      vertices.push({ x: h.x, y: h.y + lengthGrid });
      edges.push({ p1: { x: h.x, y: h.y }, p2: { x: h.x, y: h.y + lengthGrid } });
    } else {
      const rad = (h.direction as number) * Math.PI / 180;
      const ex = h.x + Math.round(lengthGrid * Math.cos(rad));
      const ey = h.y + Math.round(lengthGrid * Math.sin(rad));
      vertices.push({ x: ex, y: ey });
      edges.push({ p1: { x: h.x, y: h.y }, p2: { x: ex, y: ey } });
    }
  }

  // 壁方向入力の十字ガイド（directionPointsがあれば常にスナップ対象）
  if (s.directionPoints && s.directionPoints.length > 0) {
    const dpXs = s.directionPoints.map(p => p.x);
    const dpYs = s.directionPoints.map(p => p.y);
    // 交差点を頂点として追加（強スナップ）
    for (const x of dpXs) {
      for (const y of dpYs) {
        vertices.push({ x, y });
      }
    }
    // 縦線
    for (const x of dpXs) {
      edges.push({ p1: { x, y: gridY - 10000 }, p2: { x, y: gridY + 10000 } });
    }
    // 横線
    for (const y of dpYs) {
      edges.push({ p1: { x: gridX - 10000, y }, p2: { x: gridX + 10000, y } });
    }
  }

  // 頂点スナップ（強）
  for (const v of vertices) {
    const d = Math.hypot(v.x - gridX, v.y - gridY);
    if (d < STRONG_SNAP && d < bestDist) {
      bestDist = d;
      snapX = v.x; snapY = v.y;
    }
  }

  // 辺スナップ（頂点スナップが優先）
  if (bestDist >= STRONG_SNAP) {
    for (const e of edges) {
      const dx = e.p2.x - e.p1.x, dy = e.p2.y - e.p1.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((gridX - e.p1.x) * dx + (gridY - e.p1.y) * dy) / len2));
      const projX = e.p1.x + t * dx;
      const projY = e.p1.y + t * dy;
      const d = Math.hypot(gridX - projX, gridY - projY);
      if (d < WEAK_SNAP && d < bestDist) {
        bestDist = d;
        snapX = Math.round(projX); snapY = Math.round(projY);
      }
    }
  }

  return { x: snapX, y: snapY };
}

/** クリック位置に含まれる障害物を見つける */
function findObstacleAtPos(pos: Point, obstacles: Obstacle[]): Obstacle | null {
  for (const o of obstacles) {
    if (o.points && o.points.length >= 3) {
      // ポリゴン障害物: point-in-polygon
      let inside = false;
      const n = o.points.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = o.points[i].x, yi = o.points[i].y;
        const xj = o.points[j].x, yj = o.points[j].y;
        if ((yi > pos.y) !== (yj > pos.y) &&
            pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) return o;
    } else if (o.type === 'custom_circle') {
      // 円障害物
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      const r = Math.max(o.width, o.height) / 2;
      if (Math.hypot(pos.x - cx, pos.y - cy) <= r) return o;
    } else {
      // 矩形障害物
      if (pos.x >= o.x && pos.x <= o.x + o.width &&
          pos.y >= o.y && pos.y <= o.y + o.height) return o;
    }
  }
  return null;
}

function snapRadiusGrid(zoom: number) {
  return Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
}

/** カーソル位置にスナップを適用して返す（始点+終点の両方チェック） */
function applySnap(pos: Point, direction?: 'horizontal' | 'vertical'): Point {
  const s = useCanvasStore.getState();
  if (s.mode !== 'handrail' && s.mode !== 'anti') return pos;

  const radius = snapRadiusGrid(s.zoom);
  const dir = direction || 'horizontal';
  const result = snapHandrailPlacement(pos, s.selectedHandrailLength, dir, s.canvasData.handrails, radius, s.canvasData.antis);
  if (result) {
    s.setSnapPoint(result.snapIndicator);
    return result.snappedStart;
  }
  s.setSnapPoint(null);
  return pos;
}

/** ドロップ位置がパレットパネル上かどうかを判定 */
function isDropOnPalette(clientX: number, clientY: number): boolean {
  // data属性でパレットパネルを検索
  const panels = document.querySelectorAll('[data-palette-panel]');
  for (let i = 0; i < panels.length; i++) {
    const rect = panels[i].getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
      return true;
    }
  }
  return false;
}

export function useCanvasInteraction() {
  const dragStart = useRef<Point | null>(null);
  const isDragging = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLongPress, setIsLongPress] = useState(false);
  const touchDragReady = useRef(false); // 長押し完了後のみtrue
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** ドラッグ移動中の手摺情報（全モード共通） */
  const movingElementId = useRef<string | null>(null);
  const movingHandrail = useRef<Handrail | null>(null);
  const isDuplicating = useRef(false);
  const isDuplicateMode = useRef(false); // 複製ボタンON/OFFの状態
  /** window レベルのドラッグ追跡用（キャンバス外でも動作） */
  const stageRef = useRef<Konva.Stage | null>(null);
  // move-select: 空キャンバスで mousedown したかフラグ (ラバーバンド開始条件)
  const moveSelectRubberBandArmed = useRef(false);
  // area-designation: 空キャンバスで mousedown したかフラグ (= ラバーバンド開始条件、 平米計算 Phase D-2-c)
  const areaDesignationRubberBandArmed = useRef(false);

  // キャンバス外でのドラッグ追跡: window の pointer/touch イベントを使用
  useEffect(() => {
    const getClientPos = (e: PointerEvent | TouchEvent): { clientX: number; clientY: number } => {
      if ('touches' in e) {
        const t = (e as TouchEvent).touches[0] || (e as TouchEvent).changedTouches[0];
        return { clientX: t?.clientX ?? 0, clientY: t?.clientY ?? 0 };
      }
      return { clientX: (e as PointerEvent).clientX, clientY: (e as PointerEvent).clientY };
    };

    const onWindowMove = (e: PointerEvent | TouchEvent) => {
      if (!movingElementId.current || !stageRef.current) return;
      // タッチ由来のイベントか判定（TouchEvent と PointerEvent のタッチモード両方に対応）
      const isTouchEvent =
        'touches' in e ||
        (typeof PointerEvent !== 'undefined' && e instanceof PointerEvent && e.pointerType === 'touch');
      // タッチ操作で長押し未完了なら移動しない
      if (isTouchEvent && !touchDragReady.current) return;
      // dragStartがnullでも、movingElementIdがあれば初期化して続行
      if (!dragStart.current) {
        const { clientX, clientY } = getClientPos(e);
        const s = useCanvasStore.getState();
        const rect = stageRef.current.container().getBoundingClientRect();
        const gridPos = screenToGrid(clientX - rect.left, clientY - rect.top, s.panX, s.panY, s.zoom);
        dragStart.current = gridPos;
        return;
      }
      const { clientX, clientY } = getClientPos(e);
      const s = useCanvasStore.getState();
      const rect = stageRef.current.container().getBoundingClientRect();
      const gridPos = screenToGrid(clientX - rect.left, clientY - rect.top, s.panX, s.panY, s.zoom);

      const dx = gridPos.x - dragStart.current.x;
      const dy = gridPos.y - dragStart.current.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        if (!isDragging.current) {
          s.pushHistory();
        }
        isDragging.current = true;
        s.moveElement(movingElementId.current!, dx, dy);
        dragStart.current = gridPos;
      }
    };

    const onWindowUp = (e: PointerEvent | TouchEvent) => {
      if (!movingElementId.current) return;
      const { clientX, clientY } = getClientPos(e);
      const s = useCanvasStore.getState();

      if (isDragging.current) {
        if (isDropOnPalette(clientX, clientY)) {
          // パレット上にドロップ → 削除
          s.removeElement(movingElementId.current!);
          s.setSelectedIds([]);
          s.setSnapPoint(null);
        } else {
          // キャンバス上にドロップ → スナップ適用
          const currentH = s.canvasData.handrails.find(h => h.id === movingElementId.current);
          const currentObs = !currentH ? s.canvasData.obstacles.find(o => o.id === movingElementId.current) : null;
          if (currentH) {
            const dir = typeof currentH.direction === 'string' ? currentH.direction : 'horizontal';
            const otherHandrails = s.canvasData.handrails.filter(h => h.id !== movingElementId.current);
            const result = snapHandrailPlacement(
              { x: currentH.x, y: currentH.y },
              currentH.lengthMm, dir as 'horizontal' | 'vertical',
              otherHandrails, snapRadiusGrid(s.zoom), s.canvasData.antis,
            );
            if (result) {
              const snapDx = result.snappedStart.x - currentH.x;
              const snapDy = result.snappedStart.y - currentH.y;
              if (Math.abs(snapDx) > 0 || Math.abs(snapDy) > 0) {
                s.moveElement(movingElementId.current!, snapDx, snapDy);
              }
              s.setSnapPoint(result.snapIndicator);
              setTimeout(() => s.setSnapPoint(null), 400);
            } else {
              s.setSnapPoint(null);
            }
          } else if (currentObs) {
            // 障害物: 中心を基準に壁スナップ
            const center = { x: currentObs.x + currentObs.width / 2, y: currentObs.y + currentObs.height / 2 };
            const snapped = snapObstacleToWall(center, currentObs.width, currentObs.height, s.canvasData.buildings);
            if (snapped) {
              const snapDx = snapped.x - currentObs.x;
              const snapDy = snapped.y - currentObs.y;
              if (snapDx !== 0 || snapDy !== 0) {
                s.moveElement(movingElementId.current!, snapDx, snapDy);
              }
            }
          }
        }
      }

      movingElementId.current = null;
      movingHandrail.current = null;
      isDragging.current = false;
      dragStart.current = null;
      touchDragReady.current = false;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('touchmove', onWindowMove as EventListener);
    window.addEventListener('touchend', onWindowUp as EventListener);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('touchmove', onWindowMove as EventListener);
      window.removeEventListener('touchend', onWindowUp as EventListener);
    };
  }, []);

  // 画面座標をグリッド座標に変換
  const toGrid = useCallback(
    (stage: Konva.Stage, evt: { clientX: number; clientY: number }) => {
      const rect = stage.container().getBoundingClientRect();
      const s = useCanvasStore.getState();
      return screenToGrid(evt.clientX - rect.left, evt.clientY - rect.top, s.panX, s.panY, s.zoom);
    },
    []
  );

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if ('touches' in e.evt && (e.evt as TouchEvent).touches.length >= 2) return;
      if ('button' in e.evt && ((e.evt as MouseEvent).button === 1 || (e.evt as MouseEvent).button === 2)) return;

      const stage = e.target.getStage();
      if (!stage) return;

      const clientPos =
        'touches' in e.evt
          ? { clientX: (e.evt as TouchEvent).touches[0].clientX, clientY: (e.evt as TouchEvent).touches[0].clientY }
          : { clientX: (e.evt as MouseEvent).clientX, clientY: (e.evt as MouseEvent).clientY };

      const rawPos = toGrid(stage, clientPos);
      const s = useCanvasStore.getState();

      // 平米計算 1F足場指定モード: 他 mode handler 競合回避の早期分岐 (= 平米計算 Phase D-2-c)
      if (s.isAreaDesignationMode) {
        if (e.target === stage) {
          // 空キャンバス → ラバーバンド arm
          areaDesignationRubberBandArmed.current = true;
          dragStart.current = rawPos;
          isDragging.current = false;
        }
        // Handrail Line への hit は ScaffoldLayer onClick で処理 → ここでは何もしない
        return;
      }

      // 寸法計測モード
      if (s.isMeasuring) {
        // タッチイベント後500ms以内のmousedownは無視（ゴースト発火対策）
        if (e.type === 'mousedown' && Date.now() - lastTouchTime < 500) {
          return;
        }
        if (e.type === 'touchstart') {
          lastTouchTime = Date.now();
        }

        // タッチイベントの場合はchangedTouchesから直接座標を取得
        let measurePos = rawPos;
        const evt = e.evt;
        if ('changedTouches' in evt && (evt as TouchEvent).changedTouches.length > 0) {
          const touch = (evt as TouchEvent).changedTouches[0];
          const rect = stage.container().getBoundingClientRect();
          const { panX, panY, zoom } = useCanvasStore.getState();
          measurePos = screenToGrid(touch.clientX - rect.left, touch.clientY - rect.top, panX, panY, zoom);
        }
        const snapped = snapMeasurePoint(measurePos, s);
        if (!s.measurePoint1) {
          s.setMeasurePoint1(snapped);
          s.setMeasurePoint2(null);
        } else if (!s.measurePoint2) {
          const finalPos = { ...snapped };
          if (s.measureAxisMode === 'x') finalPos.y = s.measurePoint1.y;
          else if (s.measureAxisMode === 'y') finalPos.x = s.measurePoint1.x;
          const dx = (finalPos.x - s.measurePoint1.x) * 10;
          const dy = (finalPos.y - s.measurePoint1.y) * 10;
          s.setMeasureResultMm(Math.round(Math.sqrt(dx * dx + dy * dy)));
          s.setMeasurePoint2(finalPos);
          s.setMeasureCursor(null);
        } else {
          s.setMeasurePoint1(snapped);
          s.setMeasurePoint2(null);
          s.setMeasureResultMm(null);
        }
        return;
      }

      // 全モード共通: クリック位置に既存要素があれば選択 or 移動
      const hitHandrail = findHandrailAtPos(rawPos, s.canvasData.handrails);
      const hitPost = s.canvasData.posts.find(p => Math.hypot(p.x - rawPos.x, p.y - rawPos.y) < HIT_TOL);
      const hitAnti = s.canvasData.antis.find(a => Math.hypot(a.x - rawPos.x, a.y - rawPos.y) < HIT_TOL);
      const hitObstacle = findObstacleAtPos(rawPos, s.canvasData.obstacles);
      const hitElement = hitHandrail || hitPost || hitAnti || hitObstacle;

      if (hitElement && s.mode !== 'post' && s.mode !== 'erase') {
        const isTouchEvent = 'touches' in e.evt;
        if (isTouchEvent) {
          stageRef.current = stage;
          if (hitHandrail) {
            if (s.isDuplicateMode) {
              const newH = { ...hitHandrail, id: uuidv4() };
              s.addHandrail(newH);
              movingHandrail.current = { ...hitHandrail };
              movingElementId.current = newH.id;
            } else {
              movingHandrail.current = { ...hitHandrail };
              movingElementId.current = hitHandrail.id;
            }
          } else {
            movingElementId.current = hitElement.id;
          }
          dragStart.current = rawPos;
          isDragging.current = false;
          // 500ms長押しで選択+ドラッグ可能に
          s.setSelectedIds([]);
          touchDragReady.current = false;
          longPressTimer.current = setTimeout(() => {
            touchDragReady.current = true;
            s.setSelectedIds([movingElementId.current!]);
            try { navigator.vibrate?.(50); } catch (_) {}
          }, 500);
          return;
        }
        // PC: Alt+ドラッグで複製、通常は移動（window イベント方式）
        stageRef.current = stage;
        const isAlt = 'altKey' in e.evt && (e.evt as MouseEvent).altKey;
        if (isAlt) {
          if (hitHandrail) {
            const newH = { ...hitHandrail, id: uuidv4() };
            s.addHandrail(newH);
            movingElementId.current = newH.id;
          } else if (hitPost) {
            const newP = { ...hitPost, id: uuidv4() };
            s.addPost(newP);
            movingElementId.current = newP.id;
          } else if (hitAnti) {
            const newA = { ...hitAnti, id: uuidv4() };
            s.addAnti(newA);
            movingElementId.current = newA.id;
          }
        } else {
          movingElementId.current = hitElement.id;
        }
        dragStart.current = rawPos;
        isDragging.current = false;
        s.setSelectedIds([movingElementId.current!]);
        return;
      }

      // ヒットなし → 通常のモード処理
      movingElementId.current = null;
      movingHandrail.current = null;
      isDuplicating.current = false;

      const gridPos = applySnap(rawPos);
      dragStart.current = gridPos;
      isDragging.current = false;

      // select モード: 長押し検出
      if (s.mode === 'select') {
        longPressTimer.current = setTimeout(() => setIsLongPress(true), 500);
      }

      // post モード: クリックで支柱配置（手摺端部にスナップ成功時のみ配置）
      if (s.mode === 'post') {
        const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * s.zoom)), 5);
        let bestDist = snapRadius;
        let snapped: { x: number; y: number } | null = null;
        for (const h of s.canvasData.handrails) {
          const [p1, p2] = getHandrailEndpoints(h);
          for (const p of [p1, p2]) {
            const d = Math.hypot(p.x - rawPos.x, p.y - rawPos.y);
            if (d < bestDist) {
              bestDist = d;
              snapped = { x: p.x, y: p.y };
            }
          }
        }
        if (snapped) {
          s.addPost({ id: uuidv4(), x: snapped.x, y: snapped.y });
        }
        return;
      }
      // memo モード
      if (s.mode === 'memo') {
        if (s.memoDraft) {
          // 平米計算 Phase E-4a: source は clearMemoDraft で reset されるため先に保持
          const fromAreaCalc = s.memoDraftSource === 'area-calc';
          s.addMemo({
            id: uuidv4(),
            x: rawPos.x,
            y: rawPos.y,
            text: s.memoDraft.text,
            style: s.memoDraft.shape,
            shape: s.memoDraft.shape,
            angle: s.memoDraft.angle,
            scaleX: s.memoDraft.scaleX,
            scaleY: s.memoDraft.scaleY,
          });
          s.clearMemoDraft();
          if (!fromAreaCalc) s.setShowMemoCreateModal(true);
        } else {
          s.setShowMemoCreateModal(true);
        }
      }

      // obstacle モード: クリック配置は無効化（パレットからのD&Dのみ）

      // building + direction モード: 起点をタップしてモーダル表示
      if (s.mode === 'building' && s.buildingInputMethod === 'direction') {
        if (s.directionPoints.length === 0) {
          // 強スナップ: 既存建物・障害物の頂点
          const existVerts = getAllExistingVertices(s.canvasData.buildings, s.canvasData.obstacles);
          let snapped = snapToVertex(rawPos.x, rawPos.y, existVerts, s.zoom, 30);
          // 次: グリッド交点マグネット
          if (!snapped) snapped = snapToGridIntersection(rawPos.x, rawPos.y, s.zoom);
          // 次: 辺への弱スナップ
          if (!snapped) {
            const existEdges = getAllExistingEdges(s.canvasData.buildings, s.canvasData.obstacles);
            snapped = snapToEdge(rawPos.x, rawPos.y, existEdges, s.zoom, 10);
          }
          // フォールバック
          if (!snapped) snapped = { x: Math.round(rawPos.x), y: Math.round(rawPos.y) };
          s.addDirectionPoint(snapped);
          s.setShowDirectionInputModal(true);
        }
        dragStart.current = null;
        return;
      }


      // erase モード
      if (s.mode === 'erase') {
        const target = e.target;
        if (target !== stage && target.id()) s.removeElement(target.id());
      }

      // select モード（ドラッグ移動中でなければ選択更新）
      if (s.mode === 'select' && !isLongPress && !isDragging.current) {
        const target = e.target;
        if (target === stage) s.setSelectedIds([]);
        else if (target.id()) s.setSelectedIds([target.id()]);
      }

      // move-select モード: 空キャンバスなら arm (ラバーバンド)、要素ならタップでトグル
      if (s.mode === 'move-select' && !isDragging.current) {
        const target = e.target;
        if (target === stage) {
          moveSelectRubberBandArmed.current = true;
        } else if (target.id()) {
          moveSelectRubberBandArmed.current = false;
          const id = target.id();
          const cat = getCategoryFromId(id, s.canvasData);
          if (cat && s.moveSelectMode.categories[cat]) {
            s.toggleMoveSelectId(id);
            const { dxMm, dyMm } = useCanvasStore.getState().moveSelectMode;
            s.shiftMoveSelected(dxMm, dyMm);
          }
        }
      }
    },
    [toGrid, isLongPress]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if ('touches' in e.evt && (e.evt as TouchEvent).touches.length >= 2) return;

      const stage = e.target.getStage();
      if (!stage) return;

      const clientPos =
        'touches' in e.evt
          ? { clientX: (e.evt as TouchEvent).touches[0].clientX, clientY: (e.evt as TouchEvent).touches[0].clientY }
          : { clientX: (e.evt as MouseEvent).clientX, clientY: (e.evt as MouseEvent).clientY };

      const s = useCanvasStore.getState();

      // 平米計算 1F足場指定モード: ラバーバンドのみ動作 (= 平米計算 Phase D-2-c)
      if (s.isAreaDesignationMode) {
        if (!dragStart.current || !areaDesignationRubberBandArmed.current) return;
        const gridPos = toGrid(stage, clientPos);
        setSelectionRect({
          x: Math.min(dragStart.current.x, gridPos.x),
          y: Math.min(dragStart.current.y, gridPos.y),
          w: Math.abs(gridPos.x - dragStart.current.x),
          h: Math.abs(gridPos.y - dragStart.current.y),
        });
        return;
      }

      // 寸法計測モード
      if (s.isMeasuring && s.measurePoint1) {
        const raw = toGrid(stage, clientPos);
        const snapped = snapMeasurePoint(raw, s);
        const final = { ...snapped };
        if (s.measureAxisMode === 'x') final.y = s.measurePoint1.y;
        else if (s.measureAxisMode === 'y') final.x = s.measurePoint1.x;
        s.setMeasureCursor(final);
        return;
      }

      if (!dragStart.current) return;
      isDragging.current = true;

      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      const gridPos = toGrid(stage, clientPos);

      // 手摺モード: ドラッグ中もスナップしてプレビュー表示
      if (s.mode === 'handrail' && dragStart.current) {
        const dx = Math.abs(gridPos.x - dragStart.current.x);
        const dy = Math.abs(gridPos.y - dragStart.current.y);
        if (dx > 2 || dy > 2) {
          const direction: 'horizontal' | 'vertical' = dx >= dy ? 'horizontal' : 'vertical';
          // ドラッグ開始点を始点+終点の両方でスナップ
          const snappedStart = applySnap(dragStart.current, direction);
          dragStart.current = snappedStart;

          s.setHandrailPreview({
            x: snappedStart.x,
            y: snappedStart.y,
            lengthMm: s.selectedHandrailLength,
            direction,
          });
        }
      }

      // 手摺ドラッグ移動中は window イベントで処理するためスキップ
      if (movingElementId.current) return;

      // select + longPress または move-select (空キャンバス起点): 範囲選択矩形
      const canRubberBand =
        (s.mode === 'select' && isLongPress) ||
        (s.mode === 'move-select' && moveSelectRubberBandArmed.current);
      if (canRubberBand) {
        setSelectionRect({
          x: Math.min(dragStart.current.x, gridPos.x),
          y: Math.min(dragStart.current.y, gridPos.y),
          w: Math.abs(gridPos.x - dragStart.current.x),
          h: Math.abs(gridPos.y - dragStart.current.y),
        });
      }

      // erase モード
      if (s.mode === 'erase') {
        const target = e.target;
        if (target !== stage && target.id()) s.removeElement(target.id());
      }
    },
    [toGrid, isLongPress]
  );

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      const stage = e.target.getStage();
      if (!stage) return;

      const clientPos =
        'changedTouches' in e.evt
          ? { clientX: (e.evt as TouchEvent).changedTouches[0].clientX, clientY: (e.evt as TouchEvent).changedTouches[0].clientY }
          : { clientX: (e.evt as MouseEvent).clientX, clientY: (e.evt as MouseEvent).clientY };

      const gridPos = toGrid(stage, clientPos);
      const s = useCanvasStore.getState();

      // 平米計算 1F足場指定モード: ラバーバンド確定 → 個別反転 (= 平米計算 Phase D-2-c)
      if (s.isAreaDesignationMode && areaDesignationRubberBandArmed.current) {
        if (selectionRect) {
          const rect = selectionRect;
          const inRect = (p: { x: number; y: number }) =>
            p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.w && p.y <= rect.y + rect.h;
          const ids: string[] = [];
          s.canvasData.handrails.forEach((h) => {
            const [p1, p2] = getHandrailEndpoints(h);
            if (inRect(p1) || inRect(p2)) ids.push(h.id);
          });
          if (ids.length > 0) s.toggleHandrailsBulk(ids);
          setSelectionRect(null);
        }
        areaDesignationRubberBandArmed.current = false;
        dragStart.current = null;
        isDragging.current = false;
        return;
      }

      // 手摺モード: キャンバスドラッグでの配置は無効化（パレットD&Dのみ）
      s.setHandrailPreview(null);
      if (!s.snapPoint) s.setSnapPoint(null);

      // アンチモード: キャンバスドラッグでの配置は無効化（パレットD&Dのみ）

      // 手摺ドラッグ移動完了は window イベントで処理（キャンバス外対応）

      // 範囲選択完了
      if (s.mode === 'select' && isLongPress && selectionRect) {
        const rect = selectionRect;
        const ids: string[] = [];
        s.canvasData.handrails.forEach((h) => {
          if (h.x >= rect.x && h.y >= rect.y && h.x <= rect.x + rect.w && h.y <= rect.y + rect.h) ids.push(h.id);
        });
        s.canvasData.posts.forEach((p) => {
          if (p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.w && p.y <= rect.y + rect.h) ids.push(p.id);
        });
        s.canvasData.antis.forEach((a) => {
          if (a.x >= rect.x && a.y >= rect.y && a.x <= rect.x + rect.w && a.y <= rect.y + rect.h) ids.push(a.id);
        });
        s.setSelectedIds(ids);
        setSelectionRect(null);
      }

      // move-select: ラバーバンド確定 or 空タップで選択解除
      if (s.mode === 'move-select' && moveSelectRubberBandArmed.current) {
        const cats = s.moveSelectMode.categories;
        if (selectionRect) {
          const rect = selectionRect;
          const inRect = (p: { x: number; y: number }) =>
            p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.w && p.y <= rect.y + rect.h;
          const ids: string[] = [];
          if (cats.scaffold) {
            s.canvasData.handrails.forEach((h) => { if (inRect(h)) ids.push(h.id); });
            s.canvasData.posts.forEach((p) => { if (inRect(p)) ids.push(p.id); });
            s.canvasData.antis.forEach((a) => { if (inRect(a)) ids.push(a.id); });
          }
          if (cats.building) {
            s.canvasData.buildings.forEach((b) => {
              // 建物はいずれかの頂点が矩形内なら選択
              if (b.points.some(inRect)) ids.push(b.id);
            });
          }
          if (cats.obstacle) {
            s.canvasData.obstacles.forEach((o) => {
              const cx = o.x + o.width / 2;
              const cy = o.y + o.height / 2;
              if (inRect({ x: cx, y: cy }) || (o.points && o.points.some(inRect))) ids.push(o.id);
            });
          }
          if (cats.memo) {
            s.canvasData.memos.forEach((m) => { if (inRect(m)) ids.push(m.id); });
          }
          s.setMoveSelectIds(ids);
          setSelectionRect(null);
        } else {
          // 空キャンバスタップ (ドラッグなし) → 選択解除
          s.clearMoveSelectIds();
        }
        // shift を再適用（新選択 or 解除に応じて backup からの差分を再計算）
        const { dxMm, dyMm } = useCanvasStore.getState().moveSelectMode;
        s.shiftMoveSelected(dxMm, dyMm);
        moveSelectRubberBandArmed.current = false;
      }

      setIsLongPress(false);
      dragStart.current = null;
      isDragging.current = false;
    },
    [toGrid, isLongPress, selectionRect]
  );

  return {
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    selectionRect,
    isDuplicateMode,
  };
}
