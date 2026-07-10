import { describe, it, expect } from 'vitest';
import type { Handrail, HandrailLengthMm, Post, Anti } from '@/types';
import {
  reconstructFaces,
  associatePartsToFace,
  type FaceSpanColumn,
  type Face,
} from '../faceReconstruction';

// ============================================================
// E-1: 配置済み手摺 → 面ごとスパン列復元のテスト。
// 座標はすべてグリッド（1 grid = 10mm）。1800mm = 180 grid、離れ 900mm = 90 grid。
// 手摺は足場ライン（建物外周から離れ 90 外側）に沿って置かれている想定。
// ============================================================

let seq = 0;
function hr(
  x: number, y: number, lengthMm: number,
  direction: 'horizontal' | 'vertical' | number,
  floor?: number,
  id?: string,
): Handrail {
  return {
    id: id ?? `h${seq++}`,
    x, y,
    lengthMm: lengthMm as HandrailLengthMm,
    direction,
    color: '#000',
    floor,
  };
}

/** 矩形リング（建物 corners (0,0)-(360,0)-(360,540)-(0,540)、離れ 90 外側）を作る。 */
function rectRing(floor: number): Handrail[] {
  return [
    // 北（y=-90）: 3×1800 水平
    hr(-90, -90, 1800, 'horizontal', floor), hr(90, -90, 1800, 'horizontal', floor), hr(270, -90, 1800, 'horizontal', floor),
    // 南（y=630）: 3×1800 水平
    hr(-90, 630, 1800, 'horizontal', floor), hr(90, 630, 1800, 'horizontal', floor), hr(270, 630, 1800, 'horizontal', floor),
    // 西（x=-90）: 4×1800 垂直
    hr(-90, -90, 1800, 'vertical', floor), hr(-90, 90, 1800, 'vertical', floor), hr(-90, 270, 1800, 'vertical', floor), hr(-90, 450, 1800, 'vertical', floor),
    // 東（x=450）: 4×1800 垂直
    hr(450, -90, 1800, 'vertical', floor), hr(450, 90, 1800, 'vertical', floor), hr(450, 270, 1800, 'vertical', floor), hr(450, 450, 1800, 'vertical', floor),
  ];
}

function col(cols: FaceSpanColumn[], face: Face, floor: number): FaceSpanColumn[] {
  return cols.filter(c => c.face === face && c.floor === floor);
}

describe('reconstructFaces: 矩形2階（総二階）', () => {
  const cols = reconstructFaces([...rectRing(1), ...rectRing(2)]);

  it('4面×2階 = 8 Column が出る', () => {
    expect(cols.length).toBe(8);
    expect(new Set(cols.map(c => c.floor))).toEqual(new Set([1, 2]));
  });

  it('各面が単一 depth の Column（1階）', () => {
    for (const f of ['north', 'south', 'east', 'west'] as Face[]) {
      expect(col(cols, f, 1).length).toBe(1);
    }
  });

  it('北面: rails・区間・奥行きが正しい（1階）', () => {
    const [n] = col(cols, 'north', 1);
    expect(n.rails).toEqual([1800, 1800, 1800]);
    expect(n.depthCoord).toBe(-90);   // 固定軸 = y
    expect(n.xStart).toBe(-90);
    expect(n.xEnd).toBe(450);
  });

  it('西面: 縦4本・固定軸=x・可変軸=y 区間が正しい（1階）', () => {
    const [w] = col(cols, 'west', 1);
    expect(w.rails).toEqual([1800, 1800, 1800, 1800]);
    expect(w.depthCoord).toBe(-90);   // 固定軸 = x
    expect(w.xStart).toBe(-90);
    expect(w.xEnd).toBe(630);
  });

  it('東面 depthCoord=450（x）・2階も同一構造', () => {
    expect(col(cols, 'east', 1)[0].depthCoord).toBe(450);
    expect(col(cols, 'east', 2)[0].rails).toEqual([1800, 1800, 1800, 1800]);
    expect(col(cols, 'north', 2)[0].depthCoord).toBe(-90);
  });
});

describe('reconstructFaces: L字上階（l_se）同方向2列の分離', () => {
  // L 字（(0,0)-(360,0)-(360,180)-(180,180)-(180,360)-(0,360)）の足場リング（floor=2、離れ 90）。
  // 南が2辺（内側 y=180・外側 y=360）、東が2辺（外側 x=360・内側 x=180）に分かれる形状。
  const handrails: Handrail[] = [
    // 北（y=-90）: 3×1800
    hr(-90, -90, 1800, 'horizontal', 2), hr(90, -90, 1800, 'horizontal', 2), hr(270, -90, 1800, 'horizontal', 2),
    // 南 内側（scaffold y=270、x 90..450）: 2×1800
    hr(90, 270, 1800, 'horizontal', 2), hr(270, 270, 1800, 'horizontal', 2),
    // 南 外側（scaffold y=450、x -90..270）: 2×1800
    hr(-90, 450, 1800, 'horizontal', 2), hr(90, 450, 1800, 'horizontal', 2),
    // 東 外側（scaffold x=450、y -90..270）: 2×1800
    hr(450, -90, 1800, 'vertical', 2), hr(450, 90, 1800, 'vertical', 2),
    // 東 内側（scaffold x=270、y 90..450）: 2×1800
    hr(270, 90, 1800, 'vertical', 2), hr(270, 270, 1800, 'vertical', 2),
    // 西（scaffold x=-90、y -90..450）: 3×1800
    hr(-90, -90, 1800, 'vertical', 2), hr(-90, 90, 1800, 'vertical', 2), hr(-90, 270, 1800, 'vertical', 2),
  ];
  const cols = reconstructFaces(handrails, 2);

  it('南面が異奥行きで2 Column に分離し、奥行き昇順に並ぶ', () => {
    const s = col(cols, 'south', 2);
    expect(s.length).toBe(2);
    // 実値: 内側 depth=270（手前）、外側 depth=450（奥）
    expect(s.map(c => c.depthCoord)).toEqual([270, 450]);
    // 内側 south: x[90,450] rails[1800,1800]
    expect(s[0].xStart).toBe(90);
    expect(s[0].xEnd).toBe(450);
    expect(s[0].rails).toEqual([1800, 1800]);
    // 外側 south: x[-90,270] rails[1800,1800]
    expect(s[1].xStart).toBe(-90);
    expect(s[1].xEnd).toBe(270);
    expect(s[1].rails).toEqual([1800, 1800]);
  });

  it('東面も異奥行きで2 Column に分離（内側 x=270・外側 x=450）', () => {
    const e = col(cols, 'east', 2);
    expect(e.length).toBe(2);
    expect(e.map(c => c.depthCoord)).toEqual([270, 450]);
  });

  it('北・西は単一 Column', () => {
    expect(col(cols, 'north', 2).length).toBe(1);
    expect(col(cols, 'west', 2).length).toBe(1);
  });
});

describe('reconstructFaces: 下屋 L字（floor=1 のみ）', () => {
  // 下屋（1F せり出し）が南・東だけにある想定。floor=1 で復元される。
  const handrails: Handrail[] = [
    hr(0, 450, 1800, 'horizontal', 1), hr(180, 450, 1800, 'horizontal', 1),   // 南下屋 y=450, x[0,360]
    hr(450, 0, 1800, 'vertical', 1), hr(450, 180, 1800, 'vertical', 1),       // 東下屋 x=450, y[0,360]
  ];
  const cols = reconstructFaces(handrails);

  it('全 Column が floor=1', () => {
    expect(cols.length).toBe(2);
    expect(cols.every(c => c.floor === 1)).toBe(true);
  });

  it('南・東の下屋辺が正しい面・区間で出る', () => {
    const [s] = col(cols, 'south', 1);
    expect(s.depthCoord).toBe(450);
    expect(s.xStart).toBe(0);
    expect(s.xEnd).toBe(360);
    expect(s.rails).toEqual([1800, 1800]);

    const [e] = col(cols, 'east', 1);
    expect(e.depthCoord).toBe(450);
    expect(e.xStart).toBe(0);
    expect(e.xEnd).toBe(360);
  });

  it('北・西は空', () => {
    expect(col(cols, 'north', 1).length).toBe(0);
    expect(col(cols, 'west', 1).length).toBe(0);
  });
});

describe('reconstructFaces: 手置き手摺の混在（A案の狙い）', () => {
  // 矩形リングの北面に、手で 600 を1本足す（自動割付の連続線を延長）。
  const ring = rectRing(1);
  const hand = hr(450, -90, 600, 'horizontal', 1, 'HAND'); // 北面 x=450 端に手置き 600
  const cols = reconstructFaces([...ring, hand]);

  it('手置き 600 が北面 rails に可変軸順で混ざる', () => {
    const [n] = col(cols, 'north', 1);
    expect(n.rails).toEqual([1800, 1800, 1800, 600]);
    expect(n.handrailIds[n.handrailIds.length - 1]).toBe('HAND');
    expect(n.xEnd).toBe(510); // 450 + 60(=600mm)
  });
});

describe('reconstructFaces: 斜め手摺・空図面（除外・非破壊）', () => {
  it('空配列は空を返す', () => {
    expect(reconstructFaces([])).toEqual([]);
  });

  it('斜め手摺のみは除外され空', () => {
    expect(reconstructFaces([hr(0, 0, 1800, 45, 1)])).toEqual([]);
  });

  it('矩形リング＋斜め1本: 斜めは rails に入らず、面数は不変', () => {
    const ring = rectRing(1);
    const diag = hr(0, 0, 1800, 30, 1, 'DIAG');
    const cols = reconstructFaces([...ring, diag]);
    expect(cols.length).toBe(4);
    const allIds = cols.flatMap(c => c.handrailIds);
    expect(allIds).not.toContain('DIAG');
  });
});

describe('associatePartsToFace: 支柱・踏板の面対応付け（E-2 準備）', () => {
  // 北面（y=-90, x[-90,450]）の depth 線上に支柱と踏板を置く。
  const column: FaceSpanColumn = {
    face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
    rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
  };
  const posts: Post[] = [
    { id: 'p1', x: -90, y: -90, floor: 1 },  // 面上
    { id: 'p2', x: 90, y: -90, floor: 1 },   // 面上
    { id: 'p3', x: 90, y: 630, floor: 1 },   // 南面（対象外）
    { id: 'p4', x: 90, y: -90, floor: 2 },   // 別階（対象外）
  ];
  const antis: Anti[] = [
    { id: 'an1', x: -90, y: -90, width: 400, lengthMm: 1800, direction: 'horizontal', floor: 1 },
    { id: 'an2', x: 90, y: 630, width: 400, lengthMm: 1800, direction: 'horizontal', floor: 1 }, // 南（対象外）
  ];

  it('同 floor・depth 近接・区間内の支柱のみ拾い、昇順', () => {
    const { postCoords } = associatePartsToFace(column, posts, antis);
    expect(postCoords).toEqual([-90, 90]);
  });

  it('同面の踏板区間を拾う', () => {
    const { antiSpans } = associatePartsToFace(column, posts, antis);
    expect(antiSpans.length).toBe(1);
    expect(antiSpans[0].id).toBe('an1');
    expect(antiSpans[0].start).toBe(-90);
    expect(antiSpans[0].end).toBe(90); // -90 + 180(=1800mm)
  });
});
