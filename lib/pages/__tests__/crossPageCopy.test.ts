import { describe, it, expect } from 'vitest';
import type { CanvasData, Point } from '@/types';
import { buildCrossPagePayload, mergePayloadIntoCanvas, payloadCount } from '../crossPageCopy';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

/** テスト用 CanvasData（建物B1に roofOverhang/marker/ridge が紐づく、独立の handrail/memo/立面あり）。 */
function makeCanvas(): CanvasData {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [
      { id: 'B1', type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 },
      { id: 'B2', type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 },
    ],
    roofOverhangs: [{ id: 'RO1', buildingId: 'B1', faceIndex: 0, overhangMm: 600 }],
    obstacles: [],
    handrails: [{ id: 'H1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#4ECDC4', floor: 1 }],
    posts: [],
    antis: [],
    memos: [{ id: 'M1', x: 5, y: 5, text: 'メモ', style: 'default' }],
    compass: { angle: 0 },
    heightMarkers: [{ id: 'HM1', buildingId: 'B1', edgeIndex: 0, t: 0.5, heightMm: 5000 }],
    ridgeLines: [{ id: 'RL1', buildingId: 'B1', p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 }, heightMm: 6000 }],
    elevationViews: [{ id: 'EV1', face: 'north', originGrid: { x: 200, y: 100 }, scale: 1, primitives: [] }],
  };
}

/** 決定的 id 生成器（n1, n2, …）。 */
function seqGen() {
  let n = 0;
  return () => `n${++n}`;
}

describe('buildCrossPagePayload (E-6b)', () => {
  it('建物選択で依存(roof/marker/ridge)を自動同梱し buildingId を新 id に追随', () => {
    const cv = makeCanvas();
    const { payload } = buildCrossPagePayload(cv, ['B1'], seqGen());
    expect(payload.buildings).toHaveLength(1);
    const newBid = payload.buildings[0].id;
    expect(newBid).not.toBe('B1');
    // 依存が自動同梱され、buildingId が新 id を指す
    expect(payload.roofOverhangs).toHaveLength(1);
    expect(payload.roofOverhangs[0].buildingId).toBe(newBid);
    expect(payload.heightMarkers).toHaveLength(1);
    expect(payload.heightMarkers[0].buildingId).toBe(newBid);
    expect(payload.ridgeLines).toHaveLength(1);
    expect(payload.ridgeLines[0].buildingId).toBe(newBid);
    // 依存自身の id も振り直される
    expect(payload.heightMarkers[0].id).not.toBe('HM1');
    expect(payload.ridgeLines[0].id).not.toBe('RL1');
  });

  it('全 id が新規（元 id と重複しない）', () => {
    const cv = makeCanvas();
    const { payload } = buildCrossPagePayload(cv, ['B1'], seqGen());
    const ids = [
      ...payload.buildings, ...payload.roofOverhangs, ...payload.heightMarkers, ...payload.ridgeLines,
    ].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length); // 一意
    expect(ids).not.toContain('B1');
    expect(ids).not.toContain('HM1');
  });

  it('sourceIds は選択建物＋自動同梱依存の元 id（移動削除対象）', () => {
    const cv = makeCanvas();
    const { sourceIds } = buildCrossPagePayload(cv, ['B1'], seqGen());
    expect(sourceIds.sort()).toEqual(['B1', 'HM1', 'RL1', 'RO1'].sort());
  });

  it('選択されていない建物(B2)の依存は運ばない', () => {
    const cv = makeCanvas();
    const { payload } = buildCrossPagePayload(cv, ['B1'], seqGen());
    // B2 由来のものは無い（依存は全て B1 紐付けのみ）
    expect(payload.buildings.map((b) => b.points)).toEqual([RECT]);
  });

  it('立面(elevationView)は単体で新 id コピー、buildingId 参照なし', () => {
    const cv = makeCanvas();
    const { payload, sourceIds } = buildCrossPagePayload(cv, ['EV1'], seqGen());
    expect(payload.elevationViews).toHaveLength(1);
    expect(payload.elevationViews[0].id).toBe('n1');
    expect(payload.elevationViews[0].face).toBe('north');
    expect(sourceIds).toEqual(['EV1']);
    // 建物を選んでいないので依存は空
    expect(payload.buildings).toHaveLength(0);
    expect(payload.ridgeLines).toHaveLength(0);
  });

  it('独立オブジェクト(handrail/memo)は選択 id のみ', () => {
    const cv = makeCanvas();
    const { payload, sourceIds } = buildCrossPagePayload(cv, ['H1', 'M1'], seqGen());
    expect(payload.handrails).toHaveLength(1);
    expect(payload.memos).toHaveLength(1);
    expect(payload.handrails[0].id).not.toBe('H1');
    expect(sourceIds.sort()).toEqual(['H1', 'M1']);
  });

  it('deep clone: コピー元を変更してもペイロードに影響しない', () => {
    const cv = makeCanvas();
    const { payload } = buildCrossPagePayload(cv, ['B1'], seqGen());
    cv.buildings[0].points[0].x = 999;
    expect(payload.buildings[0].points[0].x).toBe(0);
  });
});

describe('mergePayloadIntoCanvas / payloadCount (E-6b)', () => {
  it('対象 canvas に配列 append（既存を保持）', () => {
    const src = makeCanvas();
    const { payload } = buildCrossPagePayload(src, ['B1', 'H1'], seqGen());
    const target: CanvasData = { ...makeCanvas(), buildings: [], handrails: [], roofOverhangs: [], heightMarkers: [], ridgeLines: [] };
    const merged = mergePayloadIntoCanvas(target, payload);
    expect(merged.buildings).toHaveLength(1);
    expect(merged.handrails).toHaveLength(1);
    expect(merged.roofOverhangs).toHaveLength(1);
    expect(merged.heightMarkers).toHaveLength(1);
    expect(merged.ridgeLines).toHaveLength(1);
  });

  it('payloadCount は総数（依存含む）', () => {
    const cv = makeCanvas();
    const { payload } = buildCrossPagePayload(cv, ['B1'], seqGen());
    // B1 + RO1 + HM1 + RL1 = 4
    expect(payloadCount(payload)).toBe(4);
  });
});
