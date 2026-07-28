import { describe, it, expect } from 'vitest';
import {
  BANGAI_MAX_MM, arrangeTsumawari, classifyFractions, generateTsumawariCandidates,
} from '../tsumawari';

// ============================================================
// M-1a: 妻割（センター割り）。足場電卓で確定済みの実例を固定する。
// 面内の並べ替えなので合計は不変＝離れ・端点接続の絶対制約に影響しない。
// ============================================================
const METRIC = [1800, 1200, 900, 600, 400, 300, 200];

describe('classifyFractions（端数の分類）', () => {
  it('番外はメートル系 ≤300（305 のインチ番外も含む）', () => {
    expect(classifyFractions([200, 300]).bangai).toEqual([200, 300]);
    expect(classifyFractions([305, 410]).bangai).toEqual([305]);
    expect(BANGAI_MAX_MM).toBe(305);
  });
  it('異なる2枚=ニコイチ / 同じ2枚=同数ペア / 1枚=単独', () => {
    expect(classifyFractions([400, 900]).kind).toBe('nikoichi');
    expect(classifyFractions([600, 600]).kind).toBe('pair');
    expect(classifyFractions([900]).kind).toBe('single');
    expect(classifyFractions([]).kind).toBe('none');
    expect(classifyFractions([200, 200]).kind).toBe('bangai');
    expect(classifyFractions([400, 600, 900]).kind).toBe('mixed');
  });
});

describe('arrangeTsumawari（配置ルール）', () => {
  it('ニコイチは中央に隣接、左右は 1800 の対称ブロック', () => {
    const a = arrangeTsumawari([1800, 1800, 1800, 1800, 900, 400]);
    expect(a.rails).toEqual([1800, 1800, 400, 900, 1800, 1800]);
    expect(a.kind).toBe('nikoichi');
    expect(a.totalMm).toBe(8500);
  });

  it('番外は両端専用・残る単独端数は中央（メイン偶数本なら対称になる）', () => {
    const a = arrangeTsumawari([1800, 1800, 1800, 1800, 900, 200, 200]);
    expect(a.rails).toEqual([200, 1800, 1800, 900, 1800, 1800, 200]);
    expect(a.symmetric).toBe(true);
    expect(a.totalMm).toBe(8500);
  });

  it('同数ペアは両端に1枚ずつ振り分けて対称', () => {
    const a = arrangeTsumawari([1800, 1800, 1800, 1800, 1800, 1500, 1500]);
    expect(a.rails).toEqual([1500, 1800, 1800, 1800, 1800, 1800, 1500]);
    expect(a.kind).toBe('pair');
    expect(a.symmetric).toBe(true);
    expect(a.totalMm).toBe(12000);
  });

  it('単独端数はメインが奇数本なら端へ寄せ、メインの連続ブロックを崩さない', () => {
    const a = arrangeTsumawari([1800, 1800, 1800, 900]);
    expect(a.rails).toEqual([900, 1800, 1800, 1800]);
    expect(a.kind).toBe('single');
  });

  it('端数なしはメインのみ（そのまま対称）', () => {
    const a = arrangeTsumawari([1800, 1800, 1800, 1800]);
    expect(a.rails).toEqual([1800, 1800, 1800, 1800]);
    expect(a.kind).toBe('none');
    expect(a.symmetric).toBe(true);
  });

  it('入力順は問わない（多重集合として扱う）', () => {
    const a = arrangeTsumawari([400, 1800, 900, 1800, 1800, 1800]);
    expect(a.rails).toEqual([1800, 1800, 400, 900, 1800, 1800]);
  });

  it('並べ替えても合計は不変（離れ・端点接続に影響しない）', () => {
    const src = [1800, 1800, 1800, 1800, 900, 200, 200];
    const a = arrangeTsumawari(src);
    expect(a.rails.reduce((x, y) => x + y, 0)).toBe(src.reduce((x, y) => x + y, 0));
    expect([...a.rails].sort()).toEqual([...src].sort()); // 多重集合も不変
  });

  it('空入力は空', () => {
    expect(arrangeTsumawari([]).rails).toEqual([]);
  });
});

describe('generateTsumawariCandidates（順位付け）', () => {
  it('8500 標準: 1位=[1800,1800,400,900,1800,1800] / 2位=[200,1800,1800,900,1800,1800,200]', () => {
    const cands = generateTsumawariCandidates(8500, METRIC);
    expect(cands[0].rails).toEqual([1800, 1800, 400, 900, 1800, 1800]);
    expect(cands[1].rails).toEqual([200, 1800, 1800, 900, 1800, 1800, 200]);
    // 端数が少ない順（1位は端数2本、2位は3本）
    expect(cands[0].fractionCount).toBe(2);
    expect(cands[1].fractionCount).toBe(3);
  });

  it('候補はすべて合計ちょうど', () => {
    for (const c of generateTsumawariCandidates(8500, METRIC).slice(0, 20)) {
      expect(c.totalMm).toBe(8500);
    }
  });

  it('12000: メイン 1800 だけで割り切れない分をペアで両端へ', () => {
    const cands = generateTsumawariCandidates(12000, METRIC);
    // 1800×6 + 1200 は端数1本 → 最上位
    expect(cands[0].rails.reduce((a, b) => a + b, 0)).toBe(12000);
    expect(cands[0].fractionCount).toBeLessThanOrEqual(1);
  });

  it('1800 の倍数は端数なしが最上位', () => {
    const cands = generateTsumawariCandidates(7200, METRIC);
    expect(cands[0].rails).toEqual([1800, 1800, 1800, 1800]);
    expect(cands[0].kind).toBe('none');
  });

  it('割れない長さは空配列', () => {
    expect(generateTsumawariCandidates(150, METRIC)).toEqual([]);
    expect(generateTsumawariCandidates(0, METRIC)).toEqual([]);
  });

  it('インチ規格でも動く（番外 305/200）', () => {
    const INCH = [1829, 1524, 1219, 914, 610, 410, 305, 200];
    const cands = generateTsumawariCandidates(1829 * 4 + 305 * 2, INCH);
    expect(cands[0].totalMm).toBe(1829 * 4 + 610);
    expect(cands[0].rails.reduce((a, b) => a + b, 0)).toBe(1829 * 4 + 610);
  });
});
