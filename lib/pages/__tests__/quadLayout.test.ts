import { describe, it, expect } from 'vitest';
import type { ElevationPrimitive } from '@/types';
import {
  computeQuadLayout, elevationPrimitivesBounds, type Bounds, type FaceKey,
} from '../quadLayout';

const b = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });
const face = (f: FaceKey, bounds: Bounds | null) => ({ face: f, bounds });

// refDenom=100 の枠: frameW=2970, frameH=2100, gutter=60, pad=40
//   cellW=1455, cellH=1020, innerW=1375, innerH=940
describe('computeQuadLayout: 共通縮尺と origin (E-6e)', () => {
  it('標準的な建物(360×500)は 1/75、南=左上/東=右上/北=左下/西=右下', () => {
    const faces = (['south', 'east', 'north', 'west'] as FaceKey[]).map((f) => face(f, b(0, 0, 360, 500)));
    const layout = computeQuadLayout(faces)!;
    // scaleRaw=min(1375/360,940/500)=1.88 → 1/75(scale 1.333)
    expect(layout.scaleLabel).toBe('1/75');
    expect(layout.scale).toBeCloseTo(100 / 75, 5);
    const byFace = Object.fromEntries(layout.placements.map((p) => [p.face, p.originGrid]));
    // origin = round(cellX+pad - minX*scale, cellY+pad - minY*scale)、minX=minY=0
    expect(byFace.south).toEqual({ x: 40, y: 40 });                 // col0,row0
    expect(byFace.east).toEqual({ x: 1515 + 40, y: 40 });            // col1,row0
    expect(byFace.north).toEqual({ x: 40, y: 1080 + 40 });           // col0,row1
    expect(byFace.west).toEqual({ x: 1515 + 40, y: 1080 + 40 });     // col1,row1
  });

  it('大きい建物ほど縮尺分母が大きい(3000×2000 → 1/250)', () => {
    const faces = (['south', 'east', 'north', 'west'] as FaceKey[]).map((f) => face(f, b(0, 0, 3000, 2000)));
    expect(computeQuadLayout(faces)!.scaleLabel).toBe('1/250');
  });

  it('小さい建物は上限 1/50 でクランプ', () => {
    const faces = [face('south', b(0, 0, 10, 10))];
    expect(computeQuadLayout(faces)!.scaleLabel).toBe('1/50');
  });

  it('横長(幅制約)は幅で縮尺が決まる(1400×300 → 1/150)', () => {
    const faces = [face('south', b(0, 0, 1400, 300))];
    // scaleRaw=min(1375/1400,940/300)=0.982 → 0.667(1/150)
    expect(computeQuadLayout(faces)!.scaleLabel).toBe('1/150');
  });

  it('空の面(bounds=null)は配置しない・最大面で縮尺決定', () => {
    const faces = [face('south', b(0, 0, 360, 500)), face('east', null), face('north', b(0, 0, 3000, 2000)), face('west', null)];
    const layout = computeQuadLayout(faces)!;
    expect(layout.placements.map((p) => p.face).sort()).toEqual(['north', 'south']);
    // 最大面 3000×2000 で縮尺決定
    expect(layout.scaleLabel).toBe('1/250');
  });

  it('4面とも空なら null(配置不可)', () => {
    expect(computeQuadLayout([face('south', null), face('east', null)])).toBeNull();
  });

  it('base オフセットが全 origin に加算される', () => {
    const faces = [face('south', b(0, 0, 360, 500))];
    const layout = computeQuadLayout(faces, { base: { x: 1000, y: 2000 } })!;
    expect(layout.placements[0].originGrid).toEqual({ x: 1040, y: 2040 });
  });
});

describe('elevationPrimitivesBounds', () => {
  it('line/rect/polygon/text の全座標で bbox', () => {
    const prims: ElevationPrimitive[] = [
      { kind: 'line', x1: 0, y1: -10, x2: 5, y2: 0, stroke: '#000', width: 1 },
      { kind: 'polygon', points: [2, -20, 8, -20, 8, 0], fill: '#000' },
      { kind: 'text', x: -3, y: 3, text: 'GL', size: 9, fill: '#000' },
    ];
    expect(elevationPrimitivesBounds(prims)).toEqual({ minX: -3, minY: -20, maxX: 8, maxY: 3 });
  });
  it('空なら null', () => {
    expect(elevationPrimitivesBounds([])).toBeNull();
  });
});
