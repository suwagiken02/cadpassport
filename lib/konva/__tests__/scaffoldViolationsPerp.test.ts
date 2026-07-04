import { describe, it, expect } from 'vitest';
import { findScaffoldViolations, type ScaffoldHandrail } from '../scaffoldViolations';

// ============================================================
// S-5e-4(宿題②): 直交超過 'perpendicular-overshoot' の検出。
//   縦→横の角超過（一方の端点が他方の固定軸線を角を越えて span 内部まで貫く）を検出。
//   正常な L 字接合(端点=角で出会う)・角ラップ(自分向きに離れ分伸びる)は非該当。
// 手摺座標: x,y は grid(1grid=10mm), lengthMm は mm。
// ============================================================

const perp = (v: ScaffoldHandrail[]) => findScaffoldViolations(v).filter(x => x.kind === 'perpendicular-overshoot');

describe('perpendicular-overshoot 検出', () => {
  it('U字物件の垂直→水平 50mm 超過を検出（S-2d で violations=0 と見逃したケースの再現）', () => {
    // 水平 下屋辺 H: y=0, x∈[0,1000]mm。
    const H: ScaffoldHandrail = { x: 0, y: 0, lengthMm: 1000, direction: 'horizontal' };
    // 垂直 west 辺 V: x=500mm(H の内部), y∈[-50,800]mm ＝ H の線(y=0)を 50mm 南へ貫く超過。
    const V: ScaffoldHandrail = { x: 50, y: -5, lengthMm: 850, direction: 'vertical' };
    const vio = perp([H, V]);
    expect(vio).toHaveLength(1);
    expect(vio[0].amountMm).toBe(50);
    expect(vio[0].coord).toEqual([500, 0]); // 交点(px,py)=(V.x, H.y)
  });

  it('正常な L 字接合（端点=角で出会う）は非検出', () => {
    // H: y=0, x∈[0,1000]。V: x=0(=H 左端=角), y∈[0,800]。交点(0,0)は両者の端点。
    const H: ScaffoldHandrail = { x: 0, y: 0, lengthMm: 1000, direction: 'horizontal' };
    const V: ScaffoldHandrail = { x: 0, y: 0, lengthMm: 800, direction: 'vertical' };
    expect(perp([H, V])).toEqual([]);
  });

  it('角ラップ（V が角を越えて自分向きに 900mm 伸びる）は非検出', () => {
    // V が角(0,0)から下へ 900mm ラップ。交点(0,0)は H の端点(角)なので非該当。
    const H: ScaffoldHandrail = { x: 0, y: 0, lengthMm: 1000, direction: 'horizontal' };
    const V: ScaffoldHandrail = { x: 0, y: -90, lengthMm: 1700, direction: 'vertical' }; // y∈[-900,800]
    expect(perp([H, V])).toEqual([]);
  });

  it('離れて交差しない直交ペア（100mm ギャップ）は非検出', () => {
    const H: ScaffoldHandrail = { x: 0, y: 0, lengthMm: 1000, direction: 'horizontal' };
    const V: ScaffoldHandrail = { x: 50, y: 1, lengthMm: 800, direction: 'vertical' }; // y∈[10,810], H(y=0)に届かない
    expect(perp([H, V])).toEqual([]);
  });

  it('平行ペアは (d) の対象外（perpendicular-overshoot は出さない）', () => {
    const A: ScaffoldHandrail = { x: 0, y: 0, lengthMm: 1000, direction: 'horizontal' };
    const B: ScaffoldHandrail = { x: 0, y: 5, lengthMm: 1000, direction: 'horizontal' };
    expect(perp([A, B])).toEqual([]);
  });

  it('清潔な回字（4辺 L 字接合のみ）は誤検出 0', () => {
    // 矩形の 4 辺が端点で接合。交差なし。
    const rails: ScaffoldHandrail[] = [
      { x: 0, y: 0, lengthMm: 1000, direction: 'horizontal' },   // 上辺 y=0 x[0,1000]
      { x: 100, y: 0, lengthMm: 1000, direction: 'vertical' },   // 右辺 x=1000 y[0,1000]
      { x: 0, y: 100, lengthMm: 1000, direction: 'horizontal' }, // 下辺 y=1000 x[0,1000]
      { x: 0, y: 0, lengthMm: 1000, direction: 'vertical' },     // 左辺 x=0 y[0,1000]
    ];
    expect(perp(rails)).toEqual([]);
  });
});
