// ============================================================
// P-1-fix3: DXF 出力に階段・単管が含まれること。
//
// P-1(4e7f862)で階段・単管を各所に登録したとき、dxfExport だけが対象外で、
// DXF に出ていなかった。ここで出力内容を固定し、同時に
// 「既存部材（手摺・支柱・アンチ・freeParts）の出力が変わらないこと」も押さえる。
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildDxf } from '../dxfExport';
import { gridToMm } from '@/lib/konva/gridUtils';
import { pipeEndpointsGrid, stairCornersGrid } from '@/lib/konva/planeParts';
import { newFreePart } from '@/lib/konva/freeParts';
import type { CanvasData, Pipe, Stair } from '@/types';

const base = (over: Partial<CanvasData> = {}): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
  ...over,
} as CanvasData);

/** 既存部材ひとそろい（回帰の基準）。 */
const legacy = (): Partial<CanvasData> => ({
  handrails: [{ id: 'h1', x: 10, y: 20, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
  posts: [{ id: 'p1', x: 5, y: 6 }],
  antis: [{ id: 'a1', x: 1, y: 2, width: 400, lengthMm: 1800, direction: 'horizontal' }],
  memos: [{ id: 'm1', x: 3, y: 4, text: 'メモ' }],
} as Partial<CanvasData>);

const stair: Stair = { id: 'st1', x: 60, y: 180, angleDeg: 0 };
const pipe: Pipe = { id: 'pp1', x: 20, y: 30, lengthMm: 3000, angleDeg: 45 };

/** レイヤー名で書かれたエンティティだけを数える。 */
const countOn = (dxf: string, layer: string, type: string) =>
  (dxf.match(new RegExp(`0\\n${type}\\n8\\n${layer}\\n`, 'g')) ?? []).length;

describe('階段が DXF に出る', () => {
  const dxf = buildDxf(base({ stairs: [stair] }));

  it('STAIR レイヤーが定義される', () => {
    expect(dxf).toMatch(/0\nLAYER\n2\nSTAIR\n/);
  });

  it('外形が閉じたポリラインで出る', () => {
    expect(countOn(dxf, 'STAIR', 'LWPOLYLINE')).toBe(1);
    // 4 隅がキャンバスの描画と同じ座標
    for (const c of stairCornersGrid(stair)) {
      expect(dxf).toContain(`10\n${gridToMm(c.x)}\n20\n${gridToMm(c.y)}\n`);
    }
  });

  it('段板の区切りと上り矢印（矢じり込み）が線で出る', () => {
    // 段板 5 本 ＋ 矢印の軸 1 本 ＋ 矢じり 2 本
    expect(countOn(dxf, 'STAIR', 'LINE')).toBe(5 + 1 + 2);
  });

  it('向きを変えると出力が変わる（横長になる）', () => {
    const a = buildDxf(base({ stairs: [{ ...stair, angleDeg: 0 }] }));
    const b = buildDxf(base({ stairs: [{ ...stair, angleDeg: 90 }] }));
    expect(b).not.toBe(a);
    for (const c of stairCornersGrid({ ...stair, angleDeg: 90 })) {
      expect(b).toContain(`10\n${gridToMm(c.x)}\n20\n${gridToMm(c.y)}\n`);
    }
  });

  it('上り反転で出力が変わる（矢印の向きが乗っている）', () => {
    const normal = buildDxf(base({ stairs: [{ ...stair, flip: false }] }));
    const flipped = buildDxf(base({ stairs: [{ ...stair, flip: true }] }));
    expect(flipped).not.toBe(normal);
    // 外形は同じ（向きだけが違う）
    for (const c of stairCornersGrid(stair)) {
      expect(flipped).toContain(`10\n${gridToMm(c.x)}\n20\n${gridToMm(c.y)}\n`);
    }
  });

  it('複数枚でも全部出る', () => {
    const d = buildDxf(base({ stairs: [stair, { ...stair, id: 'st2', x: 600 }] }));
    expect(countOn(d, 'STAIR', 'LWPOLYLINE')).toBe(2);
  });
});

describe('単管が DXF に出る', () => {
  const dxf = buildDxf(base({ pipes: [pipe] }));

  it('PIPE レイヤーが定義される', () => {
    expect(dxf).toMatch(/0\nLAYER\n2\nPIPE\n/);
  });

  it('線 1 本で出る（手摺と同じ粒度）', () => {
    expect(countOn(dxf, 'PIPE', 'LINE')).toBe(1);
  });

  it('長さと角度が座標に反映される', () => {
    const [a, b] = pipeEndpointsGrid(pipe);
    expect(dxf).toContain(
      `0\nLINE\n8\nPIPE\n10\n${gridToMm(a.x)}\n20\n${gridToMm(a.y)}\n11\n${gridToMm(b.x)}\n21\n${gridToMm(b.y)}\n`,
    );
  });

  it('長さを変えれば終点が変わる', () => {
    const short = buildDxf(base({ pipes: [{ ...pipe, lengthMm: 1000 }] }));
    const long = buildDxf(base({ pipes: [{ ...pipe, lengthMm: 6000 }] }));
    expect(short).not.toBe(long);
  });

  it('角度を変えれば終点が変わる', () => {
    const a0 = buildDxf(base({ pipes: [{ ...pipe, angleDeg: 0 }] }));
    const a90 = buildDxf(base({ pipes: [{ ...pipe, angleDeg: 90 }] }));
    expect(a0).not.toBe(a90);
  });
});

describe('既存部材の出力は変わらない', () => {
  it('階段・単管が無ければ、追加前とまったく同じ内容（レイヤー定義以外）', () => {
    const withEmpty = buildDxf(base({ ...legacy(), stairs: [], pipes: [] }));
    const withUndefined = buildDxf(base(legacy()));
    expect(withEmpty).toBe(withUndefined);
    // 既存のエンティティはそのまま
    expect(countOn(withEmpty, 'HANDRAIL', 'LINE')).toBe(1);
    expect(countOn(withEmpty, 'POST', 'CIRCLE')).toBe(1);
    expect(countOn(withEmpty, 'ANTI', 'SOLID')).toBe(1);
    expect(countOn(withEmpty, 'MEMO', 'TEXT')).toBe(1);
    expect(countOn(withEmpty, 'STAIR', 'LWPOLYLINE')).toBe(0);
    expect(countOn(withEmpty, 'PIPE', 'LINE')).toBe(0);
  });

  it('階段・単管を足しても既存部材の行はそのまま', () => {
    const before = buildDxf(base(legacy()));
    const after = buildDxf(base({ ...legacy(), stairs: [stair], pipes: [pipe] }));
    for (const layer of ['HANDRAIL', 'POST', 'ANTI', 'MEMO']) {
      const type = layer === 'POST' ? 'CIRCLE' : layer === 'ANTI' ? 'SOLID' : layer === 'MEMO' ? 'TEXT' : 'LINE';
      expect(countOn(after, layer, type), layer).toBe(countOn(before, layer, type));
    }
    // 手摺の行そのものが残っている
    const hr = before.match(/0\nLINE\n8\nHANDRAIL\n[^]*?21\n[-\d.]+\n/)![0];
    expect(after).toContain(hr);
  });

  it('freeParts の出力は変わらない', () => {
    const fp = [newFreePart('rail', 'f1', { x: 100, y: 50 }, { sizeMm: 1800 })];
    const before = buildDxf(base({ freeParts: fp }));
    const after = buildDxf(base({ freeParts: fp, stairs: [stair], pipes: [pipe] }));
    expect(countOn(after, 'FREEPART', 'LINE')).toBe(countOn(before, 'FREEPART', 'LINE'));
    expect(countOn(before, 'FREEPART', 'LINE')).toBeGreaterThan(0);
  });

  it('DXF の骨格（セクション構造）は従来どおり', () => {
    const dxf = buildDxf(base({ ...legacy(), stairs: [stair], pipes: [pipe] }));
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER\n0\nENDSEC\n')).toBe(true);
    expect(dxf.endsWith('0\nENDSEC\n0\nEOF\n')).toBe(true);
    expect(dxf).toContain('0\nSECTION\n2\nENTITIES\n');
  });
});

describe('何も無いページ', () => {
  it('空でも壊れない', () => {
    const dxf = buildDxf(base());
    expect(dxf).toContain('0\nSECTION\n2\nENTITIES\n');
    expect(dxf.endsWith('0\nENDSEC\n0\nEOF\n')).toBe(true);
  });
});
