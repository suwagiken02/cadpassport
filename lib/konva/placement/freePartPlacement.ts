// ============================================================
// キャンバス直下の手動部材の配置・移動 (= E-8-v5b)
//
// ■ なぜコンポーネントの外に置くか
// 接合スナップ（コマ⇔楔・ホゾ⇔受け）の呼び出しは FreePartLayer の中にあった。
// 動いてはいたが、React コンポーネントの中なので**ストアを叩く振る舞いテストが
// 1 本も書けない**。そのため「ジャッキだけ接合点を持たない」（足場が無いと
// partJoints が空を返す）という穴が、実機で気付かれるまで残っていた。
// 平面部材（planePlacement.ts）と同じ形にして、テストから直接叩けるようにする。
//
// ■ 状態はすべてストアから読む
// 渡すのは「どこへ」だけ。選んでいる部材・寸法・向き・ズーム・既存の部材は
// 呼ぶ側から渡さない＝コンポーネントの古い値を掴む事故（P-2-fix と同型）が
// 構造的に起こらない。シャドーと確定が同じ関数を通るので位置も必ず一致する。
//
// ■ 座標系
// freeParts は**常に実寸**（立面ビューの scale に追従しない）。
// 1 グリッド = 10mm、画面 px は gridPx = INITIAL_GRID_PX * zoom。
// よって 1mm あたりの画面 px は gridPx / 10 で、吸着の距離判定は
// 「mm 距離 × pxPerMm」＝実寸基準でそのまま正しく効く（scale は掛けない）。
// ============================================================
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { GRID_MM, movePart, type ElevationPart } from '@/lib/konva/elevation/elevationParts';
import { snapJoint, type JointSnap, type JointSnapOptions } from '@/lib/konva/elevation/elevationJoints';
import { newFreePart, nextFreePartId, type FreePart } from '@/lib/konva/freeParts';
import type { Point } from '@/types';

/** 接合点へ吸着する画面距離(px)。立面ビュー内と同じ値＝同じ操作感にする。 */
export const JOINT_SNAP_PX = 22;

/** キャンバスのグリッド 1 つぶんの画面 px。 */
export const gridPxOf = (zoom: number): number => INITIAL_GRID_PX * zoom;

/**
 * 吸着の距離設定（実寸基準）。
 * 立面ビューは縮小配置なので view.scale を掛けるが、freeParts は常に実寸なので掛けない。
 */
export const freePartSnapOptions = (zoom: number): JointSnapOptions => ({
  pxPerMm: gridPxOf(zoom) / GRID_MM,
  tolPx: JOINT_SNAP_PX,
});

/** いまキャンバス直下にある手動部材。 */
const currentParts = (): FreePart[] => useCanvasStore.getState().canvasData.freeParts ?? [];

/**
 * 素直に動かした量に、接合吸着の補正を足した移動量(mm)。
 * 圏外なら補正 0 ＝ 置いた場所にそのまま置かれる（「自由＋接合吸着」の原則）。
 */
export function snappedMoveMm(
  part: ElevationPart, others: ElevationPart[], dGrid: Point, zoom: number,
): { dxMm: number; dyMm: number; snap: JointSnap } {
  const move = { dxMm: dGrid.x * GRID_MM, dyMm: -dGrid.y * GRID_MM };
  const snap = snapJoint(part, others, undefined, move, freePartSnapOptions(zoom));
  return { dxMm: move.dxMm + snap.dxMm, dyMm: move.dyMm + snap.dyMm, snap };
}

/**
 * いま選んでいる部材を、その位置へ置いたときの姿（吸着込み）。
 * シャドーの表示にも、確定の実体にも**これ 1 本**を使う。
 * 部材を選んでいない／文字ツールのときは null。
 */
export function freePartDraftAt(atGrid: Point): FreePart | null {
  const s = useCanvasStore.getState();
  const tool = s.elevationAddTool;
  if (!tool || tool === 'text') return null;

  const isPost = tool === 'post' || tool === 'postExt';
  const draft = newFreePart(tool, 'draft', atGrid, {
    komaCount: isPost ? s.elevationAddSize : undefined,
    sizeMm: isPost ? undefined : s.elevationAddSize,
    flip: s.elevationAddFlip,
    angleDeg: s.elevationAddAngle,
  });

  const snap = snapJoint(draft, currentParts(), undefined, { dxMm: 0, dyMm: 0 },
    freePartSnapOptions(s.zoom));
  return (snap.dxMm || snap.dyMm) ? movePart(draft, undefined, snap) : draft;
}

/** その位置へ置く。置いたら true（部材を選んでいなければ何もしない）。 */
export function placeFreePartAt(atGrid: Point): boolean {
  const draft = freePartDraftAt(atGrid);
  if (!draft) return false;
  const s = useCanvasStore.getState();
  s.addFreePart({ ...draft, id: nextFreePartId(currentParts(), draft.kind) });
  return true;
}

/** 既存の 1 本をグリッド単位で動かす（接合が近ければ吸着）。動いたら true。 */
export function moveFreePartBy(id: string, dGrid: Point): boolean {
  const s = useCanvasStore.getState();
  const parts = currentParts();
  const part = parts.find((p) => p.id === id);
  if (!part) return false;
  const move = snappedMoveMm(part, parts, dGrid, s.zoom);
  if (Math.abs(move.dxMm) < 1e-6 && Math.abs(move.dyMm) < 1e-6) return false;
  s.setFreePart(id, movePart(part, undefined, { dxMm: move.dxMm, dyMm: move.dyMm }));
  return true;
}
