import { describe, it, expect } from 'vitest';
import type { CanvasData, Point } from '@/types';
import { collectSelectionSubset, instantiateSubset, payloadIds, payloadCount } from '../crossPageCopy';

const RECT: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

function makeCanvas(): CanvasData {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [{ id: 'B1', type: 'polygon', points: RECT.map((p) => ({ ...p })), fill: '#3d3d3a', floor: 1 }],
    roofOverhangs: [{ id: 'RO1', buildingId: 'B1', faceIndex: 0, overhangMm: 600 }],
    obstacles: [],
    handrails: [{ id: 'H1', x: 10, y: 10, lengthMm: 1800, direction: 'horizontal', color: '#4ECDC4', floor: 1 }],
    posts: [],
    antis: [],
    memos: [],
    compass: { angle: 0 },
    heightMarkers: [{ id: 'HM1', buildingId: 'B1', edgeIndex: 0, t: 0.5, heightMm: 5000 }],
    ridgeLines: [{ id: 'RL1', buildingId: 'B1', p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 }, heightMm: 6000 }],
    elevationViews: [],
  };
}

function seqGen() { let n = 0; return () => `n${++n}`; }

describe('collectSelectionSubset (E-6c)', () => {
  it('素の集合(id 振り直しなし)＋依存同梱＋origin(bbox左上)', () => {
    const cv = makeCanvas();
    const { subset, sourceIds, origin } = collectSelectionSubset(cv, ['B1', 'H1']);
    expect(subset.buildings[0].id).toBe('B1'); // まだ元 id
    expect(subset.ridgeLines).toHaveLength(1);
    expect(subset.heightMarkers).toHaveLength(1);
    expect(subset.roofOverhangs).toHaveLength(1);
    expect(subset.handrails).toHaveLength(1);
    // origin = min(建物 (0,0)…, 手摺 (10,10)) = (0,0)
    expect(origin).toEqual({ x: 0, y: 0 });
    expect(sourceIds.sort()).toEqual(['B1', 'H1', 'HM1', 'RL1', 'RO1'].sort());
  });

  it('deep clone: 元を変えても subset は不変', () => {
    const cv = makeCanvas();
    const { subset } = collectSelectionSubset(cv, ['B1']);
    cv.buildings[0].points[0].x = 999;
    expect(subset.buildings[0].points[0].x).toBe(0);
  });
});

describe('instantiateSubset: 貼り付け実体化 (E-6c)', () => {
  it('新 id 採番・buildingId 追随・位置オフセット適用', () => {
    const cv = makeCanvas();
    const { subset } = collectSelectionSubset(cv, ['B1', 'H1']);
    const out = instantiateSubset(subset, { x: 5, y: 7 }, seqGen());

    const newBid = out.buildings[0].id;
    expect(newBid).not.toBe('B1');
    // 建物頂点にオフセット
    expect(out.buildings[0].points[0]).toEqual({ x: 5, y: 7 });
    expect(out.buildings[0].points[1]).toEqual({ x: 105, y: 7 });
    // 手摺にオフセット
    expect(out.handrails[0]).toMatchObject({ x: 15, y: 17 });
    expect(out.handrails[0].id).not.toBe('H1');
    // 棟線: buildingId 追随＋端点オフセット
    expect(out.ridgeLines[0].buildingId).toBe(newBid);
    expect(out.ridgeLines[0].p1).toEqual({ x: 5, y: 57 });
    expect(out.ridgeLines[0].p2).toEqual({ x: 105, y: 57 });
    // 高さマーカー: buildingId 追随・パラメトリックなので座標オフセットなし(edgeIndex/t 不変)
    expect(out.heightMarkers[0].buildingId).toBe(newBid);
    expect(out.heightMarkers[0].edgeIndex).toBe(0);
    expect(out.heightMarkers[0].t).toBe(0.5);
    // roofOverhang: buildingId 追随
    expect(out.roofOverhangs[0].buildingId).toBe(newBid);
  });

  it('オフセット0は元位置と同じ', () => {
    const cv = makeCanvas();
    const { subset } = collectSelectionSubset(cv, ['B1']);
    const out = instantiateSubset(subset, { x: 0, y: 0 }, seqGen());
    expect(out.buildings[0].points).toEqual(RECT);
  });

  it('複数回実体化で id は毎回別（重複しない）', () => {
    const cv = makeCanvas();
    const { subset } = collectSelectionSubset(cv, ['B1', 'H1']);
    const a = payloadIds(instantiateSubset(subset, { x: 0, y: 0 }));
    const b = payloadIds(instantiateSubset(subset, { x: 0, y: 0 }));
    expect(a.some((id) => b.includes(id))).toBe(false);
    expect(payloadCount(instantiateSubset(subset, { x: 0, y: 0 }))).toBe(a.length);
  });
});
