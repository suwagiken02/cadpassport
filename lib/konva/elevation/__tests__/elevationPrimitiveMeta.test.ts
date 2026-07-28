import { describe, it, expect } from 'vitest';
import type { BuildingShape, ElevationEdit, ElevationPrimitiveKind, HeightMarker, Point } from '@/types';
import type { FaceSpanColumn } from '../faceReconstruction';
import { buildFaceElevation } from '../elevationEngine';
import { faceElevationToPrimitives } from '../elevationToObjects';

// ============================================================
// E-8a: 立面プリミティブの意味タグ・安定 id・再マッチ用ヒント。
// 部材単位の編集（選択/削除/移動）と、再生成時の差分引き継ぎの土台。
// 幾何・色・順序は従来どおり（既存の elevationToObjects.test.ts が不変で通ることで担保）。
// ============================================================
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 540 }, { x: 0, y: 540 }];
const bld = (id: string): BuildingShape => ({ id, type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 });
const northCol: FaceSpanColumn = {
  face: 'north', floor: 1, depthCoord: -90, xStart: -90, xEnd: 450,
  rails: [1800, 1800, 1800], handrailIds: ['a', 'b', 'c'],
};

const fe = buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 });
const prims = faceElevationToPrimitives(fe);
const metas = prims.map((p) => p.meta);
const idsOf = (kind: ElevationPrimitiveKind) =>
  prims.filter((p) => p.meta?.kind === kind).map((p) => p.meta!.id);

describe('E-8a: 全プリミティブに meta が付く', () => {
  it('meta の無いプリミティブは無い', () => {
    expect(prims.length).toBeGreaterThan(0);
    expect(metas.every((m) => m != null)).toBe(true);
  });

  it('id はビュー内で一意', () => {
    const ids = metas.map((m) => m!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('主要な意味タグが揃う（建物・支柱・ジャッキ・踏板・手摺・GL・寸法）', () => {
    const kinds = new Set(metas.map((m) => m!.kind));
    for (const k of ['building', 'post', 'jack', 'board', 'rail', 'gl', 'dim', 'dimText', 'text'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
  });
});

describe('E-8a: 安定 id と再マッチ用ヒント', () => {
  it('支柱は列と番号で id が決まり、面軸座標のヒントを持つ', () => {
    expect(idsOf('post')).toEqual(['post:0:0', 'post:0:1', 'post:0:2', 'post:0:3']);
    const p0 = prims.find((p) => p.meta?.id === 'post:0:0')!;
    expect(p0.meta!.index).toBe(0);
    expect(p0.meta!.x).toBe(0);          // 左端（minXg=-90 基準）
    expect(p0.meta!.heightMm).toBe(6500); // 天端
  });

  it('踏板・手摺は高さ(mm)を持ち、id にも高さが入る', () => {
    const boards = prims.filter((p) => p.meta?.kind === 'board');
    expect(boards.map((p) => p.meta!.heightMm)).toEqual([1100, 2900, 4700]);
    expect(boards[0].meta!.id).toBe('board:0:1100:0');
    const rails = prims.filter((p) => p.meta?.kind === 'rail');
    expect(rails.every((p) => typeof p.meta!.heightMm === 'number')).toBe(true);
    expect(rails[0].meta!.id.startsWith('rail:0:')).toBe(true);
  });

  it('建物シルエットは建物 id と段番号を持つ', () => {
    const b = prims.find((p) => p.meta?.kind === 'building')!;
    expect(b.meta!.id).toBe('building:B:0');
    expect(b.meta!.buildingId).toBe('B');
    expect(b.meta!.heightMm).toBe(6500);
  });

  it('寸法は段番号つき、天端は固定 id', () => {
    expect(idsOf('dim')).toContain('dim:v');
    expect(idsOf('dim')).toContain('dim:level:0');
    expect(idsOf('dim')).toContain('dim:top');
    expect(idsOf('dimText')).toContain('dimText:top');
    const lv0 = prims.find((p) => p.meta?.id === 'dimText:level:0')!;
    expect(lv0.meta!.heightMm).toBe(1100);
    expect(lv0.kind === 'text' && lv0.text).toBe('スタート 1100');
  });

  it('GL 線と GL 文字は固定 id', () => {
    expect(idsOf('gl')).toEqual(['gl']);
    expect(idsOf('text')).toContain('gl:text');
  });

  it('同じ入力なら id は再生成しても同じ（安定 id）', () => {
    const again = faceElevationToPrimitives(buildFaceElevation([northCol], [bld('B')], { defaultHeightMm: 6500 }));
    expect(again.map((p) => p.meta!.id)).toEqual(prims.map((p) => p.meta!.id));
  });
});

describe('E-8a: 嵩上げ・屋根バンドのタグ', () => {
  // 南辺中央が高い（への字）→ 妻面で嵩上げが出る。屋根バンドも棟マーカーで出す。
  const markers: HeightMarker[] = [
    { id: 's0', buildingId: 'G', edgeIndex: 2, t: 0, heightMm: 5000 },
    { id: 'sm', buildingId: 'G', edgeIndex: 2, t: 0.5, heightMm: 9000 },
    { id: 's1', buildingId: 'G', edgeIndex: 2, t: 1, heightMm: 5000 },
  ];
  const southCol: FaceSpanColumn = {
    face: 'south', floor: 1, depthCoord: 540, xStart: 0, xEnd: 360,
    rails: [1800, 1800], handrailIds: ['a', 'b'],
  };
  const feG = buildFaceElevation([southCol], [bld('G')], { markers });
  const primsG = faceElevationToPrimitives(feG);

  it('嵩上げの段違い床は raise タグ（床＋手摺2本の3点セット）', () => {
    const raises = primsG.filter((p) => p.meta?.kind === 'raise');
    expect(raises.length).toBeGreaterThan(0);
    expect(raises.every((p) => p.meta!.id.startsWith('raise:0:'))).toBe(true);
    expect(raises.some((p) => p.meta!.id.endsWith(':board'))).toBe(true);
    expect(raises.some((p) => p.meta!.id.endsWith(':rail450'))).toBe(true);
  });

  it('id はここでも一意', () => {
    const ids = primsG.map((p) => p.meta!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('E-8a: ElevationEdit 型（差分の器）', () => {
  it('4 種の op を表現できる（型の受け入れ確認）', () => {
    const edits: ElevationEdit[] = [
      { op: 'hide', targetId: 'post:0:1' },
      { op: 'move', targetId: 'board:0:1100:0', dx: 2, dy: -1 },
      { op: 'text', targetId: 'dimText:top', text: '天端 6600' },
      { op: 'add', primitive: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#fff', width: 1, meta: { kind: 'rail', id: 'add:1' } } },
    ];
    expect(edits).toHaveLength(4);
    expect(edits[3].op === 'add' && edits[3].primitive.meta?.id).toBe('add:1');
  });
});
