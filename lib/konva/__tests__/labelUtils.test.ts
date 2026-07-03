import { describe, it, expect } from 'vitest';
import { numberToAlpha, relabelByFace2F, relabelByFace1F, autoStartVertexIndex } from '../labelUtils';
import { getBuildingEdgesClockwise, type EdgeInfo } from '../autoLayoutUtils';
import type { BuildingShape } from '@/types';

// Phase H-3d-6: ラベル付けロジックの単体テスト。
// 仕様: docs/handoff-h-3d-6.md
// 設計: 設計報告 (5 + 6 + 4 = 15 件)。

// ============================================================
// 1. numberToAlpha (Excel 列番号風 0-indexed)
// ============================================================
describe('numberToAlpha', () => {
  it('n=0 → "A"', () => {
    expect(numberToAlpha(0)).toBe('A');
  });
  it('n=25 → "Z"', () => {
    expect(numberToAlpha(25)).toBe('Z');
  });
  it('n=26 → "AA"', () => {
    expect(numberToAlpha(26)).toBe('AA');
  });
  it('n=27 → "AB"', () => {
    expect(numberToAlpha(27)).toBe('AB');
  });
  it('n=701 → "ZZ", n=702 → "AAA"', () => {
    expect(numberToAlpha(701)).toBe('ZZ');
    expect(numberToAlpha(702)).toBe('AAA');
  });
});

// ============================================================
// 2. relabelByFace2F (⭐ 起点 CW、 同面分割は suffix)
// ============================================================
describe('relabelByFace2F', () => {
  // 矩形 2F (CW、 Y 下向き screen 座標): NW=(0,0), NE=(1000,0), SE=(1000,1000), SW=(0,1000)
  // edges (getBuildingEdgesClockwise 経由):
  //   edge 0: NW→NE (face=north)
  //   edge 1: NE→SE (face=east)
  //   edge 2: SE→SW (face=south)
  //   edge 3: SW→NW (face=west)
  const square: BuildingShape = {
    id: 'sq', type: 'polygon',
    points: [
      { x: 0, y: 0 },          // 0: NW
      { x: 1000, y: 0 },       // 1: NE
      { x: 1000, y: 1000 },    // 2: SE
      { x: 0, y: 1000 },       // 3: SW
    ],
    fill: '#000', floor: 2,
  };

  it('矩形 2F、 ⭐=NW (startVertexIndex=0): [A, B, C, D]', () => {
    const edges = getBuildingEdgesClockwise(square);
    const labeled = relabelByFace2F(edges, 0);
    expect(labeled.map(e => e.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('矩形 2F、 ⭐=NE (startVertexIndex=1): 物理順 [D, A, B, C]', () => {
    const edges = getBuildingEdgesClockwise(square);
    const labeled = relabelByFace2F(edges, 1);
    expect(labeled.map(e => e.label)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('矩形 2F、 ⭐=SE (startVertexIndex=2): 物理順 [C, D, A, B]', () => {
    const edges = getBuildingEdgesClockwise(square);
    const labeled = relabelByFace2F(edges, 2);
    expect(labeled.map(e => e.label)).toEqual(['C', 'D', 'A', 'B']);
  });

  it('矩形 2F、 ⭐=SW (startVertexIndex=3): 物理順 [B, C, D, A]', () => {
    const edges = getBuildingEdgesClockwise(square);
    const labeled = relabelByFace2F(edges, 3);
    expect(labeled.map(e => e.label)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('北面 3 分割の 6 辺、 ⭐=NW: [A1, A2, A3, B, C, D]', () => {
    // 6 頂点で北辺が 3 分割 (1F の頂点が 2F 北面に 2 個投影された想定)
    const split: BuildingShape = {
      id: 'sp', type: 'polygon',
      points: [
        { x: 0, y: 0 },        // 0: NW
        { x: 300, y: 0 },      // 1: north 中間 1
        { x: 600, y: 0 },      // 2: north 中間 2
        { x: 1000, y: 0 },     // 3: NE
        { x: 1000, y: 1000 },  // 4: SE
        { x: 0, y: 1000 },     // 5: SW
      ],
      fill: '#000', floor: 2,
    };
    const edges = getBuildingEdgesClockwise(split);
    expect(edges.length).toBe(6);
    // 北面 3 つ連続 (face=north, dir=horizontal が 3 連) → group 1 個 size 3
    // → A1/A2/A3 + B (東) + C (南) + D (西)
    const labeled = relabelByFace2F(edges, 0);
    expect(labeled.map(e => e.label)).toEqual(['A1', 'A2', 'A3', 'B', 'C', 'D']);
  });

  it('凹型 (T字) 2F、 ⭐=NW: 同 face 非連続は別 letter', () => {
    // T字: 上に細い arm、 下に幅広 bar
    //   (300,0)─(700,0)
    //      |       |
    //   (300,300) (700,300)
    //      |       |
    // (0,300)─────────(1000,300)
    //      |               |
    //   (0,1000)─(1000,1000)
    const tShape: BuildingShape = {
      id: 't', type: 'polygon',
      points: [
        { x: 300, y: 0 },        // 0: 上 arm 左上
        { x: 700, y: 0 },        // 1: 上 arm 右上
        { x: 700, y: 300 },      // 2: 上 arm 右下
        { x: 1000, y: 300 },     // 3: bar 右上
        { x: 1000, y: 1000 },    // 4: bar 右下 (SE)
        { x: 0, y: 1000 },       // 5: bar 左下 (SW)
        { x: 0, y: 300 },        // 6: bar 左上
        { x: 300, y: 300 },      // 7: 上 arm 左下
      ],
      fill: '#000', floor: 2,
    };
    const edges = getBuildingEdgesClockwise(tShape);
    expect(edges.length).toBe(8);
    // face 系列 (CW from index 0):
    //   0: north (上 arm 上辺)
    //   1: east  (上 arm 右辺)
    //   2: north (右 shoulder、 同 face だが index 1 で切れたので別 group)
    //   3: east  (bar 右辺、 同 face だが index 2 で切れたので別 group)
    //   4: south (bar 下辺)
    //   5: west  (bar 左辺)
    //   6: north (左 shoulder)
    //   7: west  (上 arm 左辺、 同 face だが index 6 で切れたので別 group)
    // すべて group size 1、 連続せず → 8 letter (A, B, C, D, E, F, G, H)
    const labeled = relabelByFace2F(edges, 0);
    expect(labeled.map(e => e.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    // sanity: face は変わってないこと
    expect(labeled[0].face).toBe('north');
    expect(labeled[2].face).toBe('north');
    expect(labeled[6].face).toBe('north');
    expect(labeled[1].face).toBe('east');
    expect(labeled[3].face).toBe('east');
  });
});

// ============================================================
// 3. relabelByFace1F (⭐ → 最近接 1F 頂点 → CW 巡回で下屋辺のみ採番)
// ============================================================
describe('relabelByFace1F', () => {
  // L 型 1F (split 適用後): main rect (0,0)-(6000,7000)、 突き出し east (6000,0)-(9000,4000)
  // 2F vertex (6000, 0) が 1F の top edge に投影されて split されている前提で、 7 頂点。
  // edges (CW):
  //   0: (0,0)→(6000,0)         top of main      (covered)
  //   1: (6000,0)→(9000,0)      top of 突き出し   (uncovered)
  //   2: (9000,0)→(9000,4000)   right of 突き出し (uncovered)
  //   3: (9000,4000)→(6000,4000) bottom of 突き出し (uncovered)
  //   4: (6000,4000)→(6000,7000) lower main east  (covered = 2F の split east と一致)
  //   5: (6000,7000)→(0,7000)   bottom of main   (covered)
  //   6: (0,7000)→(0,0)          left of main     (covered)
  const lShape: BuildingShape = {
    id: 'l1', type: 'polygon',
    points: [
      { x: 0, y: 0 },         // 0: NW
      { x: 6000, y: 0 },      // 1: split point (= top of main 終点 / 突き出し base 開始)
      { x: 9000, y: 0 },      // 2: NE of 突き出し
      { x: 9000, y: 4000 },   // 3: SE of 突き出し
      { x: 6000, y: 4000 },   // 4: SW of 突き出し
      { x: 6000, y: 7000 },   // 5: SE of main
      { x: 0, y: 7000 },      // 6: SW of main
    ],
    fill: '#000', floor: 1,
  };
  const lShapeUncoveredIdx = new Set([1, 2, 3]);

  it('L 型 (突き出し east)、 ⭐=SW: 上="A", 右="B", 下="C"', () => {
    const edges = getBuildingEdgesClockwise(lShape);
    expect(edges.length).toBe(7);
    const labeled = relabelByFace1F(edges, lShapeUncoveredIdx, { x: 0, y: 7000 });
    // closest 1F vertex to (0,7000) = vertex 6 (距離 0)。
    // CW 巡回: edges 6, 0, 1, 2, 3, 4, 5
    // covered skip: 6, 0 → uncovered 1='A' (上), 2='B' (右), 3='C' (下)
    expect(labeled.length).toBe(3);
    expect(labeled.find(e => e.index === 1)?.label).toBe('A');
    expect(labeled.find(e => e.index === 2)?.label).toBe('B');
    expect(labeled.find(e => e.index === 3)?.label).toBe('C');
  });

  it('L 型 (突き出し east)、 ⭐=NE: 右="A", 下="B", 上="C" (CW 巡回で別順)', () => {
    const edges = getBuildingEdgesClockwise(lShape);
    const labeled = relabelByFace1F(edges, lShapeUncoveredIdx, { x: 9000, y: 0 });
    // closest 1F vertex to (9000,0) = vertex 2 (距離 0)。
    // CW 巡回: edges 2, 3, 4, 5, 6, 0, 1
    // 順次採番: 2='A' (右), 3='B' (下), covered 4/5/6/0 skip, 1='C' (上)
    expect(labeled.length).toBe(3);
    expect(labeled.find(e => e.index === 2)?.label).toBe('A');
    expect(labeled.find(e => e.index === 3)?.label).toBe('B');
    expect(labeled.find(e => e.index === 1)?.label).toBe('C');
  });

  // 凸型 1F (突き出し north): collinearEdgePairs.test.ts と同形状。
  // 1F: 8 辺、 uncovered は 突き出しの 3 辺 (index 0=上, 1=右, 7=左)。
  const protrusion1F: BuildingShape = {
    id: 'p1', type: 'polygon',
    points: [
      { x: 3000, y: 0 },       // 0: 突き出し左上
      { x: 6000, y: 0 },       // 1: 突き出し右上
      { x: 6000, y: 2000 },    // 2: 突き出し右下
      { x: 9000, y: 2000 },    // 3: 段差右
      { x: 9000, y: 9000 },    // 4: 南東
      { x: 0, y: 9000 },       // 5: 南西
      { x: 0, y: 2000 },       // 6: 段差左
      { x: 3000, y: 2000 },    // 7: 突き出し左下
    ],
    fill: '#000', floor: 1,
  };
  const protrusionUncoveredIdx = new Set([0, 1, 7]);

  it('凸型 1F (突き出し north)、 ⭐=2F の SW (0,9000): 突き出し左="A", 上="B", 右="C"', () => {
    const edges = getBuildingEdgesClockwise(protrusion1F);
    const labeled = relabelByFace1F(edges, protrusionUncoveredIdx, { x: 0, y: 9000 });
    // closest 1F vertex to (0,9000) = vertex 5 (距離 0)。
    // CW 巡回: edges 5, 6, 7, 0, 1, 2, 3, 4
    // covered skip: 5, 6 → uncovered 7='A' (左), 0='B' (上), 1='C' (右), 残り covered skip
    expect(labeled.length).toBe(3);
    expect(labeled.find(e => e.index === 7)?.label).toBe('A');
    expect(labeled.find(e => e.index === 0)?.label).toBe('B');
    expect(labeled.find(e => e.index === 1)?.label).toBe('C');
  });

  it('commonStartPoint = null: 1F polygon vertex 0 から CW で採番', () => {
    const edges = getBuildingEdgesClockwise(protrusion1F);
    const labeled = relabelByFace1F(edges, protrusionUncoveredIdx, null);
    // startVertexIdx = 0 (default)。 CW 巡回: edges 0, 1, 2, 3, 4, 5, 6, 7
    // 採番: 0='A' (上), 1='B' (右), covered skip 2-6, 7='C' (左)
    expect(labeled.length).toBe(3);
    expect(labeled.find(e => e.index === 0)?.label).toBe('A');
    expect(labeled.find(e => e.index === 1)?.label).toBe('B');
    expect(labeled.find(e => e.index === 7)?.label).toBe('C');
  });

  it('Z 超え: 27 個全部 uncovered → 26 番目 (index 25)="Z"、 27 番目="AA"', () => {
    // 合成: 27 個の edge、 全部 uncovered 扱い。 巡回順 = 配列順。
    const synth: EdgeInfo[] = Array.from({ length: 27 }, (_, i) => ({
      index: i,
      originalIndex: i,
      label: '?',
      p1: { x: i * 100, y: 0 },
      p2: { x: i * 100 + 50, y: 0 },
      lengthMm: 500,
      face: 'north' as const,
      handrailDir: 'horizontal' as const,
      nx: 0,
      ny: -1,
    }));
    const allUncovered = new Set(Array.from({ length: 27 }, (_, i) => i));
    const labeled = relabelByFace1F(synth, allUncovered, null);
    expect(labeled.length).toBe(27);
    expect(labeled[0].label).toBe('A');
    expect(labeled[25].label).toBe('Z');
    expect(labeled[26].label).toBe('AA');
  });
});

// ============================================================
// 案Y-2: autoStartVertexIndex（星未設定時の内部自動起点＝北西角）
// ============================================================
describe('autoStartVertexIndex（北西角＝北の面が起点）', () => {
  const mk = (pts: [number, number][]): BuildingShape => ({
    id: 'b', type: 'polygon', points: pts.map(([x, y]) => ({ x, y })), fill: '#000', floor: 2,
  });

  it('矩形(NW始点CW): 北辺(index0)が起点', () => {
    const rect = mk([[0, 0], [900, 0], [900, 700], [0, 700]]);
    const idx = autoStartVertexIndex(rect);
    const edges = getBuildingEdgesClockwise(rect);
    expect(edges[idx].face).toBe('north'); // 起点辺は北向き
    expect(idx).toBe(0);
  });

  it('矩形(SW始点で描画されても)北辺を起点に選ぶ', () => {
    // 頂点順が北西始まりでない矩形でも、北向き辺の index を返す
    const rect = mk([[0, 700], [0, 0], [900, 0], [900, 700]]);
    const edges = getBuildingEdgesClockwise(rect);
    const idx = autoStartVertexIndex(rect);
    expect(edges[idx].face).toBe('north');
    // 最も北(y最小)の辺
    expect(edges[idx].p1.y).toBe(Math.min(...edges.map(e => e.p1.y)));
  });

  it('L字下屋(東に張り出し): 最北かつ最西の北辺を起点', () => {
    const l = mk([[0, 0], [900, 0], [900, 400], [1200, 400], [1200, 700], [0, 700]]);
    const edges = getBuildingEdgesClockwise(l);
    const idx = autoStartVertexIndex(l);
    expect(edges[idx].face).toBe('north');
    // y=0 の最北北辺（西端 x=0）
    expect(edges[idx].p1.y).toBe(0);
    expect(Math.min(edges[idx].p1.x, edges[idx].p2.x)).toBe(0);
  });
});
