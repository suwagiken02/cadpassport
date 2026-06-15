import { describe, it, expect } from 'vitest';
import {
  isCollinearWith,
  findCollinearEdgePairs,
  getBuildingEdgesClockwise,
  type EdgeInfo,
} from '../autoLayoutUtils';
import type { BuildingShape } from '@/types';

// Phase H-3d-2 Stage 2: 1F辺と2F辺の同一直線判定
// bothmode の自動割付の根本再設計に向けた基盤テスト。
//
// 凸型1F (北側中央に 3000x2000 突き出し) + 四角2F (本体と同範囲) の
// シナリオで、連動ペアが正しく検出されることを検証する。

describe('isCollinearWith / findCollinearEdgePairs', () => {
  // 1F: 凸型 (北向き突き出し)、本体 9000x7000、突き出し 3000x2000 中央北
  // 頂点列 (CW、Y下向き):
  //   0: (3000, 0)    突き出し左上
  //   1: (6000, 0)    突き出し右上
  //   2: (6000, 2000) 突き出し右下
  //   3: (9000, 2000) 段差右
  //   4: (9000, 9000) 南東
  //   5: (0, 9000)    南西
  //   6: (0, 2000)    段差左
  //   7: (3000, 2000) 突き出し左下
  // 辺 (8 本):
  //   index 0: 突き出し上辺  (北向き 3000mm、Y=0、X=[3000,6000])
  //   index 1: 突き出し右側面 (東向き 2000mm、X=6000、Y=[0,2000])
  //   index 2: 段差右         (北向き 3000mm、Y=2000、X=[6000,9000]) ← 2F北と連動 (B1)
  //   index 3: 東壁           (東向き 7000mm、X=9000、Y=[2000,9000]) ← 2F東と完全同位置
  //   index 4: 南底辺         (南向き 9000mm、Y=9000、X=[0,9000])    ← 2F南と完全同位置
  //   index 5: 西壁           (西向き 7000mm、X=0、Y=[2000,9000])    ← 2F西と完全同位置
  //   index 6: 段差左         (北向き 3000mm、Y=2000、X=[0,3000])    ← 2F北と連動 (B1)
  //   index 7: 突き出し左側面 (西向き 2000mm、X=3000、Y=[0,2000])
  const building1F: BuildingShape = {
    id: 'b1', type: 'polygon',
    points: [
      { x: 3000, y: 0 }, { x: 6000, y: 0 },
      { x: 6000, y: 2000 }, { x: 9000, y: 2000 },
      { x: 9000, y: 9000 }, { x: 0, y: 9000 },
      { x: 0, y: 2000 }, { x: 3000, y: 2000 },
    ],
    fill: '#000', floor: 1,
  };

  // 2F: 1F の本体 (突き出しを除く部分) と同じ範囲、X=[0,9000]、Y=[2000,9000]
  const building2F: BuildingShape = {
    id: 'b2', type: 'polygon',
    points: [
      { x: 0, y: 2000 }, { x: 9000, y: 2000 },
      { x: 9000, y: 9000 }, { x: 0, y: 9000 },
    ],
    fill: '#000', floor: 2,
  };

  it('凸型1F + 四角2F: 連動ペア 5 本 (突き出しの 3 辺以外すべて)', () => {
    const pairs = findCollinearEdgePairs(building1F, building2F);
    expect(pairs.length).toBe(5);
    const pairedIndices = pairs.map(p => p.edge1FIndex).sort((a, b) => a - b);
    expect(pairedIndices).toEqual([2, 3, 4, 5, 6]);
  });

  it('突き出しの 3 辺 (上辺・右側面・左側面) は連動なし', () => {
    const pairs = findCollinearEdgePairs(building1F, building2F);
    const pairedIndices = new Set(pairs.map(p => p.edge1FIndex));
    expect(pairedIndices.has(0)).toBe(false); // 突き出し上辺 (Y=0)
    expect(pairedIndices.has(1)).toBe(false); // 突き出し右側面 (X=6000)
    expect(pairedIndices.has(7)).toBe(false); // 突き出し左側面 (X=3000)
  });

  it('1F=2F が完全同位置の辺は連動扱い (東壁・南底辺・西壁)', () => {
    const pairs = findCollinearEdgePairs(building1F, building2F);
    const pairedIndices = new Set(pairs.map(p => p.edge1FIndex));
    expect(pairedIndices.has(3)).toBe(true); // 東壁 (X=9000、Y=[2000,9000])
    expect(pairedIndices.has(4)).toBe(true); // 南底辺 (Y=9000、X=[0,9000])
    expect(pairedIndices.has(5)).toBe(true); // 西壁 (X=0、Y=[2000,9000])
  });

  it('1F が 2F の一部にだけ収まる (B1ルール、段差) → 連動扱い', () => {
    const pairs = findCollinearEdgePairs(building1F, building2F);
    const pairedIndices = new Set(pairs.map(p => p.edge1FIndex));
    // 段差右: X=[6000,9000] ⊆ 2F北 X=[0,9000]
    expect(pairedIndices.has(2)).toBe(true);
    // 段差左: X=[0,3000] ⊆ 2F北 X=[0,9000]
    expect(pairedIndices.has(6)).toBe(true);
  });

  it('1F が 2F の範囲からはみ出す → 連動なし', () => {
    // 1F: 10000x7000、2F: 9000x7000、北辺で 1F が 1000mm はみ出す
    const big1F: BuildingShape = {
      id: 'b1', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 10000, y: 0 },
        { x: 10000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 1,
    };
    const small2F: BuildingShape = {
      id: 'b2', type: 'polygon',
      points: [
        { x: 0, y: 0 }, { x: 9000, y: 0 },
        { x: 9000, y: 7000 }, { x: 0, y: 7000 },
      ],
      fill: '#000', floor: 2,
    };
    const e1s = getBuildingEdgesClockwise(big1F);
    const e2s = getBuildingEdgesClockwise(small2F);
    // 北辺: 1F X=[0,10000]、2F X=[0,9000] → 1F が範囲外 → 連動なし
    expect(isCollinearWith(e1s[0], e2s[0])).toBe(false);
  });

  it('Y 一致でも X 範囲が重ならない辺 → 連動なし', () => {
    // 同じ Y=0 の北向き辺だが、X 範囲が完全に分離
    const e1: EdgeInfo = {
      index: 0, originalIndex: 0, label: 'A',
      p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 },
      lengthMm: 3000, face: 'north', handrailDir: 'horizontal',
      nx: 0, ny: -1,
    };
    const e2: EdgeInfo = {
      index: 0, originalIndex: 0, label: 'A',
      p1: { x: 6000, y: 0 }, p2: { x: 9000, y: 0 },
      lengthMm: 3000, face: 'north', handrailDir: 'horizontal',
      nx: 0, ny: -1,
    };
    // X=[0,3000] は X=[6000,9000] に含まれない → 連動なし
    expect(isCollinearWith(e1, e2)).toBe(false);
  });

  it('法線方向が逆 (北向き vs 南向き) → 連動なし', () => {
    const e1: EdgeInfo = {
      index: 0, originalIndex: 0, label: 'A',
      p1: { x: 0, y: 0 }, p2: { x: 9000, y: 0 },
      lengthMm: 9000, face: 'north', handrailDir: 'horizontal',
      nx: 0, ny: -1,
    };
    const e2: EdgeInfo = {
      index: 0, originalIndex: 0, label: 'A',
      p1: { x: 0, y: 0 }, p2: { x: 9000, y: 0 },
      lengthMm: 9000, face: 'south', handrailDir: 'horizontal',
      nx: 0, ny: 1, // 法線が逆
    };
    expect(isCollinearWith(e1, e2)).toBe(false);
  });

  it('handrailDir が一致しない (horizontal vs vertical) → 連動なし', () => {
    const eH: EdgeInfo = {
      index: 0, originalIndex: 0, label: 'A',
      p1: { x: 0, y: 0 }, p2: { x: 9000, y: 0 },
      lengthMm: 9000, face: 'north', handrailDir: 'horizontal',
      nx: 0, ny: -1,
    };
    const eV: EdgeInfo = {
      index: 0, originalIndex: 0, label: 'A',
      p1: { x: 0, y: 0 }, p2: { x: 0, y: 9000 },
      lengthMm: 9000, face: 'west', handrailDir: 'vertical',
      nx: -1, ny: 0,
    };
    expect(isCollinearWith(eH, eV)).toBe(false);
  });
});
