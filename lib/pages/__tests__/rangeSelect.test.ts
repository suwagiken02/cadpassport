import { describe, it, expect } from 'vitest';
import type { CanvasData, Point } from '@/types';
import { collectIdsInRect, heightMarkerPoint } from '../rangeSelect';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

function makeCanvas(): CanvasData {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [{ id: 'B1', type: 'polygon', points: RECT, fill: '#3d3d3a', floor: 1 }],
    roofOverhangs: [],
    obstacles: [{ id: 'O1', type: 'aircon', x: 200, y: 200, width: 20, height: 20 }],
    handrails: [{ id: 'H1', x: 10, y: 10, lengthMm: 1800, direction: 'horizontal', color: '#4ECDC4', floor: 1 }],
    posts: [{ id: 'P1', x: 20, y: 20, floor: 1 }],
    antis: [{ id: 'A1', x: 30, y: 30, width: 400, lengthMm: 1800, direction: 'horizontal', floor: 1 }],
    memos: [{ id: 'M1', x: 40, y: 40, text: 'm', style: 'default' }],
    compass: { angle: 0 },
    magnetPins: [{ id: 'MP1', x: 50, y: 50 }],
    heightMarkers: [{ id: 'HM1', buildingId: 'B1', edgeIndex: 0, t: 0.5, heightMm: 5000 }],
    ridgeLines: [{ id: 'RL1', buildingId: 'B1', p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 }, heightMm: 6000 }],
    elevationViews: [{ id: 'EV1', face: 'north', originGrid: { x: 300, y: 300 }, scale: 1, primitives: [] }],
  };
}

describe('heightMarkerPoint', () => {
  it('outline 辺を (edgeIndex,t) で補間', () => {
    const b = makeCanvas().buildings[0];
    // edge0 = (0,0)-(100,0)、t=0.5 → (50,0)
    expect(heightMarkerPoint({ edgeIndex: 0, t: 0.5 }, b)).toEqual({ x: 50, y: 0 });
    // edge1 = (100,0)-(100,100)、t=0.25 → (100,25)
    expect(heightMarkerPoint({ edgeIndex: 1, t: 0.25 }, b)).toEqual({ x: 100, y: 25 });
  });
});

describe('collectIdsInRect (E-6c)', () => {
  const cv = makeCanvas();
  it('点系オブジェクト(足場・メモ)を矩形で拾う', () => {
    expect(collectIdsInRect(cv, { x: 5, y: 5, w: 40, h: 40 }).sort()).toEqual(['A1', 'H1', 'M1', 'P1']);
  });
  it('建物は頂点が矩形内なら選択', () => {
    expect(collectIdsInRect(cv, { x: -5, y: -5, w: 10, h: 10 })).toContain('B1');
  });
  it('高さマーカーは outline 補間点で判定', () => {
    // (50,0) を含む矩形
    expect(collectIdsInRect(cv, { x: 40, y: -5, w: 20, h: 10 })).toContain('HM1');
    // 建物頂点は含まない範囲
    expect(collectIdsInRect(cv, { x: 40, y: -5, w: 20, h: 10 })).not.toContain('B1');
  });
  it('障害物は中心で判定', () => {
    expect(collectIdsInRect(cv, { x: 205, y: 205, w: 10, h: 10 })).toEqual(['O1']);
  });
  it('立面ビューは originGrid で判定', () => {
    expect(collectIdsInRect(cv, { x: 295, y: 295, w: 10, h: 10 })).toEqual(['EV1']);
  });
  it('棟線は端点で判定', () => {
    expect(collectIdsInRect(cv, { x: -5, y: 45, w: 10, h: 10 })).toContain('RL1');
  });
  it('マグネットピンを拾う', () => {
    expect(collectIdsInRect(cv, { x: 45, y: 45, w: 10, h: 10 })).toContain('MP1');
  });
  it('範囲外は空', () => {
    expect(collectIdsInRect(cv, { x: 1000, y: 1000, w: 5, h: 5 })).toEqual([]);
  });
});
