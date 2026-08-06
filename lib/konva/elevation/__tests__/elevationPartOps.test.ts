import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { partsToPrimitives, withPartDeleted } from '../elevationParts';

// ============================================================
// E-8-v2d: 既存部材の選択・削除。
// 移動は E-8-v3 で自由座標＋接合点スナップに変わったため、ここでは扱わない
// （旧「最寄りの有効スロットへ差し替え」の検証は E-8-v3d で撤去）。
// UI(Konva)の操作は実機確認だが、部材の増減はここで固定する。
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
