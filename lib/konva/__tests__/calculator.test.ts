import { describe, it, expect } from 'vitest';
import { evalExpr } from '../calculator';

describe('evalExpr（四則演算）', () => {
  it('加減乗除', () => {
    expect(evalExpr('1+2')).toBe(3);
    expect(evalExpr('7-9')).toBe(-2);
    expect(evalExpr('6*7')).toBe(42);
    expect(evalExpr('8/2')).toBe(4);
  });
  it('× ÷ が + − より先（優先順位）', () => {
    expect(evalExpr('2+3*4')).toBe(14);
    expect(evalExpr('2+3*4-5/2')).toBe(11.5);
    expect(evalExpr('10-2*3')).toBe(4);
  });
  it('連続演算', () => {
    expect(evalExpr('1+2+3+4')).toBe(10);
    expect(evalExpr('2*3*4')).toBe(24);
  });
  it('小数', () => {
    expect(evalExpr('0.5+0.25')).toBe(0.75);
    expect(evalExpr('1.5*2')).toBe(3);
  });
  it('先頭の負数', () => {
    expect(evalExpr('-3+5')).toBe(2);
    expect(evalExpr('-2*-3')).toBe(6);
  });
  it('ゼロ除算は null', () => {
    expect(evalExpr('5/0')).toBeNull();
    expect(evalExpr('1+2/0')).toBeNull();
  });
  it('空・不正式は null', () => {
    expect(evalExpr('')).toBeNull();
    expect(evalExpr('1+')).toBeNull();
    expect(evalExpr('*3')).toBeNull();
    expect(evalExpr('1++2')).toBeNull();
    expect(evalExpr('.')).toBeNull();
  });
});
