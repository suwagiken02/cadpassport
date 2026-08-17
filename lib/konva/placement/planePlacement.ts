// ============================================================
// 平面部材の配置 (= P-2 / P-2-fix)
//
// 置き方は 2 つあるが、処理は 1 本:
//   ・パレットから掴んで引き出す（ドラッグ&ドロップ）
//   ・パレットで選んでおいてキャンバスをクリック
// どちらも updatePlanePreview → placePlanePart を通る。
//
// ■ コンポーネントの外に置いてある理由 (= P-2-fix)
// もとは PartSelector の中に useCallback で書いていたが、その中に
// ドラッグ状態(toolbarDrag)への参照が残っていた。依存配列が安定だったため
// **初回の null を永久に捕まえ**、条件が常に偽になって「どちらの置き方でも
// 置けない」状態になっていた。
// ここには drag(何を置くか) と gridPos(どこへ置くか) しか渡らないので、
// 同じ事故が構造的に起こらない。
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX, mmToGrid } from '@/lib/konva/gridUtils';
import {
  snapHandrailPlacement, snapObstacleToWall, snapToMagnetPin, snapPostToHandrailEnds,
} from '@/lib/konva/snapUtils';
import { getHandrailColor } from '@/lib/konva/handrailColors';
import { snapStairToCell } from '@/lib/konva/planeParts';
import type { PlacePayload } from '@/components/toolbar/placePayload';
import type { HandrailLengthMm, Point } from '@/types';

/** 手摺の端点へ吸着する画面距離(px)。 */
const SNAP_PX = 80;

/** シャドー（置かれる姿）の更新。gridPos が null＝キャンバスの外。 */
export function updatePlanePreview(drag: PlacePayload, gridPos: Point | null): void {
  // P-3: ゴーストの入れ物は 3 つ（handrailPreview / planePartPreview / obstaclePreview）
  //   あるのに、分岐ごとに「自分が使う入れ物」しか消していなかった。そのため部材を
  //   持ち替えると**前の部材のゴーストがキャンバスに残り**、新しい部材のゴーストが
  //   出ていないように見えていた（支柱→アンチ、階段→アンチ など）。
  //   毎回**全部消してから 1 つだけ立てる**ことで、同じ取りこぼしが起こらなくなる。
  clearPlanePreviews();
  if (!gridPos) return;

  const s = useCanvasStore.getState();
  const { zoom, canvasData } = s;
  const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);

  // P-2: 支柱にもシャドーを出す（他の部材と揃える）。吸着後の位置に出るので、
  //   どの手摺の端に付くかが置く前に分かる。
  if (drag.type === 'post') {
    const at = snapPostToHandrailEnds(gridPos, canvasData.handrails, snapRadius);
    s.setPlanePartPreview({ kind: 'post', x: at.x, y: at.y });
    return;
  }

  if (drag.type === 'obstacle') {
    const wg = mmToGrid(drag.widthMm);
    const hg = mmToGrid(drag.heightMm);
    // 壁スナップを試行。成功ならその位置、失敗ならカーソル中心に配置
    const snapped = snapObstacleToWall(gridPos, wg, hg, canvasData.buildings);
    s.setObstaclePreview({
      x: snapped ? snapped.x : gridPos.x - Math.round(wg / 2),
      y: snapped ? snapped.y : gridPos.y - Math.round(hg / 2),
      widthGrid: wg, heightGrid: hg,
      type: drag.obstacleType,
    });
    return;
  }

  // P-1-fix8: 階段・単管も、置かれる姿をキャンバスに出す（手摺と同じ考え方）。
  //   札だけでは「どこにどう置けるか」が離すまで分からない、が実機の指摘。
  //   階段は**吸着後**の位置に出す＝どの区画に納まるかが置く前に分かる。
  if (drag.type === 'stair') {
    // P-1-fix11: 辺が近くの手摺に沿う位置へ。ゴーストと配置は同じ関数を通す。
    const at = snapStairToCell(gridPos, drag.angleDeg, canvasData.handrails);
    s.setPlanePartPreview({
      kind: 'stair',
      stair: { id: 'preview', x: at.x, y: at.y, angleDeg: drag.angleDeg, flip: drag.flip },
    });
    return;
  }

  if (drag.type === 'pipe') {
    s.setPlanePartPreview({
      kind: 'pipe',
      pipe: {
        id: 'preview', x: gridPos.x, y: gridPos.y,
        lengthMm: drag.lengthMm, angleDeg: drag.angleDeg,
      },
    });
    return;
  }

  // 手摺・アンチ: 吸着は同じ 1 本（snapHandrailPlacement）。placePlanePart と
  //   **同じ関数・同じ引数**なので、ゴーストの位置と置かれる位置は必ず一致する。
  const result = snapHandrailPlacement(
    gridPos, drag.lengthMm as HandrailLengthMm, drag.direction,
    canvasData.handrails, snapRadius, canvasData.antis
  );
  const at = result ? result.snappedStart : gridPos;
  s.setSnapPoint(result ? result.snapIndicator : null);

  if (drag.type === 'anti') {
    // P-3: アンチは手摺の細線ではなく**アンチの板**でゴーストを出す。
    //   吸着の計算は上の 1 本のまま＝置かれる位置は 1 ミリも変わらない。
    s.setPlanePartPreview({
      kind: 'anti',
      anti: {
        x: at.x, y: at.y,
        width: drag.antiWidth, lengthMm: drag.lengthMm, direction: drag.direction,
      },
    });
    return;
  }

  s.setHandrailPreview({
    x: at.x, y: at.y,
    lengthMm: drag.lengthMm, direction: drag.direction,
  });
}

/** シャドーを全部消す。 */
export function clearPlanePreviews(): void {
  const s = useCanvasStore.getState();
  s.setHandrailPreview(null);
  s.setObstaclePreview(null);
  s.setPlanePartPreview(null);
  s.setSnapPoint(null);
}

/** その位置へ置く。 */
export function placePlanePart(drag: PlacePayload, gridPos: Point): void {
  const s = useCanvasStore.getState();
    {
      const { zoom, canvasData, activeFloor } = s;

      if (drag.type === 'handrail') {
        const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
        const result = snapHandrailPlacement(gridPos, drag.lengthMm as HandrailLengthMm, drag.direction, canvasData.handrails, snapRadius, canvasData.antis);
        const dropPos = result ? result.snappedStart : gridPos;
        if (result) { s.setSnapPoint(result.snapIndicator); setTimeout(() => s.setSnapPoint(null), 400); }
        // S-5e-4b: パレット drop の手摺に activeFloor を付与（従来は floor 未付与＝常に 1F 扱いの不具合）。
        //   activeFloor=1(単一階/既定)では従来と同一（h.floor ?? 1）。
        s.addHandrail({ id: uuidv4(), x: dropPos.x, y: dropPos.y, lengthMm: drag.lengthMm as HandrailLengthMm, direction: drag.direction, color: getHandrailColor(drag.lengthMm as HandrailLengthMm), floor: activeFloor });
      } else if (drag.type === 'anti') {
        const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
        const result = snapHandrailPlacement(gridPos, drag.lengthMm as HandrailLengthMm, drag.direction, canvasData.handrails, snapRadius, canvasData.antis);
        const dropPos = result ? result.snappedStart : gridPos;
        if (result) { s.setSnapPoint(result.snapIndicator); setTimeout(() => s.setSnapPoint(null), 400); }
        s.addAnti({ id: uuidv4(), x: dropPos.x, y: dropPos.y, width: drag.antiWidth, lengthMm: drag.lengthMm, direction: drag.direction });
      } else if (drag.type === 'post') {
        const snapRadius = Math.max(Math.round(SNAP_PX / (INITIAL_GRID_PX * zoom)), 5);
        const at = snapPostToHandrailEnds(gridPos, canvasData.handrails, snapRadius);
        s.addPost({ id: uuidv4(), x: at.x, y: at.y });
      } else if (drag.type === 'stair') {
        // P-1-fix11: 辺が近くの手摺に沿う位置へ吸着（無ければ 600×1800 の格子）。
        //   ゴースト(onMove)とまったく同じ関数・同じ引数なので位置が必ず一致する。
        const at = snapStairToCell(gridPos, drag.angleDeg, canvasData.handrails);
        useCanvasStore.getState().addStair({
          id: uuidv4(), x: at.x, y: at.y,
          angleDeg: drag.angleDeg, flip: drag.flip, floor: activeFloor,
        });
      } else if (drag.type === 'pipe') {
        // P-1: 単管はスナップ無し（置いた場所そのまま）。
        useCanvasStore.getState().addPipe({
          id: uuidv4(), x: gridPos.x, y: gridPos.y,
          lengthMm: drag.lengthMm, angleDeg: drag.angleDeg, floor: activeFloor,
        });
      } else if (drag.type === 'obstacle') {
        const wGrid = mmToGrid(drag.widthMm);
        const hGrid = mmToGrid(drag.heightMm);

        // Phase M-6a-place: ピン優先吸着（最近傍角×最近傍ピン）
        const cx = gridPos.x;
        const cy = gridPos.y;
        const corners = drag.obstacleType === 'custom_circle'
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
        s.addObstacle({ id: uuidv4(), type: drag.obstacleType, x: finalX, y: finalY, width: wGrid, height: hGrid });
      }
    }
}
