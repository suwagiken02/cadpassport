import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { partsToPrimitives } from '../elevationParts';
import { buildElevationSlots, slotOccupied, slotToPart, snapToSlot } from '../elevationSlots';

// ============================================================
// E-8-v2d: 既存部材の選択・移動・削除。
// 移動は「ポインタ位置 → 最寄りの有効スロット → 部材を差し替え」で表す（自由座標を持たない）。
// UI(Konva)の操作は実機確認だが、位置決めのロジックはここで固定する。
// ============================================================
const geom: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360, 540],
    jackTopMm: 150,
    topRailMm: 6500,
    levelsMm: [1100, 2900, 4700],
    komaGridMm: [150, 600, 1050, 1500, 1950, 2400, 2850],
  }],
};
/** 自動生成の踏板（スパン1・2900）。 */
const autoBoard: ElevationPart = {
  id: 'board:0:2900:180', kind: 'board', scaffoldIndex: 0, origin: 'auto',
  spanIndex: 1, levelMm: 2900, x0: 180, x1: 360,
};

/** UI と同じ移動処理（ElevationEditGroup.moveToNearestSlot の中身）。 */
function moveToNearest(
  parts: ElevationPart[], target: ElevationPart, pointer: { x: number; yMm: number },
): ElevationPart[] {
  const slot = snapToSlot(pointer, geom, target.kind);
  if (!slot) return parts;
  const same = slot.spanIndex === target.spanIndex && slot.postIndex === target.postIndex
    && slot.levelMm === target.levelMm && slot.scaffoldIndex === target.scaffoldIndex;
  if (same) return parts;
  if (slotOccupied(parts.filter((p) => p.id !== target.id), slot)) return parts;
  const moved: ElevationPart = { ...slotToPart(slot, target.id), origin: 'manual' };
  return parts.map((p) => (p.id === target.id ? moved : p));
}

describe('部材の移動（隣の有効位置へ吸着）', () => {
  it('隣のスパンへ落とすとスパン番号とレンジが更新される', () => {
    const out = moveToNearest([autoBoard], autoBoard, { x: 450, yMm: 2900 });
    expect(out[0]).toMatchObject({ id: autoBoard.id, spanIndex: 2, levelMm: 2900, x0: 360, x1: 540 });
  });

  it('上の段へ落とすと高さが更新される（横は同じスパン）', () => {
    const out = moveToNearest([autoBoard], autoBoard, { x: 270, yMm: 4700 });
    expect(out[0]).toMatchObject({ spanIndex: 1, levelMm: 4700 });
  });

  it('自動生成部材を動かすと手動扱いになる（再生成で作り直されない）', () => {
    const out = moveToNearest([autoBoard], autoBoard, { x: 90, yMm: 1100 });
    expect(out[0].origin).toBe('manual');
    expect(out[0].id).toBe(autoBoard.id); // id は保つ（差分の同定に使う）
  });

  it('同じスロットへのドロップは何も変えない', () => {
    const parts = [autoBoard];
    expect(moveToNearest(parts, autoBoard, { x: 270, yMm: 2900 })).toBe(parts);
  });

  it('埋まっている位置へは移さない', () => {
    const other: ElevationPart = { ...autoBoard, id: 'other', spanIndex: 2, x0: 360, x1: 540 };
    const parts = [autoBoard, other];
    const out = moveToNearest(parts, autoBoard, { x: 450, yMm: 2900 });
    expect(out).toBe(parts); // 変化なし
  });

  it('中途半端な位置に落としても必ず有効位置へ収まる', () => {
    const out = moveToNearest([autoBoard], autoBoard, { x: 401, yMm: 4310 });
    const slots = buildElevationSlots(geom, 'board');
    const hit = slots.find((s) => s.spanIndex === out[0].spanIndex && s.levelMm === out[0].levelMm);
    expect(hit).toBeDefined();
  });

  it('移動後も絵が起こせる（座標は geom から都度計算）', () => {
    const out = moveToNearest([autoBoard], autoBoard, { x: 450, yMm: 2900 });
    const prims = partsToPrimitives({ parts: out, geom });
    expect(prims).toHaveLength(1);
    expect(prims[0].kind === 'line' && [prims[0].x1, prims[0].x2]).toEqual([360, 540]);
  });
});

describe('部材の削除', () => {
  it('parts から取り除くだけ（自動生成分も同じ操作）', () => {
    const parts = [autoBoard, { ...autoBoard, id: 'keep', spanIndex: 0, x0: 0, x1: 180 }];
    const out = parts.filter((p) => p.id !== autoBoard.id);
    expect(out.map((p) => p.id)).toEqual(['keep']);
    expect(partsToPrimitives({ parts: out, geom })).toHaveLength(1);
  });
});
