import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { partsToPrimitives, withPartDeleted } from '../elevationParts';
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
    // E-8-v2f: 踏板は縁＋本体の 2 枚。どちらも移動後のスパン幅で引き直される。
    // E-8-v2h: 端は boardInsetGrid(2.5) だけ内側（1 枚ずつ切れて見えるように）。
    expect(prims).toHaveLength(2);
    for (const p of prims) expect(p.kind === 'line' && [p.x1, p.x2]).toEqual([362.5, 537.5]);
  });
});

describe('部材の削除', () => {
  it('parts から取り除くだけ（自動生成分も同じ操作）', () => {
    const parts = [autoBoard, { ...autoBoard, id: 'keep', spanIndex: 0, x0: 0, x1: 180 }];
    const out = parts.filter((p) => p.id !== autoBoard.id);
    expect(out.map((p) => p.id)).toEqual(['keep']);
    // E-8-v2f: 残った 1 部材ぶん（踏板 = 縁＋本体の 2 枚）だけが描かれる。
    expect(partsToPrimitives({ parts: out, geom })).toHaveLength(2);
  });

  // E-8-v2j: 消去ツールでも編集バーでも同じ意味になるよう withPartDeleted に集約した。
  it('自動生成分は墓標を残す（作り直してもぶり返さない）', () => {
    const out = withPartDeleted([autoBoard], autoBoard.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: autoBoard.id, origin: 'manual', removed: true });
    expect(partsToPrimitives({ parts: out, geom })).toEqual([]);   // 墓標は描かない
  });

  it('手動追加分は配列から取り除くだけ（墓標を作らない）', () => {
    const manual = { ...autoBoard, id: 'manual:board:1', origin: 'manual' as const };
    expect(withPartDeleted([manual], manual.id)).toEqual([]);
  });

  it('知らない id なら何もしない（同じ配列を返す）', () => {
    const parts = [autoBoard];
    expect(withPartDeleted(parts, 'nope')).toBe(parts);
  });
});
